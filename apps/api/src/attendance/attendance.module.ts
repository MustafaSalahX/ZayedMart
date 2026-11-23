import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { getLocalDateKey, getLocalTimeHMS, normalizeDigits } from '@zayed-mart/shared';
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
  @RequireAnyPermission(['attendance:write', 'attendance:kiosk'])
  async recordAttendance(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const canRecord =
        auth.has('attendance:write') ||
        (auth.user.role === 'kiosk' && auth.has('attendance:kiosk'));
      if (!canRecord) {
        return res.status(403).json({
          error: 'تسجيل الحضور والانصراف متاح فقط للأدمن والمدير والمشرف والأمن ومراقب الكاميرات',
        });
      }

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
        confirm_by_cctv,
        cctv_observed_time = '',
        cctv_note = '',
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
      const canVerify = auth.has('attendance:verify');
      const autoVerified =
        canVerify &&
        confirm_by_cctv !== false &&
        confirm_by_cctv !== 'false' &&
        confirm_by_cctv !== 0;
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
        verified_by: autoVerified ? auth.actorLabel : '',
        cctv_status: autoVerified ? 'confirmed' : 'pending',
        cctv_observed_time: autoVerified ? String(cctv_observed_time || '').trim() : '',
        cctv_note: autoVerified ? String(cctv_note || '').trim().slice(0, 300) : '',
        timestamp: isFullWrite ? timestamp : undefined,
        allowed_break_minutes: isFullWrite ? allowed_break_minutes : 0,
        break_reason: isFullWrite ? break_reason : '',
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
  @RequireAnyPermission(['attendance:write', 'attendance:kiosk'])
  async quickScan(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const canRecord =
        auth.has('attendance:write') ||
        (auth.user.role === 'kiosk' && auth.has('attendance:kiosk'));
      if (!canRecord) {
        return res.status(403).json({
          error: 'تسجيل الحضور والانصراف متاح فقط للأدمن والمدير والمشرف والأمن ومراقب الكاميرات',
        });
      }

      const {
        code_or_qr = '',
        preferred_action = '',
        allowed_break_minutes = 0,
        break_reason = '',
        allow_reopen_shift = false,
        confirm_by_cctv,
        cctv_observed_time = '',
        cctv_note = '',
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
      const canVerify = auth.has('attendance:verify');
      const autoVerified =
        canVerify &&
        confirm_by_cctv !== false &&
        confirm_by_cctv !== 'false' &&
        confirm_by_cctv !== 0;

      const created = await this.db.insertAttendanceLog({
        emp,
        action_type: actionType,
        note: 'تسجيل سريع عبر الكود / QR',
        recorded_by: `${auth.actorLabel} [QR]`,
        autoVerified,
        verified_by: autoVerified ? auth.actorLabel : '',
        cctv_status: autoVerified ? 'confirmed' : 'pending',
        cctv_observed_time: autoVerified ? String(cctv_observed_time || '').trim() : '',
        cctv_note: autoVerified ? String(cctv_note || '').trim().slice(0, 300) : '',
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
  @HttpCode(200)
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
        `UPDATE attendance_logs
         SET verified_by_cctv = 1,
             verified_at = ?,
             verified_by = ?,
             cctv_status = 'confirmed',
             synced = 1
         WHERE date_key = ?
           AND verified_by_cctv = 0
           AND COALESCE(cctv_status, 'pending') != 'mismatch'`,
        [now, auth.actorLabel, dateKey]
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
      return res.status(200).json({ ok: true, count: result.changes });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post(':id/verify')
  @HttpCode(200)
  @RequirePermission('attendance:verify')
  async verifyOne(
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
        return res.status(404).json({ error: 'السجل غير موجود' });
      }

      const status = body?.status === 'mismatch' ? 'mismatch' : 'confirmed';
      const verifiedFlag = status === 'confirmed' ? 1 : 0;
      const now = new Date().toISOString();
      let observedTime = String(body?.observed_time ?? body?.cctv_observed_time ?? '')
        .trim()
        .slice(0, 20);
      if (status === 'confirmed' && !observedTime) {
        const tsDate = new Date(existing.timestamp);
        if (!Number.isNaN(tsDate.getTime())) {
          observedTime = getLocalTimeHMS(tsDate).slice(0, 5);
        }
      }
      const cctvNote = String(body?.note ?? body?.cctv_note ?? '')
        .trim()
        .slice(0, 300);

      await this.db.execute(
        `UPDATE attendance_logs
         SET verified_by_cctv = ?,
             verified_at = ?,
             verified_by = ?,
             cctv_status = ?,
             cctv_observed_time = ?,
             cctv_note = ?,
             synced = 1
         WHERE id = ?`,
        [verifiedFlag, now, auth.actorLabel, status, observedTime, cctvNote, existing.id]
      );

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: status === 'mismatch' ? 'تنبيه تعارض حضور بالكاميرا' : 'تأكيد حضور بالكاميرا',
        details: `الموظف "${existing.employee_name}" (${existing.action_type})${observedTime ? ` — وقت الكاميرا ${observedTime}` : ''}${cctvNote ? ` — ${cctvNote}` : ''}`,
        ip: getClientIp(req),
        severity: status === 'mismatch' ? 'warning' : 'info',
      });

      const updated = await this.db.queryOne(
        'SELECT * FROM attendance_logs WHERE id = ?',
        [existing.id]
      );
      await this.realtime.broadcastStoreUpdate('attendance_verify');
      return res.status(200).json({ ok: true, log: updated });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Patch(':id/verify')
  @RequirePermission('attendance:verify')
  async verifyOnePatch(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    return this.verifyOne(id, body, auth, req, res);
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

      const existingCctvStatus =
        existing.cctv_status || (Number(existing.verified_by_cctv) === 1 ? 'confirmed' : 'pending');
      const requestedStatus =
        body?.cctv_status === 'confirmed' ||
        body?.cctv_status === 'mismatch' ||
        body?.cctv_status === 'pending'
          ? body.cctv_status
          : null;

      let nextVerified = Number(existing.verified_by_cctv || 0);
      let nextCctvStatus: 'pending' | 'confirmed' | 'mismatch' = existingCctvStatus;

      if (requestedStatus) {
        nextCctvStatus = requestedStatus;
        nextVerified = requestedStatus === 'confirmed' ? 1 : 0;
      } else if (body?.verified_by_cctv !== undefined) {
        nextVerified = body.verified_by_cctv ? 1 : 0;
        nextCctvStatus =
          nextVerified === 1
            ? 'confirmed'
            : existingCctvStatus === 'mismatch'
            ? 'mismatch'
            : 'pending';
      }

      const nowIso = new Date().toISOString();
      const statusChanged = nextCctvStatus !== existingCctvStatus;
      let nextVerifiedAt = existing.verified_at || '';
      let nextVerifiedBy =
        body?.verified_by !== undefined
          ? String(body.verified_by || '').trim()
          : existing.verified_by || '';

      if (nextCctvStatus === 'pending') {
        nextVerifiedAt = '';
        nextVerifiedBy = '';
      } else if (statusChanged || !nextVerifiedAt) {
        nextVerifiedAt = nowIso;
        if (!nextVerifiedBy) {
          nextVerifiedBy = auth.actorLabel;
        }
      }

      const rawObservedInput = body?.cctv_observed_time ?? body?.observed_time;
      let nextObservedTime =
        rawObservedInput !== undefined
          ? String(rawObservedInput || '').trim().slice(0, 20)
          : nextCctvStatus === 'pending'
          ? ''
          : existing.cctv_observed_time || '';
      if (nextCctvStatus === 'confirmed' && !nextObservedTime) {
        const parsedNext = new Date(nextIso);
        if (!Number.isNaN(parsedNext.getTime())) {
          nextObservedTime = getLocalTimeHMS(parsedNext).slice(0, 5);
        }
      }

      const nextCctvNote =
        body?.cctv_note !== undefined
          ? String(body.cctv_note || '').trim().slice(0, 300)
          : nextCctvStatus === 'pending'
          ? ''
          : existing.cctv_note || '';

      await this.db.execute(
        `UPDATE attendance_logs
         SET action_type = ?, timestamp = ?, date_key = ?, shift_date_key = ?,
             late_minutes = ?, allowed_break_minutes = ?, break_duration_minutes = ?, break_reason = ?,
             note = ?, verified_by_cctv = ?, verified_at = ?, verified_by = ?,
             cctv_status = ?, cctv_observed_time = ?, cctv_note = ?, synced = 1
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
          nextVerifiedAt,
          nextVerifiedBy,
          nextCctvStatus,
          nextObservedTime,
          nextCctvNote,
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
