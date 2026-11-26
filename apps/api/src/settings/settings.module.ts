import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  DEFAULT_ROLE_PERMISSIONS,
  normalizeDigits,
  ROLES_METADATA,
} from '@zayed-mart/shared';
import type { Request, Response } from 'express';
import {
  createLoginRateLimiter,
  decryptPasswordForAdmin,
  encryptPasswordForAdmin,
  getClientIp,
  hashPin,
  verifyPinHash,
} from '../common/crypto.util';
import {
  AuthContext,
  CurrentAuth,
  RequirePermission,
} from '../common/decorators';
import { DatabaseService, normalizeServerTheme } from '../database/database.service';
import { StorageService } from '../database/storage.service';
import { RealtimeService } from '../realtime/realtime.service';

const USERNAME_REGEX = /^[a-z0-9._-]{3,32}$/;
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

const RESERVED_USERNAMES = new Set([
  'root',
  'system',
  'null',
  'undefined',
  'kiosk_device',
  'admin_system',
  'superuser',
]);

const VALID_AVATAR_PRESETS = new Set([
  '',
  'role_default',
  'badge_crown',
  'badge_shield',
  'badge_cashier',
  'badge_camera',
  'badge_store',
  'badge_warehouse',
  'badge_delivery',
  'badge_star',
  'badge_bolt',
  'initials_gradient',
  'initials_minimal',
]);

const VALID_MODES = new Set(['light', 'dark', 'system']);
const VALID_FONTS = new Set(['auto', 'cairo', 'ibm', 'ibm-plex', 'tajawal', 'readex']);
const VALID_SCALES = new Set(['scale-normal', 'scale-large', 'scale-xlarge']);
const VALID_DENSITIES = new Set(['comfortable', 'compact']);
const VALID_GLASS_MODES = new Set(['auto', 'full', 'reduced', 'off']);

const ROLE_DISPLAY_ORDER = [
  'owner',
  'manager',
  'supervisor',
  'cashier',
  'cctv',
  'security',
  'hall',
  'warehouse',
  'delivery',
  'kiosk',
];

function validateUsernameFormat(raw: string): {
  ok: boolean;
  normalized: string;
  reason?: string;
} {
  const normalized = String(raw || '').trim().toLowerCase();
  if (!normalized) {
    return { ok: false, normalized: '', reason: 'يرجى كتابة اسم المستخدم' };
  }
  if (normalized.length < 3 || normalized.length > 32) {
    return {
      ok: false,
      normalized,
      reason: 'يجب أن يكون اسم المستخدم بين 3 و 32 حرفاً',
    };
  }
  if (!USERNAME_REGEX.test(normalized)) {
    return {
      ok: false,
      normalized,
      reason: 'يُسمح فقط بالحروف الإنجليزية الصغيرة والأرقام والرموز (. _ -)',
    };
  }
  if (RESERVED_USERNAMES.has(normalized)) {
    return {
      ok: false,
      normalized,
      reason: 'اسم المستخدم هذا محجوز للنظام — اختر اسماً آخر',
    };
  }
  return { ok: true, normalized };
}

function sanitizePreferencesPatch(
  existing: Record<string, any>,
  patch: Record<string, any>
): Record<string, any> {
  const next: Record<string, any> = { ...(existing || {}) };
  if (next.theme !== undefined) {
    const normalizedExisting = normalizeServerTheme(next.theme);
    if (normalizedExisting) {
      next.theme = normalizedExisting;
    } else {
      delete next.theme;
    }
  }
  if (!patch || typeof patch !== 'object') return next;

  const normalizedPatchTheme = normalizeServerTheme(patch.theme);
  if (normalizedPatchTheme) {
    next.theme = normalizedPatchTheme;
  }

  const rawMode = patch.modePref ?? patch.mode;
  if (typeof rawMode === 'string' && VALID_MODES.has(rawMode)) {
    next.modePref = rawMode;
  }

  if (typeof patch.fontFamily === 'string' && VALID_FONTS.has(patch.fontFamily)) {
    next.fontFamily = patch.fontFamily;
  }

  if (typeof patch.fontScale === 'string' && VALID_SCALES.has(patch.fontScale)) {
    next.fontScale = patch.fontScale;
  }

  if (typeof patch.density === 'string' && VALID_DENSITIES.has(patch.density)) {
    next.density = patch.density;
  }

  if (typeof patch.glassMode === 'string' && VALID_GLASS_MODES.has(patch.glassMode)) {
    next.glassMode = patch.glassMode;
  } else if (typeof patch.reducedBlur === 'boolean') {
    next.glassMode = patch.reducedBlur ? 'reduced' : 'full';
  }

  if (typeof patch.liteMode === 'boolean') {
    next.liteMode = patch.liteMode;
  }
  if (typeof patch.voiceConfirm === 'boolean') {
    next.voiceConfirm = patch.voiceConfirm;
  }
  if (typeof patch.uiSounds === 'boolean') {
    next.uiSounds = patch.uiSounds;
  }
  const rawWalkieChimes = patch.walkieChimes ?? patch.walkieSounds;
  if (typeof rawWalkieChimes === 'boolean') {
    next.walkieChimes = rawWalkieChimes;
  }

  return next;
}

@Controller('api')
export class SettingsController {
  private readonly verifyLimiter = createLoginRateLimiter({
    maxAttempts: 5,
    windowMs: 180000,
    blockMs: 60000,
  });

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService
  ) {}

  private rejectIfKiosk(auth: AuthContext, res: Response): boolean {
    if (!auth?.user || auth.user.role === 'kiosk' || auth.user.id === '__DEVICE_KIOSK__') {
      res.status(403).json({
        ok: false,
        code: 'FORBIDDEN',
        error: 'وضع كشك العمال المقيد لا يسمح بتعديل إعدادات الحساب',
      });
      return true;
    }
    return false;
  }

  private async loadFullPublicUser(userId: string) {
    const userRow = await this.db.queryOne<any>(
      'SELECT * FROM system_users WHERE id = ? LIMIT 1',
      [userId]
    );
    if (!userRow) return null;
    const [empRowRaw, rolePolicyRowRaw, preferences] = await Promise.all([
      userRow.employee_id
        ? this.db.queryOne<any>('SELECT * FROM employees WHERE id = ? LIMIT 1', [
            userRow.employee_id,
          ])
        : Promise.resolve(null),
      this.db.queryOne<any>(
        'SELECT * FROM role_policies WHERE role = ? LIMIT 1',
        [userRow.role]
      ),
      this.db.loadUserPreferences(userRow),
    ]);
    const {
      userRow: hydratedUser,
      empRow,
      rolePolicyRow,
    } = await this.db.hydrateUserBundle(userRow, empRowRaw, rolePolicyRowRaw, userRow.role);
    return {
      ...this.db.buildPublicUserPayload(hydratedUser, empRow, rolePolicyRow),
      preferences,
    };
  }

  // =========================================================================
  // SELF-SERVICE PROFILE, PHOTO, USERNAME, PASSWORD, PREFERENCES & SESSIONS
  // =========================================================================

  @Put('profile/me')
  @RequirePermission('profile:edit_self')
  async updateMyProfile(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    if (this.rejectIfKiosk(auth, res)) return;
    try {
      const rawUserRow = await this.db.queryOne<any>(
        'SELECT * FROM system_users WHERE id = ? LIMIT 1',
        [auth.user.id]
      );
      if (!rawUserRow) {
        return res.status(404).json({ ok: false, error: 'الحساب غير موجود' });
      }
      const { userRow } = await this.db.hydrateUserBundle(
        rawUserRow,
        null,
        null,
        rawUserRow.role
      );

      let nextDisplayName = userRow.display_name;
      if (body?.display_name !== undefined) {
        const clean = String(body.display_name || '').trim();
        if (clean.length < 2 || clean.length > 60) {
          return res.status(400).json({
            ok: false,
            error: 'الاسم الظاهر يجب أن يكون بين حرفين و 60 حرفاً',
          });
        }
        nextDisplayName = clean;
      }

      let nextColor = userRow.avatar_color || '#0B57D0';
      if (body?.avatar_color !== undefined) {
        const cleanColor = String(body.avatar_color || '').trim();
        if (!HEX_COLOR_REGEX.test(cleanColor)) {
          return res.status(400).json({ ok: false, error: 'صيغة اللون غير صالحة' });
        }
        nextColor = cleanColor;
      }

      let nextPreset = userRow.avatar_preset || '';
      let nextAvatarUrl = userRow.avatar_url || '';
      let oldAvatarToDelete = '';

      if (body?.avatar_preset !== undefined) {
        const cleanPreset = String(body.avatar_preset || '').trim();
        if (!VALID_AVATAR_PRESETS.has(cleanPreset)) {
          return res.status(400).json({ ok: false, error: 'الأفاتار المحدد غير مدعوم' });
        }
        nextPreset = cleanPreset;
        if (cleanPreset && body?.clear_photo !== false) {
          oldAvatarToDelete = userRow.avatar_url || '';
          nextAvatarUrl = '';
        }
      }

      const nowIso = new Date().toISOString();
      if (this.db.schemaCaps.systemUsersRoleProfiles) {
        await this.db.execute(
          `UPDATE system_users
           SET display_name = ?, avatar_color = ?, avatar_preset = ?, avatar_url = ?, updated_at = ?
           WHERE id = ?`,
          [nextDisplayName, nextColor, nextPreset, nextAvatarUrl, nowIso, userRow.id]
        );
      } else {
        await this.db.execute(
          `UPDATE system_users
           SET display_name = ?, avatar_color = ?, updated_at = ?
           WHERE id = ?`,
          [nextDisplayName, nextColor, nowIso, userRow.id]
        );
        if (
          body?.avatar_preset !== undefined ||
          body?.avatar_color !== undefined ||
          oldAvatarToDelete
        ) {
          await this.db.saveProfileAvatar(
            'user',
            userRow.id,
            {
              avatar_url: nextAvatarUrl,
              avatar_preset: nextPreset,
              avatar_color: nextColor,
            },
            nowIso
          );
        }
      }

      if (userRow.employee_id) {
        const nextPhone =
          body?.phone !== undefined ? String(body.phone || '').trim().slice(0, 32) : undefined;
        if (nextPhone !== undefined) {
          if (this.db.schemaCaps.employeesAvatars) {
            await this.db.execute(
              `UPDATE employees
               SET name = ?, avatar_color = ?, avatar_preset = ?, avatar_url = ?, phone = ?, updated_at = ?
               WHERE id = ?`,
              [
                nextDisplayName,
                nextColor,
                nextPreset,
                nextAvatarUrl,
                nextPhone,
                nowIso,
                userRow.employee_id,
              ]
            );
          } else {
            await this.db.execute(
              `UPDATE employees
               SET name = ?, avatar_color = ?, phone = ?, updated_at = ?
               WHERE id = ?`,
              [nextDisplayName, nextColor, nextPhone, nowIso, userRow.employee_id]
            );
          }
        } else if (this.db.schemaCaps.employeesAvatars) {
          await this.db.execute(
            `UPDATE employees
             SET name = ?, avatar_color = ?, avatar_preset = ?, avatar_url = ?, updated_at = ?
             WHERE id = ?`,
            [nextDisplayName, nextColor, nextPreset, nextAvatarUrl, nowIso, userRow.employee_id]
          );
        } else {
          await this.db.execute(
            `UPDATE employees
             SET name = ?, avatar_color = ?, updated_at = ?
             WHERE id = ?`,
            [nextDisplayName, nextColor, nowIso, userRow.employee_id]
          );
        }

        if (
          !this.db.schemaCaps.employeesAvatars &&
          (body?.avatar_preset !== undefined || body?.avatar_color !== undefined || oldAvatarToDelete)
        ) {
          await this.db.saveProfileAvatar(
            'employee',
            userRow.employee_id,
            {
              avatar_url: nextAvatarUrl,
              avatar_preset: nextPreset,
              avatar_color: nextColor,
            },
            nowIso
          );
        }
      }

      if (oldAvatarToDelete) {
        await this.storage.deleteManagedAvatar(oldAvatarToDelete);
      }

      this.db.invalidateAuthCache();

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: nextDisplayName,
        role: auth.user.role,
        action: 'تحديث بيانات الملف الشخصي',
        details: `تحديث الاسم/المظهر الشخصي لـ "${nextDisplayName}"`,
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('profile_update');
      const user = await this.loadFullPublicUser(userRow.id);
      return res.json({ ok: true, user });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  @Post('profile/me/avatar')
  @HttpCode(200)
  @RequirePermission('profile:edit_self')
  async uploadMyAvatar(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    if (this.rejectIfKiosk(auth, res)) return;
    try {
      const rawUserRow = await this.db.queryOne<any>(
        'SELECT * FROM system_users WHERE id = ? LIMIT 1',
        [auth.user.id]
      );
      if (!rawUserRow) {
        return res.status(404).json({ ok: false, error: 'الحساب غير موجود' });
      }
      const { userRow } = await this.db.hydrateUserBundle(
        rawUserRow,
        null,
        null,
        rawUserRow.role
      );

      const uploaded = await this.storage.uploadAvatarDataUrl(body?.dataUrl, userRow.id, {
        preferDataUrlWhenNoCloudBucket: this.db.storageMode === 'supabase_postgres',
      });
      if (uploaded.ok === false) {
        return res.status(400).json({ ok: false, error: uploaded.error });
      }

      const nowIso = new Date().toISOString();
      const oldAvatarUrl = userRow.avatar_url || '';

      if (this.db.schemaCaps.systemUsersRoleProfiles) {
        await this.db.execute(
          `UPDATE system_users
           SET avatar_url = ?, avatar_preset = '', updated_at = ?
           WHERE id = ?`,
          [uploaded.url, nowIso, userRow.id]
        );
      } else {
        await this.db.saveProfileAvatar(
          'user',
          userRow.id,
          { avatar_url: uploaded.url, avatar_preset: '' },
          nowIso
        );
      }

      if (userRow.employee_id) {
        if (this.db.schemaCaps.employeesAvatars) {
          await this.db.execute(
            `UPDATE employees
             SET avatar_url = ?, avatar_preset = '', updated_at = ?
             WHERE id = ?`,
            [uploaded.url, nowIso, userRow.employee_id]
          );
        } else {
          await this.db.saveProfileAvatar(
            'employee',
            userRow.employee_id,
            { avatar_url: uploaded.url, avatar_preset: '' },
            nowIso
          );
        }
      }

      if (body?.apply_to_role_default && auth.has('users:manage')) {
        await this.upsertRoleDefaultAvatar(userRow.role, uploaded.url, nowIso);
      }

      if (oldAvatarUrl && oldAvatarUrl !== uploaded.url) {
        await this.storage.deleteManagedAvatar(oldAvatarUrl);
      }

      this.db.invalidateAuthCache();

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تحديث الصورة الشخصية',
        details: body?.apply_to_role_default && auth.has('users:manage')
          ? `تم تحديث الصورة الشخصية وتعيينها كصورة افتراضية لدور (${auth.user.role_label})`
          : 'تم رفع وتحديث الصورة الشخصية بنجاح',
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('avatar_update');
      const user = await this.loadFullPublicUser(userRow.id);
      return res.json({ ok: true, avatar_url: uploaded.url, user });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  @Delete('profile/me/avatar')
  @RequirePermission('profile:edit_self')
  async deleteMyAvatar(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    if (this.rejectIfKiosk(auth, res)) return;
    try {
      const rawUserRow = await this.db.queryOne<any>(
        'SELECT * FROM system_users WHERE id = ? LIMIT 1',
        [auth.user.id]
      );
      if (!rawUserRow) {
        return res.status(404).json({ ok: false, error: 'الحساب غير موجود' });
      }
      const { userRow } = await this.db.hydrateUserBundle(
        rawUserRow,
        null,
        null,
        rawUserRow.role
      );

      const oldAvatarUrl = userRow.avatar_url || '';
      const nowIso = new Date().toISOString();

      if (this.db.schemaCaps.systemUsersRoleProfiles) {
        await this.db.execute(
          `UPDATE system_users SET avatar_url = '', updated_at = ? WHERE id = ?`,
          [nowIso, userRow.id]
        );
      } else {
        await this.db.saveProfileAvatar('user', userRow.id, { avatar_url: '' }, nowIso);
      }

      if (userRow.employee_id) {
        if (this.db.schemaCaps.employeesAvatars) {
          await this.db.execute(
            `UPDATE employees SET avatar_url = '', updated_at = ? WHERE id = ?`,
            [nowIso, userRow.employee_id]
          );
        } else {
          await this.db.saveProfileAvatar(
            'employee',
            userRow.employee_id,
            { avatar_url: '' },
            nowIso
          );
        }
      }

      if (oldAvatarUrl) {
        await this.storage.deleteManagedAvatar(oldAvatarUrl);
      }

      this.db.invalidateAuthCache();

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'حذف الصورة الشخصية',
        details: 'تمت إزالة الصورة الشخصية واستعادة الصورة الافتراضية',
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('avatar_delete');
      const user = await this.loadFullPublicUser(userRow.id);
      return res.json({ ok: true, user });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  @Get('profile/username-available')
  async checkUsernameAvailable(
    @Query('username') rawUsername: string | undefined,
    @Query('exclude_user_id') rawExcludeId: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    if (this.rejectIfKiosk(auth, res)) return;
    try {
      const check = validateUsernameFormat(rawUsername || '');
      if (!check.ok) {
        return res.json({
          ok: true,
          available: false,
          normalized: check.normalized,
          reason: check.reason,
        });
      }

      const excludeId =
        rawExcludeId && auth.has('users:manage') ? String(rawExcludeId).trim() : auth.user.id;
      const existing = await this.db.queryOne<{ id: string }>(
        'SELECT id FROM system_users WHERE LOWER(username) = LOWER(?) AND id != ? LIMIT 1',
        [check.normalized, excludeId]
      );
      if (existing) {
        return res.json({
          ok: true,
          available: false,
          normalized: check.normalized,
          reason: 'اسم المستخدم محجوز بالفعل لحساب آخر',
        });
      }
      return res.json({
        ok: true,
        available: true,
        normalized: check.normalized,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  @Put('profile/me/username')
  @RequirePermission('profile:edit_self')
  async changeMyUsername(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    if (this.rejectIfKiosk(auth, res)) return;
    try {
      const ip = getClientIp(req);
      const limiterKey = `pwd_verify:${auth.user.id}`;
      const block = this.verifyLimiter.checkBlocked(ip, limiterKey);
      if (block.blocked) {
        return res.status(429).json({
          ok: false,
          code: 'RATE_LIMITED',
          error: `تم إيقاف التحقق مؤقتاً بعد محاولات خاطئة متكررة. حاول بعد ${block.retryAfterSec} ثانية.`,
        });
      }

      const formatCheck = validateUsernameFormat(body?.new_username || '');
      if (!formatCheck.ok) {
        return res.status(400).json({ ok: false, error: formatCheck.reason });
      }

      const currentPass = normalizeDigits(String(body?.current_password || '').trim());
      if (!currentPass) {
        return res.status(400).json({
          ok: false,
          error: 'يرجى إدخال كلمة المرور الحالية لتأكيد تغيير اسم المستخدم',
        });
      }

      const userRow = await this.db.queryOne<any>(
        'SELECT * FROM system_users WHERE id = ? LIMIT 1',
        [auth.user.id]
      );
      if (!userRow) {
        return res.status(404).json({ ok: false, error: 'الحساب غير موجود' });
      }

      if (!verifyPinHash(currentPass, userRow.pin_salt, userRow.pin_hash)) {
        const failInfo = this.verifyLimiter.recordFailure(ip, limiterKey);
        return res.status(failInfo.lockedNow ? 429 : 400).json({
          ok: false,
          error: failInfo.lockedNow
            ? 'تم قفل المحاولات مؤقتاً لمدة 60 ثانية بسبب تكرار كلمة المرور الخاطئة'
            : 'كلمة المرور الحالية غير صحيحة',
        });
      }
      this.verifyLimiter.reset(ip, limiterKey);

      const taken = await this.db.queryOne<{ id: string }>(
        'SELECT id FROM system_users WHERE LOWER(username) = LOWER(?) AND id != ? LIMIT 1',
        [formatCheck.normalized, userRow.id]
      );
      if (taken) {
        return res.status(409).json({
          ok: false,
          error: 'اسم المستخدم محجوز بالفعل لحساب آخر',
        });
      }

      const nowIso = new Date().toISOString();
      const oldUsername = userRow.username;
      if (this.db.schemaCaps.systemUsersRoleProfiles) {
        await this.db.execute(
          `UPDATE system_users
           SET username = ?, username_changed_at = ?, updated_at = ?
           WHERE id = ?`,
          [formatCheck.normalized, nowIso, nowIso, userRow.id]
        );
      } else {
        await this.db.execute(
          `UPDATE system_users
           SET username = ?, updated_at = ?
           WHERE id = ?`,
          [formatCheck.normalized, nowIso, userRow.id]
        );
      }

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تغيير اسم المستخدم الشخصي',
        details: `تم تغيير اسم المستخدم من "@${oldUsername}" إلى "@${formatCheck.normalized}"`,
        ip,
        severity: 'warning',
      });

      this.db.invalidateAuthCache();
      await this.realtime.broadcastStoreUpdate('username_update');
      const user = await this.loadFullPublicUser(userRow.id);
      return res.json({ ok: true, user });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  @Put('profile/me/password')
  @RequirePermission('profile:edit_self')
  async changeMyPassword(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    if (this.rejectIfKiosk(auth, res)) return;
    try {
      const ip = getClientIp(req);
      const limiterKey = `pwd_verify:${auth.user.id}`;
      const block = this.verifyLimiter.checkBlocked(ip, limiterKey);
      if (block.blocked) {
        return res.status(429).json({
          ok: false,
          code: 'RATE_LIMITED',
          error: `تم إيقاف التحقق مؤقتاً بعد محاولات خاطئة متكررة. حاول بعد ${block.retryAfterSec} ثانية.`,
        });
      }

      const currentPass = normalizeDigits(String(body?.current_password || '').trim());
      const newPass = normalizeDigits(String(body?.new_password || '').trim());
      const confirmPass =
        body?.confirm_password !== undefined
          ? normalizeDigits(String(body.confirm_password || '').trim())
          : undefined;

      if (!currentPass) {
        return res.status(400).json({ ok: false, error: 'يرجى إدخال كلمة المرور الحالية' });
      }

      const settings = await this.db.getSettingsMap();
      const minLen = Math.max(3, Number(settings.password_min_length || 4));
      if (!newPass || newPass.length < minLen || newPass.length > 64) {
        return res.status(400).json({
          ok: false,
          error: `يجب أن تكون كلمة المرور الجديدة بين ${minLen} و 64 حرفاً أو رقماً`,
        });
      }
      if (confirmPass !== undefined && confirmPass !== newPass) {
        return res.status(400).json({
          ok: false,
          error: 'تأكيد كلمة المرور الجديدة غير متطابق',
        });
      }
      if (newPass === currentPass) {
        return res.status(400).json({
          ok: false,
          error: 'كلمة المرور الجديدة يجب أن تختلف عن كلمة المرور الحالية',
        });
      }

      const userRow = await this.db.queryOne<any>(
        'SELECT * FROM system_users WHERE id = ? LIMIT 1',
        [auth.user.id]
      );
      if (!userRow) {
        return res.status(404).json({ ok: false, error: 'الحساب غير موجود' });
      }

      if (!verifyPinHash(currentPass, userRow.pin_salt, userRow.pin_hash)) {
        const failInfo = this.verifyLimiter.recordFailure(ip, limiterKey);
        return res.status(failInfo.lockedNow ? 429 : 400).json({
          ok: false,
          error: failInfo.lockedNow
            ? 'تم قفل المحاولات مؤقتاً لمدة 60 ثانية بسبب تكرار كلمة المرور الخاطئة'
            : 'كلمة المرور الحالية غير صحيحة',
        });
      }
      this.verifyLimiter.reset(ip, limiterKey);

      // Generic error ONLY — NEVER leak conflicting user's display_name in self-service flow!
      const conflict = await this.db.findPasswordConflict(newPass, userRow.id);
      if (conflict) {
        return res.status(400).json({
          ok: false,
          error: 'كلمة المرور هذه مستخدمة بالفعل — يرجى اختيار كلمة مرور أخرى',
        });
      }

      const { saltHex, hashHex } = hashPin(newPass);
      const cipher = encryptPasswordForAdmin(newPass, await this.db.getSessionSecret());
      const nowIso = new Date().toISOString();
      const nextSessionVersion = Number(userRow.session_version || 1) + 1;

      if (this.db.schemaCaps.systemUsersRoleProfiles) {
        await this.db.execute(
          `UPDATE system_users
           SET pin_salt = ?, pin_hash = ?, pin_cipher = ?, session_version = ?, password_changed_at = ?, updated_at = ?
           WHERE id = ?`,
          [saltHex, hashHex, cipher, nextSessionVersion, nowIso, nowIso, userRow.id]
        );
      } else {
        await this.db.execute(
          `UPDATE system_users
           SET pin_salt = ?, pin_hash = ?, pin_cipher = ?, updated_at = ?
           WHERE id = ?`,
          [saltHex, hashHex, cipher, nowIso, userRow.id]
        );
      }

      // Revoke all previous sessions and issue one fresh token with the bumped session_version
      const revokeRes = await this.db.execute(
        'UPDATE user_sessions SET revoked = 1 WHERE user_id = ? AND revoked = 0',
        [userRow.id]
      );
      this.db.invalidateAuthCache();

      const freshToken = await this.db.issueSessionForUser(
        { id: userRow.id, session_version: nextSessionVersion },
        ip,
        String(req.headers['user-agent'] || '')
      );

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تغيير كلمة المرور الشخصية',
        details: `تم تحديث كلمة المرور وتجديد الجلسة وإبطال (${Math.max(0, revokeRes.changes - 1)}) جلسة أخرى`,
        ip,
        severity: 'warning',
      });

      await this.realtime.broadcastStoreUpdate('password_change');
      const user = await this.loadFullPublicUser(userRow.id);
      return res.json({
        ok: true,
        token: freshToken,
        user,
        revokedSessionsCount: Math.max(0, revokeRes.changes - 1),
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  @Put('profile/me/preferences')
  async updateMyPreferences(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    if (this.rejectIfKiosk(auth, res)) return;
    try {
      const userRow = await this.db.queryOne<any>(
        'SELECT * FROM system_users WHERE id = ? LIMIT 1',
        [auth.user.id]
      );
      if (!userRow) {
        return res.status(404).json({ ok: false, error: 'الحساب غير موجود' });
      }

      const existing = await this.db.loadUserPreferences(userRow);
      const merged = sanitizePreferencesPatch(existing, body || {});
      const serialized = JSON.stringify(merged);
      if (Buffer.byteLength(serialized, 'utf8') > 4096) {
        return res.status(400).json({ ok: false, error: 'حجم التفضيلات يتجاوز الحد المسموح' });
      }

      await this.db.saveUserPreferences(userRow.id, serialized, new Date().toISOString());
      this.db.invalidateAuthCache();

      return res.json({ ok: true, preferences: merged });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  @Get('profile/me/sessions')
  async listMySessions(@CurrentAuth() auth: AuthContext, @Res() res: Response) {
    if (this.rejectIfKiosk(auth, res)) return;
    try {
      const rows = await this.db.queryAll<any>(
        `SELECT id, ip_address, user_agent, created_at, expires_at
         FROM user_sessions
         WHERE user_id = ? AND revoked = 0 AND expires_at > ?
         ORDER BY created_at DESC`,
        [auth.user.id, new Date().toISOString()]
      );

      const sessions = rows.map((r) => ({
        id: r.id,
        is_current: r.id === auth.sessionId,
        ip_address: r.ip_address || '',
        user_agent: r.user_agent || '',
        created_at: r.created_at,
        expires_at: r.expires_at,
      }));
      return res.json({ ok: true, sessions });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  @Post('profile/me/sessions/revoke-others')
  @HttpCode(200)
  async revokeMyOtherSessions(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    if (this.rejectIfKiosk(auth, res)) return;
    try {
      const result = await this.db.execute(
        'UPDATE user_sessions SET revoked = 1 WHERE user_id = ? AND id != ? AND revoked = 0',
        [auth.user.id, auth.sessionId]
      );
      this.db.invalidateAuthCache();
      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تسجيل خروج الأجهزة الأخرى للحساب',
        details: `تم إنهاء (${result.changes}) جلسة أخرى نشطة لهذا الحساب`,
        ip: getClientIp(req),
        severity: 'warning',
      });
      return res.json({ ok: true, revokedCount: result.changes });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // =========================================================================
  // ADMIN ROLE PHOTOS & ACCOUNT CREDENTIALS MANAGEMENT (users:manage)
  // =========================================================================

  private async upsertRoleDefaultAvatar(role: string, avatarUrl: string, nowIso: string) {
    if (!this.db.schemaCaps.rolePoliciesAvatars) {
      await this.db.saveProfileAvatar('role', role, { avatar_url: avatarUrl }, nowIso);
      return;
    }
    const existing = await this.db.queryOne<{ role: string }>(
      'SELECT role FROM role_policies WHERE role = ? LIMIT 1',
      [role]
    );
    if (existing) {
      await this.db.execute(
        'UPDATE role_policies SET avatar_url = ?, updated_at = ? WHERE role = ?',
        [avatarUrl, nowIso, role]
      );
    } else {
      const defaults = DEFAULT_ROLE_PERMISSIONS[role] || [];
      await this.db.execute(
        `INSERT INTO role_policies (role, permissions_json, avatar_url, updated_at)
         VALUES (?, ?, ?, ?)`,
        [role, JSON.stringify(defaults), avatarUrl, nowIso]
      );
    }
  }

  @Get('settings/role-accounts')
  @RequirePermission('users:manage')
  async getRoleAccounts(@Res() res: Response) {
    try {
      const secretHex = await this.db.getSessionSecret();
      const [users, rolePolicies, employees, avatarMap] = await Promise.all([
        this.db.queryAll<any>(
          `SELECT * FROM system_users ORDER BY is_active DESC, created_at ASC`
        ),
        this.db.queryAll<any>('SELECT * FROM role_policies'),
        this.db.queryAll<any>('SELECT * FROM employees'),
        this.db.loadProfileAvatarsMap(),
      ]);

      if (this.db.needsProfileAvatarFallback) {
        this.db.applyProfileAvatarMap(avatarMap, { users, employees, rolePolicies });
      }
      const policyMap = this.db.buildRolePoliciesMapWithFallback(rolePolicies, avatarMap);
      const empMap = new Map<string, any>(employees.map((e) => [e.id, e]));

      const countsByRole = new Map<string, { total: number; active: number }>();
      const accounts = users.map((u) => {
        const entry = countsByRole.get(u.role) || { total: 0, active: 0 };
        entry.total += 1;
        if (Number(u.is_active) === 1) entry.active += 1;
        countsByRole.set(u.role, entry);

        const rp = policyMap.get(u.role) || null;
        const emp = u.employee_id ? empMap.get(u.employee_id) || null : null;
        const roleMeta = ROLES_METADATA[u.role] || { label: u.role, shortLabel: u.role, icon: 'person', color: '#0B57D0' };
        const effectiveAvatarUrl = this.db.resolveEffectiveAvatarUrl(u, emp, rp);

        return {
          id: u.id,
          username: u.username,
          display_name: u.display_name,
          role: u.role,
          role_label: roleMeta.label,
          role_short_label: roleMeta.shortLabel || roleMeta.label,
          avatar_color: u.avatar_color || rp?.avatar_color || roleMeta.color || '#0B57D0',
          avatar_url: String(u.avatar_url || '').trim(),
          effective_avatar_url: effectiveAvatarUrl,
          avatar_preset: String(u.avatar_preset || emp?.avatar_preset || rp?.avatar_preset || '').trim(),
          is_active: Number(u.is_active) === 1,
          employee_id: u.employee_id || '',
          emp_code: emp?.emp_code || '',
          department: emp?.department || '',
          last_login_at: u.last_login_at || '',
          password_changed_at: u.password_changed_at || '',
          username_changed_at: u.username_changed_at || '',
          created_at: u.created_at,
          updated_at: u.updated_at,
          password_value: decryptPasswordForAdmin(u.pin_cipher, secretHex),
        };
      });

      const roles = ROLE_DISPLAY_ORDER.filter((r) => Boolean(ROLES_METADATA[r])).map((roleId) => {
        const meta = ROLES_METADATA[roleId];
        const rp = policyMap.get(roleId) || null;
        const counts = countsByRole.get(roleId) || { total: 0, active: 0 };
        return {
          id: roleId,
          label: meta.label,
          shortLabel: meta.shortLabel,
          icon: meta.icon,
          description: meta.description,
          color: rp?.avatar_color || meta.color,
          avatar_url: String(rp?.avatar_url || '').trim(),
          avatar_preset: String(rp?.avatar_preset || '').trim(),
          total_accounts: counts.total,
          active_accounts: counts.active,
        };
      });

      return res.json({ ok: true, roles, accounts });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  @Post('settings/roles/:role/avatar')
  @HttpCode(200)
  @RequirePermission('users:manage')
  async uploadRoleDefaultAvatar(
    @Param('role') role: string,
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      if (!ROLES_METADATA[role]) {
        return res.status(400).json({ ok: false, error: 'الدور الوظيفي غير صالح' });
      }
      if (role === 'owner' && auth.user.role !== 'owner') {
        return res.status(403).json({ ok: false, error: 'تعديل صورة دور المالك متاح للمالك فقط' });
      }

      const uploaded = await this.storage.uploadAvatarDataUrl(body?.dataUrl, `role_${role}`, {
        preferDataUrlWhenNoCloudBucket: this.db.storageMode === 'supabase_postgres',
      });
      if (uploaded.ok === false) {
        return res.status(400).json({ ok: false, error: uploaded.error });
      }

      const rawPrevRow = await this.db.queryOne<any>(
        'SELECT * FROM role_policies WHERE role = ? LIMIT 1',
        [role]
      );
      const { rolePolicyRow: prevRow } = await this.db.hydrateUserBundle(
        null,
        null,
        rawPrevRow,
        role
      );
      const nowIso = new Date().toISOString();
      await this.upsertRoleDefaultAvatar(role, uploaded.url, nowIso);

      if (prevRow?.avatar_url && prevRow.avatar_url !== uploaded.url) {
        await this.storage.deleteManagedAvatar(prevRow.avatar_url);
      }

      this.db.invalidateAuthCache();

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تحديث الصورة الافتراضية لدور وظيفي',
        details: `تحديث الصورة الافتراضية لدور (${ROLES_METADATA[role].label})`,
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('role_avatar_update');
      return res.json({ ok: true, role, avatar_url: uploaded.url });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  @Delete('settings/roles/:role/avatar')
  @RequirePermission('users:manage')
  async deleteRoleDefaultAvatar(
    @Param('role') role: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      if (!ROLES_METADATA[role]) {
        return res.status(400).json({ ok: false, error: 'الدور الوظيفي غير صالح' });
      }
      if (role === 'owner' && auth.user.role !== 'owner') {
        return res.status(403).json({ ok: false, error: 'تعديل صورة دور المالك متاح للمالك فقط' });
      }

      const rawPrevRow = await this.db.queryOne<any>(
        'SELECT * FROM role_policies WHERE role = ? LIMIT 1',
        [role]
      );
      const { rolePolicyRow: prevRow } = await this.db.hydrateUserBundle(
        null,
        null,
        rawPrevRow,
        role
      );
      await this.upsertRoleDefaultAvatar(role, '', new Date().toISOString());

      if (prevRow?.avatar_url) {
        await this.storage.deleteManagedAvatar(prevRow.avatar_url);
      }

      this.db.invalidateAuthCache();

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'إزالة الصورة الافتراضية لدور وظيفي',
        details: `إزالة الصورة الافتراضية لدور (${ROLES_METADATA[role].label})`,
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('role_avatar_delete');
      return res.json({ ok: true, role });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  @Post('settings/role-accounts/:id/avatar')
  @HttpCode(200)
  @RequirePermission('users:manage')
  async uploadAccountAvatar(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const rawTarget = await this.db.queryOne<any>(
        'SELECT * FROM system_users WHERE id = ? LIMIT 1',
        [id]
      );
      if (!rawTarget) {
        return res.status(404).json({ ok: false, error: 'الحساب غير موجود' });
      }
      if (rawTarget.role === 'owner' && auth.user.role !== 'owner') {
        return res.status(403).json({
          ok: false,
          error: 'غير مصرح بتعديل صورة حساب المالك إلا بواسطة المالك',
        });
      }

      const { userRow: target } = await this.db.hydrateUserBundle(
        rawTarget,
        null,
        null,
        rawTarget.role
      );

      const uploaded = await this.storage.uploadAvatarDataUrl(body?.dataUrl, target.id, {
        preferDataUrlWhenNoCloudBucket: this.db.storageMode === 'supabase_postgres',
      });
      if (uploaded.ok === false) {
        return res.status(400).json({ ok: false, error: uploaded.error });
      }

      const nowIso = new Date().toISOString();
      const oldUrl = target.avatar_url || '';

      if (this.db.schemaCaps.systemUsersRoleProfiles) {
        await this.db.execute(
          `UPDATE system_users SET avatar_url = ?, avatar_preset = '', updated_at = ? WHERE id = ?`,
          [uploaded.url, nowIso, target.id]
        );
      } else {
        await this.db.saveProfileAvatar(
          'user',
          target.id,
          { avatar_url: uploaded.url, avatar_preset: '' },
          nowIso
        );
      }
      if (target.employee_id) {
        if (this.db.schemaCaps.employeesAvatars) {
          await this.db.execute(
            `UPDATE employees SET avatar_url = ?, avatar_preset = '', updated_at = ? WHERE id = ?`,
            [uploaded.url, nowIso, target.employee_id]
          );
        } else {
          await this.db.saveProfileAvatar(
            'employee',
            target.employee_id,
            { avatar_url: uploaded.url, avatar_preset: '' },
            nowIso
          );
        }
      }

      if (oldUrl && oldUrl !== uploaded.url) {
        await this.storage.deleteManagedAvatar(oldUrl);
      }

      this.db.invalidateAuthCache();

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تحديث صورة حساب مستخدم',
        details: `تم تحديث الصورة الشخصية لحساب "${target.display_name}" (@${target.username})`,
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('account_avatar_update');
      return res.json({ ok: true, id: target.id, avatar_url: uploaded.url });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  @Delete('settings/role-accounts/:id/avatar')
  @RequirePermission('users:manage')
  async deleteAccountAvatar(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const rawTarget = await this.db.queryOne<any>(
        'SELECT * FROM system_users WHERE id = ? LIMIT 1',
        [id]
      );
      if (!rawTarget) {
        return res.status(404).json({ ok: false, error: 'الحساب غير موجود' });
      }
      if (rawTarget.role === 'owner' && auth.user.role !== 'owner') {
        return res.status(403).json({
          ok: false,
          error: 'غير مصرح بحذف صورة حساب المالك إلا بواسطة المالك',
        });
      }

      const { userRow: target } = await this.db.hydrateUserBundle(
        rawTarget,
        null,
        null,
        rawTarget.role
      );

      const oldUrl = target.avatar_url || '';
      const nowIso = new Date().toISOString();

      if (this.db.schemaCaps.systemUsersRoleProfiles) {
        await this.db.execute(
          `UPDATE system_users SET avatar_url = '', updated_at = ? WHERE id = ?`,
          [nowIso, target.id]
        );
      } else {
        await this.db.saveProfileAvatar('user', target.id, { avatar_url: '' }, nowIso);
      }
      if (target.employee_id) {
        if (this.db.schemaCaps.employeesAvatars) {
          await this.db.execute(
            `UPDATE employees SET avatar_url = '', updated_at = ? WHERE id = ?`,
            [nowIso, target.employee_id]
          );
        } else {
          await this.db.saveProfileAvatar(
            'employee',
            target.employee_id,
            { avatar_url: '' },
            nowIso
          );
        }
      }

      if (oldUrl) {
        await this.storage.deleteManagedAvatar(oldUrl);
      }

      this.db.invalidateAuthCache();

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'حذف صورة حساب مستخدم',
        details: `إزالة الصورة المخصصة لحساب "${target.display_name}" (@${target.username})`,
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('account_avatar_delete');
      return res.json({ ok: true, id: target.id });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  @Put('settings/role-accounts/:id/credentials')
  @RequirePermission('users:manage')
  async updateAccountCredentials(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const rawTarget = await this.db.queryOne<any>(
        'SELECT * FROM system_users WHERE id = ? LIMIT 1',
        [id]
      );
      if (!rawTarget) {
        return res.status(404).json({ ok: false, error: 'الحساب غير موجود' });
      }
      const { userRow: target } = await this.db.hydrateUserBundle(
        rawTarget,
        null,
        null,
        rawTarget.role
      );

      // Escalation guards
      const nextRole = body?.role !== undefined ? String(body.role).trim() : target.role;
      if (!ROLES_METADATA[nextRole]) {
        return res.status(400).json({ ok: false, error: 'الدور الوظيفي غير صالح' });
      }
      if (auth.user.role !== 'owner' && (target.role === 'owner' || nextRole === 'owner')) {
        return res.status(403).json({
          ok: false,
          error: 'غير مصرح بتعديل حساب المالك أو منح صلاحية المالك',
        });
      }

      const nextActive =
        body?.is_active !== undefined ? Boolean(body.is_active) : Number(target.is_active) === 1;

      if (target.role === 'owner' && (nextRole !== 'owner' || !nextActive)) {
        const activeOwnersRow = await this.db.queryOne<{ c: any }>(
          "SELECT COUNT(*) as c FROM system_users WHERE role = 'owner' AND is_active = 1"
        );
        if (Number(activeOwnersRow?.c || 0) <= 1) {
          return res.status(400).json({
            ok: false,
            error: 'لا يمكن إيقاف أو تغيير دور حساب المالك الوحيد النشط في النظام!',
          });
        }
      }

      let nextDisplayName = target.display_name;
      if (body?.display_name !== undefined) {
        const clean = String(body.display_name || '').trim();
        if (clean.length < 2 || clean.length > 60) {
          return res.status(400).json({
            ok: false,
            error: 'الاسم الظاهر يجب أن يكون بين حرفين و 60 حرفاً',
          });
        }
        nextDisplayName = clean;
      }

      let nextUsername = target.username;
      let usernameChangedAt = target.username_changed_at || '';
      const nowIso = new Date().toISOString();

      if (body?.username !== undefined) {
        const check = validateUsernameFormat(body.username);
        if (!check.ok) {
          return res.status(400).json({ ok: false, error: check.reason });
        }
        if (check.normalized !== String(target.username || '').toLowerCase()) {
          const taken = await this.db.queryOne<{ id: string }>(
            'SELECT id FROM system_users WHERE LOWER(username) = LOWER(?) AND id != ? LIMIT 1',
            [check.normalized, target.id]
          );
          if (taken) {
            return res.status(409).json({
              ok: false,
              error: 'اسم المستخدم محجوز بالفعل لحساب آخر',
            });
          }
          nextUsername = check.normalized;
          usernameChangedAt = nowIso;
        }
      }

      let nextColor = target.avatar_color || '#0B57D0';
      if (body?.avatar_color !== undefined) {
        const cleanColor = String(body.avatar_color || '').trim();
        if (!HEX_COLOR_REGEX.test(cleanColor)) {
          return res.status(400).json({ ok: false, error: 'صيغة اللون غير صالحة' });
        }
        nextColor = cleanColor;
      }

      let nextPreset = target.avatar_preset || '';
      let nextAvatarUrl = target.avatar_url || '';
      let oldAvatarToDelete = '';
      if (body?.avatar_preset !== undefined) {
        const cleanPreset = String(body.avatar_preset || '').trim();
        if (!VALID_AVATAR_PRESETS.has(cleanPreset)) {
          return res.status(400).json({ ok: false, error: 'الأفاتار المحدد غير مدعوم' });
        }
        nextPreset = cleanPreset;
        if (cleanPreset && body?.clear_photo !== false) {
          oldAvatarToDelete = target.avatar_url || '';
          nextAvatarUrl = '';
        }
      }

      const rawNewPass = normalizeDigits(
        String(body?.new_password ?? body?.password ?? '').trim()
      );
      let saltHex = target.pin_salt;
      let hashHex = target.pin_hash;
      let cipher = target.pin_cipher || '';
      let passwordChangedAt = target.password_changed_at || '';
      let nextSessionVersion = Number(target.session_version || 1);

      const passwordChanged = rawNewPass.length > 0;
      if (passwordChanged) {
        if (rawNewPass.length < 3 || rawNewPass.length > 64) {
          return res.status(400).json({
            ok: false,
            error: 'كلمة المرور يجب أن تكون بين 3 و 64 حرفاً أو رقماً',
          });
        }
        const conflict = await this.db.findPasswordConflict(rawNewPass, target.id);
        if (conflict) {
          return res.status(400).json({
            ok: false,
            error: `كلمة المرور هذه مستخدمة بالفعل لـ "${conflict.display_name}" — اختر كلمة مرور مميزة لكل حساب`,
          });
        }
        const hashed = hashPin(rawNewPass);
        saltHex = hashed.saltHex;
        hashHex = hashed.hashHex;
        cipher = encryptPasswordForAdmin(rawNewPass, await this.db.getSessionSecret());
        passwordChangedAt = nowIso;
      }

      const shouldRevokeSessions = Boolean(
        body?.revoke_sessions || passwordChanged || nextRole !== target.role || !nextActive
      );
      if (shouldRevokeSessions) {
        nextSessionVersion += 1;
      }

      if (this.db.schemaCaps.systemUsersRoleProfiles) {
        await this.db.execute(
          `UPDATE system_users
           SET username = ?, display_name = ?, role = ?, pin_salt = ?, pin_hash = ?, pin_cipher = ?,
               avatar_color = ?, avatar_preset = ?, avatar_url = ?, is_active = ?,
               session_version = ?, password_changed_at = ?, username_changed_at = ?, updated_at = ?
           WHERE id = ?`,
          [
            nextUsername,
            nextDisplayName,
            nextRole,
            saltHex,
            hashHex,
            cipher,
            nextColor,
            nextPreset,
            nextAvatarUrl,
            nextActive ? 1 : 0,
            nextSessionVersion,
            passwordChangedAt,
            usernameChangedAt,
            nowIso,
            target.id,
          ]
        );
      } else {
        await this.db.execute(
          `UPDATE system_users
           SET username = ?, display_name = ?, role = ?, pin_salt = ?, pin_hash = ?, pin_cipher = ?,
               avatar_color = ?, is_active = ?, updated_at = ?
           WHERE id = ?`,
          [
            nextUsername,
            nextDisplayName,
            nextRole,
            saltHex,
            hashHex,
            cipher,
            nextColor,
            nextActive ? 1 : 0,
            nowIso,
            target.id,
          ]
        );
        if (
          body?.avatar_preset !== undefined ||
          body?.avatar_color !== undefined ||
          oldAvatarToDelete
        ) {
          await this.db.saveProfileAvatar(
            'user',
            target.id,
            {
              avatar_url: nextAvatarUrl,
              avatar_preset: nextPreset,
              avatar_color: nextColor,
            },
            nowIso
          );
        }
      }

      // Sync non-badge fields to linked employee (never corrupt employees.emp_code QR badge!)
      if (target.employee_id) {
        if (this.db.schemaCaps.employeesAvatars) {
          await this.db.execute(
            `UPDATE employees
             SET name = ?, system_role = ?, login_enabled = ?, avatar_color = ?, avatar_preset = ?, avatar_url = ?, updated_at = ?
             WHERE id = ?`,
            [
              nextDisplayName,
              nextRole,
              nextActive ? 1 : 0,
              nextColor,
              nextPreset,
              nextAvatarUrl,
              nowIso,
              target.employee_id,
            ]
          );
        } else {
          await this.db.execute(
            `UPDATE employees
             SET name = ?, system_role = ?, login_enabled = ?, avatar_color = ?, updated_at = ?
             WHERE id = ?`,
            [
              nextDisplayName,
              nextRole,
              nextActive ? 1 : 0,
              nextColor,
              nowIso,
              target.employee_id,
            ]
          );
          if (
            body?.avatar_preset !== undefined ||
            body?.avatar_color !== undefined ||
            oldAvatarToDelete
          ) {
            await this.db.saveProfileAvatar(
              'employee',
              target.employee_id,
              {
                avatar_url: nextAvatarUrl,
                avatar_preset: nextPreset,
                avatar_color: nextColor,
              },
              nowIso
            );
          }
        }
      }

      if (oldAvatarToDelete) {
        await this.storage.deleteManagedAvatar(oldAvatarToDelete);
      }

      let freshToken: string | undefined;
      if (shouldRevokeSessions) {
        await this.db.execute(
          'UPDATE user_sessions SET revoked = 1 WHERE user_id = ? AND revoked = 0',
          [target.id]
        );
        if (target.id === auth.user.id && nextActive) {
          freshToken = await this.db.issueSessionForUser(
            { id: target.id, session_version: nextSessionVersion },
            getClientIp(req),
            String(req.headers['user-agent'] || '')
          );
        }
      }
      this.db.invalidateAuthCache();

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تحديث بيانات/كلمة مرور حساب دور',
        details: `تحديث "${nextDisplayName}" (@${nextUsername}) — الدور: ${ROLES_METADATA[nextRole].label}${passwordChanged ? ' [تغيير كلمة المرور]' : ''}`,
        ip: getClientIp(req),
        severity: passwordChanged || !nextActive ? 'warning' : 'info',
      });

      await this.realtime.broadcastStoreUpdate('account_credentials_update');
      const updatedAccount = await this.loadFullPublicUser(target.id);
      return res.json({
        ok: true,
        account: updatedAccount,
        ...(freshToken ? { token: freshToken } : {}),
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
}

@Module({
  controllers: [SettingsController],
})
export class SettingsModule {}
