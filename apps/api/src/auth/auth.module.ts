import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  inferDefaultRoleFromDepartment,
  normalizeDigits,
  ROLES_METADATA,
} from '@zayed-mart/shared';
import type { Request, Response } from 'express';
import {
  createLoginRateLimiter,
  decryptPasswordForAdmin,
  getClientIp,
  verifyPinHash,
} from '../common/crypto.util';
import {
  AuthContext,
  CurrentAuth,
  Public,
  RequireAnyPermission,
} from '../common/decorators';
import { DatabaseService } from '../database/database.service';

const LOGIN_ROLE_ORDER = [
  'owner',
  'manager',
  'supervisor',
  'cashier',
  'cctv',
  'security',
  'hall',
  'warehouse',
  'delivery',
];

@Controller('api')
export class AuthController {
  private readonly rateLimiter = createLoginRateLimiter({
    maxAttempts: Number(process.env.ZAYED_MAX_LOGIN_ATTEMPTS || 5),
    windowMs: 180000,
    blockMs: Number(process.env.ZAYED_LOCKOUT_MS || 60000),
  });

  constructor(private readonly db: DatabaseService) {}

  @Public()
  @Get('auth/store-info')
  async getStoreInfo() {
    const settings = await this.db.getSettingsMap();
    return {
      ok: true,
      store_name: settings.store_name || 'زايد مارت',
      branch_name: settings.branch_name || 'الفرع الرئيسي',
      login_show_role_cards: settings.login_show_role_cards !== 'false',
    };
  }

  @Public()
  @Get('auth/profiles')
  async getProfiles() {
    const settings = await this.db.getSettingsMap();
    const showRoleCards = settings.login_show_role_cards !== 'false';
    let profiles: any[] = [];

    if (showRoleCards) {
      const [users, rolePolicies, employees, avatarMap] = await Promise.all([
        this.db.queryAll<any>(
          "SELECT * FROM system_users WHERE is_active = 1 AND role != 'kiosk' ORDER BY display_name ASC"
        ),
        this.db.queryAll<any>('SELECT * FROM role_policies'),
        this.db.queryAll<any>('SELECT * FROM employees WHERE is_active = 1'),
        this.db.loadProfileAvatarsMap(),
      ]);

      if (this.db.needsProfileAvatarFallback) {
        this.db.applyProfileAvatarMap(avatarMap, { users, employees, rolePolicies });
      }
      const policyMap = this.db.buildRolePoliciesMapWithFallback(rolePolicies, avatarMap);
      const empMap = new Map<string, any>(employees.map((e) => [e.id, e]));

      profiles = users
        .map((u) => {
          const roleMeta = ROLES_METADATA[u.role] || {
            label: u.role,
            shortLabel: u.role,
            icon: 'person',
            color: '#0B57D0',
          };
          const rp = policyMap.get(u.role) || null;
          const emp = u.employee_id ? empMap.get(u.employee_id) || null : null;
          const avatarUrl = this.db.resolveEffectiveAvatarUrl(u, emp, rp);
          const avatarPreset = String(
            u.avatar_preset || emp?.avatar_preset || rp?.avatar_preset || ''
          ).trim();
          return {
            id: u.id,
            role: u.role,
            role_label: roleMeta.label,
            role_short_label: roleMeta.shortLabel || roleMeta.label,
            role_icon: roleMeta.icon || 'person',
            display_name: u.display_name,
            avatar_url: avatarUrl,
            avatar_color: u.avatar_color || rp?.avatar_color || roleMeta.color || '#0B57D0',
            avatar_preset: avatarPreset,
            has_custom_photo: Boolean(avatarUrl),
          };
        })
        .sort((a, b) => {
          const ia = LOGIN_ROLE_ORDER.indexOf(a.role);
          const ib = LOGIN_ROLE_ORDER.indexOf(b.role);
          const ra = ia === -1 ? 99 : ia;
          const rb = ib === -1 ? 99 : ib;
          if (ra !== rb) return ra - rb;
          return String(a.display_name || '').localeCompare(String(b.display_name || ''), 'ar');
        });
    }

    return {
      ok: true,
      store_name: settings.store_name || 'زايد مارت',
      branch_name: settings.branch_name || 'الفرع الرئيسي',
      login_show_role_cards: showRoleCards,
      profiles,
    };
  }

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    try {
      const rawPassword = normalizeDigits(
        String(body?.password ?? body?.pin ?? '').trim()
      );
      const rawUsername = String(body?.username ?? '').trim().toLowerCase();
      const rawUserId = String(body?.user_id ?? '').trim();
      const ip = getClientIp(req);
      const isTargetedLogin = Boolean(rawUserId || rawUsername);
      const targetKey = isTargetedLogin
        ? `acct:${rawUserId || rawUsername}`
        : 'password_login';

      const blockCheck = this.rateLimiter.checkBlocked(ip, targetKey);
      if (blockCheck.blocked) {
        return res.status(429).json({
          ok: false,
          code: 'RATE_LIMITED',
          error: `تم إيقاف المحاولات مؤقتاً لحماية النظام. حاول بعد ${blockCheck.retryAfterSec} ثانية.`,
        });
      }

      if (!rawPassword) {
        return res.status(400).json({
          ok: false,
          error: 'يرجى إدخال كلمة المرور',
        });
      }

      let matchedUser: any = null;

      if (isTargetedLogin) {
        const candidate = rawUserId
          ? await this.db.queryOne<any>(
              'SELECT * FROM system_users WHERE id = ? AND is_active = 1 LIMIT 1',
              [rawUserId]
            )
          : await this.db.queryOne<any>(
              'SELECT * FROM system_users WHERE LOWER(username) = LOWER(?) AND is_active = 1 LIMIT 1',
              [rawUsername]
            );
        if (candidate && verifyPinHash(rawPassword, candidate.pin_salt, candidate.pin_hash)) {
          matchedUser = candidate;
        }
      } else {
        const activeUsers = await this.db.queryAll<any>(
          'SELECT * FROM system_users WHERE is_active = 1'
        );

        for (const candidate of activeUsers) {
          const isMatch = verifyPinHash(rawPassword, candidate.pin_salt, candidate.pin_hash);
          if (isMatch && !matchedUser) {
            matchedUser = candidate;
          }
        }

        // Only allow initial emp_code auto-provisioning if NO system_users account exists yet for that employee.
        // Once a system_users row exists, system_users.pin_hash is the single authoritative password!
        if (!matchedUser) {
          const matchedEmp = await this.db.queryOne<any>(
            `SELECT * FROM employees
             WHERE is_active = 1
               AND emp_code = ?
               AND COALESCE(login_enabled, 1) = 1
               AND COALESCE(system_role, '') != 'none'
               AND NOT EXISTS (SELECT 1 FROM system_users su WHERE su.employee_id = employees.id)
             LIMIT 1`,
            [rawPassword]
          );
          if (matchedEmp) {
            matchedUser = await this.db.syncEmployeeLoginAccount(matchedEmp);
          }
        }
      }

      if (!matchedUser) {
        const failInfo = this.rateLimiter.recordFailure(ip, targetKey);
        await this.db.recordAuditLog({
          userId: '',
          userName: rawUsername || 'محاولة دخول',
          role: '',
          action: failInfo.lockedNow
            ? 'حظر مؤقت بسبب محاولات خاطئة متكررة'
            : 'فشل تسجيل دخول (بيانات غير صحيحة)',
          details: failInfo.lockedNow
            ? 'تم قفل المحاولات لمدة 60 ثانية بعد استنفاد الحد المسموح'
            : `محاولة دخول فاشلة (متبقي ${failInfo.remaining} محاولات)`,
          ip,
          severity: failInfo.lockedNow ? 'critical' : 'warning',
        });

        return res.status(failInfo.lockedNow ? 429 : 401).json({
          ok: false,
          error: failInfo.lockedNow
            ? 'تم قفل الدخول لمدة 60 ثانية بسبب تكرار كلمة المرور الخاطئة!'
            : rawUsername
            ? 'اسم المستخدم أو كلمة المرور غير صحيحة'
            : 'كلمة المرور غير صحيحة',
        });
      }

      this.rateLimiter.reset(ip, targetKey);
      const nowIso = new Date().toISOString();
      await this.db.execute('UPDATE system_users SET last_login_at = ? WHERE id = ?', [
        nowIso,
        matchedUser.id,
      ]);

      const [token, permissions, rolePolicyRowRaw, empRowRaw, userPreferences] = await Promise.all([
        this.db.issueSessionForUser(
          matchedUser,
          ip,
          String(req.headers['user-agent'] || '')
        ),
        this.db.getRolePermissions(
          matchedUser.role,
          matchedUser.custom_permissions_json
        ),
        this.db.queryOne<any>(
          'SELECT * FROM role_policies WHERE role = ? LIMIT 1',
          [matchedUser.role]
        ),
        matchedUser.employee_id
          ? this.db.queryOne<any>('SELECT * FROM employees WHERE id = ? LIMIT 1', [
              matchedUser.employee_id,
            ])
          : Promise.resolve(null),
        this.db.loadUserPreferences(matchedUser),
      ]);

      const {
        userRow: hydratedMatchedUser,
        empRow,
        rolePolicyRow,
      } = await this.db.hydrateUserBundle(
        matchedUser,
        empRowRaw,
        rolePolicyRowRaw,
        matchedUser.role
      );

      const roleMeta = ROLES_METADATA[hydratedMatchedUser.role] || {
        label: hydratedMatchedUser.role,
      };
      const publicUser = {
        ...this.db.buildPublicUserPayload(hydratedMatchedUser, empRow, rolePolicyRow),
        preferences: userPreferences,
      };

      await this.db.recordAuditLog({
        userId: matchedUser.id,
        userName: matchedUser.display_name,
        role: matchedUser.role,
        action: 'تسجيل دخول ناجح',
        details: isTargetedLogin
          ? `دخول مباشر عبر ${rawUsername ? `اسم المستخدم (@${matchedUser.username})` : 'بطاقة الدور'} (${roleMeta.label})`
          : `تم تحديد الصلاحية تلقائياً: (${roleMeta.label})`,
        ip,
        severity: 'info',
      });

      return res.json({
        ok: true,
        token,
        user: publicUser,
        permissions,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  @Get('auth/me')
  async me(@CurrentAuth() auth: AuthContext) {
    return {
      ok: true,
      user: auth.user,
      permissions: auth.permissions,
    };
  }

  @Post('auth/logout')
  @HttpCode(200)
  async logout(@CurrentAuth() auth: AuthContext, @Req() req: Request) {
    await this.db.execute('UPDATE user_sessions SET revoked = 1 WHERE id = ?', [
      auth.sessionId,
    ]);
    await this.db.recordAuditLog({
      userId: auth.user.id,
      userName: auth.user.display_name,
      role: auth.user.role,
      action: 'تسجيل خروج',
      details: 'إنهاء الجلسة الحالية بأمان',
      ip: getClientIp(req),
      severity: 'info',
    });
    return { ok: true };
  }

  @Post('auth/lock-to-kiosk')
  @HttpCode(200)
  @RequireAnyPermission(['attendance:kiosk', 'users:manage', 'settings:manage', 'staff:manage'])
  async lockToKiosk(@CurrentAuth() auth: AuthContext, @Req() req: Request) {
    const kioskUser =
      (await this.db.queryOne<any>(
        "SELECT * FROM system_users WHERE role = 'kiosk' AND is_active = 1 LIMIT 1"
      )) || {
        id: '__DEVICE_KIOSK__',
        username: 'kiosk_device',
        display_name: 'شاشة كشك حضور العمال',
        role: 'kiosk',
        avatar_color: '#E37400',
      };

    await this.db.execute('UPDATE user_sessions SET revoked = 1 WHERE id = ?', [
      auth.sessionId,
    ]);
    const ip = getClientIp(req);
    const token = await this.db.issueSessionForUser(
      kioskUser,
      ip,
      String(req.headers['user-agent'] || '')
    );
    const permissions = await this.db.getRolePermissions('kiosk');

    await this.db.recordAuditLog({
      userId: auth.user.id,
      userName: auth.user.display_name,
      role: auth.user.role,
      action: 'تفعيل وضع كشك العمال المقيد',
      details: 'تم قفل الجهاز على صلاحية كشك الحضور فقط',
      ip,
      severity: 'info',
    });

    return {
      ok: true,
      token,
      user: {
        id: kioskUser.id,
        username: kioskUser.username,
        display_name: kioskUser.display_name,
        role: kioskUser.role,
        role_label: ROLES_METADATA.kiosk.label,
        avatar_color: kioskUser.avatar_color,
      },
      permissions,
    };
  }

  @Get('profile/me')
  async getMyProfile(@CurrentAuth() auth: AuthContext, @Res() res: Response) {
    try {
      const secretHex = await this.db.getSessionSecret();
      const rawUserRow = await this.db.queryOne<any>(
        'SELECT * FROM system_users WHERE id = ? LIMIT 1',
        [auth.user.id]
      );
      const [empRowRaw, rolePolicyRowRaw, sessionsCountRow, userPreferences] = await Promise.all([
        rawUserRow?.employee_id
          ? this.db.queryOne<any>('SELECT * FROM employees WHERE id = ? LIMIT 1', [
              rawUserRow.employee_id,
            ])
          : Promise.resolve(null),
        this.db.queryOne<any>(
          'SELECT * FROM role_policies WHERE role = ? LIMIT 1',
          [auth.user.role]
        ),
        this.db.queryOne<{ c: any }>(
          'SELECT COUNT(*) as c FROM user_sessions WHERE user_id = ? AND revoked = 0 AND expires_at > ?',
          [auth.user.id, new Date().toISOString()]
        ),
        this.db.loadUserPreferences(rawUserRow),
      ]);
      const { userRow, empRow, rolePolicyRow } = await this.db.hydrateUserBundle(
        rawUserRow,
        empRowRaw,
        rolePolicyRowRaw,
        auth.user.role
      );
      const myPass = userRow
        ? decryptPasswordForAdmin(userRow.pin_cipher, secretHex) || empRow?.emp_code || ''
        : '';
      const effectiveAvatarUrl = this.db.resolveEffectiveAvatarUrl(
        userRow,
        empRow,
        rolePolicyRow
      );
      const resolvedPreset = String(
        userRow?.avatar_preset || empRow?.avatar_preset || rolePolicyRow?.avatar_preset || ''
      ).trim();

      const empId = empRow?.id || '';
      const myAttendanceLogs = empId
        ? await this.db.queryAll<any>(
            'SELECT * FROM attendance_logs WHERE employee_id = ? ORDER BY timestamp DESC LIMIT 80',
            [empId]
          )
        : [];

      const myNamePattern = `%${auth.user.display_name}%`;
      const myShortages = await this.db.queryAll<any>(
        'SELECT * FROM shortages WHERE recorded_by LIKE ? ORDER BY timestamp DESC LIMIT 50',
        [myNamePattern]
      );
      const myNotes = await this.db.queryAll<any>(
        'SELECT * FROM notes WHERE recorded_by LIKE ? ORDER BY timestamp DESC LIMIT 50',
        [myNamePattern]
      );
      const myAuditLogs = await this.db.queryAll<any>(
        'SELECT * FROM audit_logs WHERE user_id = ? OR user_id = ? OR user_name LIKE ? ORDER BY timestamp DESC LIMIT 80',
        [auth.user.id, empId, myNamePattern]
      );

      const checkInsCount = myAttendanceLogs.filter((l) => l.action_type === 'check_in').length;
      const breaksCount = myAttendanceLogs.filter((l) => l.action_type === 'break_start').length;
      const totalBreakMinutes = myAttendanceLogs
        .filter((l) => l.action_type === 'break_end')
        .reduce((sum, l) => sum + (Number(l.break_duration_minutes) || 0), 0);
      const totalLateMinutes = myAttendanceLogs.reduce(
        (sum, l) => sum + (Number(l.late_minutes) || 0),
        0
      );

      return res.json({
        ok: true,
        profile: {
          id: auth.user.id,
          user_id: auth.user.id,
          username: userRow?.username || auth.user.username,
          display_name: userRow?.display_name || auth.user.display_name,
          role: auth.user.role,
          role_label: auth.user.role_label,
          avatar_color: userRow?.avatar_color || auth.user.avatar_color,
          avatar_url: effectiveAvatarUrl,
          own_avatar_url: String(userRow?.avatar_url || '').trim(),
          effective_avatar_url: effectiveAvatarUrl,
          role_default_avatar_url: String(rolePolicyRow?.avatar_url || '').trim(),
          avatar_preset: resolvedPreset,
          preferences: userPreferences,
          password_changed_at: userRow?.password_changed_at || '',
          username_changed_at: userRow?.username_changed_at || '',
          last_login_at: userRow?.last_login_at || '',
          active_sessions_count: Number(sessionsCountRow?.c || 1),
          my_password: auth.user.role === 'kiosk' ? '' : myPass,
          employee_id: empId,
          emp_code: empRow?.emp_code || '',
          department: empRow?.department || ROLES_METADATA[auth.user.role]?.shortLabel || '',
          role_title: empRow?.role_title || ROLES_METADATA[auth.user.role]?.label || '',
          shift_start: empRow?.shift_start || '08:00',
          shift_end: empRow?.shift_end || '20:00',
          phone: empRow?.phone || '',
          qr_payload: empRow ? `ZMART:EMP:${empRow.id}` : '',
          employee: empRow
            ? {
                id: empRow.id,
                emp_code: empRow.emp_code || '',
                name: empRow.name,
                department: empRow.department,
                role_title: empRow.role_title || '',
                shift_start: empRow.shift_start || '08:00',
                shift_end: empRow.shift_end || '20:00',
                phone: empRow.phone || '',
                avatar_color: empRow.avatar_color || auth.user.avatar_color,
                avatar_url: empRow.avatar_url || effectiveAvatarUrl,
                avatar_preset: empRow.avatar_preset || resolvedPreset,
              }
            : null,
        },
        stats: {
          checkInsCount,
          breaksCount,
          totalBreakMinutes,
          totalLateMinutes,
          shortagesReportedCount: myShortages.length,
          notesReportedCount: myNotes.length,
        },
        myAttendanceLogs,
        myShortages,
        myNotes,
        myAuditLogs,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Get('logs/person/:id')
  async getPersonLog(
    @Param('id') rawId: string,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const targetId = String(rawId || '').trim();
      const canSeeAnyone =
        auth.has('audit:view') ||
        auth.has('reports:view') ||
        auth.has('staff:manage') ||
        auth.has('users:manage') ||
        auth.has('attendance:read');

      const isSelf =
        targetId === auth.user.id ||
        Boolean(auth.user.employee_id && targetId === auth.user.employee_id);

      if (!canSeeAnyone && !isSelf) {
        return res.status(403).json({ error: 'غير مصرح بعرض سجل موظف آخر' });
      }

      let empRow = await this.db.queryOne<any>(
        'SELECT * FROM employees WHERE id = ? LIMIT 1',
        [targetId]
      );
      let userRow = await this.db.queryOne<any>(
        'SELECT * FROM system_users WHERE id = ? LIMIT 1',
        [targetId]
      );

      if (empRow && !userRow) {
        userRow = await this.db.queryOne<any>(
          'SELECT * FROM system_users WHERE employee_id = ? LIMIT 1',
          [empRow.id]
        );
      } else if (userRow && !empRow && userRow.employee_id) {
        empRow = await this.db.queryOne<any>(
          'SELECT * FROM employees WHERE id = ? LIMIT 1',
          [userRow.employee_id]
        );
      }

      if (!empRow && !userRow) {
        return res.status(404).json({ error: 'لم يتم العثور على الموظف أو المستخدم' });
      }

      const personName = empRow?.name || userRow?.display_name || '';
      const empId = empRow?.id || '__NO_EMP__';
      const userId = userRow?.id || '__NO_USER__';
      const namePattern = `%${personName}%`;

      const attendanceLogs = await this.db.queryAll<any>(
        'SELECT * FROM attendance_logs WHERE employee_id = ? ORDER BY timestamp DESC LIMIT 250',
        [empId]
      );
      const shortages = await this.db.queryAll<any>(
        'SELECT * FROM shortages WHERE recorded_by LIKE ? OR updated_by LIKE ? ORDER BY timestamp DESC LIMIT 150',
        [namePattern, namePattern]
      );
      const notes = await this.db.queryAll<any>(
        'SELECT * FROM notes WHERE recorded_by LIKE ? ORDER BY timestamp DESC LIMIT 150',
        [namePattern]
      );
      const truckLogs = await this.db.queryAll<any>(
        'SELECT * FROM truck_logs WHERE recorded_by LIKE ? ORDER BY arrival_time DESC LIMIT 100',
        [namePattern]
      );
      const teamMessages = await this.db.queryAll<any>(
        'SELECT * FROM team_messages WHERE sender_id = ? OR sender_name LIKE ? ORDER BY timestamp DESC LIMIT 100',
        [userId, namePattern]
      );
      const auditLogs = await this.db.queryAll<any>(
        'SELECT * FROM audit_logs WHERE user_id = ? OR user_id = ? OR user_name LIKE ? OR details LIKE ? ORDER BY timestamp DESC LIMIT 250',
        [userId, empId, namePattern, namePattern]
      );

      const daysSet = new Set(
        attendanceLogs
          .filter((l) => l.action_type === 'check_in')
          .map((l) => l.shift_date_key || l.date_key)
      );
      const totalBreakCount = attendanceLogs.filter((l) => l.action_type === 'break_start').length;
      const totalBreakMinutes = attendanceLogs
        .filter((l) => l.action_type === 'break_end')
        .reduce((sum, l) => sum + (Number(l.break_duration_minutes) || 0), 0);
      const overBreakCount = attendanceLogs.filter(
        (l) =>
          l.action_type === 'break_end' &&
          Number(l.allowed_break_minutes) > 0 &&
          Number(l.break_duration_minutes) > Number(l.allowed_break_minutes)
      ).length;
      const totalLateMinutes = attendanceLogs.reduce(
        (sum, l) => sum + (Number(l.late_minutes) || 0),
        0
      );

      const canSeePassword =
        isSelf || auth.has('users:manage') || auth.has('staff:manage');
      const secretHex = await this.db.getSessionSecret();
      const passwordValue =
        canSeePassword && userRow
          ? decryptPasswordForAdmin(userRow.pin_cipher, secretHex) || empRow?.emp_code || ''
          : undefined;

      const resolvedRole =
        userRow?.role ||
        empRow?.system_role ||
        inferDefaultRoleFromDepartment(empRow?.department, empRow?.role_title);

      return res.json({
        ok: true,
        person: {
          id: empRow?.id || userRow?.id,
          employee_id: empRow?.id || '',
          user_id: userRow?.id || '',
          emp_code: empRow?.emp_code || '',
          name: personName,
          department: empRow?.department || ROLES_METADATA[resolvedRole]?.shortLabel || '',
          role_title: empRow?.role_title || ROLES_METADATA[resolvedRole]?.label || '',
          role: resolvedRole,
          role_label: ROLES_METADATA[resolvedRole]?.label || resolvedRole,
          shift_start: empRow?.shift_start || '08:00',
          shift_end: empRow?.shift_end || '20:00',
          phone: empRow?.phone || '',
          password_value: passwordValue,
        },
        summary: {
          daysPresent: daysSet.size,
          totalAttendanceEvents: attendanceLogs.length,
          totalBreakCount,
          totalBreakMinutes,
          overBreakCount,
          totalLateMinutes,
          shortagesCount: shortages.length,
          notesCount: notes.length,
          trucksCount: truckLogs.length,
          messagesCount: teamMessages.length,
          auditCount: auditLogs.length,
        },
        attendanceLogs,
        shortages,
        notes,
        truckLogs,
        teamMessages,
        auditLogs,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
}

@Module({
  controllers: [AuthController],
})
export class AuthModule {}
