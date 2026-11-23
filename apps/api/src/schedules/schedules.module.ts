import {
  Body,
  Controller,
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
  computeShiftDurationHours,
  formatShiftDurationArabic,
  getCairoDateKey,
  getLocalDateKey,
  getPreviousDateKey,
  getSaturdayWeekStart,
  getScheduleWeekdayLabel,
  getWeekDateKeys,
  getWeekdayCodeFromDateKey,
  inferScheduleTeam,
  isScheduleTeamGroup,
  isScheduleWeekday,
  normalizeDigits,
  SCHEDULE_TEAM_GROUP_IDS,
  SCHEDULE_TEAM_GROUPS,
  SCHEDULE_WEEKDAYS,
  ScheduleTeamGroup,
  ScheduleWeekday,
  shiftWeekStart,
} from '@zayed-mart/shared';
import crypto from 'node:crypto';
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

const PENDING_SWAP_STATUSES = ['pending_requester', 'pending_peer', 'pending_manager'] as const;
const VALID_SWAP_STATUSES = [
  'pending_requester',
  'pending_peer',
  'pending_manager',
  'approved',
  'rejected',
  'cancelled',
  'reverted',
] as const;

function parseShiftTimeToMinutes(hhmm?: string, fallback = 8 * 60): number {
  const clean = String(hhmm || '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(clean)) return fallback;
  const [h, m] = clean.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return fallback;
  }
  return h * 60 + m;
}

function doShiftsOverlap(startA?: string, endA?: string, startB?: string, endB?: string): boolean {
  const sA = parseShiftTimeToMinutes(startA, 8 * 60);
  let eA = parseShiftTimeToMinutes(endA, 20 * 60);
  if (eA <= sA) eA += 24 * 60;

  const sB = parseShiftTimeToMinutes(startB, 8 * 60);
  let eB = parseShiftTimeToMinutes(endB, 20 * 60);
  if (eB <= sB) eB += 24 * 60;

  const dayMinutes = 24 * 60;
  for (const offset of [-dayMinutes, 0, dayMinutes]) {
    if (Math.max(sA, sB + offset) < Math.min(eA, eB + offset)) {
      return true;
    }
  }
  return false;
}

function classifyShiftPeriod(shiftStart?: string): 'morning' | 'evening' | 'night' {
  const minutes = parseShiftTimeToMinutes(shiftStart, 8 * 60);
  const hour = Math.floor(minutes / 60);
  if (hour >= 4 && hour < 13) return 'morning';
  if (hour >= 13 && hour < 20) return 'evening';
  return 'night';
}

@Controller('api/schedules')
export class SchedulesController {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService
  ) {}

  private isDateKey(value: unknown): value is string {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  }

  private async loadEmployeeNamesMap(
    rows: Array<{ requester_employee_id?: string; target_employee_id?: string }>,
    seedMap?: Map<string, string>
  ): Promise<Map<string, string>> {
    const map = seedMap ? new Map(seedMap) : new Map<string, string>();
    const missingIds = Array.from(
      new Set(
        rows
          .flatMap((r) => [r.requester_employee_id, r.target_employee_id])
          .map((id) => String(id || '').trim())
          .filter((id) => id && !map.has(id))
      )
    );
    if (missingIds.length > 0) {
      const placeholders = missingIds.map(() => '?').join(', ');
      const found = await this.db.queryAll<{ id: string; name: string }>(
        `SELECT id, name FROM employees WHERE id IN (${placeholders})`,
        missingIds
      );
      for (const e of found) {
        map.set(e.id, e.name);
      }
    }
    return map;
  }

  private enrichSwapRow(
    s: any,
    empNameById: Map<string, string>,
    options: { myEmployeeId: string; canManage: boolean; canSwap: boolean }
  ) {
    const reqApproved = Number(s.requester_approved || 0);
    const tgtApproved = Number(s.target_approved || 0);
    const mgrApproved = Number(s.manager_approved || 0);
    const isPending = (PENDING_SWAP_STATUSES as readonly string[]).includes(s.status);
    const { myEmployeeId, canManage, canSwap } = options;

    let awaitingMyAction = false;
    if (
      s.status === 'pending_requester' &&
      myEmployeeId &&
      s.requester_employee_id === myEmployeeId &&
      reqApproved === 0 &&
      canSwap
    ) {
      awaitingMyAction = true;
    } else if (
      s.status === 'pending_peer' &&
      myEmployeeId &&
      s.target_employee_id === myEmployeeId &&
      tgtApproved === 0 &&
      canSwap
    ) {
      awaitingMyAction = true;
    } else if (s.status === 'pending_manager' && canManage && mgrApproved === 0) {
      awaitingMyAction = true;
    }

    const canCancel = Boolean(
      isPending &&
        (canManage || (myEmployeeId && s.requester_employee_id === myEmployeeId && canSwap))
    );
    const canRevert = Boolean(s.status === 'approved' && canManage);

    return {
      ...s,
      requester_approved: reqApproved,
      target_approved: tgtApproved,
      manager_approved: mgrApproved,
      requester_name: empNameById.get(s.requester_employee_id) || '',
      target_name: s.target_employee_id ? empNameById.get(s.target_employee_id) || '' : '',
      awaiting_my_action: awaitingMyAction,
      can_cancel: canCancel,
      can_revert: canRevert,
    };
  }

  @Get('week')
  @RequireAnyPermission(['schedule:read', 'schedule:manage', 'schedule:swap_request'])
  async getWeekSchedule(
    @Query('weekStart') weekStart: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const trimmedWeek = String(weekStart || '').trim();
      if (trimmedWeek && !this.isDateKey(trimmedWeek)) {
        return res.status(400).json({ error: 'صيغة تاريخ الأسبوع غير صحيحة (YYYY-MM-DD)' });
      }

      const todayDateKey = getCairoDateKey();
      const todayWeekday = getWeekdayCodeFromDateKey(todayDateKey);
      const weekStartDate = getSaturdayWeekStart(trimmedWeek || todayDateKey);
      const weekDates = getWeekDateKeys(weekStartDate);

      const targetAttDate = getLocalDateKey();
      const prevAttDate = getPreviousDateKey(targetAttDate);

      const canManage = auth.has('schedule:manage');
      const canSwap = auth.has('schedule:swap_request') || canManage;
      const canVerify = auth.has('attendance:verify');
      const hasFullShiftVisibility =
        auth.user.role === 'owner' ||
        canManage ||
        auth.has('attendance:write') ||
        canVerify;
      const canSeeEmpCode = canManage || auth.user.role === 'owner';

      const [
        myEmployee,
        effectiveList,
        settings,
        weekSwapsRaw,
        directLogs,
        prevShiftLogs,
        settingsMap,
      ] = await Promise.all([
        this.db.resolveEmployeeForAuth(auth),
        this.db.getEffectiveWeekSchedule(weekStartDate),
        this.db.getScheduleSettings(),
        this.db.queryAll<any>(
          'SELECT * FROM dayoff_swap_requests WHERE week_start_date = ? ORDER BY created_at DESC',
          [weekStartDate]
        ),
        this.db.queryAll<any>(
          'SELECT * FROM attendance_logs WHERE date_key = ? OR shift_date_key = ? ORDER BY timestamp DESC',
          [targetAttDate, targetAttDate]
        ),
        this.db.queryAll<any>(
          'SELECT * FROM attendance_logs WHERE date_key = ? OR shift_date_key = ? ORDER BY timestamp ASC',
          [prevAttDate, prevAttDate]
        ),
        this.db.getSettingsMap(),
      ]);
      const myEmployeeId = myEmployee?.id || '';
      const myEffectiveEmp = myEmployeeId
        ? effectiveList.find((e) => e.id === myEmployeeId)
        : null;
      const userTeamGroup: ScheduleTeamGroup = myEffectiveEmp?.team_group
        ? myEffectiveEmp.team_group
        : await this.db.resolveTeamGroupForAuth(auth);
      const visibleGroups: ScheduleTeamGroup[] = hasFullShiftVisibility
        ? [...SCHEDULE_TEAM_GROUP_IDS]
        : [userTeamGroup];

      const empNameById = new Map<string, string>(
        effectiveList.map((e) => [e.id, String(e.name || '')])
      );
      const groupLabelById = new Map<ScheduleTeamGroup, string>(
        SCHEDULE_TEAM_GROUPS.map((g) => [g.id, g.label])
      );

      // Merge today's logs with active cross-day shifts from yesterday
      const prevByEmp = new Map<string, any[]>();
      for (const l of prevShiftLogs) {
        if (!prevByEmp.has(l.employee_id)) prevByEmp.set(l.employee_id, []);
        prevByEmp.get(l.employee_id)!.push(l);
      }
      const mergedById = new Map<string, any>();
      for (const l of directLogs) {
        mergedById.set(l.id, l);
      }
      const nowMs = Date.now();
      for (const [, empPrevLogs] of prevByEmp.entries()) {
        const lastPrev = empPrevLogs[empPrevLogs.length - 1];
        if (!lastPrev) continue;
        const touchedTargetDate = empPrevLogs.some((l) => l.date_key === targetAttDate);
        const lastPrevDateObj = new Date(lastPrev.timestamp);
        const isNightOrEveningOnPrev = lastPrevDateObj.getHours() >= 14;
        const isStillOpenFromYesterday =
          lastPrev.action_type !== 'check_out' &&
          ((nowMs - lastPrevDateObj.getTime()) / (3600 * 1000) <= 22 || isNightOrEveningOnPrev);
        if (touchedTargetDate || isStillOpenFromYesterday) {
          const lastShiftKey = lastPrev.shift_date_key || lastPrev.date_key;
          for (const l of empPrevLogs) {
            if ((l.shift_date_key || l.date_key) === lastShiftKey) {
              mergedById.set(l.id, l);
            }
          }
        }
      }
      const attendanceLogs = Array.from(mergedById.values()).sort((a, b) =>
        String(b.timestamp).localeCompare(String(a.timestamp))
      );
      const logsByEmp = new Map<string, any[]>();
      for (let i = attendanceLogs.length - 1; i >= 0; i--) {
        const log = attendanceLogs[i];
        if (!logsByEmp.has(log.employee_id)) logsByEmp.set(log.employee_id, []);
        logsByEmp.get(log.employee_id)!.push(log);
      }
      const defaultMaxBreak = Number(settingsMap.max_break_minutes || 30);

      const resolveLogCctvStatus = (log: any): 'confirmed' | 'mismatch' | 'pending' => {
        if (log?.cctv_status === 'mismatch') return 'mismatch';
        if (log?.cctv_status === 'confirmed' || Number(log?.verified_by_cctv) === 1) {
          return 'confirmed';
        }
        return 'pending';
      };

      const groups = visibleGroups.map((groupId) => {
        const meta = SCHEDULE_TEAM_GROUPS.find((g) => g.id === groupId)!;
        const groupEmps = effectiveList
          .filter((e) => e.team_group === groupId)
          .map((e) => ({
            id: e.id,
            ...(canSeeEmpCode ? { emp_code: e.emp_code } : {}),
            name: e.name,
            department: e.department,
            role_title: e.role_title || '',
            avatar_color: e.avatar_color || '#1A73E8',
            shift_start: e.shift_start || '08:00',
            shift_end: e.shift_end || '20:00',
            team_group: e.team_group,
            default_day_of_week: e.default_day_of_week,
            effective_day_of_week: e.effective_day_of_week,
            is_override: e.is_override,
            override_source: e.override_source,
            swap_request_id: e.swap_request_id,
          }));

        const totalCount = groupEmps.length;
        const minRequired = settings.minOnDuty[groupId] ?? meta.defaultMinOnDuty;
        const coverageByDay = {} as Record<
          ScheduleWeekday,
          {
            dateKey: string;
            offCount: number;
            onDutyCount: number;
            totalCount: number;
            minRequired: number;
            lowCoverage: boolean;
            offEmployeeIds: string[];
          }
        >;

        for (const dayMeta of SCHEDULE_WEEKDAYS) {
          const day = dayMeta.code;
          const offEmployeeIds = groupEmps
            .filter((e) => e.effective_day_of_week === day)
            .map((e) => e.id);
          const offCount = offEmployeeIds.length;
          const onDutyCount = Math.max(0, totalCount - offCount);
          const lowCoverage =
            totalCount > 0 &&
            (onDutyCount === 0 || onDutyCount < Math.min(minRequired, totalCount));
          coverageByDay[day] = {
            dateKey: weekDates[day],
            offCount,
            onDutyCount,
            totalCount,
            minRequired,
            lowCoverage,
            offEmployeeIds,
          };
        }

        return {
          id: meta.id,
          label: meta.label,
          shortLabel: meta.shortLabel,
          icon: meta.icon,
          tone: meta.tone,
          defaultMinOnDuty: meta.defaultMinOnDuty,
          employees: groupEmps,
          coverageByDay,
        };
      });

      const myShiftStart = myEffectiveEmp?.shift_start || '08:00';
      const myShiftEnd = myEffectiveEmp?.shift_end || '20:00';

      const shiftRoster = effectiveList
        .map((e) => {
          const shiftStart = e.shift_start || '08:00';
          const shiftEnd = e.shift_end || '20:00';
          const isMe = Boolean(myEmployeeId && e.id === myEmployeeId);
          const overlapsMyShift = myEffectiveEmp
            ? doShiftsOverlap(shiftStart, shiftEnd, myShiftStart, myShiftEnd)
            : false;

          if (!hasFullShiftVisibility && e.team_group !== userTeamGroup && !overlapsMyShift) {
            return null;
          }

          const allEmpLogs = logsByEmp.get(e.id) || [];
          const latestLog = allEmpLogs[allEmpLogs.length - 1] || null;
          const activeShiftKey = latestLog?.shift_date_key || latestLog?.date_key || targetAttDate;
          const empLogs = allEmpLogs.filter(
            (l) => (l.shift_date_key || l.date_key) === activeShiftKey
          );
          const firstCheckIn =
            empLogs.find((l) => l.action_type === 'check_in') ||
            allEmpLogs.find((l) => l.action_type === 'check_in');
          const checkOutLog = empLogs.filter((l) => l.action_type === 'check_out').pop() || null;

          let currentStatus: 'present' | 'on_break' | 'checked_out' | 'absent' = 'absent';
          if (latestLog) {
            if (latestLog.action_type === 'check_in' || latestLog.action_type === 'break_end') {
              currentStatus = 'present';
            } else if (latestLog.action_type === 'break_start') {
              currentStatus = 'on_break';
            } else if (latestLog.action_type === 'check_out') {
              currentStatus = 'checked_out';
            }
          }

          const isScheduledOffToday = Boolean(
            e.effective_day_of_week && e.effective_day_of_week === todayWeekday
          );
          const hasCheckInToday = allEmpLogs.some(
            (l) =>
              l.action_type === 'check_in' &&
              (l.date_key === targetAttDate ||
                l.shift_date_key === targetAttDate ||
                l.date_key === todayDateKey ||
                l.shift_date_key === todayDateKey)
          );
          const workedOnDayOff = Boolean(isScheduledOffToday && hasCheckInToday);

          const shiftDurationHours = computeShiftDurationHours(shiftStart, shiftEnd);
          const shiftDurationLabel = formatShiftDurationArabic(shiftDurationHours);

          const baseItem = {
            id: e.id,
            name: e.name,
            department: e.department,
            role_title: e.role_title || '',
            avatar_color: e.avatar_color || '#1A73E8',
            team_group: e.team_group,
            team_group_label: groupLabelById.get(e.team_group) || e.team_group,
            shift_start: shiftStart,
            shift_end: shiftEnd,
            shiftDurationHours,
            shiftDurationLabel,
            shiftPeriod: classifyShiftPeriod(shiftStart),
            effective_day_of_week: e.effective_day_of_week,
            default_day_of_week: e.default_day_of_week,
            is_override: e.is_override,
            currentStatus,
            isScheduledOffToday,
            workedOnDayOff,
            overlapsMyShift,
            isMe,
          };

          if (!hasFullShiftVisibility) {
            return baseItem;
          }

          const breakEnds = empLogs.filter((l) => l.action_type === 'break_end');
          let totalBreakMinutes = breakEnds.reduce(
            (sum, l) => sum + (Number(l.break_duration_minutes) || 0),
            0
          );
          if (currentStatus === 'on_break' && latestLog) {
            const currentBreakElapsed = Math.max(
              0,
              Math.round((nowMs - new Date(latestLog.timestamp).getTime()) / 60000)
            );
            totalBreakMinutes += currentBreakElapsed;
          }
          const allowedBreakMinutes =
            currentStatus === 'on_break' && latestLog
              ? Number(latestLog.allowed_break_minutes) || defaultMaxBreak
              : defaultMaxBreak;
          const activeBreakStart =
            currentStatus === 'on_break' && latestLog ? latestLog.timestamp : null;
          const lateMinutes = firstCheckIn ? Number(firstCheckIn.late_minutes || 0) : 0;

          return {
            ...baseItem,
            checkInTime: firstCheckIn ? firstCheckIn.timestamp : null,
            checkOutTime: checkOutLog ? checkOutLog.timestamp : null,
            latestActionTime: latestLog ? latestLog.timestamp : null,
            lateMinutes,
            totalBreakMinutes,
            allowedBreakMinutes,
            activeBreakStart,
            latestLogId: latestLog ? latestLog.id : null,
            latestRecordedBy: latestLog ? latestLog.recorded_by : null,
            latestVerified: latestLog ? Boolean(Number(latestLog.verified_by_cctv)) : true,
            latestCctvStatus: latestLog ? resolveLogCctvStatus(latestLog) : ('none' as const),
            latestVerifiedBy: latestLog ? latestLog.verified_by || '' : '',
            latestCctvObservedTime: latestLog ? latestLog.cctv_observed_time || '' : '',
            latestCctvNote: latestLog ? latestLog.cctv_note || '' : '',
            phone: e.phone || '',
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      const filteredSwaps = canManage
        ? weekSwapsRaw
        : myEmployeeId
        ? weekSwapsRaw.filter(
            (s) =>
              s.requester_employee_id === myEmployeeId || s.target_employee_id === myEmployeeId
          )
        : [];

      const fullNameMap = await this.loadEmployeeNamesMap(filteredSwaps, empNameById);
      const swaps = filteredSwaps.map((s) =>
        this.enrichSwapRow(s, fullNameMap, { myEmployeeId, canManage, canSwap })
      );

      return res.json({
        ok: true,
        weekStartDate,
        weekDates,
        todayDateKey,
        todayWeekday,
        canManage,
        canSwap,
        canVerify,
        hasFullShiftVisibility,
        myEmployeeId,
        userTeamGroup,
        visibleGroups,
        settings,
        groups,
        shiftRoster,
        swaps,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Put('assign')
  @RequirePermission('schedule:manage')
  async assignDayOff(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const cleanEmpId = String(body?.employeeId || '').trim();
      if (!cleanEmpId) {
        return res.status(400).json({ error: 'يرجى تحديد الموظف' });
      }

      const rawScope = body?.scope;
      if (rawScope !== undefined && rawScope !== 'default' && rawScope !== 'week') {
        return res.status(400).json({ error: 'نطاق التعديل غير صالح (default أو week)' });
      }
      const scope: 'default' | 'week' =
        rawScope || (body?.weekStartDate ? 'week' : 'default');

      const hasDayProp = Object.prototype.hasOwnProperty.call(body || {}, 'dayOfWeek');
      const rawDay = body?.dayOfWeek;
      const isClearingDay = rawDay === null || rawDay === '';
      if (hasDayProp && !isClearingDay && !isScheduleWeekday(rawDay)) {
        return res.status(400).json({ error: 'يوم الإجازة المختار غير صالح' });
      }

      const rawTeamGroup = body?.teamGroup;
      let explicitTeamGroup: ScheduleTeamGroup | null = null;
      if (rawTeamGroup !== undefined && rawTeamGroup !== null && String(rawTeamGroup).trim() !== '') {
        if (!isScheduleTeamGroup(rawTeamGroup)) {
          return res.status(400).json({ error: 'مجموعة العمل المختارة غير صالحة' });
        }
        explicitTeamGroup = rawTeamGroup;
      }

      if (!hasDayProp && !explicitTeamGroup) {
        return res.status(400).json({ error: 'يرجى تحديد يوم الإجازة أو المجموعة' });
      }

      const rawWeek = String(body?.weekStartDate || '').trim();
      if (scope === 'week' && rawWeek && !this.isDateKey(rawWeek)) {
        return res.status(400).json({ error: 'صيغة تاريخ الأسبوع غير صحيحة (YYYY-MM-DD)' });
      }

      const emp = await this.db.queryOne<any>(
        'SELECT * FROM employees WHERE id = ? AND is_active = 1',
        [cleanEmpId]
      );
      if (!emp) {
        return res.status(404).json({ error: 'الموظف غير موجود أو غير نشط' });
      }

      const existingDefault = await this.db.queryOne<any>(
        'SELECT * FROM employee_dayoff_defaults WHERE employee_id = ?',
        [emp.id]
      );
      const currentDefaultGroup = isScheduleTeamGroup(existingDefault?.team_group)
        ? existingDefault.team_group
        : inferScheduleTeam(emp);
      const effectiveTeamGroup: ScheduleTeamGroup = explicitTeamGroup || currentDefaultGroup;
      const teamGroupChanged = Boolean(
        explicitTeamGroup && explicitTeamGroup !== currentDefaultGroup
      );

      const nowIso = new Date().toISOString();
      const currentSat = getSaturdayWeekStart(getCairoDateKey());
      const canonicalWeek =
        scope === 'week' ? getSaturdayWeekStart(rawWeek || getCairoDateKey()) : '';
      const statements: Array<{ sql: string; params?: any[] }> = [];

      if (scope === 'default') {
        if (isClearingDay) {
          statements.push({
            sql: 'DELETE FROM employee_dayoff_defaults WHERE employee_id = ?',
            params: [emp.id],
          });
        } else {
          const targetDay: ScheduleWeekday | null = isScheduleWeekday(rawDay)
            ? rawDay
            : isScheduleWeekday(existingDefault?.day_of_week)
            ? existingDefault.day_of_week
            : null;
          if (!targetDay) {
            return res.status(400).json({ error: 'يرجى تحديد يوم الإجازة الثابت للموظف' });
          }
          statements.push({
            sql: `INSERT INTO employee_dayoff_defaults (employee_id, team_group, day_of_week, updated_by, updated_at)
                  VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT (employee_id) DO UPDATE SET
                    team_group = EXCLUDED.team_group,
                    day_of_week = EXCLUDED.day_of_week,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = EXCLUDED.updated_at`,
            params: [emp.id, effectiveTeamGroup, targetDay, auth.actorLabel, nowIso],
          });
        }

        if (teamGroupChanged) {
          statements.push({
            sql: `UPDATE weekly_dayoff_overrides
                  SET team_group = ?, updated_by = ?, updated_at = ?
                  WHERE employee_id = ? AND week_start_date >= ?`,
            params: [effectiveTeamGroup, auth.actorLabel, nowIso, emp.id, currentSat],
          });
        }

        statements.push({
          sql: `UPDATE dayoff_swap_requests
                SET status = 'cancelled',
                    rejection_reason = 'تم تعديل الجدول بواسطة الإدارة',
                    updated_at = ?
                WHERE week_start_date >= ?
                  AND status IN ('pending_requester', 'pending_peer', 'pending_manager')
                  AND (requester_employee_id = ? OR target_employee_id = ?)`,
          params: [nowIso, currentSat, emp.id, emp.id],
        });
      } else {
        if (isClearingDay) {
          statements.push({
            sql: 'DELETE FROM weekly_dayoff_overrides WHERE week_start_date = ? AND employee_id = ?',
            params: [canonicalWeek, emp.id],
          });
        } else {
          let targetDay: ScheduleWeekday | null = isScheduleWeekday(rawDay) ? rawDay : null;
          if (!targetDay) {
            const existingWeekOvr = await this.db.queryOne<any>(
              'SELECT day_of_week FROM weekly_dayoff_overrides WHERE week_start_date = ? AND employee_id = ?',
              [canonicalWeek, emp.id]
            );
            targetDay = isScheduleWeekday(existingWeekOvr?.day_of_week)
              ? existingWeekOvr.day_of_week
              : isScheduleWeekday(existingDefault?.day_of_week)
              ? existingDefault.day_of_week
              : null;
          }
          if (!targetDay) {
            return res.status(400).json({ error: 'يرجى تحديد يوم الإجازة لهذا الأسبوع' });
          }
          statements.push({
            sql: `INSERT INTO weekly_dayoff_overrides (
                    id, week_start_date, employee_id, team_group, day_of_week, source, swap_request_id, updated_by, updated_at
                  ) VALUES (?, ?, ?, ?, ?, 'manual', '', ?, ?)
                  ON CONFLICT (week_start_date, employee_id) DO UPDATE SET
                    team_group = EXCLUDED.team_group,
                    day_of_week = EXCLUDED.day_of_week,
                    source = 'manual',
                    swap_request_id = '',
                    updated_by = EXCLUDED.updated_by,
                    updated_at = EXCLUDED.updated_at`,
            params: [
              crypto.randomUUID(),
              canonicalWeek,
              emp.id,
              effectiveTeamGroup,
              targetDay,
              auth.actorLabel,
              nowIso,
            ],
          });
        }

        if (teamGroupChanged) {
          if (existingDefault) {
            statements.push({
              sql: 'UPDATE employee_dayoff_defaults SET team_group = ?, updated_by = ?, updated_at = ? WHERE employee_id = ?',
              params: [effectiveTeamGroup, auth.actorLabel, nowIso, emp.id],
            });
          }
          statements.push({
            sql: `UPDATE weekly_dayoff_overrides
                  SET team_group = ?, updated_by = ?, updated_at = ?
                  WHERE employee_id = ? AND week_start_date >= ?`,
            params: [effectiveTeamGroup, auth.actorLabel, nowIso, emp.id, currentSat],
          });
        }

        statements.push({
          sql: `UPDATE dayoff_swap_requests
                SET status = 'cancelled',
                    rejection_reason = 'تم تعديل الجدول بواسطة الإدارة',
                    updated_at = ?
                WHERE week_start_date = ?
                  AND status IN ('pending_requester', 'pending_peer', 'pending_manager')
                  AND (requester_employee_id = ? OR target_employee_id = ?)`,
          params: [nowIso, canonicalWeek, emp.id, emp.id],
        });
      }

      await this.db.executeBatch(statements);

      const dayText = isClearingDay
        ? 'مسح الإجازة'
        : isScheduleWeekday(rawDay)
        ? getScheduleWeekdayLabel(rawDay)
        : 'تحديث المجموعة';
      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تعديل جدول الإجازات',
        details: `${emp.name}: ${dayText} (${scope === 'default' ? 'الجدول الثابت' : `أسبوع ${canonicalWeek}`})`,
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('day_off_schedule');
      return res.json({
        ok: true,
        scope,
        weekStartDate: scope === 'week' ? canonicalWeek : undefined,
        employeeId: emp.id,
        teamGroup: effectiveTeamGroup,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('bulk')
  @HttpCode(200)
  @RequirePermission('schedule:manage')
  async bulkScheduleAction(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const action = String(body?.action || '').trim();
      const nowIso = new Date().toISOString();
      const todayKey = getCairoDateKey();
      const currentSat = getSaturdayWeekStart(todayKey);

      if (action === 'save_entries') {
        const rawScope = body?.scope;
        if (rawScope !== undefined && rawScope !== 'default' && rawScope !== 'week') {
          return res.status(400).json({ error: 'نطاق التعديل غير صالح (default أو week)' });
        }
        const scope: 'default' | 'week' =
          rawScope || (body?.weekStartDate ? 'week' : 'default');
        const rawWeek = String(body?.weekStartDate || '').trim();
        if (scope === 'week' && rawWeek && !this.isDateKey(rawWeek)) {
          return res.status(400).json({ error: 'صيغة تاريخ الأسبوع غير صحيحة (YYYY-MM-DD)' });
        }
        const canonicalWeek = scope === 'week' ? getSaturdayWeekStart(rawWeek || todayKey) : '';

        const entries = Array.isArray(body?.entries) ? body.entries : [];
        if (entries.length === 0) {
          return res.status(400).json({ error: 'يرجى إرسال بيانات موظف واحد على الأقل' });
        }

        const [activeEmps, defaultsRows] = await Promise.all([
          this.db.queryAll<any>('SELECT * FROM employees WHERE is_active = 1'),
          this.db.queryAll<any>('SELECT * FROM employee_dayoff_defaults'),
        ]);
        const empById = new Map<string, any>(activeEmps.map((e) => [e.id, e]));
        const defaultByEmpId = new Map<string, any>(defaultsRows.map((d) => [d.employee_id, d]));

        const statements: Array<{ sql: string; params?: any[] }> = [];
        const touchedEmpIds: string[] = [];

        for (const entry of entries) {
          const empId = String(entry?.employeeId || '').trim();
          const emp = empById.get(empId);
          if (!emp) {
            return res.status(400).json({ error: `الموظف غير موجود أو غير نشط (${empId})` });
          }

          const rawDay = entry?.dayOfWeek;
          const isClearing = rawDay === null || rawDay === '' || rawDay === undefined;
          if (!isClearing && !isScheduleWeekday(rawDay)) {
            return res.status(400).json({ error: `يوم الإجازة غير صالح للموظف ${emp.name}` });
          }

          let explicitTeamGroup: ScheduleTeamGroup | null = null;
          if (
            entry?.teamGroup !== undefined &&
            entry?.teamGroup !== null &&
            String(entry.teamGroup).trim() !== ''
          ) {
            if (!isScheduleTeamGroup(entry.teamGroup)) {
              return res.status(400).json({ error: `المجموعة غير صالحة للموظف ${emp.name}` });
            }
            explicitTeamGroup = entry.teamGroup;
          }

          const existingDefault = defaultByEmpId.get(empId);
          const currentDefaultGroup = isScheduleTeamGroup(existingDefault?.team_group)
            ? existingDefault.team_group
            : inferScheduleTeam(emp);
          const teamGroup = explicitTeamGroup || currentDefaultGroup;
          const teamGroupChanged = Boolean(
            explicitTeamGroup && explicitTeamGroup !== currentDefaultGroup
          );

          touchedEmpIds.push(empId);

          if (scope === 'default') {
            if (isClearing) {
              statements.push({
                sql: 'DELETE FROM employee_dayoff_defaults WHERE employee_id = ?',
                params: [empId],
              });
            } else {
              statements.push({
                sql: `INSERT INTO employee_dayoff_defaults (employee_id, team_group, day_of_week, updated_by, updated_at)
                      VALUES (?, ?, ?, ?, ?)
                      ON CONFLICT (employee_id) DO UPDATE SET
                        team_group = EXCLUDED.team_group,
                        day_of_week = EXCLUDED.day_of_week,
                        updated_by = EXCLUDED.updated_by,
                        updated_at = EXCLUDED.updated_at`,
                params: [empId, teamGroup, rawDay, auth.actorLabel, nowIso],
              });
            }
            if (teamGroupChanged) {
              statements.push({
                sql: `UPDATE weekly_dayoff_overrides
                      SET team_group = ?, updated_by = ?, updated_at = ?
                      WHERE employee_id = ? AND week_start_date >= ?`,
                params: [teamGroup, auth.actorLabel, nowIso, empId, currentSat],
              });
            }
          } else {
            if (isClearing) {
              statements.push({
                sql: 'DELETE FROM weekly_dayoff_overrides WHERE week_start_date = ? AND employee_id = ?',
                params: [canonicalWeek, empId],
              });
            } else {
              statements.push({
                sql: `INSERT INTO weekly_dayoff_overrides (
                        id, week_start_date, employee_id, team_group, day_of_week, source, swap_request_id, updated_by, updated_at
                      ) VALUES (?, ?, ?, ?, ?, 'manual', '', ?, ?)
                      ON CONFLICT (week_start_date, employee_id) DO UPDATE SET
                        team_group = EXCLUDED.team_group,
                        day_of_week = EXCLUDED.day_of_week,
                        source = 'manual',
                        swap_request_id = '',
                        updated_by = EXCLUDED.updated_by,
                        updated_at = EXCLUDED.updated_at`,
                params: [
                  crypto.randomUUID(),
                  canonicalWeek,
                  empId,
                  teamGroup,
                  rawDay,
                  auth.actorLabel,
                  nowIso,
                ],
              });
            }
            if (teamGroupChanged && existingDefault) {
              statements.push({
                sql: 'UPDATE employee_dayoff_defaults SET team_group = ?, updated_by = ?, updated_at = ? WHERE employee_id = ?',
                params: [teamGroup, auth.actorLabel, nowIso, empId],
              });
            }
          }
        }

        const uniqueEmpIds = Array.from(new Set(touchedEmpIds));
        if (uniqueEmpIds.length > 0) {
          const placeholders = uniqueEmpIds.map(() => '?').join(', ');
          if (scope === 'default') {
            statements.push({
              sql: `UPDATE dayoff_swap_requests
                    SET status = 'cancelled',
                        rejection_reason = 'تم تعديل الجدول بواسطة الإدارة',
                        updated_at = ?
                    WHERE week_start_date >= ?
                      AND status IN ('pending_requester', 'pending_peer', 'pending_manager')
                      AND (requester_employee_id IN (${placeholders}) OR target_employee_id IN (${placeholders}))`,
              params: [nowIso, currentSat, ...uniqueEmpIds, ...uniqueEmpIds],
            });
          } else {
            statements.push({
              sql: `UPDATE dayoff_swap_requests
                    SET status = 'cancelled',
                        rejection_reason = 'تم تعديل الجدول بواسطة الإدارة',
                        updated_at = ?
                    WHERE week_start_date = ?
                      AND status IN ('pending_requester', 'pending_peer', 'pending_manager')
                      AND (requester_employee_id IN (${placeholders}) OR target_employee_id IN (${placeholders}))`,
              params: [nowIso, canonicalWeek, ...uniqueEmpIds, ...uniqueEmpIds],
            });
          }
        }

        await this.db.executeBatch(statements);
        await this.db.recordAuditLog({
          userId: auth.user.id,
          userName: auth.user.display_name,
          role: auth.user.role,
          action: 'حفظ جماعي لجدول الإجازات',
          details: `تحديث (${entries.length}) موظف (${scope === 'default' ? 'الجدول الثابت' : `أسبوع ${canonicalWeek}`})`,
          ip: getClientIp(req),
        });
        await this.realtime.broadcastStoreUpdate('day_off_schedule');
        return res.json({
          ok: true,
          action,
          scope,
          weekStartDate: scope === 'week' ? canonicalWeek : undefined,
          count: entries.length,
        });
      }

      if (action === 'copy_previous_week') {
        const rawWeek = String(body?.weekStartDate || '').trim();
        if (rawWeek && !this.isDateKey(rawWeek)) {
          return res.status(400).json({ error: 'صيغة تاريخ الأسبوع غير صحيحة (YYYY-MM-DD)' });
        }
        const targetWeek = getSaturdayWeekStart(rawWeek || todayKey);
        const prevWeek = shiftWeekStart(targetWeek, -1);
        const prevSchedule = await this.db.getEffectiveWeekSchedule(prevWeek);
        const toCopy = prevSchedule.filter((e) => isScheduleWeekday(e.effective_day_of_week));

        const statements: Array<{ sql: string; params?: any[] }> = toCopy.map((emp) => ({
          sql: `INSERT INTO weekly_dayoff_overrides (
                  id, week_start_date, employee_id, team_group, day_of_week, source, swap_request_id, updated_by, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'manual', '', ?, ?)
                ON CONFLICT (week_start_date, employee_id) DO UPDATE SET
                  team_group = EXCLUDED.team_group,
                  day_of_week = EXCLUDED.day_of_week,
                  source = 'manual',
                  swap_request_id = '',
                  updated_by = EXCLUDED.updated_by,
                  updated_at = EXCLUDED.updated_at`,
          params: [
            crypto.randomUUID(),
            targetWeek,
            emp.id,
            emp.team_group,
            emp.effective_day_of_week,
            auth.actorLabel,
            nowIso,
          ],
        }));

        statements.push({
          sql: `UPDATE dayoff_swap_requests
                SET status = 'cancelled',
                    rejection_reason = 'تم تعديل الجدول بواسطة الإدارة',
                    updated_at = ?
                WHERE week_start_date = ?
                  AND status IN ('pending_requester', 'pending_peer', 'pending_manager')`,
          params: [nowIso, targetWeek],
        });

        await this.db.executeBatch(statements);
        await this.db.recordAuditLog({
          userId: auth.user.id,
          userName: auth.user.display_name,
          role: auth.user.role,
          action: 'نسخ جدول الإجازات من الأسبوع السابق',
          details: `نسخ (${toCopy.length}) موظف من أسبوع ${prevWeek} إلى أسبوع ${targetWeek}`,
          ip: getClientIp(req),
        });
        await this.realtime.broadcastStoreUpdate('day_off_schedule');
        return res.json({
          ok: true,
          action,
          weekStartDate: targetWeek,
          previousWeekStartDate: prevWeek,
          copiedCount: toCopy.length,
        });
      }

      if (action === 'reset_to_defaults') {
        const rawWeek = String(body?.weekStartDate || '').trim();
        if (rawWeek && !this.isDateKey(rawWeek)) {
          return res.status(400).json({ error: 'صيغة تاريخ الأسبوع غير صحيحة (YYYY-MM-DD)' });
        }
        const targetWeek = getSaturdayWeekStart(rawWeek || todayKey);

        await this.db.executeBatch([
          {
            sql: 'DELETE FROM weekly_dayoff_overrides WHERE week_start_date = ?',
            params: [targetWeek],
          },
          {
            sql: `UPDATE dayoff_swap_requests
                  SET status = 'cancelled',
                      rejection_reason = 'تمت إعادة تعيين جدول الأسبوع للجدول الثابت',
                      updated_at = ?
                  WHERE week_start_date = ?
                    AND status IN ('pending_requester', 'pending_peer', 'pending_manager')`,
            params: [nowIso, targetWeek],
          },
        ]);

        await this.db.recordAuditLog({
          userId: auth.user.id,
          userName: auth.user.display_name,
          role: auth.user.role,
          action: 'إعادة تعيين جدول الأسبوع للثابت',
          details: `حذف استثناءات أسبوع ${targetWeek} والعودة للجدول الثابت`,
          ip: getClientIp(req),
        });
        await this.realtime.broadcastStoreUpdate('day_off_schedule');
        return res.json({ ok: true, action, weekStartDate: targetWeek });
      }

      return res.status(400).json({ error: 'الإجراء الجماعي غير مدعوم' });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Put('settings')
  @RequirePermission('schedule:manage')
  async updateSettings(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const statements: Array<{ sql: string; params?: any[] }> = [];
      const upsertSql = `INSERT INTO settings (key, value) VALUES (?, ?)
                         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;

      if (body && Object.prototype.hasOwnProperty.call(body, 'swapRequiresManagerApproval')) {
        const rawFlag = body.swapRequiresManagerApproval;
        const boolVal =
          rawFlag === true ||
          rawFlag === 1 ||
          String(rawFlag).trim().toLowerCase() === 'true' ||
          String(rawFlag).trim() === '1';
        statements.push({
          sql: upsertSql,
          params: ['dayoff_swap_requires_manager_approval', boolVal ? 'true' : 'false'],
        });
      }

      if (body?.minOnDuty && typeof body.minOnDuty === 'object') {
        const keyMap: Record<ScheduleTeamGroup, string> = {
          cashiers: 'dayoff_min_onduty_cashiers',
          hall: 'dayoff_min_onduty_hall',
          security_cctv: 'dayoff_min_onduty_security_cctv',
        };
        for (const groupId of SCHEDULE_TEAM_GROUP_IDS) {
          if (Object.prototype.hasOwnProperty.call(body.minOnDuty, groupId)) {
            const parsed = Number(normalizeDigits(String(body.minOnDuty[groupId] ?? '')).trim());
            if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
              return res.status(400).json({
                error: 'الحد الأدنى للموظفين المتواجدين يجب أن يكون رقماً صحيحاً (0 أو أكثر)',
              });
            }
            statements.push({
              sql: upsertSql,
              params: [keyMap[groupId], String(Math.floor(parsed))],
            });
          }
        }
      }

      if (statements.length > 0) {
        await this.db.executeBatch(statements);
      }

      const settings = await this.db.getScheduleSettings();
      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تحديث إعدادات جدول الإجازات',
        details: `اعتماد الإدارة الإلزامي: ${settings.swapRequiresManagerApproval ? 'مفعل' : 'تلقائي بموافقة الموظفين'} | الحد الأدنى: كاشير=${settings.minOnDuty.cashiers}, صالة=${settings.minOnDuty.hall}, أمن=${settings.minOnDuty.security_cctv}`,
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('day_off_settings');
      return res.json({ ok: true, settings });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Get('swaps')
  @RequireAnyPermission(['schedule:read', 'schedule:manage', 'schedule:swap_request'])
  async listSwaps(
    @Query('weekStart') weekStart: string | undefined,
    @Query('status') status: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const canManage = auth.has('schedule:manage');
      const canSwap = auth.has('schedule:swap_request') || canManage;
      const myEmployee = await this.db.resolveEmployeeForAuth(auth);
      const myEmployeeId = myEmployee?.id || '';

      if (!canManage && !myEmployeeId) {
        return res.json({ ok: true, swaps: [] });
      }

      const where: string[] = [];
      const params: any[] = [];

      const trimmedWeek = String(weekStart || '').trim();
      if (trimmedWeek) {
        if (!this.isDateKey(trimmedWeek)) {
          return res.status(400).json({ error: 'صيغة تاريخ الأسبوع غير صحيحة (YYYY-MM-DD)' });
        }
        where.push('week_start_date = ?');
        params.push(getSaturdayWeekStart(trimmedWeek));
      }

      const trimmedStatus = String(status || '').trim();
      if (trimmedStatus) {
        if (trimmedStatus === 'pending') {
          where.push("status IN ('pending_requester', 'pending_peer', 'pending_manager')");
        } else {
          const requested = trimmedStatus
            .split(',')
            .map((s) => s.trim())
            .filter((s) => (VALID_SWAP_STATUSES as readonly string[]).includes(s));
          if (requested.length === 0) {
            return res.status(400).json({ error: 'حالة الطلب غير صالحة' });
          }
          where.push(`status IN (${requested.map(() => '?').join(', ')})`);
          params.push(...requested);
        }
      }

      if (!canManage) {
        where.push('(requester_employee_id = ? OR target_employee_id = ?)');
        params.push(myEmployeeId, myEmployeeId);
      }

      const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      const rows = await this.db.queryAll<any>(
        `SELECT * FROM dayoff_swap_requests ${whereClause} ORDER BY created_at DESC LIMIT 200`,
        params
      );

      const empNameById = await this.loadEmployeeNamesMap(rows);
      const swaps = rows.map((s) =>
        this.enrichSwapRow(s, empNameById, { myEmployeeId, canManage, canSwap })
      );
      return res.json({ ok: true, swaps });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('swaps')
  @RequireAnyPermission(['schedule:swap_request', 'schedule:manage'])
  async createSwap(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const canManage = auth.has('schedule:manage');
      const canSwap = auth.has('schedule:swap_request') || canManage;
      const myEmployee = await this.db.resolveEmployeeForAuth(auth);
      const myEmployeeId = myEmployee?.id || '';

      const clientId = String(body?.id || '').trim();
      if (clientId) {
        const existingById = await this.db.queryOne<any>(
          'SELECT * FROM dayoff_swap_requests WHERE id = ?',
          [clientId]
        );
        if (existingById) {
          const nameMap = await this.loadEmployeeNamesMap([existingById]);
          return res.status(200).json({
            ok: true,
            swap: this.enrichSwapRow(existingById, nameMap, {
              myEmployeeId,
              canManage,
              canSwap,
            }),
          });
        }
      }

      const requestType = String(body?.requestType || 'swap').trim();
      if (requestType !== 'swap' && requestType !== 'move') {
        return res.status(400).json({ error: 'نوع الطلب غير صالح (swap أو move)' });
      }

      const scope = String(body?.scope || 'week').trim();
      if (scope !== 'week' && scope !== 'permanent') {
        return res.status(400).json({ error: 'نطاق الطلب غير صالح (week أو permanent)' });
      }

      const rawWeek = String(body?.weekStartDate || '').trim();
      if (rawWeek && !this.isDateKey(rawWeek)) {
        return res.status(400).json({ error: 'صيغة تاريخ الأسبوع غير صحيحة (YYYY-MM-DD)' });
      }

      const todayDateKey = getCairoDateKey();
      const canonicalWeek = getSaturdayWeekStart(rawWeek || todayDateKey);
      const weekDates = getWeekDateKeys(canonicalWeek);

      let requesterEmployeeId = '';
      if (!canManage) {
        if (!myEmployeeId) {
          return res.status(403).json({
            error: 'حسابك غير مرتبط بسجل موظف نشط — تواصل مع الإدارة لربط حسابك',
          });
        }
        requesterEmployeeId = myEmployeeId;
      } else {
        requesterEmployeeId = String(body?.requesterEmployeeId || myEmployeeId || '').trim();
        if (!requesterEmployeeId) {
          return res.status(400).json({ error: 'يرجى تحديد الموظف صاحب الطلب' });
        }
      }

      const effectiveList = await this.db.getEffectiveWeekSchedule(canonicalWeek);
      const requester = effectiveList.find((e) => e.id === requesterEmployeeId);
      if (!requester) {
        return res.status(404).json({ error: 'الموظف صاحب الطلب غير موجود أو غير نشط' });
      }
      if (!requester.effective_day_of_week) {
        return res.status(400).json({
          error: 'لم يتم تحديد يوم إجازة للموظف في هذا الأسبوع بعد',
        });
      }
      const reqFromDay = requester.effective_day_of_week;

      const openReq = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM dayoff_swap_requests
         WHERE requester_employee_id = ?
           AND week_start_date = ?
           AND status IN ('pending_requester', 'pending_peer', 'pending_manager')
         LIMIT 1`,
        [requesterEmployeeId, canonicalWeek]
      );
      if (openReq) {
        return res.status(400).json({
          error: 'يوجد طلب تبديل أو ترحيل مفتوح بالفعل لهذا الموظف في هذا الأسبوع',
        });
      }

      const nowIso = new Date().toISOString();
      const cleanReason = String(body?.reason || '').trim().slice(0, 300);
      let targetEmployeeId = '';
      let targetFromDay: ScheduleWeekday = reqFromDay;
      let targetName = '';
      let reqApproved = 1;
      let reqApprovedAt = nowIso;
      const tgtApproved = 0;
      const tgtApprovedAt = '';
      let initialStatus: string = 'pending_peer';

      if (requestType === 'swap') {
        targetEmployeeId = String(body?.targetEmployeeId || '').trim();
        if (!targetEmployeeId) {
          return res.status(400).json({ error: 'يرجى اختيار الزميل المطلوب التبديل معه' });
        }
        if (targetEmployeeId === requesterEmployeeId) {
          return res.status(400).json({ error: 'لا يمكن تبديل الإجازة مع نفس الموظف' });
        }

        const target = effectiveList.find((e) => e.id === targetEmployeeId);
        if (!target) {
          return res.status(404).json({ error: 'الزميل المختار غير موجود أو غير نشط' });
        }
        if (target.team_group !== requester.team_group) {
          return res.status(400).json({
            error: 'يمكن تبديل الإجازة فقط مع زميل من نفس المجموعة',
          });
        }
        if (!target.effective_day_of_week) {
          return res.status(400).json({
            error: 'الزميل المختار ليس لديه يوم إجازة محدد في هذا الأسبوع',
          });
        }
        targetFromDay = target.effective_day_of_week;
        targetName = String(target.name || '');

        if (targetFromDay === reqFromDay) {
          return res.status(400).json({
            error: 'يومان الإجازة متطابقان بالفعل — اختر زميلاً في يوم مختلف',
          });
        }

        if (!canManage) {
          if (weekDates[reqFromDay] < todayDateKey || weekDates[targetFromDay] < todayDateKey) {
            return res.status(400).json({
              error: 'لا يمكن طلب تبديل ليوم إجازة قد مضى بالفعل',
            });
          }
        }

        const duplicateBetweenPair = await this.db.queryOne<{ id: string }>(
          `SELECT id FROM dayoff_swap_requests
           WHERE week_start_date = ?
             AND request_type = 'swap'
             AND status IN ('pending_requester', 'pending_peer', 'pending_manager')
             AND ((requester_employee_id = ? AND target_employee_id = ?)
               OR (requester_employee_id = ? AND target_employee_id = ?))
           LIMIT 1`,
          [canonicalWeek, requesterEmployeeId, targetEmployeeId, targetEmployeeId, requesterEmployeeId]
        );
        if (duplicateBetweenPair) {
          return res.status(400).json({
            error: 'يوجد طلب تبديل معلق بالفعل بين هذين الموظفين في هذا الأسبوع',
          });
        }

        if (myEmployeeId && myEmployeeId === requesterEmployeeId) {
          reqApproved = 1;
          reqApprovedAt = nowIso;
          initialStatus = 'pending_peer';
        } else {
          reqApproved = 0;
          reqApprovedAt = '';
          initialStatus = 'pending_requester';
        }
      } else {
        const rawTargetDay = String(body?.targetDay || '').trim();
        if (!isScheduleWeekday(rawTargetDay)) {
          return res.status(400).json({ error: 'يرجى تحديد اليوم الجديد المطلوب للترحيل' });
        }
        if (rawTargetDay === reqFromDay) {
          return res.status(400).json({ error: 'اليوم المختار هو نفس يوم الإجازة الحالي' });
        }
        if (!canManage) {
          if (weekDates[reqFromDay] < todayDateKey || weekDates[rawTargetDay] < todayDateKey) {
            return res.status(400).json({
              error: 'لا يمكن طلب ترحيل ليوم إجازة قد مضى بالفعل',
            });
          }
        }
        targetEmployeeId = '';
        targetFromDay = rawTargetDay;
        reqApproved = 1;
        reqApprovedAt = nowIso;
        initialStatus = 'pending_manager';
      }

      const id = clientId || crypto.randomUUID();
      await this.db.execute(
        `INSERT INTO dayoff_swap_requests (
          id, request_type, scope, week_start_date, team_group,
          requester_employee_id, requester_from_day, target_employee_id, target_from_day,
          reason, requester_approved, requester_approved_at, target_approved, target_approved_at,
          manager_approved, manager_approved_by, manager_approved_at, status, rejection_reason,
          created_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', '', ?, '', ?, ?, ?)`,
        [
          id,
          requestType,
          scope,
          canonicalWeek,
          requester.team_group,
          requesterEmployeeId,
          reqFromDay,
          targetEmployeeId,
          targetFromDay,
          cleanReason,
          reqApproved,
          reqApprovedAt,
          tgtApproved,
          tgtApprovedAt,
          initialStatus,
          auth.user.id,
          nowIso,
          nowIso,
        ]
      );

      const created = await this.db.queryOne<any>(
        'SELECT * FROM dayoff_swap_requests WHERE id = ?',
        [id]
      );
      const empNameById = new Map<string, string>(
        effectiveList.map((e) => [e.id, String(e.name || '')])
      );
      const swap = this.enrichSwapRow(created, empNameById, {
        myEmployeeId,
        canManage,
        canSwap,
      });

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: requestType === 'swap' ? 'طلب تبديل إجازة' : 'طلب ترحيل إجازة',
        details:
          requestType === 'swap'
            ? `${requester.name} (${getScheduleWeekdayLabel(reqFromDay)}) ↔ ${targetName} (${getScheduleWeekdayLabel(targetFromDay)}) — أسبوع ${canonicalWeek}`
            : `${requester.name}: من ${getScheduleWeekdayLabel(reqFromDay)} إلى ${getScheduleWeekdayLabel(targetFromDay)} — أسبوع ${canonicalWeek}`,
        ip: getClientIp(req),
      });

      if (initialStatus === 'pending_peer') {
        await this.realtime.broadcastTargetedEvent(
          'day_off_swap',
          {
            action: 'created',
            requestId: id,
            status: initialStatus,
            message: `طلب تبديل إجازة جديد من ${requester.name} (${getScheduleWeekdayLabel(reqFromDay)} ↔ ${getScheduleWeekdayLabel(targetFromDay)})`,
          },
          { employeeIds: [targetEmployeeId] }
        );
      } else if (initialStatus === 'pending_requester') {
        await this.realtime.broadcastTargetedEvent(
          'day_off_swap',
          {
            action: 'created',
            requestId: id,
            status: initialStatus,
            message: `تم تسجيل طلب تبديل إجازة (${requester.name} ↔ ${targetName}) وبانتظار موافقة الموظفين`,
          },
          { employeeIds: [requesterEmployeeId, targetEmployeeId] }
        );
      } else {
        await this.realtime.broadcastTargetedEvent(
          'day_off_swap',
          {
            action: 'pending_manager',
            requestId: id,
            status: initialStatus,
            message: `طلب ترحيل إجازة جديد من ${requester.name} بانتظار اعتماد الإدارة`,
          },
          { includeManagers: true }
        );
      }

      await this.realtime.broadcastStoreUpdate('day_off_swap');
      return res.status(201).json({ ok: true, swap });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('swaps/:id/respond')
  @HttpCode(200)
  @RequireAnyPermission(['schedule:swap_request', 'schedule:manage'])
  async respondToSwap(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const decision = String(body?.decision || '').trim();
      if (decision !== 'approve' && decision !== 'reject') {
        return res.status(400).json({ error: 'القرار غير صالح (approve أو reject)' });
      }
      const cleanReason = String(body?.reason || '').trim().slice(0, 300);

      const swap = await this.db.queryOne<any>('SELECT * FROM dayoff_swap_requests WHERE id = ?', [
        id,
      ]);
      if (!swap) {
        return res.status(404).json({ error: 'طلب التبديل غير موجود' });
      }
      if (swap.request_type !== 'swap') {
        return res.status(400).json({ error: 'طلبات الترحيل تُعتمد من الإدارة فقط' });
      }

      const canManage = auth.has('schedule:manage');
      const canSwap = auth.has('schedule:swap_request') || canManage;
      const myEmployee = await this.db.resolveEmployeeForAuth(auth);
      const myEmployeeId = myEmployee?.id || '';

      const isReqPending = Boolean(
        myEmployeeId &&
          myEmployeeId === swap.requester_employee_id &&
          Number(swap.requester_approved) === 0
      );
      const isTgtPending = Boolean(
        myEmployeeId &&
          myEmployeeId === swap.target_employee_id &&
          Number(swap.target_approved) === 0
      );

      if (
        swap.status === 'cancelled' &&
        decision === 'approve' &&
        (isReqPending || isTgtPending) &&
        String(swap.rejection_reason || '').includes('تعديل الجدول')
      ) {
        return res.status(409).json({
          error: 'تغيّر جدول أحد الموظفين قبل إتمام الموافقة — يرجى إنشاء طلب جديد',
        });
      }

      if (swap.status !== 'pending_requester' && swap.status !== 'pending_peer') {
        return res.status(400).json({ error: 'هذا الطلب لم يعد في مرحلة موافقة الموظفين' });
      }

      if (!isReqPending && !isTgtPending) {
        return res.status(403).json({
          error: 'يمكن فقط للموظف المعني في هذا الطلب الموافقة أو الرفض',
        });
      }

      const nowIso = new Date().toISOString();
      const nameMap = await this.loadEmployeeNamesMap([swap]);
      const reqName = nameMap.get(swap.requester_employee_id) || 'الموظف الأول';
      const tgtName = nameMap.get(swap.target_employee_id) || 'الموظف الثاني';

      if (decision === 'reject') {
        const rejectReason = cleanReason || 'تم رفض التبديل من قبل الموظف';
        await this.db.execute(
          `UPDATE dayoff_swap_requests
           SET status = 'rejected',
               rejection_reason = ?,
               updated_at = ?
           WHERE id = ? AND status IN ('pending_requester', 'pending_peer')`,
          [rejectReason, nowIso, swap.id]
        );
        const updated = await this.db.queryOne<any>(
          'SELECT * FROM dayoff_swap_requests WHERE id = ?',
          [swap.id]
        );
        await this.db.recordAuditLog({
          userId: auth.user.id,
          userName: auth.user.display_name,
          role: auth.user.role,
          action: 'رفض تبديل إجازة',
          details: `رفض التبديل بين ${reqName} و${tgtName}: ${rejectReason}`,
          ip: getClientIp(req),
          severity: 'warning',
        });

        await this.realtime.broadcastTargetedEvent(
          'day_off_swap',
          {
            action: 'rejected',
            requestId: swap.id,
            status: 'rejected',
            message: `تم رفض طلب تبديل الإجازة بين ${reqName} و${tgtName}`,
          },
          {
            employeeIds: [swap.requester_employee_id, swap.target_employee_id],
            includeManagers: true,
          }
        );
        await this.realtime.broadcastStoreUpdate('day_off_swap');
        return res.json({
          ok: true,
          swap: this.enrichSwapRow(updated, nameMap, { myEmployeeId, canManage, canSwap }),
        });
      }

      const nextReqApp = isReqPending ? 1 : Number(swap.requester_approved || 0);
      const nextReqAt = isReqPending ? nowIso : String(swap.requester_approved_at || '');
      const nextTgtApp = isTgtPending ? 1 : Number(swap.target_approved || 0);
      const nextTgtAt = isTgtPending ? nowIso : String(swap.target_approved_at || '');

      if (nextReqApp === 1 && nextTgtApp === 1) {
        const effectiveList = await this.db.getEffectiveWeekSchedule(swap.week_start_date);
        const reqEmp = effectiveList.find((e) => e.id === swap.requester_employee_id);
        const tgtEmp = effectiveList.find((e) => e.id === swap.target_employee_id);

        const isStale =
          !reqEmp ||
          !tgtEmp ||
          reqEmp.effective_day_of_week !== swap.requester_from_day ||
          tgtEmp.effective_day_of_week !== swap.target_from_day;

        if (isStale) {
          await this.db.execute(
            `UPDATE dayoff_swap_requests
             SET status = 'cancelled',
                 rejection_reason = 'تغيّر جدول أحد الموظفين قبل إتمام الموافقة',
                 updated_at = ?
             WHERE id = ?`,
            [nowIso, swap.id]
          );
          await this.realtime.broadcastStoreUpdate('day_off_swap');
          return res.status(409).json({
            error: 'تغيّر جدول أحد الموظفين قبل إتمام الموافقة — يرجى إنشاء طلب جديد',
          });
        }

        const settings = await this.db.getScheduleSettings();
        if (settings.swapRequiresManagerApproval) {
          await this.db.execute(
            `UPDATE dayoff_swap_requests
             SET requester_approved = ?,
                 requester_approved_at = ?,
                 target_approved = ?,
                 target_approved_at = ?,
                 status = 'pending_manager',
                 updated_at = ?
             WHERE id = ? AND status IN ('pending_requester', 'pending_peer')`,
            [nextReqApp, nextReqAt, nextTgtApp, nextTgtAt, nowIso, swap.id]
          );
          const updated = await this.db.queryOne<any>(
            'SELECT * FROM dayoff_swap_requests WHERE id = ?',
            [swap.id]
          );
          await this.db.recordAuditLog({
            userId: auth.user.id,
            userName: auth.user.display_name,
            role: auth.user.role,
            action: 'موافقة الموظفين على تبديل الإجازة (بانتظار الإدارة)',
            details: `وافق ${reqName} و${tgtName} على التبديل في أسبوع ${swap.week_start_date} وبانتظار اعتماد الإدارة`,
            ip: getClientIp(req),
          });

          await this.realtime.broadcastTargetedEvent(
            'day_off_swap',
            {
              action: 'pending_manager',
              requestId: swap.id,
              status: 'pending_manager',
              message: `وافق ${reqName} و${tgtName} على التبديل وبانتظار اعتماد الإدارة`,
            },
            {
              employeeIds: [swap.requester_employee_id, swap.target_employee_id],
              includeManagers: true,
            }
          );
          await this.realtime.broadcastStoreUpdate('day_off_swap');
          return res.json({
            ok: true,
            swap: this.enrichSwapRow(updated, nameMap, { myEmployeeId, canManage, canSwap }),
          });
        }

        const sortedEntries = [
          {
            employeeId: swap.requester_employee_id,
            newDay: swap.target_from_day,
            teamGroup: reqEmp.team_group,
          },
          {
            employeeId: swap.target_employee_id,
            newDay: swap.requester_from_day,
            teamGroup: tgtEmp.team_group,
          },
        ].sort((a, b) => a.employeeId.localeCompare(b.employeeId));

        const statements: Array<{ sql: string; params?: any[] }> = [
          {
            sql: `UPDATE dayoff_swap_requests
                  SET requester_approved = ?,
                      requester_approved_at = ?,
                      target_approved = ?,
                      target_approved_at = ?,
                      status = 'approved',
                      updated_at = ?
                  WHERE id = ? AND status IN ('pending_requester', 'pending_peer')`,
            params: [nextReqApp, nextReqAt, nextTgtApp, nextTgtAt, nowIso, swap.id],
          },
          ...sortedEntries.map((entry) => ({
            sql: `INSERT INTO weekly_dayoff_overrides (
                    id, week_start_date, employee_id, team_group, day_of_week, source, swap_request_id, updated_by, updated_at
                  ) VALUES (?, ?, ?, ?, ?, 'swap', ?, ?, ?)
                  ON CONFLICT (week_start_date, employee_id) DO UPDATE SET
                    team_group = EXCLUDED.team_group,
                    day_of_week = EXCLUDED.day_of_week,
                    source = 'swap',
                    swap_request_id = EXCLUDED.swap_request_id,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = EXCLUDED.updated_at`,
            params: [
              crypto.randomUUID(),
              swap.week_start_date,
              entry.employeeId,
              entry.teamGroup,
              entry.newDay,
              swap.id,
              auth.actorLabel,
              nowIso,
            ],
          })),
        ];

        if (swap.scope === 'permanent') {
          for (const entry of sortedEntries) {
            statements.push({
              sql: `INSERT INTO employee_dayoff_defaults (employee_id, team_group, day_of_week, updated_by, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT (employee_id) DO UPDATE SET
                      team_group = EXCLUDED.team_group,
                      day_of_week = EXCLUDED.day_of_week,
                      updated_by = EXCLUDED.updated_by,
                      updated_at = EXCLUDED.updated_at`,
              params: [entry.employeeId, entry.teamGroup, entry.newDay, auth.actorLabel, nowIso],
            });
          }
        }

        statements.push({
          sql: `UPDATE dayoff_swap_requests
                SET status = 'cancelled',
                    rejection_reason = 'تم اعتماد طلب تبديل آخر لنفس الأسبوع',
                    updated_at = ?
                WHERE week_start_date = ?
                  AND id != ?
                  AND status IN ('pending_requester', 'pending_peer', 'pending_manager')
                  AND (requester_employee_id IN (?, ?) OR target_employee_id IN (?, ?))`,
          params: [
            nowIso,
            swap.week_start_date,
            swap.id,
            swap.requester_employee_id,
            swap.target_employee_id,
            swap.requester_employee_id,
            swap.target_employee_id,
          ],
        });

        await this.db.executeBatch(statements);

        const updated = await this.db.queryOne<any>(
          'SELECT * FROM dayoff_swap_requests WHERE id = ?',
          [swap.id]
        );
        await this.db.recordAuditLog({
          userId: auth.user.id,
          userName: auth.user.display_name,
          role: auth.user.role,
          action: 'اعتماد وتطبيق تبديل إجازة تلقائياً',
          details: `تطبيق التبديل بين ${reqName} (${getScheduleWeekdayLabel(swap.requester_from_day)} ← ${getScheduleWeekdayLabel(swap.target_from_day)}) و${tgtName} (${getScheduleWeekdayLabel(swap.target_from_day)} ← ${getScheduleWeekdayLabel(swap.requester_from_day)}) — أسبوع ${swap.week_start_date}`,
          ip: getClientIp(req),
        });

        await this.realtime.broadcastTargetedEvent(
          'day_off_swap',
          {
            action: 'approved',
            requestId: swap.id,
            status: 'approved',
            message: `تم اعتماد وتطبيق تبديل الإجازة بين ${reqName} و${tgtName}`,
          },
          {
            employeeIds: [swap.requester_employee_id, swap.target_employee_id],
            includeManagers: true,
          }
        );
        await this.realtime.broadcastStoreUpdate('day_off_swap');
        return res.json({
          ok: true,
          swap: this.enrichSwapRow(updated, nameMap, { myEmployeeId, canManage, canSwap }),
        });
      }

      const nextStatus = nextTgtApp === 0 ? 'pending_peer' : 'pending_requester';
      await this.db.execute(
        `UPDATE dayoff_swap_requests
         SET requester_approved = ?,
             requester_approved_at = ?,
             target_approved = ?,
             target_approved_at = ?,
             status = ?,
             updated_at = ?
         WHERE id = ? AND status IN ('pending_requester', 'pending_peer')`,
        [nextReqApp, nextReqAt, nextTgtApp, nextTgtAt, nextStatus, nowIso, swap.id]
      );

      const updated = await this.db.queryOne<any>(
        'SELECT * FROM dayoff_swap_requests WHERE id = ?',
        [swap.id]
      );
      const waitingEmpId = nextTgtApp === 0 ? swap.target_employee_id : swap.requester_employee_id;
      await this.realtime.broadcastTargetedEvent(
        'day_off_swap',
        {
          action: 'awaiting_peer',
          requestId: swap.id,
          status: nextStatus,
          message: `طلب تبديل إجازة بين ${reqName} و${tgtName} بانتظار موافقتك`,
        },
        { employeeIds: [waitingEmpId] }
      );
      await this.realtime.broadcastStoreUpdate('day_off_swap');

      return res.json({
        ok: true,
        swap: this.enrichSwapRow(updated, nameMap, { myEmployeeId, canManage, canSwap }),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('swaps/:id/decision')
  @HttpCode(200)
  @RequirePermission('schedule:manage')
  async managerDecision(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const decision = String(body?.decision || '').trim();
      if (decision !== 'approve' && decision !== 'reject') {
        return res.status(400).json({ error: 'القرار غير صالح (approve أو reject)' });
      }
      const cleanReason = String(body?.reason || '').trim().slice(0, 300);

      const swap = await this.db.queryOne<any>('SELECT * FROM dayoff_swap_requests WHERE id = ?', [
        id,
      ]);
      if (!swap) {
        return res.status(404).json({ error: 'الطلب غير موجود' });
      }
      if (
        swap.status === 'cancelled' &&
        decision === 'approve' &&
        String(swap.rejection_reason || '').includes('تعديل الجدول')
      ) {
        return res.status(409).json({
          error: 'تغيّر جدول أحد الموظفين قبل اعتماد الإدارة — يرجى إنشاء طلب جديد',
        });
      }
      if (swap.status !== 'pending_manager') {
        return res.status(400).json({ error: 'هذا الطلب ليس في مرحلة اعتماد الإدارة' });
      }
      if (
        swap.request_type === 'swap' &&
        (Number(swap.requester_approved) !== 1 || Number(swap.target_approved) !== 1)
      ) {
        return res.status(400).json({
          error: 'لا يمكن اعتماد التبديل قبل موافقة كلا الموظفين',
        });
      }

      const myEmployee = await this.db.resolveEmployeeForAuth(auth);
      const myEmployeeId = myEmployee?.id || '';
      const nameMap = await this.loadEmployeeNamesMap([swap]);
      const reqName = nameMap.get(swap.requester_employee_id) || 'الموظف';
      const tgtName = swap.target_employee_id ? nameMap.get(swap.target_employee_id) || 'الزميل' : '';
      const nowIso = new Date().toISOString();
      const affectedEmpIds = [swap.requester_employee_id, swap.target_employee_id].filter(Boolean);

      if (decision === 'reject') {
        const rejectReason = cleanReason || 'تم رفض الطلب من قبل الإدارة';
        await this.db.execute(
          `UPDATE dayoff_swap_requests
           SET status = 'rejected',
               rejection_reason = ?,
               manager_approved = 0,
               manager_approved_by = ?,
               manager_approved_at = ?,
               updated_at = ?
           WHERE id = ? AND status = 'pending_manager'`,
          [rejectReason, auth.actorLabel, nowIso, nowIso, swap.id]
        );
        const updated = await this.db.queryOne<any>(
          'SELECT * FROM dayoff_swap_requests WHERE id = ?',
          [swap.id]
        );
        await this.db.recordAuditLog({
          userId: auth.user.id,
          userName: auth.user.display_name,
          role: auth.user.role,
          action: 'رفض إدارة لطلب إجازة',
          details: `رفض طلب ${reqName}${tgtName ? ` ↔ ${tgtName}` : ''}: ${rejectReason}`,
          ip: getClientIp(req),
          severity: 'warning',
        });
        await this.realtime.broadcastTargetedEvent(
          'day_off_swap',
          {
            action: 'rejected',
            requestId: swap.id,
            status: 'rejected',
            message: `تم رفض طلب الإجازة الخاص بـ ${reqName} من قبل الإدارة`,
          },
          { employeeIds: affectedEmpIds, includeManagers: true }
        );
        await this.realtime.broadcastStoreUpdate('day_off_swap');
        return res.json({
          ok: true,
          swap: this.enrichSwapRow(updated, nameMap, {
            myEmployeeId,
            canManage: true,
            canSwap: true,
          }),
        });
      }

      const effectiveList = await this.db.getEffectiveWeekSchedule(swap.week_start_date);
      const reqEmp = effectiveList.find((e) => e.id === swap.requester_employee_id);
      const tgtEmp =
        swap.request_type === 'swap'
          ? effectiveList.find((e) => e.id === swap.target_employee_id)
          : null;

      const isStale =
        !reqEmp ||
        reqEmp.effective_day_of_week !== swap.requester_from_day ||
        (swap.request_type === 'swap' &&
          (!tgtEmp || tgtEmp.effective_day_of_week !== swap.target_from_day));

      if (isStale) {
        await this.db.execute(
          `UPDATE dayoff_swap_requests
           SET status = 'cancelled',
               rejection_reason = 'تغيّر جدول أحد الموظفين قبل اعتماد الإدارة',
               updated_at = ?
           WHERE id = ?`,
          [nowIso, swap.id]
        );
        await this.realtime.broadcastStoreUpdate('day_off_swap');
        return res.status(409).json({
          error: 'تغيّر جدول أحد الموظفين قبل اعتماد الإدارة — يرجى إنشاء طلب جديد',
        });
      }

      const entries =
        swap.request_type === 'swap'
          ? [
              {
                employeeId: swap.requester_employee_id,
                newDay: swap.target_from_day,
                teamGroup: reqEmp.team_group,
              },
              {
                employeeId: swap.target_employee_id,
                newDay: swap.requester_from_day,
                teamGroup: tgtEmp!.team_group,
              },
            ].sort((a, b) => a.employeeId.localeCompare(b.employeeId))
          : [
              {
                employeeId: swap.requester_employee_id,
                newDay: swap.target_from_day,
                teamGroup: reqEmp.team_group,
              },
            ];

      const sourceVal = swap.request_type === 'move' ? 'move' : 'swap';
      const statements: Array<{ sql: string; params?: any[] }> = [
        {
          sql: `UPDATE dayoff_swap_requests
                SET manager_approved = 1,
                    manager_approved_by = ?,
                    manager_approved_at = ?,
                    status = 'approved',
                    updated_at = ?
                WHERE id = ? AND status = 'pending_manager'`,
          params: [auth.actorLabel, nowIso, nowIso, swap.id],
        },
        ...entries.map((entry) => ({
          sql: `INSERT INTO weekly_dayoff_overrides (
                  id, week_start_date, employee_id, team_group, day_of_week, source, swap_request_id, updated_by, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (week_start_date, employee_id) DO UPDATE SET
                  team_group = EXCLUDED.team_group,
                  day_of_week = EXCLUDED.day_of_week,
                  source = EXCLUDED.source,
                  swap_request_id = EXCLUDED.swap_request_id,
                  updated_by = EXCLUDED.updated_by,
                  updated_at = EXCLUDED.updated_at`,
          params: [
            crypto.randomUUID(),
            swap.week_start_date,
            entry.employeeId,
            entry.teamGroup,
            entry.newDay,
            sourceVal,
            swap.id,
            auth.actorLabel,
            nowIso,
          ],
        })),
      ];

      if (swap.scope === 'permanent') {
        for (const entry of entries) {
          statements.push({
            sql: `INSERT INTO employee_dayoff_defaults (employee_id, team_group, day_of_week, updated_by, updated_at)
                  VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT (employee_id) DO UPDATE SET
                    team_group = EXCLUDED.team_group,
                    day_of_week = EXCLUDED.day_of_week,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = EXCLUDED.updated_at`,
            params: [entry.employeeId, entry.teamGroup, entry.newDay, auth.actorLabel, nowIso],
          });
        }
      }

      if (swap.request_type === 'swap') {
        statements.push({
          sql: `UPDATE dayoff_swap_requests
                SET status = 'cancelled',
                    rejection_reason = 'تم اعتماد طلب تبديل آخر لنفس الأسبوع',
                    updated_at = ?
                WHERE week_start_date = ?
                  AND id != ?
                  AND status IN ('pending_requester', 'pending_peer', 'pending_manager')
                  AND (requester_employee_id IN (?, ?) OR target_employee_id IN (?, ?))`,
          params: [
            nowIso,
            swap.week_start_date,
            swap.id,
            swap.requester_employee_id,
            swap.target_employee_id,
            swap.requester_employee_id,
            swap.target_employee_id,
          ],
        });
      } else {
        statements.push({
          sql: `UPDATE dayoff_swap_requests
                SET status = 'cancelled',
                    rejection_reason = 'تم اعتماد طلب إجازة آخر لنفس الأسبوع',
                    updated_at = ?
                WHERE week_start_date = ?
                  AND id != ?
                  AND status IN ('pending_requester', 'pending_peer', 'pending_manager')
                  AND (requester_employee_id = ? OR target_employee_id = ?)`,
          params: [
            nowIso,
            swap.week_start_date,
            swap.id,
            swap.requester_employee_id,
            swap.requester_employee_id,
          ],
        });
      }

      await this.db.executeBatch(statements);

      const updated = await this.db.queryOne<any>(
        'SELECT * FROM dayoff_swap_requests WHERE id = ?',
        [swap.id]
      );
      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action:
          swap.request_type === 'swap' ? 'اعتماد الإدارة لتبديل الإجازة' : 'اعتماد الإدارة لترحيل الإجازة',
        details:
          swap.request_type === 'swap'
            ? `اعتماد التبديل بين ${reqName} و${tgtName} في أسبوع ${swap.week_start_date}`
            : `اعتماد ترحيل ${reqName} من ${getScheduleWeekdayLabel(swap.requester_from_day)} إلى ${getScheduleWeekdayLabel(swap.target_from_day)} — أسبوع ${swap.week_start_date}`,
        ip: getClientIp(req),
      });

      await this.realtime.broadcastTargetedEvent(
        'day_off_swap',
        {
          action: 'approved',
          requestId: swap.id,
          status: 'approved',
          message:
            swap.request_type === 'swap'
              ? `تم اعتماد وتطبيق تبديل الإجازة بين ${reqName} و${tgtName}`
              : `تم اعتماد ترحيل إجازة ${reqName} ليوم ${getScheduleWeekdayLabel(swap.target_from_day)}`,
        },
        { employeeIds: affectedEmpIds, includeManagers: true }
      );
      await this.realtime.broadcastStoreUpdate('day_off_swap');

      return res.json({
        ok: true,
        swap: this.enrichSwapRow(updated, nameMap, {
          myEmployeeId,
          canManage: true,
          canSwap: true,
        }),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('swaps/:id/cancel')
  @HttpCode(200)
  @RequireAnyPermission(['schedule:swap_request', 'schedule:manage'])
  async cancelSwap(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const swap = await this.db.queryOne<any>('SELECT * FROM dayoff_swap_requests WHERE id = ?', [
        id,
      ]);
      if (!swap) {
        return res.status(404).json({ error: 'الطلب غير موجود' });
      }
      if (!(PENDING_SWAP_STATUSES as readonly string[]).includes(swap.status)) {
        return res.status(400).json({ error: 'لا يمكن إلغاء طلب منتهٍ بالفعل' });
      }

      const canManage = auth.has('schedule:manage');
      const canSwap = auth.has('schedule:swap_request') || canManage;
      const myEmployee = await this.db.resolveEmployeeForAuth(auth);
      const myEmployeeId = myEmployee?.id || '';

      if (!canManage && (!myEmployeeId || myEmployeeId !== swap.requester_employee_id)) {
        return res.status(403).json({
          error: 'يمكن لمقدم الطلب أو الإدارة فقط إلغاء هذا الطلب',
        });
      }

      const nowIso = new Date().toISOString();
      const cancelReason =
        String(body?.reason || '').trim().slice(0, 300) ||
        (canManage && myEmployeeId !== swap.requester_employee_id
          ? 'تم إلغاء الطلب بواسطة الإدارة'
          : 'تم إلغاء الطلب بواسطة مقدم الطلب');

      await this.db.execute(
        `UPDATE dayoff_swap_requests
         SET status = 'cancelled',
             rejection_reason = ?,
             updated_at = ?
         WHERE id = ? AND status IN ('pending_requester', 'pending_peer', 'pending_manager')`,
        [cancelReason, nowIso, swap.id]
      );

      const updated = await this.db.queryOne<any>(
        'SELECT * FROM dayoff_swap_requests WHERE id = ?',
        [swap.id]
      );
      const nameMap = await this.loadEmployeeNamesMap([swap]);
      const reqName = nameMap.get(swap.requester_employee_id) || 'الموظف';
      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'إلغاء طلب تبديل/ترحيل إجازة',
        details: `إلغاء طلب ${reqName} لأسبوع ${swap.week_start_date}: ${cancelReason}`,
        ip: getClientIp(req),
      });

      const affectedEmpIds = [swap.requester_employee_id, swap.target_employee_id].filter(Boolean);
      await this.realtime.broadcastTargetedEvent(
        'day_off_swap',
        {
          action: 'cancelled',
          requestId: swap.id,
          status: 'cancelled',
          message: `تم إلغاء طلب الإجازة الخاص بـ ${reqName}`,
        },
        { employeeIds: affectedEmpIds, includeManagers: true }
      );
      await this.realtime.broadcastStoreUpdate('day_off_swap');

      return res.json({
        ok: true,
        swap: this.enrichSwapRow(updated, nameMap, { myEmployeeId, canManage, canSwap }),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('swaps/:id/revert')
  @HttpCode(200)
  @RequirePermission('schedule:manage')
  async revertSwap(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const swap = await this.db.queryOne<any>('SELECT * FROM dayoff_swap_requests WHERE id = ?', [
        id,
      ]);
      if (!swap) {
        return res.status(404).json({ error: 'الطلب غير موجود' });
      }
      if (swap.status !== 'approved') {
        return res.status(400).json({ error: 'يمكن التراجع فقط عن الطلبات المعتمدة' });
      }

      const effectiveList = await this.db.getEffectiveWeekSchedule(swap.week_start_date, {
        includeInactiveWithOverrides: true,
      });
      const reqEmp = effectiveList.find((e) => e.id === swap.requester_employee_id);
      const tgtEmp =
        swap.request_type === 'swap'
          ? effectiveList.find((e) => e.id === swap.target_employee_id)
          : null;

      const mismatch =
        !reqEmp ||
        reqEmp.effective_day_of_week !== swap.target_from_day ||
        (swap.request_type === 'swap' &&
          (!tgtEmp || tgtEmp.effective_day_of_week !== swap.requester_from_day));

      if (mismatch) {
        return res.status(409).json({
          error: 'تم تعديل الجدول لاحقاً ولا يمكن التراجع تلقائياً عن هذا الطلب',
        });
      }

      const nowIso = new Date().toISOString();
      const revertReason =
        String(body?.reason || '').trim().slice(0, 300) || 'تم التراجع عن التبديل بواسطة الإدارة';

      const restoreEntries =
        swap.request_type === 'swap'
          ? [
              {
                employeeId: swap.requester_employee_id,
                originalDay: swap.requester_from_day,
                teamGroup: reqEmp.team_group,
              },
              {
                employeeId: swap.target_employee_id,
                originalDay: swap.target_from_day,
                teamGroup: tgtEmp!.team_group,
              },
            ].sort((a, b) => a.employeeId.localeCompare(b.employeeId))
          : [
              {
                employeeId: swap.requester_employee_id,
                originalDay: swap.requester_from_day,
                teamGroup: reqEmp.team_group,
              },
            ];

      const statements: Array<{ sql: string; params?: any[] }> = [
        {
          sql: `UPDATE dayoff_swap_requests
                SET status = 'reverted',
                    rejection_reason = ?,
                    updated_at = ?
                WHERE id = ? AND status = 'approved'`,
          params: [revertReason, nowIso, swap.id],
        },
        ...restoreEntries.map((entry) => ({
          sql: `INSERT INTO weekly_dayoff_overrides (
                  id, week_start_date, employee_id, team_group, day_of_week, source, swap_request_id, updated_by, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'revert', ?, ?, ?)
                ON CONFLICT (week_start_date, employee_id) DO UPDATE SET
                  team_group = EXCLUDED.team_group,
                  day_of_week = EXCLUDED.day_of_week,
                  source = 'revert',
                  swap_request_id = EXCLUDED.swap_request_id,
                  updated_by = EXCLUDED.updated_by,
                  updated_at = EXCLUDED.updated_at`,
          params: [
            crypto.randomUUID(),
            swap.week_start_date,
            entry.employeeId,
            entry.teamGroup,
            entry.originalDay,
            swap.id,
            auth.actorLabel,
            nowIso,
          ],
        })),
      ];

      if (swap.scope === 'permanent') {
        for (const entry of restoreEntries) {
          statements.push({
            sql: `INSERT INTO employee_dayoff_defaults (employee_id, team_group, day_of_week, updated_by, updated_at)
                  VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT (employee_id) DO UPDATE SET
                    team_group = EXCLUDED.team_group,
                    day_of_week = EXCLUDED.day_of_week,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = EXCLUDED.updated_at`,
            params: [entry.employeeId, entry.teamGroup, entry.originalDay, auth.actorLabel, nowIso],
          });
        }
      }

      await this.db.executeBatch(statements);

      const updated = await this.db.queryOne<any>(
        'SELECT * FROM dayoff_swap_requests WHERE id = ?',
        [swap.id]
      );
      const myEmployee = await this.db.resolveEmployeeForAuth(auth);
      const myEmployeeId = myEmployee?.id || '';
      const nameMap = await this.loadEmployeeNamesMap([swap]);
      const reqName = nameMap.get(swap.requester_employee_id) || 'الموظف';
      const tgtName = swap.target_employee_id ? nameMap.get(swap.target_employee_id) || 'الزميل' : '';

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'التراجع عن تبديل/ترحيل إجازة',
        details: `إعادة الجدول الأصلي لـ ${reqName}${tgtName ? ` و${tgtName}` : ''} في أسبوع ${swap.week_start_date}`,
        ip: getClientIp(req),
        severity: 'warning',
      });

      const affectedEmpIds = [swap.requester_employee_id, swap.target_employee_id].filter(Boolean);
      await this.realtime.broadcastTargetedEvent(
        'day_off_swap',
        {
          action: 'reverted',
          requestId: swap.id,
          status: 'reverted',
          message: `تم التراجع عن تبديل الإجازة وإعادة الجدول الأصلي`,
        },
        { employeeIds: affectedEmpIds, includeManagers: true }
      );
      await this.realtime.broadcastStoreUpdate('day_off_swap');

      return res.json({
        ok: true,
        swap: this.enrichSwapRow(updated, nameMap, {
          myEmployeeId,
          canManage: true,
          canSwap: true,
        }),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
}

@Module({
  controllers: [SchedulesController],
})
export class SchedulesModule {}
