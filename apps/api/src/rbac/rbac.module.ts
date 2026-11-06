import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ALL_PERMISSIONS, normalizeDigits, ROLES_METADATA } from '@zayed-mart/shared';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import {
  decryptPasswordForAdmin,
  encryptPasswordForAdmin,
  getClientIp,
  hashPin,
} from '../common/crypto.util';
import {
  AuthContext,
  CurrentAuth,
  RequireAnyPermission,
  RequirePermission,
} from '../common/decorators';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';

@Controller('api')
export class RbacController {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService
  ) {}

  @Get('rbac/overview')
  @RequireAnyPermission(['users:manage', 'audit:view'])
  async getOverview(@CurrentAuth() auth: AuthContext) {
    const canManageUsers = auth.has('users:manage');
    const secretHex = await this.db.getSessionSecret();
    const rawUsers = canManageUsers
      ? await this.db.queryAll<any>(
          `SELECT id, username, display_name, role, pin_cipher, avatar_color, is_active, employee_id, custom_permissions_json, last_login_at, created_at
           FROM system_users
           ORDER BY is_active DESC, created_at ASC`
        )
      : [];

    const users = rawUsers.map((u) => {
      const { pin_cipher, custom_permissions_json, ...rest } = u;
      let customPerms: string[] = [];
      try {
        customPerms = JSON.parse(custom_permissions_json || '[]');
      } catch {
        customPerms = [];
      }
      return {
        ...rest,
        custom_permissions: Array.isArray(customPerms) ? customPerms : [],
        password_value: decryptPasswordForAdmin(pin_cipher, secretHex),
      };
    });

    const policiesRows = await this.db.queryAll<any>(
      'SELECT role, permissions_json FROM role_policies'
    );
    const policies: Record<string, string[]> = {};
    for (const r of policiesRows) {
      try {
        policies[r.role] = JSON.parse(r.permissions_json);
      } catch {
        policies[r.role] = [];
      }
    }
    policies.owner = ALL_PERMISSIONS.map((p) => p.id);

    const activeSessionsRow = await this.db.queryOne<{ c: any }>(
      'SELECT COUNT(*) as c FROM user_sessions WHERE revoked = 0 AND expires_at > ?',
      [new Date().toISOString()]
    );
    const auditLogs = await this.db.queryAll<any>(
      'SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 500'
    );

    return {
      rolesMeta: ROLES_METADATA,
      permissionsCatalog: ALL_PERMISSIONS,
      policies,
      users,
      activeSessionsCount: Number(activeSessionsRow?.c || 0),
      auditLogs,
    };
  }

  @Post('rbac/users')
  @RequirePermission('users:manage')
  async createUser(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const {
        username,
        display_name,
        role = 'security',
        password,
        pin,
        avatar_color = '#0B57D0',
        custom_permissions = [],
      } = body || {};

      const rawPass = normalizeDigits(String(password ?? pin ?? '').trim());
      if (!display_name?.trim()) {
        return res.status(400).json({ error: 'يرجى كتابة اسم المستخدم أو وصف الصلاحية' });
      }
      if (!ROLES_METADATA[role]) {
        return res.status(400).json({ error: 'الدور المحدد غير صالح' });
      }
      if (!rawPass) {
        return res.status(400).json({ error: 'يرجى تحديد كلمة المرور' });
      }

      const conflict = await this.db.findPasswordConflict(rawPass);
      if (conflict) {
        return res.status(400).json({
          error: `كلمة المرور هذه مخصصة بالفعل لـ "${conflict.display_name}" — اختر كلمة مرور مختلفة ليتم تحديد الدور تلقائياً عند الدخول`,
        });
      }

      const cleanUsername = username?.trim()
        ? username.trim().toLowerCase().replace(/\s+/g, '_')
        : `${role}_${crypto.randomBytes(3).toString('hex')}`;

      const exists = await this.db.queryOne(
        'SELECT id FROM system_users WHERE username = ?',
        [cleanUsername]
      );
      if (exists) {
        return res.status(400).json({ error: 'المعرف مستخدم بالفعل' });
      }

      const validPermIds = new Set(ALL_PERMISSIONS.map((p) => p.id));
      const cleanCustomPerms = Array.isArray(custom_permissions)
        ? custom_permissions.filter((p) => validPermIds.has(p))
        : [];

      const { saltHex, hashHex } = hashPin(rawPass);
      const cipher = encryptPasswordForAdmin(rawPass, await this.db.getSessionSecret());
      const id = body?.id ? String(body.id) : crypto.randomUUID();
      const now = new Date().toISOString();

      await this.db.execute(
        `INSERT INTO system_users (
          id, username, display_name, role, pin_salt, pin_hash, pin_cipher, avatar_color, is_active, custom_permissions_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          id,
          cleanUsername,
          display_name.trim(),
          role,
          saltHex,
          hashHex,
          cipher,
          avatar_color,
          JSON.stringify(cleanCustomPerms),
          now,
          now,
        ]
      );

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'إنشاء كلمة مرور وصلاحية جديدة',
        details: `إنشاء كلمة مرور لـ "${display_name.trim()}" بدور (${ROLES_METADATA[role].label})`,
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('rbac_user_add');
      return res.status(201).json({ ok: true, id });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Put('rbac/users/:id')
  @RequirePermission('users:manage')
  async updateUser(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const target = await this.db.queryOne<any>(
        'SELECT * FROM system_users WHERE id = ?',
        [id]
      );
      if (!target) {
        return res.status(404).json({ error: 'الحساب غير موجود' });
      }

      const {
        display_name = target.display_name,
        role = target.role,
        password,
        pin,
        is_active = target.is_active,
        avatar_color = target.avatar_color,
        custom_permissions,
      } = body || {};

      if (!ROLES_METADATA[role]) {
        return res.status(400).json({ error: 'الدور غير صالح' });
      }

      if (target.role === 'owner' && (role !== 'owner' || !is_active)) {
        const activeOwnersRow = await this.db.queryOne<{ c: any }>(
          "SELECT COUNT(*) as c FROM system_users WHERE role = 'owner' AND is_active = 1"
        );
        if (Number(activeOwnersRow?.c || 0) <= 1) {
          return res.status(400).json({
            error: 'لا يمكن إيقاف أو تغيير دور حساب المدير الوحيد النشط في النظام!',
          });
        }
      }

      const rawPass = normalizeDigits(String(password ?? pin ?? '').trim());
      let saltHex = target.pin_salt;
      let hashHex = target.pin_hash;
      let cipher = target.pin_cipher || '';

      if (rawPass.length > 0) {
        const conflict = await this.db.findPasswordConflict(rawPass, target.id);
        if (conflict) {
          return res.status(400).json({
            error: `كلمة المرور هذه مستخدمة بالفعل لـ "${conflict.display_name}" — اختر كلمة مرور مميزة لكل صلاحية`,
          });
        }
        const hashed = hashPin(rawPass);
        saltHex = hashed.saltHex;
        hashHex = hashed.hashHex;
        cipher = encryptPasswordForAdmin(rawPass, await this.db.getSessionSecret());
      }

      let nextCustomPermsJson = target.custom_permissions_json || '[]';
      if (Array.isArray(custom_permissions)) {
        const validPermIds = new Set(ALL_PERMISSIONS.map((p) => p.id));
        nextCustomPermsJson = JSON.stringify(
          custom_permissions.filter((p) => validPermIds.has(p))
        );
      }

      const nowIso = new Date().toISOString();
      await this.db.execute(
        `UPDATE system_users
         SET display_name = ?, role = ?, pin_salt = ?, pin_hash = ?, pin_cipher = ?, avatar_color = ?, is_active = ?, custom_permissions_json = ?, updated_at = ?
         WHERE id = ?`,
        [
          display_name.trim(),
          role,
          saltHex,
          hashHex,
          cipher,
          avatar_color,
          is_active ? 1 : 0,
          nextCustomPermsJson,
          nowIso,
          target.id,
        ]
      );

      if (target.employee_id) {
        await this.db.execute(
          `UPDATE employees
           SET name = ?,
               system_role = ?,
               login_enabled = ?,
               emp_code = CASE WHEN ? != '' THEN ? ELSE emp_code END,
               updated_at = ?
           WHERE id = ?`,
          [
            display_name.trim(),
            role,
            is_active ? 1 : 0,
            rawPass,
            rawPass,
            nowIso,
            target.employee_id,
          ]
        );
      }

      if (!is_active || role !== target.role || rawPass.length > 0) {
        await this.db.execute(
          'UPDATE user_sessions SET revoked = 1 WHERE user_id = ? AND id != ?',
          [target.id, auth.sessionId]
        );
      }

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تحديث كلمة مرور / صلاحية',
        details: `تحديث "${display_name.trim()}" (${ROLES_METADATA[role].label}) - نشط: ${is_active ? 'نعم' : 'لا'}`,
        ip: getClientIp(req),
        severity: !is_active ? 'warning' : 'info',
      });

      await this.realtime.broadcastStoreUpdate('rbac_user_update');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Delete('rbac/users/:id')
  @RequirePermission('users:manage')
  async deleteUser(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const target = await this.db.queryOne<any>(
        'SELECT * FROM system_users WHERE id = ?',
        [id]
      );
      if (!target) {
        return res.status(404).json({ error: 'الحساب غير موجود' });
      }

      if (target.role === 'owner' && Number(target.is_active) === 1) {
        const activeOwnersRow = await this.db.queryOne<{ c: any }>(
          "SELECT COUNT(*) as c FROM system_users WHERE role = 'owner' AND is_active = 1"
        );
        if (Number(activeOwnersRow?.c || 0) <= 1) {
          return res.status(400).json({
            error: 'لا يمكن حذف كلمة مرور المدير الوحيد النشط في النظام!',
          });
        }
      }

      await this.db.execute('UPDATE user_sessions SET revoked = 1 WHERE user_id = ?', [
        target.id,
      ]);
      await this.db.execute('DELETE FROM system_users WHERE id = ?', [target.id]);
      if (target.employee_id) {
        await this.db.execute('UPDATE employees SET login_enabled = 0 WHERE id = ?', [
          target.employee_id,
        ]);
      }

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'حذف كلمة مرور وصلاحية',
        details: `حذف حساب "${target.display_name}" (${ROLES_METADATA[target.role]?.label || target.role}) وإبطال جلساته`,
        ip: getClientIp(req),
        severity: 'warning',
      });

      await this.realtime.broadcastStoreUpdate('rbac_user_delete');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Put('rbac/policies/:role')
  @RequirePermission('users:manage')
  async updateRolePolicy(
    @Param('role') role: string,
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      if (role === 'owner') {
        return res.status(400).json({ error: 'دور المالك يحتفظ دائماً بكافة الصلاحيات' });
      }
      if (!ROLES_METADATA[role]) {
        return res.status(400).json({ error: 'الدور غير معروف' });
      }

      const validPermIds = new Set(ALL_PERMISSIONS.map((p) => p.id));
      const incoming = Array.isArray(body?.permissions) ? body.permissions : [];
      const sanitized = incoming.filter((p: string) => validPermIds.has(p));
      const nowIso = new Date().toISOString();

      await this.db.execute(
        `INSERT INTO role_policies (role, permissions_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT (role) DO UPDATE SET permissions_json = EXCLUDED.permissions_json, updated_at = EXCLUDED.updated_at`,
        [role, JSON.stringify(sanitized), nowIso]
      );

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تحديث مصفوفة صلاحيات RBAC',
        details: `تعديل صلاحيات دور (${ROLES_METADATA[role].label}) إلى ${sanitized.length} صلاحية`,
        ip: getClientIp(req),
        severity: 'warning',
      });

      await this.realtime.broadcastStoreUpdate('rbac_policy_update');
      return res.json({ ok: true, permissions: sanitized });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('rbac/sessions/revoke-all')
  @RequirePermission('users:manage')
  async revokeAllSessions(@CurrentAuth() auth: AuthContext, @Req() req: Request) {
    const result = await this.db.execute(
      'UPDATE user_sessions SET revoked = 1 WHERE revoked = 0 AND id != ?',
      [auth.sessionId]
    );
    await this.db.recordAuditLog({
      userId: auth.user.id,
      userName: auth.user.display_name,
      role: auth.user.role,
      action: 'إبطال كافة الجلسات النشطة',
      details: `تم تسجيل خروج إجباري لـ (${result.changes}) جهاز/جلسة أخرى`,
      ip: getClientIp(req),
      severity: 'critical',
    });
    await this.realtime.broadcastStoreUpdate('sessions_revoked');
    return { ok: true, revokedCount: result.changes };
  }

  @Get('audit-logs')
  @RequireAnyPermission(['audit:view', 'users:manage', 'reports:view'])
  async getAuditLogs(
    @Query('limit') rawLimit: string | undefined,
    @Query('search') rawSearch: string | undefined,
    @Query('role') rawRole: string | undefined
  ) {
    const limit = Math.min(2000, Math.max(50, Number(rawLimit) || 500));
    const search = String(rawSearch || '').trim();
    const roleFilter = String(rawRole || '').trim();

    let logs = await this.db.queryAll<any>(
      `SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ${limit}`
    );

    if (roleFilter && roleFilter !== 'all') {
      logs = logs.filter((l) => l.role === roleFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      logs = logs.filter(
        (l) =>
          (l.user_name || '').toLowerCase().includes(q) ||
          (l.action || '').toLowerCase().includes(q) ||
          (l.details || '').toLowerCase().includes(q)
      );
    }

    return { ok: true, auditLogs: logs };
  }

  @Delete('audit-logs')
  @RequirePermission('users:manage')
  async clearAuditLogs(@CurrentAuth() auth: AuthContext, @Req() req: Request) {
    await this.db.execute('DELETE FROM audit_logs');
    await this.db.recordAuditLog({
      userId: auth.user.id,
      userName: auth.user.display_name,
      role: auth.user.role,
      action: 'تصفير سجل التدقيق الشامل (Master Log)',
      details: 'تم مسح سجل التدقيق القديم بواسطة الأدمن',
      ip: getClientIp(req),
      severity: 'warning',
    });
    await this.realtime.broadcastStoreUpdate('audit_cleared');
    return { ok: true };
  }
}

@Module({
  controllers: [RbacController],
})
export class RbacModule {}
