import {
  Body,
  Controller,
  Delete,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { getLocalDateKey, normalizeDigits } from '@zayed-mart/shared';
import type { Request, Response } from 'express';
import { getClientIp } from '../common/crypto.util';
import {
  AuthContext,
  CurrentAuth,
  RequireAnyPermission,
  RequirePermission,
} from '../common/decorators';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';

@Controller('api/attendance')
export class AttendanceController {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService
  ) {}

  @Post()
  @RequireAnyPermission(['attendance:write', 'attendance:kiosk', 'attendance:self'])
  async recordAttendance(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const {
        id: clientId,
        employee_id,
        action_type,
        note = '',
        proof_url = '',
        timestamp,
        allowed_break_minutes = 0,
        break_reason = '',
        allow_reopen_shift = false,
      } = body || {};

      const validActions = ['check_in', 'break_start', 'break_end', 'check_out'];
      if (!employee_id || !validActions.includes(action_type)) {
        return res.status(400).json({ error: 'بيانات حركة الحضور غير مكتملة' });
      }

      const emp = await this.db.queryOne<any>(
        'SELECT * FROM employees WHERE id = ? AND is_active = 1',
        [employee_id]
      );
      if (!emp) {
        return res.status(404).json({ error: 'الموظف غير موجود' });
      }

      const isFullWrite = auth.has('attendance:write');
      const isKiosk = auth.has('attendance:kiosk');

      if (!isFullWrite && !isKiosk) {
        // User only has attendance:self — verify they are acting on their own employee record
        const userRow = await this.db.queryOne<any>(
          'SELECT employee_id, display_name FROM system_users WHERE id = ? LIMIT 1',
          [auth.user.id]
        );
        const isOwnEmployee =
          (userRow?.employee_id && userRow.employee_id === emp.id) ||
          String(emp.name || '').trim() === String(auth.user.display_name || '').trim();
        if (!isOwnEmployee) {
          return res.status(403).json({
            error: 'صلاحيتك تسمح بتسجيل حضورك وبريكك الشخصي فقط وليس لباقي الموظفين',
          });
        }
      }

      const autoVerified = auth.has('attendance:verify');
      const canReopen = Boolean(allow_reopen_shift) && (auth.has('records:manage') || isFullWrite);

      const created = await this.db.insertAttendanceLog({
        id: clientId,
        emp,
        action_type,
        note: isFullWrite
          ? String(note || (canReopen ? 'إعادة فتح حضور الشفت استثنائياً' : '')).slice(0, 300)
          : '',
        proof_url: isFullWrite ? proof_url : '',
        recorded_by: auth.actorLabel,
        autoVerified,
        timestamp: isFullWrite ? timestamp : undefined,
        allowed_break_minutes: isFullWrite || auth.has('attendance:self') ? allowed_break_minutes : 0,
        break_reason: isFullWrite || auth.has('attendance:self') ? break_reason : '',
        allow_reopen_shift: canReopen,
        actorUser: auth.user,
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('attendance');
      return res.status(201).json({ ok: true, log: created });
    } catch (err: any) {
      const status = typeof err?.getStatus === 'function' ? err.getStatus() : err?.status || 500;
      return res.status(status).json({ error: err.message });
    }
  }

  @Post('quick-scan')
  @RequireAnyPermission(['attendance:kiosk', 'attendance:write', 'attendance:self'])
  async quickScan(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const {
        code_or_qr = '',
        preferred_action = '',
        allowed_break_minutes = 0,
        break_reason = '',
        allow_reopen_shift = false,
      } = body || {};

      const raw = normalizeDigits(String(code_or_qr || '').trim());
      if (!raw) {
        return res
          .status(400)
          .json({ error: 'يرجى مسح كرت الـ QR أو إدخال الكود السريع' });
      }

      let emp: any = null;
      if (raw.startsWith('ZMART:EMP:')) {
        const empId = raw.slice('ZMART:EMP:'.length).trim();
        emp = await this.db.queryOne(
          'SELECT * FROM employees WHERE id = ? AND is_active = 1',
          [empId]
        );
      } else if (raw.startsWith('ZMART:CODE:')) {
        const code = raw.slice('ZMART:CODE:'.length).trim();
        emp = await this.db.queryOne(
          'SELECT * FROM employees WHERE emp_code = ? AND is_active = 1',
          [code]
        );
      } else {
        emp = await this.db.queryOne(
          'SELECT * FROM employees WHERE (emp_code = ? OR id = ?) AND is_active = 1',
          [raw, raw]
        );
      }

      if (!emp) {
        return res
          .status(404)
          .json({ error: `لم يتم العثور على موظف بالكود (${raw})` });
      }

      if (!auth.has('attendance:write') && !auth.has('attendance:kiosk')) {
        const userRow = await this.db.queryOne<any>(
          'SELECT employee_id, display_name FROM system_users WHERE id = ? LIMIT 1',
          [auth.user.id]
        );
        const isOwnEmployee =
          (userRow?.employee_id && userRow.employee_id === emp.id) ||
          String(emp.name || '').trim() === String(auth.user.display_name || '').trim();
        if (!isOwnEmployee) {
          return res.status(403).json({
            error: 'صلاحيتك تسمح بمسح الكود الخاص بك فقط',
          });
        }
      }

      const todayKey = getLocalDateKey();
      const openShift = await this.db.findOpenShiftForEmployee(emp.id, new Date());
      const latestLog = openShift.isOpen
        ? openShift.latestLog
        : await this.db.queryOne<any>(
            'SELECT * FROM attendance_logs WHERE employee_id = ? AND date_key = ? ORDER BY timestamp DESC LIMIT 1',
            [emp.id, todayKey]
          );

      if (!preferred_action && latestLog) {
        const elapsedSec = (Date.now() - new Date(latestLog.timestamp).getTime()) / 1000;
        if (elapsedSec < 45) {
          return res.json({
            ok: true,
            duplicateGuard: true,
            employee: emp,
            action_type: latestLog.action_type,
            message: `تم تسجيل حركة "${emp.name}" منذ ثوانٍ بالفعل ✓`,
          });
        }
      }

      const validActions = ['check_in', 'break_start', 'break_end', 'check_out'];
      let actionType = validActions.includes(preferred_action) ? preferred_action : '';
      if (!actionType) {
        if (!latestLog || latestLog.action_type === 'check_out') {
          actionType = 'check_in';
        } else if (latestLog.action_type === 'break_start') {
          actionType = 'break_end';
        } else {
          actionType = 'check_out';
        }
      }

      const canReopen =
        Boolean(allow_reopen_shift) && (auth.has('records:manage') || auth.has('attendance:write'));

      const created = await this.db.insertAttendanceLog({
        emp,
        action_type: actionType,
        note: 'تسجيل سريع عبر الكود / QR',
        recorded_by: `${auth.actorLabel} [QR]`,
        autoVerified: auth.has('attendance:verify'),
        allowed_break_minutes,
        break_reason,
        allow_reopen_shift: canReopen,
        actorUser: auth.user,
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('attendance_qr');
      return res.status(201).json({
        ok: true,
        employee: emp,
        action_type: actionType,
        nextAction: actionType,
        log: created,
      });
    } catch (err: any) {
      const status = typeof err?.getStatus === 'function' ? err.getStatus() : err?.status || 500;
      return res.status(status).json({ error: err.message });
    }
  }

  @Post('verify-all')
  @RequirePermission('attendance:verify')
  async verifyAll(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const dateKey = body?.date_key || getLocalDateKey();
      const now = new Date().toISOString();
      const result = await this.db.execute(
        'UPDATE attendance_logs SET verified_by_cctv = 1, verified_at = ?, synced = 1 WHERE date_key = ? AND verified_by_cctv = 0',
        [now, dateKey]
      );

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'مطابقة جماعية لحضور الموظفين',
        details: `تم اعتماد مطابقة ${result.changes} حركة لتاريخ ${dateKey}`,
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('attendance_verify_all');
      return res.json({ ok: true, count: result.changes });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post(':id/verify')
  @RequirePermission('attendance:verify')
  async verifyOne(@Param('id') id: string, @Res() res: Response) {
    try {
      const now = new Date().toISOString();
      const result = await this.db.execute(
        'UPDATE attendance_logs SET verified_by_cctv = 1, verified_at = ?, synced = 1 WHERE id = ?',
        [now, id]
      );
      if (result.changes === 0) {
        return res.status(404).json({ error: 'السجل غير موجود' });
      }
      await this.realtime.broadcastStoreUpdate('attendance_verify');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Patch(':id/verify')
  @RequirePermission('attendance:verify')
  async verifyOnePatch(@Param('id') id: string, @Res() res: Response) {
    return this.verifyOne(id, res);
  }

  @Put(':id')
  @RequirePermission('records:manage')
  async updateAttendance(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const existing = await this.db.queryOne<any>(
        'SELECT * FROM attendance_logs WHERE id = ?',
        [id]
      );
      if (!existing) {
        return res.status(404).json({ error: 'سجل الحضور غير موجود' });
      }

      const validActions = ['check_in', 'break_start', 'break_end', 'check_out'];
      const nextAction = validActions.includes(body?.action_type)
        ? body.action_type
        : existing.action_type;

      let nextIso = existing.timestamp;
      let nextDateKey = existing.date_key;
      if (body?.timestamp) {
        const parsed = new Date(body.timestamp);
        if (!Number.isNaN(parsed.getTime())) {
          nextIso = parsed.toISOString();
          nextDateKey = getLocalDateKey(parsed);
        }
      }

      const nextShiftDateKey =
        body?.shift_date_key !== undefined && String(body.shift_date_key).trim()
          ? String(body.shift_date_key).trim()
          : existing.shift_date_key || nextDateKey;

      const nextLate =
        body?.late_minutes !== undefined
          ? Math.max(0, Number(normalizeDigits(body.late_minutes)) || 0)
          : Number(existing.late_minutes || 0);

      const nextAllowedBreak =
        body?.allowed_break_minutes !== undefined
          ? Math.max(0, Number(normalizeDigits(body.allowed_break_minutes)) || 0)
          : Number(existing.allowed_break_minutes || 0);

      const nextBreakDuration =
        body?.break_duration_minutes !== undefined
          ? Math.max(0, Number(normalizeDigits(body.break_duration_minutes)) || 0)
          : Number(existing.break_duration_minutes || 0);

      const nextBreakReason =
        body?.break_reason !== undefined
          ? String(body.break_reason || '').slice(0, 120)
          : existing.break_reason || '';

      const nextNote =
        body?.note !== undefined
          ? String(body.note || '').slice(0, 300)
          : existing.note;

      const nextVerified =
        body?.verified_by_cctv !== undefined
          ? body.verified_by_cctv
            ? 1
            : 0
          : Number(existing.verified_by_cctv || 0);

      await this.db.execute(
        `UPDATE attendance_logs
         SET action_type = ?, timestamp = ?, date_key = ?, shift_date_key = ?,
             late_minutes = ?, allowed_break_minutes = ?, break_duration_minutes = ?, break_reason = ?,
             note = ?, verified_by_cctv = ?, synced = 1
         WHERE id = ?`,
        [
          nextAction,
          nextIso,
          nextDateKey,
          nextShiftDateKey,
          nextLate,
          nextAllowedBreak,
          nextBreakDuration,
          nextBreakReason,
          nextNote,
          nextVerified,
          existing.id,
        ]
      );

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تعديل سجل حضور',
        details: `تعديل حركة الموظف "${existing.employee_name}" (${nextAction})`,
        ip: getClientIp(req),
      });

      const updated = await this.db.queryOne(
        'SELECT * FROM attendance_logs WHERE id = ?',
        [existing.id]
      );
      await this.realtime.broadcastStoreUpdate('attendance_edit');
      return res.json({ ok: true, log: updated });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Delete(':id')
  @RequirePermission('records:manage')
  async deleteAttendance(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const existing = await this.db.queryOne<any>(
        'SELECT * FROM attendance_logs WHERE id = ?',
        [id]
      );
      if (!existing) {
        return res.status(404).json({ error: 'سجل الحضور غير موجود' });
      }
      await this.db.execute('DELETE FROM attendance_logs WHERE id = ?', [existing.id]);

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'حذف سجل حضور',
        details: `حذف حركة (${existing.action_type}) للموظف "${existing.employee_name}"`,
        ip: getClientIp(req),
        severity: 'warning',
      });

      await this.realtime.broadcastStoreUpdate('attendance_delete');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
}

@Module({
  controllers: [AttendanceController],
})
export class AttendanceModule {}
