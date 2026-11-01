import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createStoreDatabase,
  resolveWritableDataDir,
  getLocalDateKey,
  getPreviousDateKey,
  getNextDateKey,
  getLocalTimeHMS,
  computeLateMinutes,
  generateNextEmpCode,
  inferDefaultRoleFromDepartment,
  syncEmployeeLoginAccount,
} from './db.js';
import { purgeLegacyFakeSeedData } from './seedData.js';
import {
  getCloudConfig,
  testCloudConnection,
  syncWithCloud,
  ensureCloudHydratedOnBoot,
  scheduleAutoCloudSync,
  deleteCloudRecord,
  exportFullBackup,
  importFullBackup,
} from './cloudSync.js';
import {
  ROLES_METADATA,
  ALL_PERMISSIONS,
  hashPin,
  verifyPinHash,
  encryptPasswordForAdmin,
  decryptPasswordForAdmin,
  signSessionToken,
  verifySignedTokenFormat,
  validateImageMagicBytes,
  createLoginRateLimiter,
  getRolePermissions,
  recordAuditLog,
  securityHeadersMiddleware,
  normalizeDigits,
  normalizeRequestedQty,
} from './rbac.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(options = {}) {
  const isServerless = Boolean(
    options.serverless ||
      process.env.VERCEL ||
      process.env.VERCEL_ENV ||
      process.env.AWS_LAMBDA_FUNCTION_NAME
  );
  const db = createStoreDatabase(options.dbPath, {
    seedStoreData: options.seedStoreData,
  });
  const uploadsDir = options.uploadsDir || resolveWritableDataDir('uploads');

  try {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
  } catch {
    // Ignore on read-only paths
  }

  const rateLimiter = createLoginRateLimiter({
    maxAttempts: options.maxLoginAttempts || 5,
    windowMs: 180000,
    blockMs: options.lockoutMs || 60000,
  });

  const app = express();
  const dbBootId = crypto.randomUUID();
  app.use(securityHeadersMiddleware);
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use('/uploads', express.static(uploadsDir));

  // Auto-hydrate from Supabase on Vercel Cold-Start (or periodic multi-device refresh)
  app.use('/api', async (req, _res, next) => {
    if (req.path === '/events' || req.path === '/cloud/test') return next();
    try {
      await ensureCloudHydratedOnBoot(db, uploadsDir);
    } catch {
      // Non-blocking if cloud unreachable
    }
    return next();
  });

  const sseClients = new Set();

  function getSettingsMap() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  function getSessionSecret() {
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'session_hmac_secret'")
      .get();
    return row?.value || '';
  }

  function getClientIp(req) {
    return (
      req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      'local'
    );
  }

  function issueSessionForUser(user, req, durationHours = 24 * 365 * 5) {
    const sessionId = `${crypto.randomUUID()}:${user.id}`;
    const now = new Date();
    const expires = new Date(now.getTime() + durationHours * 3600 * 1000);
    db.prepare(`
      INSERT INTO user_sessions (id, user_id, ip_address, user_agent, created_at, expires_at, revoked)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(
      sessionId,
      user.id,
      getClientIp(req),
      String(req.headers['user-agent'] || '').slice(0, 200),
      now.toISOString(),
      expires.toISOString()
    );
    return signSessionToken(sessionId, getSessionSecret());
  }

  function findPasswordConflict(rawPassword, excludeUserId = '') {
    const clean = String(rawPassword || '').trim();
    if (!clean) return null;
    const rows = db.prepare('SELECT * FROM system_users WHERE id != ?').all(excludeUserId);
    for (const u of rows) {
      if (verifyPinHash(clean, u.pin_salt, u.pin_hash)) {
        return u;
      }
    }
    return null;
  }

  function resolveAuthFromToken(rawToken) {
    const sessionId = verifySignedTokenFormat(rawToken, getSessionSecret());
    if (!sessionId) return null;

    let session = db
      .prepare('SELECT * FROM user_sessions WHERE id = ?')
      .get(sessionId);

    if (session) {
      if (session.revoked) return null;
      if (new Date(session.expires_at).getTime() <= Date.now()) return null;
    } else if (sessionId.includes(':')) {
      // Stateless rehydration for serverless cold starts when HMAC signature is valid
      const colonIdx = sessionId.indexOf(':');
      const embeddedUserId = sessionId.slice(colonIdx + 1).trim();
      if (!embeddedUserId) return null;

      if (embeddedUserId !== '__DEVICE_KIOSK__') {
        const activeUser = db
          .prepare('SELECT id FROM system_users WHERE id = ? AND is_active = 1')
          .get(embeddedUserId);
        if (!activeUser) return null;
      }

      const now = new Date();
      const expires = new Date(now.getTime() + 24 * 365 * 5 * 3600 * 1000);
      db.prepare(`
        INSERT OR IGNORE INTO user_sessions (id, user_id, ip_address, user_agent, created_at, expires_at, revoked)
        VALUES (?, ?, 'serverless', 'rehydrated', ?, ?, 0)
      `).run(sessionId, embeddedUserId, now.toISOString(), expires.toISOString());

      session = db
        .prepare('SELECT * FROM user_sessions WHERE id = ? AND revoked = 0')
        .get(sessionId);
      if (!session) return null;
    } else {
      return null;
    }

    if (session.user_id === '__DEVICE_KIOSK__') {
      const permissions = getRolePermissions(db, 'kiosk');
      return {
        sessionId: session.id,
        user: {
          id: '__DEVICE_KIOSK__',
          username: 'kiosk_device',
          display_name: 'شاشة كشك حضور العمال',
          role: 'kiosk',
          role_label: ROLES_METADATA.kiosk.label,
          avatar_color: '#E37400',
        },
        permissions,
        actorLabel: 'كشك العمال',
        has(perm) {
          return permissions.includes(perm);
        },
      };
    }

    const user = db
      .prepare('SELECT * FROM system_users WHERE id = ? AND is_active = 1')
      .get(session.user_id);
    if (!user) return null;

    const permissions = getRolePermissions(db, user.role, user.custom_permissions_json);
    const roleMeta = ROLES_METADATA[user.role] || { shortLabel: user.role };
    const actorLabel =
      user.role === 'kiosk'
        ? 'كشك العمال'
        : `${user.display_name} (${roleMeta.shortLabel})`;

    return {
      sessionId: session.id,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        role_label: roleMeta.label || user.role,
        avatar_color: user.avatar_color,
        employee_id: user.employee_id || '',
      },
      permissions,
      actorLabel,
      has(perm) {
        return user.role === 'owner' || permissions.includes(perm);
      },
    };
  }

  function extractBearerOrQueryToken(req) {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    if (typeof req.query?.token === 'string') {
      return req.query.token.trim();
    }
    return '';
  }

  function requireAuth(req, res, next) {
    const auth = resolveAuthFromToken(extractBearerOrQueryToken(req));
    if (!auth) {
      return res.status(401).json({
        ok: false,
        code: 'UNAUTHENTICATED',
        error: 'انتهت الجلسة أو يلزم تسجيل الدخول أولاً',
      });
    }
    req.auth = auth;
    return next();
  }

  function requirePermission(perm) {
    return (req, res, next) => {
      if (!req.auth) {
        return res.status(401).json({ ok: false, error: 'يلزم تسجيل الدخول' });
      }
      if (!req.auth.has(perm)) {
        recordAuditLog(db, {
          userId: req.auth.user.id,
          userName: req.auth.user.display_name,
          role: req.auth.user.role,
          action: 'رفض صلاحية RBAC',
          details: `محاولة تنفيذ إجراء يتطلب صلاحية (${perm}) على المسار ${req.method} ${req.path}`,
          ip: getClientIp(req),
          severity: 'warning',
        });
        return res.status(403).json({
          ok: false,
          code: 'FORBIDDEN',
          error: `عفواً، دورك الحالي (${req.auth.user.role_label}) لا يملك صلاحية تنفيذ هذا الإجراء.`,
        });
      }
      return next();
    };
  }

  function requireAnyPermission(perms) {
    return (req, res, next) => {
      if (!req.auth) {
        return res.status(401).json({ ok: false, error: 'يلزم تسجيل الدخول' });
      }
      if (!perms.some((p) => req.auth.has(p))) {
        return res.status(403).json({
          ok: false,
          code: 'FORBIDDEN',
          error: `عفواً، دورك الحالي (${req.auth.user.role_label}) غير مصرح له بهذا الإجراء.`,
        });
      }
      return next();
    };
  }

  function broadcastUpdate(reason = 'change') {
    const payload = JSON.stringify({ reason, at: new Date().toISOString() });
    for (const res of sseClients) {
      try {
        res.write(`event: update\ndata: ${payload}\n\n`);
      } catch {
        sseClients.delete(res);
      }
    }
    if (reason !== 'cloud_sync') {
      scheduleAutoCloudSync(db, uploadsDir);
    }
  }

  // Finds an open 12h shift (checked in or on break within the last 22 hours without a check_out)
  function findOpenShiftForEmployee(employeeId, refDate = new Date()) {
    const refIso = refDate.toISOString();
    const recentLogs = db
      .prepare(
        'SELECT * FROM attendance_logs WHERE employee_id = ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT 15'
      )
      .all(employeeId, refIso);

    if (recentLogs.length === 0) {
      return {
        isOpen: false,
        shiftDateKey: getLocalDateKey(refDate),
        latestLog: null,
        checkInLog: null,
      };
    }

    const latestLog = recentLogs[0];
    const elapsedHours =
      (refDate.getTime() - new Date(latestLog.timestamp).getTime()) / (3600 * 1000);

    if (latestLog.action_type !== 'check_out' && elapsedHours <= 22) {
      // Find the check_in that opened this shift
      let checkInLog = null;
      for (const l of recentLogs) {
        if (l.action_type === 'check_out') break;
        if (l.action_type === 'check_in') {
          checkInLog = l;
          break;
        }
      }
      const shiftDateKey =
        checkInLog?.shift_date_key ||
        checkInLog?.date_key ||
        latestLog.shift_date_key ||
        latestLog.date_key ||
        getLocalDateKey(refDate);
      return {
        isOpen: true,
        shiftDateKey,
        latestLog,
        checkInLog,
      };
    }

    return {
      isOpen: false,
      shiftDateKey: getLocalDateKey(refDate),
      latestLog,
      checkInLog: null,
    };
  }

  function insertAttendanceLog({
    id: requestedId,
    emp,
    action_type,
    note = '',
    proof_url = '',
    recorded_by,
    autoVerified = 0,
    timestamp,
    allowed_break_minutes = 0,
    break_reason = '',
    actorUser = null,
    ip = '',
  }) {
    if (requestedId) {
      const existingById = db
        .prepare('SELECT * FROM attendance_logs WHERE id = ? LIMIT 1')
        .get(String(requestedId));
      if (existingById) return existingById;
    }
    const eventDate = timestamp ? new Date(timestamp) : new Date();
    const isoTime = eventDate.toISOString();
    const dateKey = getLocalDateKey(eventDate);
    const openShift = findOpenShiftForEmployee(emp.id, eventDate);

    // Link break_start, break_end, and check_out to the open shift's shift_date_key even after midnight!
    const shiftDateKey =
      action_type === 'check_in'
        ? dateKey
        : openShift.isOpen
        ? openShift.shiftDateKey
        : dateKey;

    let lateMinutes = 0;
    if (action_type === 'check_in') {
      const existingCheckIn = db
        .prepare(
          "SELECT id FROM attendance_logs WHERE employee_id = ? AND (date_key = ? OR shift_date_key = ?) AND action_type = 'check_in'"
        )
        .get(emp.id, dateKey, shiftDateKey);
      if (!existingCheckIn) {
        lateMinutes = computeLateMinutes(emp.shift_start, eventDate);
      }
    }

    const defaultMaxBreak = Number(getSettingsMap().max_break_minutes || 30);
    let finalAllowedBreak = 0;
    let finalBreakDuration = 0;
    let finalBreakReason = String(break_reason || '').trim().slice(0, 120);

    if (action_type === 'break_start') {
      const parsedAllowed = Number(normalizeDigits(String(allowed_break_minutes || '')));
      finalAllowedBreak =
        Number.isFinite(parsedAllowed) && parsedAllowed > 0 ? parsedAllowed : defaultMaxBreak;
    } else if (
      action_type === 'break_end' ||
      (action_type === 'check_out' && openShift.latestLog?.action_type === 'break_start')
    ) {
      const lastBreakStart = db
        .prepare(
          `SELECT * FROM attendance_logs
           WHERE employee_id = ? AND (shift_date_key = ? OR date_key = ?) AND action_type = 'break_start'
           ORDER BY timestamp DESC LIMIT 1`
        )
        .get(emp.id, shiftDateKey, dateKey);

      if (lastBreakStart) {
        finalBreakDuration = Math.max(
          1,
          Math.round((eventDate.getTime() - new Date(lastBreakStart.timestamp).getTime()) / 60000)
        );
        finalAllowedBreak = lastBreakStart.allowed_break_minutes || defaultMaxBreak;
        if (!finalBreakReason) {
          finalBreakReason = lastBreakStart.break_reason || '';
        }
        db.prepare('UPDATE attendance_logs SET break_duration_minutes = ? WHERE id = ?').run(
          finalBreakDuration,
          lastBreakStart.id
        );
      }
    }

    const finalNote =
      note ||
      (action_type === 'break_start' && finalBreakReason
        ? `بريك (${finalAllowedBreak} د) - ${finalBreakReason}`
        : action_type === 'break_end' && finalBreakDuration > 0
        ? `عودة من بريك بعد ${finalBreakDuration} دقيقة (المسموح ${finalAllowedBreak} د)`
        : '');

    const attLogId = requestedId ? String(requestedId) : crypto.randomUUID();

    db.prepare(`
      INSERT INTO attendance_logs (
        id, employee_id, employee_name, department, action_type, timestamp, date_key, shift_date_key,
        late_minutes, allowed_break_minutes, break_duration_minutes, break_reason,
        note, proof_url, recorded_by, verified_by_cctv, verified_at, synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      attLogId,
      emp.id,
      emp.name,
      emp.department,
      action_type,
      isoTime,
      dateKey,
      shiftDateKey,
      lateMinutes,
      finalAllowedBreak,
      finalBreakDuration,
      finalBreakReason,
      finalNote,
      proof_url,
      recorded_by,
      autoVerified ? 1 : 0,
      autoVerified ? isoTime : ''
    );

    const actionArabicMap = {
      check_in: 'حضور',
      break_start: `بدء استراحة (${finalAllowedBreak} دقيقة)`,
      break_end: `عودة من استراحة (قضى ${finalBreakDuration} دقيقة)`,
      check_out: 'انصراف',
    };

    recordAuditLog(db, {
      userId: actorUser?.id || emp.id,
      userName: actorUser?.display_name || recorded_by,
      role: actorUser?.role || '',
      action: `حركة موظف: ${actionArabicMap[action_type] || action_type}`,
      details: `الموظف "${emp.name}" (${emp.department}) — شفت ${shiftDateKey}${dateKey !== shiftDateKey ? ` [ممتد لليوم ${dateKey}]` : ''}${finalNote ? ` — ${finalNote}` : ''}`,
      ip,
      severity:
        action_type === 'break_end' && finalAllowedBreak > 0 && finalBreakDuration > finalAllowedBreak
          ? 'warning'
          : 'info',
    });

    return db.prepare('SELECT * FROM attendance_logs WHERE id = ?').get(attLogId);
  }

  function buildBootstrapData(dateKey, auth) {
    const targetDate = dateKey || getLocalDateKey();
    const prevDate = getPreviousDateKey(targetDate);
    const todayKey = getLocalDateKey();
    const settings = getSettingsMap();
    const isInternalSnap = !auth;

    const canAttendance =
      isInternalSnap ||
      auth.has('attendance:read') ||
      auth.has('attendance:write') ||
      auth.has('attendance:kiosk') ||
      auth.has('staff:manage') ||
      auth.has('reports:view');

    const canReadAttendanceLogs =
      isInternalSnap || auth.has('attendance:read') || auth.has('reports:view');

    const canTrucks =
      isInternalSnap ||
      auth.has('trucks:read') ||
      auth.has('trucks:write') ||
      auth.has('suppliers:manage') ||
      auth.has('reports:view');

    const canShortages =
      isInternalSnap ||
      auth.has('shortages:read') ||
      auth.has('shortages:write') ||
      auth.has('shortages:manage');

    const canNotes =
      isInternalSnap ||
      auth.has('notes:read') ||
      auth.has('notes:write') ||
      auth.has('reports:view');

    const canHandover =
      isInternalSnap ||
      auth.has('handover:manage') ||
      auth.has('reports:view');

    const canChat =
      isInternalSnap ||
      auth.has('chat:read') ||
      auth.has('chat:write');

    const employees = canAttendance
      ? db
          .prepare('SELECT * FROM employees WHERE is_active = 1 ORDER BY department, emp_code, name')
          .all()
      : [];

    // 12-Hour Cross-Day Shift Synchronization:
    // 1) Fetch logs directly on targetDate OR whose shift_date_key is targetDate (so Day 1 sees Day 2's check_out/breaks!)
    // 2) Also fetch yesterday's shift logs if that shift either had activity on targetDate OR is still open right now!
    let attendanceLogs = [];
    if (canAttendance) {
      const directLogs = db
        .prepare(
          'SELECT * FROM attendance_logs WHERE date_key = ? OR shift_date_key = ? ORDER BY timestamp DESC'
        )
        .all(targetDate, targetDate);

      const prevShiftLogs = db
        .prepare(
          'SELECT * FROM attendance_logs WHERE date_key = ? OR shift_date_key = ? ORDER BY timestamp ASC'
        )
        .all(prevDate, prevDate);

      // Group prevShiftLogs by employee_id
      const prevByEmp = new Map();
      for (const l of prevShiftLogs) {
        if (!prevByEmp.has(l.employee_id)) prevByEmp.set(l.employee_id, []);
        prevByEmp.get(l.employee_id).push(l);
      }

      const mergedById = new Map();
      for (const l of directLogs) {
        mergedById.set(l.id, l);
      }

      const nowMs = Date.now();
      for (const [, empPrevLogs] of prevByEmp.entries()) {
        const lastPrev = empPrevLogs[empPrevLogs.length - 1];
        if (!lastPrev) continue;
        const touchedTargetDate = empPrevLogs.some((l) => l.date_key === targetDate);
        const lastPrevDateObj = new Date(lastPrev.timestamp);
        const isNightOrEveningOnPrev = lastPrevDateObj.getHours() >= 14;
        const isStillOpenFromYesterday =
          lastPrev.action_type !== 'check_out' &&
          ((targetDate === todayKey &&
            (nowMs - lastPrevDateObj.getTime()) / (3600 * 1000) <= 22) ||
            isNightOrEveningOnPrev);

        if (touchedTargetDate || isStillOpenFromYesterday) {
          // Include only logs belonging to the open/cross-day shift from prevDate
          const lastShiftKey = lastPrev.shift_date_key || lastPrev.date_key;
          for (const l of empPrevLogs) {
            if ((l.shift_date_key || l.date_key) === lastShiftKey) {
              mergedById.set(l.id, l);
            }
          }
        }
      }

      attendanceLogs = Array.from(mergedById.values()).sort((a, b) =>
        b.timestamp.localeCompare(a.timestamp)
      );
    }

    const logsByEmp = new Map();
    for (let i = attendanceLogs.length - 1; i >= 0; i--) {
      const log = attendanceLogs[i];
      if (!logsByEmp.has(log.employee_id)) {
        logsByEmp.set(log.employee_id, []);
      }
      logsByEmp.get(log.employee_id).push(log);
    }

    let presentCount = 0;
    let onBreakCount = 0;
    let checkedOutCount = 0;
    let lateCount = 0;
    let unverifiedAttendanceCount = 0;

    if (canAttendance) {
      for (const log of attendanceLogs) {
        if (!log.verified_by_cctv) unverifiedAttendanceCount += 1;
      }
    }

    const canManageStaffOrUsers =
      isInternalSnap || (auth && (auth.has('staff:manage') || auth.has('users:manage')));
    const linkedUsersByEmpId = new Map();
    if (canManageStaffOrUsers && employees.length > 0) {
      const secretHex = getSessionSecret();
      const linkedRows = db
        .prepare("SELECT * FROM system_users WHERE employee_id != '' AND is_active = 1")
        .all();
      for (const u of linkedRows) {
        linkedUsersByEmpId.set(u.employee_id, {
          role: u.role,
          password: decryptPasswordForAdmin(u.pin_cipher, secretHex) || '',
        });
      }
    }

    const defaultMaxBreak = Number(settings.max_break_minutes || 30);

    const enrichedEmployees = employees.map((emp) => {
      const allEmpLogs = logsByEmp.get(emp.id) || [];
      const latestLog = allEmpLogs[allEmpLogs.length - 1] || null;
      const activeShiftKey =
        latestLog?.shift_date_key || latestLog?.date_key || targetDate;

      // Isolate logs belonging to the latest active shift on this view
      const empLogs = allEmpLogs.filter(
        (l) => (l.shift_date_key || l.date_key) === activeShiftKey
      );
      const firstCheckIn =
        empLogs.find((l) => l.action_type === 'check_in') ||
        allEmpLogs.find((l) => l.action_type === 'check_in');

      let currentStatus = 'absent';
      if (latestLog) {
        if (latestLog.action_type === 'check_in' || latestLog.action_type === 'break_end') {
          currentStatus = 'present';
          presentCount += 1;
        } else if (latestLog.action_type === 'break_start') {
          currentStatus = 'on_break';
          onBreakCount += 1;
        } else if (latestLog.action_type === 'check_out') {
          currentStatus = 'checked_out';
          checkedOutCount += 1;
        }
      }

      const lateMinutes = firstCheckIn ? firstCheckIn.late_minutes || 0 : 0;
      if (lateMinutes > 0) lateCount += 1;

      const isCrossDayShift = Boolean(
        (firstCheckIn && firstCheckIn.date_key !== targetDate) ||
          empLogs.some((l) => l.date_key !== ( l.shift_date_key || l.date_key ))
      );

      // Calculate total break stats for this shift
      const breakStarts = empLogs.filter((l) => l.action_type === 'break_start');
      const breakEnds = empLogs.filter((l) => l.action_type === 'break_end');
      let totalBreakMinutes = breakEnds.reduce(
        (sum, l) => sum + (Number(l.break_duration_minutes) || 0),
        0
      );
      if (currentStatus === 'on_break' && latestLog) {
        const currentBreakElapsed = Math.max(
          0,
          Math.round((Date.now() - new Date(latestLog.timestamp).getTime()) / 60000)
        );
        totalBreakMinutes += currentBreakElapsed;
      }

      const checkOutLog = empLogs.filter((l) => l.action_type === 'check_out').pop() || null;
      const shiftDurationMinutes = firstCheckIn
        ? Math.max(
            0,
            Math.round(
              ((checkOutLog ? new Date(checkOutLog.timestamp).getTime() : Date.now()) -
                new Date(firstCheckIn.timestamp).getTime()) /
                60000
            )
          )
        : 0;

      // Data minimization for Kiosk Least-Privilege Role!
      if (auth && !canReadAttendanceLogs && !auth.has('staff:manage')) {
        return {
          id: emp.id,
          emp_code: emp.emp_code,
          name: emp.name,
          department: emp.department,
          avatar_color: emp.avatar_color,
          currentStatus,
          isCrossDayShift,
          shiftDateKey: activeShiftKey,
        };
      }

      const linkedInfo = linkedUsersByEmpId.get(emp.id);
      const resolvedSystemRole =
        linkedInfo?.role ||
        emp.system_role ||
        inferDefaultRoleFromDepartment(emp.department, emp.role_title);

      return {
        ...emp,
        system_role: resolvedSystemRole,
        login_password: canManageStaffOrUsers
          ? linkedInfo?.password || emp.emp_code || ''
          : undefined,
        currentStatus,
        isCrossDayShift,
        shiftDateKey: activeShiftKey,
        checkInTime: firstCheckIn ? firstCheckIn.timestamp : null,
        checkOutTime: checkOutLog ? checkOutLog.timestamp : null,
        shiftDurationMinutes,
        latestActionTime: latestLog ? latestLog.timestamp : null,
        latestActionType: latestLog ? latestLog.action_type : null,
        latestRecordedBy: latestLog ? latestLog.recorded_by : null,
        latestLogId: latestLog ? latestLog.id : null,
        latestVerified: latestLog ? Boolean(latestLog.verified_by_cctv) : true,
        activeBreakStart: currentStatus === 'on_break' && latestLog ? latestLog.timestamp : null,
        allowedBreakMinutes:
          currentStatus === 'on_break' && latestLog
            ? Number(latestLog.allowed_break_minutes) || defaultMaxBreak
            : defaultMaxBreak,
        breakReason:
          currentStatus === 'on_break' && latestLog
            ? latestLog.break_reason || latestLog.note || ''
            : '',
        totalBreakMinutes,
        breaksCount: breakStarts.length,
        lateMinutes,
        todayLogsCount: empLogs.length,
      };
    });

    // Strict Least-Privilege response for Kiosk sessions
    const isKioskOnly =
      auth &&
      auth.has('attendance:kiosk') &&
      !canReadAttendanceLogs &&
      !canTrucks &&
      !canShortages &&
      !canNotes;

    if (isKioskOnly) {
      return {
        dateKey: targetDate,
        serverTime: new Date().toISOString(),
        auth: {
          user: auth.user,
          permissions: auth.permissions,
        },
        settings: {
          store_name: settings.store_name || 'زايد مارت',
          branch_name: settings.branch_name || 'الفرع الرئيسي',
          max_break_minutes: Number(settings.max_break_minutes || 30),
          max_unload_minutes: Number(settings.max_unload_minutes || 60),
        },
        employees: enrichedEmployees,
        attendanceLogs: [],
        suppliers: [],
        truckLogs: [],
        shortages: [],
        productCatalog: [],
        notes: [],
        handovers: [],
        teamMessages: [],
        myProfile: null,
        pendingHandover: null,
        summary: {
          totalEmployees: employees.length,
          presentCount,
          onBreakCount,
          checkedOutCount,
          absentCount: 0,
          lateCount: 0,
          unverifiedAttendanceCount: 0,
          unloadingTrucksCount: 0,
          completedTrucksCount: 0,
          issuesTrucksCount: 0,
          openShortagesCount: 0,
          urgentShortagesCount: 0,
          orderedShortagesCount: 0,
          resolvedShortagesTodayCount: 0,
          urgentNotesCount: 0,
          openHandoverNotesCount: 0,
          pendingSupplierReturnsCount: 0,
        },
      };
    }

    const canSeeSupplierDirectory =
      canTrucks || (auth && auth.has('shortages:manage'));

    const suppliers = canSeeSupplierDirectory
      ? db
          .prepare(
            'SELECT * FROM suppliers WHERE is_active = 1 ORDER BY has_pending_return DESC, name'
          )
          .all()
      : [];

    const truckLogs = canTrucks
      ? db
          .prepare(`
            SELECT * FROM truck_logs
            WHERE status = 'unloading' OR date_key = ?
            ORDER BY CASE WHEN status = 'unloading' THEN 0 ELSE 1 END, arrival_time DESC
          `)
          .all(targetDate)
      : [];

    const unloadingTrucksCount = truckLogs.filter((t) => t.status === 'unloading').length;
    const completedTrucksCount = truckLogs.filter(
      (t) => t.status === 'completed' && t.date_key === targetDate
    ).length;
    const issuesTrucksCount = truckLogs.filter(
      (t) =>
        t.date_key === targetDate &&
        (t.delivery_condition === 'shortage' || t.delivery_condition === 'return_damaged')
    ).length;

    const shortages = canShortages
      ? db
          .prepare(`
            SELECT * FROM shortages
            WHERE status IN ('open', 'ordered') OR date_key = ?
            ORDER BY
              CASE status WHEN 'open' THEN 0 WHEN 'ordered' THEN 1 ELSE 2 END,
              CASE urgency WHEN 'out_of_stock' THEN 0 ELSE 1 END,
              updated_at DESC
          `)
          .all(targetDate)
      : [];

    const productCatalog = canShortages
      ? db
          .prepare(
            'SELECT * FROM product_catalog WHERE is_active = 1 ORDER BY usage_count DESC, name ASC'
          )
          .all()
      : [];

    const openShortagesCount = shortages.filter((s) => s.status === 'open').length;
    const orderedShortagesCount = shortages.filter((s) => s.status === 'ordered').length;
    const urgentShortagesCount = shortages.filter(
      (s) => s.status === 'open' && s.urgency === 'out_of_stock'
    ).length;
    const resolvedShortagesTodayCount = shortages.filter(
      (s) => s.status === 'resolved' && s.date_key === targetDate
    ).length;

    const notes = canNotes
      ? db
          .prepare(`
            SELECT * FROM notes
            WHERE is_open_handover = 1 OR date_key = ?
            ORDER BY is_open_handover DESC, timestamp DESC
          `)
          .all(targetDate)
      : [];

    const urgentNotesCount = notes.filter(
      (n) => n.severity === 'urgent' && n.date_key === targetDate
    ).length;
    const openHandoverNotesCount = notes.filter((n) => n.is_open_handover === 1).length;

    const teamMessages = canChat
      ? db
          .prepare(
            'SELECT * FROM team_messages ORDER BY is_pinned DESC, timestamp DESC LIMIT 120'
          )
          .all()
      : [];

    const currentRole = auth?.user?.role || '';
    const currentUserName = (auth?.user?.display_name || '').trim();
    const isAdminOrManager = !auth || currentRole === 'owner' || currentRole === 'manager';

    const allHandovers = canHandover
      ? db
          .prepare('SELECT * FROM shift_handovers ORDER BY timestamp DESC LIMIT 40')
          .all()
          .map((h) => {
            let openItems = [];
            try {
              openItems = JSON.parse(h.open_items_json || '[]');
            } catch {
              openItems = [];
            }
            return { ...h, openItems };
          })
      : [];

    const handovers = canHandover
      ? isAdminOrManager
        ? allHandovers.slice(0, 20)
        : allHandovers
            .filter((h) => {
              const tRole = h.target_role || h.from_role || 'cctv';
              return tRole === currentRole;
            })
            .slice(0, 20)
      : [];

    const pendingHandover = canHandover
      ? handovers.find((h) => h.acknowledged === 0) || null
      : null;

    // Build role-matched colleague list for Shift Handover Dropdown
    let roleColleagues = [];
    if (canHandover && auth?.user) {
      const targetRolesSet =
        currentRole === 'owner' || currentRole === 'manager'
          ? new Set(['owner', 'manager', 'supervisor'])
          : new Set([currentRole]);

      const seenNames = new Set();
      if (currentUserName) seenNames.add(currentUserName.toLowerCase());

      const activeEmpRows = db
        .prepare(
          'SELECT id, name, department, role_title, system_role FROM employees WHERE is_active = 1 ORDER BY name'
        )
        .all();

      for (const emp of activeEmpRows) {
        const effRole =
          emp.system_role || inferDefaultRoleFromDepartment(emp.department, emp.role_title);
        const cleanName = (emp.name || '').trim();
        if (!cleanName || seenNames.has(cleanName.toLowerCase())) continue;
        if (targetRolesSet.has(effRole)) {
          seenNames.add(cleanName.toLowerCase());
          roleColleagues.push({
            id: emp.id,
            name: cleanName,
            department: emp.department,
            role_title: emp.role_title || '',
            role: effRole,
          });
        }
      }

      const activeSysUsers = db
        .prepare(
          'SELECT id, display_name, role FROM system_users WHERE is_active = 1 ORDER BY display_name'
        )
        .all();

      for (const u of activeSysUsers) {
        const cleanName = (u.display_name || '').trim();
        if (!cleanName || seenNames.has(cleanName.toLowerCase())) continue;
        if (targetRolesSet.has(u.role)) {
          seenNames.add(cleanName.toLowerCase());
          roleColleagues.push({
            id: u.id,
            name: cleanName,
            department: '',
            role_title: ROLES_METADATA[u.role]?.shortLabel || u.role,
            role: u.role,
          });
        }
      }
    }

    // Build personal profile for the currently logged-in user (their own password & QR & info)
    let myProfile = null;
    if (auth?.user && auth.user.role !== 'kiosk') {
      const secretHex = getSessionSecret();
      const userRow = db
        .prepare('SELECT * FROM system_users WHERE id = ? LIMIT 1')
        .get(auth.user.id);
      const empRow = userRow?.employee_id
        ? db.prepare('SELECT * FROM employees WHERE id = ? LIMIT 1').get(userRow.employee_id)
        : null;
      const myPass = userRow
        ? decryptPasswordForAdmin(userRow.pin_cipher, secretHex) || empRow?.emp_code || ''
        : '';

      myProfile = {
        user_id: auth.user.id,
        username: auth.user.username,
        display_name: auth.user.display_name,
        role: auth.user.role,
        role_label: auth.user.role_label,
        avatar_color: auth.user.avatar_color,
        my_password: myPass,
        employee_id: empRow?.id || '',
        emp_code: empRow?.emp_code || '',
        department: empRow?.department || ROLES_METADATA[auth.user.role]?.shortLabel || '',
        role_title: empRow?.role_title || ROLES_METADATA[auth.user.role]?.label || '',
        shift_start: empRow?.shift_start || '08:00',
        shift_end: empRow?.shift_end || '20:00',
        phone: empRow?.phone || '',
        qr_payload: empRow ? `ZMART:EMP:${empRow.id}` : '',
      };
    }

    const canManageSettings = auth?.has('settings:manage');

    const totalDbRecords =
      db.prepare('SELECT COUNT(*) as c FROM employees').get().c +
      db.prepare('SELECT COUNT(*) as c FROM suppliers').get().c +
      db.prepare('SELECT COUNT(*) as c FROM shortages').get().c +
      db.prepare('SELECT COUNT(*) as c FROM attendance_logs').get().c +
      db.prepare('SELECT COUNT(*) as c FROM notes').get().c +
      db.prepare('SELECT COUNT(*) as c FROM truck_logs').get().c +
      db.prepare('SELECT COUNT(*) as c FROM team_messages').get().c;

    return {
      dbBootId,
      serverColdEmpty: totalDbRecords === 0,
      dateKey: targetDate,
      serverTime: new Date().toISOString(),
      auth: auth
        ? {
            user: auth.user,
            permissions: auth.permissions,
          }
        : null,
      myProfile,
      settings: {
        store_name: settings.store_name || 'زايد مارت',
        branch_name: settings.branch_name || 'الفرع الرئيسي',
        max_break_minutes: Number(settings.max_break_minutes || 30),
        max_unload_minutes: Number(settings.max_unload_minutes || 60),
        cloud_sync_enabled: settings.cloud_sync_enabled === 'true',
        supabase_url: canManageSettings ? settings.supabase_url || '' : '',
        has_supabase_key: canManageSettings ? Boolean(settings.supabase_anon_key) : false,
        last_cloud_sync: settings.last_cloud_sync || '',
      },
      employees: enrichedEmployees,
      attendanceLogs: canReadAttendanceLogs ? attendanceLogs : [],
      suppliers: canTrucks ? suppliers : canSeeSupplierDirectory ? suppliers : [],
      truckLogs,
      shortages,
      productCatalog,
      notes,
      handovers,
      teamMessages,
      pendingHandover,
      roleColleagues,
      summary: {
        totalEmployees: canAttendance ? employees.length : 0,
        presentCount: canAttendance ? presentCount : 0,
        onBreakCount: canAttendance ? onBreakCount : 0,
        checkedOutCount: canAttendance ? checkedOutCount : 0,
        absentCount: canAttendance
          ? Math.max(0, employees.length - presentCount - onBreakCount - checkedOutCount)
          : 0,
        lateCount: canReadAttendanceLogs ? lateCount : 0,
        unverifiedAttendanceCount: canReadAttendanceLogs ? unverifiedAttendanceCount : 0,
        unloadingTrucksCount: canTrucks ? unloadingTrucksCount : 0,
        completedTrucksCount: canTrucks ? completedTrucksCount : 0,
        issuesTrucksCount: canTrucks ? issuesTrucksCount : 0,
        openShortagesCount: canShortages ? openShortagesCount : 0,
        urgentShortagesCount: canShortages ? urgentShortagesCount : 0,
        orderedShortagesCount: canShortages ? orderedShortagesCount : 0,
        resolvedShortagesTodayCount: canShortages ? resolvedShortagesTodayCount : 0,
        urgentNotesCount: canNotes ? urgentNotesCount : 0,
        openHandoverNotesCount: canNotes ? openHandoverNotesCount : 0,
        pendingSupplierReturnsCount: canTrucks
          ? suppliers.filter((s) => s.has_pending_return === 1).length
          : 0,
      },
    };
  }

  // =========================================================================
  // 1. ONE-TIME PASSWORD AUTHENTICATION (AUTO-SELECTS ROLE BY PASSWORD)
  // =========================================================================

  app.get('/api/auth/store-info', (req, res) => {
    const settings = getSettingsMap();
    res.json({
      store_name: settings.store_name || 'زايد مارت',
      branch_name: settings.branch_name || 'الفرع الرئيسي',
    });
  });

  // Backward-compatible public info endpoint (no account list exposed)
  app.get('/api/auth/profiles', (req, res) => {
    const settings = getSettingsMap();
    res.json({
      store_name: settings.store_name || 'زايد مارت',
      branch_name: settings.branch_name || 'الفرع الرئيسي',
    });
  });

  app.post('/api/auth/login', (req, res) => {
    try {
      const rawPassword = normalizeDigits(
        String(req.body?.password ?? req.body?.pin ?? '').trim()
      );
      const ip = getClientIp(req);
      const targetKey = 'password_login';

      const blockCheck = rateLimiter.checkBlocked(ip, targetKey);
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

      const activeUsers = db
        .prepare('SELECT * FROM system_users WHERE is_active = 1')
        .all();

      let matchedUser = null;
      for (const candidate of activeUsers) {
        const isMatch = verifyPinHash(rawPassword, candidate.pin_salt, candidate.pin_hash);
        if (isMatch && !matchedUser) {
          matchedUser = candidate;
        }
      }

      // Fallback: if no direct match in system_users, check if password matches an active employee's emp_code
      if (!matchedUser) {
        const matchedEmp = db
          .prepare(
            "SELECT * FROM employees WHERE is_active = 1 AND emp_code = ? AND COALESCE(login_enabled, 1) = 1 AND COALESCE(system_role, '') != 'none' LIMIT 1"
          )
          .get(rawPassword);
        if (matchedEmp) {
          matchedUser = syncEmployeeLoginAccount(db, matchedEmp);
        }
      }

      if (!matchedUser) {
        const failInfo = rateLimiter.recordFailure(ip, targetKey);
        recordAuditLog(db, {
          userId: '',
          userName: 'محاولة دخول',
          role: '',
          action: failInfo.lockedNow
            ? 'حظر مؤقت بسبب محاولات خاطئة متكررة'
            : 'فشل تسجيل دخول (كلمة مرور خاطئة)',
          details: failInfo.lockedNow
            ? 'تم قفل المحاولات لمدة 60 ثانية بعد استنفاد الحد المسموح'
            : `كلمة المرور غير صحيحة (متبقي ${failInfo.remaining} محاولات)`,
          ip,
          severity: failInfo.lockedNow ? 'critical' : 'warning',
        });

        return res.status(failInfo.lockedNow ? 429 : 401).json({
          ok: false,
          error: failInfo.lockedNow
            ? 'تم قفل الدخول لمدة 60 ثانية بسبب تكرار كلمة المرور الخاطئة!'
            : 'كلمة المرور غير صحيحة',
        });
      }

      rateLimiter.reset(ip, targetKey);
      const nowIso = new Date().toISOString();
      db.prepare('UPDATE system_users SET last_login_at = ? WHERE id = ?').run(
        nowIso,
        matchedUser.id
      );

      const token = issueSessionForUser(matchedUser, req);
      const permissions = getRolePermissions(db, matchedUser.role);
      const roleMeta = ROLES_METADATA[matchedUser.role] || { label: matchedUser.role };

      recordAuditLog(db, {
        userId: matchedUser.id,
        userName: matchedUser.display_name,
        role: matchedUser.role,
        action: 'تسجيل دخول ناجح',
        details: `تم تحديد الصلاحية تلقائياً: (${roleMeta.label})`,
        ip,
        severity: 'info',
      });

      return res.json({
        ok: true,
        token,
        user: {
          id: matchedUser.id,
          username: matchedUser.username,
          display_name: matchedUser.display_name,
          role: matchedUser.role,
          role_label: roleMeta.label,
          avatar_color: matchedUser.avatar_color,
        },
        permissions,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({
      ok: true,
      user: req.auth.user,
      permissions: req.auth.permissions,
    });
  });

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    db.prepare('UPDATE user_sessions SET revoked = 1 WHERE id = ?').run(req.auth.sessionId);
    recordAuditLog(db, {
      userId: req.auth.user.id,
      userName: req.auth.user.display_name,
      role: req.auth.user.role,
      action: 'تسجيل خروج',
      details: 'إنهاء الجلسة الحالية بأمان',
      ip: getClientIp(req),
      severity: 'info',
    });
    res.json({ ok: true });
  });

  // Switch an active staff tablet into locked least-privilege Kiosk session immediately
  app.post(
    '/api/auth/lock-to-kiosk',
    requireAuth,
    requireAnyPermission(['attendance:kiosk', 'users:manage', 'settings:manage', 'staff:manage']),
    (req, res) => {
    const kioskUser =
      db.prepare("SELECT * FROM system_users WHERE role = 'kiosk' AND is_active = 1 LIMIT 1").get() || {
        id: '__DEVICE_KIOSK__',
        username: 'kiosk_device',
        display_name: 'شاشة كشك حضور العمال',
        role: 'kiosk',
        avatar_color: '#E37400',
      };

    // Revoke privileged session first so nobody can hit browser Back!
    db.prepare('UPDATE user_sessions SET revoked = 1 WHERE id = ?').run(req.auth.sessionId);

    const token = issueSessionForUser(kioskUser, req);
    const permissions = getRolePermissions(db, 'kiosk');

    recordAuditLog(db, {
      userId: req.auth.user.id,
      userName: req.auth.user.display_name,
      role: req.auth.user.role,
      action: 'تفعيل وضع كشك العمال المقيد',
      details: 'تم قفل الجهاز على صلاحية كشك الحضور فقط',
      ip: getClientIp(req),
      severity: 'info',
    });

    return res.json({
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
    });
  });

  // =========================================================================
  // 2. PROTECTED LIVE EVENTS & BOOTSTRAP
  // =========================================================================

  app.get('/api/events', requireAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: connected\ndata: {"ok":true}\n\n`);
    if (isServerless) {
      return res.end();
    }
    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  app.get('/api/bootstrap', requireAuth, (req, res) => {
    try {
      const data = buildBootstrapData(req.query.date, req.auth);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // =========================================================================
  // 3. RBAC-PROTECTED OPERATIONAL ENDPOINTS
  // =========================================================================

  app.post(
    '/api/upload',
    requireAuth,
    requireAnyPermission(['attendance:write', 'trucks:write', 'notes:write', 'shortages:write', 'records:manage']),
    (req, res) => {
      try {
        const { dataUrl, prefix = 'proof' } = req.body || {};
        if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
          return res.status(400).json({ error: 'صيغة الصورة غير صالحة' });
        }
        const match = dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
        if (!match) {
          return res.status(400).json({ error: 'يرجى رفع صورة بصيغة JPG أو PNG أو WebP' });
        }
        const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
        const buffer = Buffer.from(match[2], 'base64');

        if (!validateImageMagicBytes(buffer, ext)) {
          return res.status(400).json({ error: 'محتوى ملف الصورة غير سليم أو يتجاوز الحجم المسموح' });
        }

        const safePrefix = String(prefix).replace(/[^a-z0-9_-]/gi, '') || 'proof';
        const fileName = `${safePrefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
        const fullPath = path.join(uploadsDir, fileName);
        try {
          fs.writeFileSync(fullPath, buffer);
        } catch {
          return res.json({ ok: true, url: dataUrl });
        }
        if (isServerless) {
          return res.json({ ok: true, url: dataUrl });
        }
        return res.json({ ok: true, url: `/uploads/${fileName}` });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    '/api/attendance',
    requireAuth,
    requireAnyPermission(['attendance:write', 'attendance:kiosk']),
    (req, res) => {
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
        } = req.body || {};

        const validActions = ['check_in', 'break_start', 'break_end', 'check_out'];
        if (!employee_id || !validActions.includes(action_type)) {
          return res.status(400).json({ error: 'بيانات حركة الحضور غير مكتملة' });
        }

        const emp = db.prepare('SELECT * FROM employees WHERE id = ? AND is_active = 1').get(employee_id);
        if (!emp) {
          return res.status(404).json({ error: 'الموظف غير موجود' });
        }

        const isFullWrite = req.auth.has('attendance:write');
        const autoVerified = req.auth.has('attendance:verify');

        const created = insertAttendanceLog({
          id: clientId,
          emp,
          action_type,
          note: isFullWrite ? String(note || '').slice(0, 300) : '',
          proof_url: isFullWrite ? proof_url : '',
          recorded_by: req.auth.actorLabel,
          autoVerified,
          timestamp: isFullWrite ? timestamp : undefined,
          allowed_break_minutes: isFullWrite ? allowed_break_minutes : 0,
          break_reason: isFullWrite ? break_reason : '',
          actorUser: req.auth.user,
          ip: getClientIp(req),
        });

        broadcastUpdate('attendance');
        return res.status(201).json({ ok: true, log: created });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    '/api/attendance/quick-scan',
    requireAuth,
    requireAnyPermission(['attendance:kiosk', 'attendance:write']),
    (req, res) => {
      try {
        const {
          code_or_qr = '',
          preferred_action = '',
          allowed_break_minutes = 0,
          break_reason = '',
        } = req.body || {};

        const raw = normalizeDigits(String(code_or_qr || '').trim());
        if (!raw) {
          return res.status(400).json({ error: 'يرجى مسح كرت الـ QR أو إدخال الكود السريع' });
        }

        let emp = null;
        if (raw.startsWith('ZMART:EMP:')) {
          const empId = raw.slice('ZMART:EMP:'.length).trim();
          emp = db.prepare('SELECT * FROM employees WHERE id = ? AND is_active = 1').get(empId);
        } else if (raw.startsWith('ZMART:CODE:')) {
          const code = raw.slice('ZMART:CODE:'.length).trim();
          emp = db
            .prepare('SELECT * FROM employees WHERE emp_code = ? AND is_active = 1')
            .get(code);
        } else {
          emp = db
            .prepare('SELECT * FROM employees WHERE (emp_code = ? OR id = ?) AND is_active = 1')
            .get(raw, raw);
        }

        if (!emp) {
          return res.status(404).json({ error: `لم يتم العثور على موظف بالكود (${raw})` });
        }

        const todayKey = getLocalDateKey();
        const openShift = findOpenShiftForEmployee(emp.id, new Date());
        const latestLog = openShift.isOpen
          ? openShift.latestLog
          : db
              .prepare(
                'SELECT * FROM attendance_logs WHERE employee_id = ? AND date_key = ? ORDER BY timestamp DESC LIMIT 1'
              )
              .get(emp.id, todayKey);

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

        const created = insertAttendanceLog({
          emp,
          action_type: actionType,
          note: 'تسجيل سريع عبر الكود / QR',
          recorded_by: `${req.auth.actorLabel} [QR]`,
          autoVerified: req.auth.has('attendance:verify'),
          allowed_break_minutes,
          break_reason,
          actorUser: req.auth.user,
          ip: getClientIp(req),
        });

        broadcastUpdate('attendance_qr');
        return res.status(201).json({
          ok: true,
          employee: emp,
          action_type: actionType,
          log: created,
        });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    '/api/attendance/verify-all',
    requireAuth,
    requirePermission('attendance:verify'),
    (req, res) => {
      try {
        const dateKey = req.body?.date_key || getLocalDateKey();
        const now = new Date().toISOString();
        const result = db
          .prepare(
            'UPDATE attendance_logs SET verified_by_cctv = 1, verified_at = ?, synced = 0 WHERE date_key = ? AND verified_by_cctv = 0'
          )
          .run(now, dateKey);

        recordAuditLog(db, {
          userId: req.auth.user.id,
          userName: req.auth.user.display_name,
          role: req.auth.user.role,
          action: 'مطابقة جماعية لحضور الموظفين',
          details: `تم اعتماد مطابقة ${result.changes} حركة لتاريخ ${dateKey}`,
          ip: getClientIp(req),
        });

        broadcastUpdate('attendance_verify_all');
        return res.json({ ok: true, count: result.changes });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    '/api/attendance/:id/verify',
    requireAuth,
    requirePermission('attendance:verify'),
    (req, res) => {
      try {
        const now = new Date().toISOString();
        const result = db
          .prepare(
            'UPDATE attendance_logs SET verified_by_cctv = 1, verified_at = ?, synced = 0 WHERE id = ?'
          )
          .run(now, req.params.id);
        if (result.changes === 0) {
          return res.status(404).json({ error: 'السجل غير موجود' });
        }
        broadcastUpdate('attendance_verify');
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.post('/api/trucks/arrive', requireAuth, requirePermission('trucks:write'), (req, res) => {
    try {
      const {
        supplier_id = '',
        supplier_name,
        category = 'بقالة جافة',
        plate_or_driver = '',
        invoice_number = '',
        notes = '',
        arrival_proof_url = '',
      } = req.body || {};

      let resolvedName = (supplier_name || '').trim();
      let resolvedCategory = category;

      if (supplier_id) {
        const sup = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplier_id);
        if (sup) {
          resolvedName = sup.name;
          resolvedCategory = sup.category;
        }
      }

      if (!resolvedName) {
        return res.status(400).json({ error: 'يرجى اختيار المورد أو كتابة اسمه' });
      }

      const now = new Date();
      const isoTime = now.toISOString();
      const dateKey = getLocalDateKey(now);
      const autoVerified = req.auth.has('attendance:verify') ? 1 : 0;
      const id = req.body?.id ? String(req.body.id) : crypto.randomUUID();
      const existingTrk = db.prepare('SELECT * FROM truck_logs WHERE id = ?').get(id);
      if (existingTrk) {
        return res.status(200).json({ ok: true, truck: existingTrk });
      }

      db.prepare(`
        INSERT INTO truck_logs (
          id, supplier_id, supplier_name, category, plate_or_driver, status,
          arrival_time, departure_time, duration_minutes, date_key, delivery_condition,
          invoice_number, notes, arrival_proof_url, completion_proof_url,
          recorded_by, verified_by_cctv, synced
        ) VALUES (?, ?, ?, ?, ?, 'unloading', ?, '', 0, ?, 'pending', ?, ?, ?, '', ?, ?, 0)
      `).run(
        id,
        supplier_id,
        resolvedName,
        resolvedCategory,
        plate_or_driver,
        isoTime,
        dateKey,
        invoice_number,
        notes,
        arrival_proof_url,
        req.auth.actorLabel,
        autoVerified
      );

      const created = db.prepare('SELECT * FROM truck_logs WHERE id = ?').get(id);
      broadcastUpdate('truck_arrive');
      return res.status(201).json({ ok: true, truck: created });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post(
    '/api/trucks/:id/complete',
    requireAuth,
    requirePermission('trucks:write'),
    (req, res) => {
      try {
        const existing = db.prepare('SELECT * FROM truck_logs WHERE id = ?').get(req.params.id);
        if (!existing) {
          return res.status(404).json({ error: 'سجل العربية غير موجود' });
        }

        const {
          delivery_condition = 'complete',
          invoice_number,
          notes,
          completion_proof_url = '',
          clear_previous_return = false,
        } = req.body || {};

        const now = new Date();
        const departureIso = now.toISOString();
        const arrivalDate = new Date(existing.arrival_time);
        const durationMin = Math.max(
          1,
          Math.round((now.getTime() - arrivalDate.getTime()) / 60000)
        );

        const mergedNotes =
          notes !== undefined && notes !== ''
            ? existing.notes
              ? `${existing.notes} | عند الاستلام (${req.auth.actorLabel}): ${notes}`
              : notes
            : existing.notes;

        const finalInvoice =
          invoice_number !== undefined && invoice_number !== ''
            ? invoice_number
            : existing.invoice_number;

        db.prepare(`
          UPDATE truck_logs
          SET status = 'completed',
              departure_time = ?,
              duration_minutes = ?,
              delivery_condition = ?,
              invoice_number = ?,
              notes = ?,
              completion_proof_url = ?,
              synced = 0
          WHERE id = ?
        `).run(
          departureIso,
          durationMin,
          delivery_condition,
          finalInvoice,
          mergedNotes,
          completion_proof_url || existing.completion_proof_url,
          existing.id
        );

        if (existing.supplier_id) {
          if (delivery_condition === 'return_damaged' || delivery_condition === 'shortage') {
            const reason =
              notes ||
              (delivery_condition === 'return_damaged'
                ? 'يوجد مرتجع أو بضاعة تالفة مسجلة في آخر توريد'
                : 'يوجد عجز/نواقص مسجلة في آخر توريد');
            db.prepare(
              'UPDATE suppliers SET has_pending_return = 1, pending_return_note = ?, updated_at = ? WHERE id = ?'
            ).run(reason, departureIso, existing.supplier_id);
          } else if (clear_previous_return && req.auth.has('suppliers:clear_return')) {
            db.prepare(
              "UPDATE suppliers SET has_pending_return = 0, pending_return_note = '', updated_at = ? WHERE id = ?"
            ).run(departureIso, existing.supplier_id);
          }
        }

        const updated = db.prepare('SELECT * FROM truck_logs WHERE id = ?').get(existing.id);
        broadcastUpdate('truck_complete');
        return res.json({ ok: true, truck: updated });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    '/api/trucks/:id/verify',
    requireAuth,
    requirePermission('attendance:verify'),
    (req, res) => {
      try {
        db.prepare('UPDATE truck_logs SET verified_by_cctv = 1, synced = 0 WHERE id = ?').run(
          req.params.id
        );
        broadcastUpdate('truck_verify');
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    '/api/suppliers/:id/clear-return',
    requireAuth,
    requirePermission('suppliers:clear_return'),
    (req, res) => {
      try {
        const sup = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(req.params.id);
        db.prepare(
          "UPDATE suppliers SET has_pending_return = 0, pending_return_note = '', updated_at = ? WHERE id = ?"
        ).run(new Date().toISOString(), req.params.id);

        recordAuditLog(db, {
          userId: req.auth.user.id,
          userName: req.auth.user.display_name,
          role: req.auth.user.role,
          action: 'تسوية مرتجع مورد',
          details: `مسح تنبيه المرتجع للمورد (${sup?.name || req.params.id})`,
          ip: getClientIp(req),
        });

        broadcastUpdate('supplier_return_clear');
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.post('/api/notes', requireAuth, requirePermission('notes:write'), (req, res) => {
    try {
      const {
        location_tag = 'الصالة والممرات',
        category_tag = 'ملاحظة عامة',
        severity = 'normal',
        dvr_timestamp,
        content = '',
        proof_url = '',
        is_open_handover = false,
      } = req.body || {};

      const finalContent = content.trim() || `${category_tag} - ${location_tag}`;
      const now = new Date();
      const isoTime = now.toISOString();
      const dateKey = getLocalDateKey(now);
      const dvrTime = (dvr_timestamp || '').trim() || getLocalTimeHMS(now);
      const id = req.body?.id ? String(req.body.id) : crypto.randomUUID();
      const existingNote = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
      if (existingNote) {
        return res.status(200).json({ ok: true, note: existingNote });
      }

      db.prepare(`
        INSERT INTO notes (
          id, location_tag, category_tag, severity, dvr_timestamp, content, proof_url,
          recorded_by, is_open_handover, resolved_by, resolved_at, timestamp, date_key, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, 0)
      `).run(
        id,
        location_tag,
        category_tag,
        severity,
        dvrTime,
        finalContent,
        proof_url,
        req.auth.actorLabel,
        is_open_handover ? 1 : 0,
        isoTime,
        dateKey
      );

      const created = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
      broadcastUpdate('note_add');
      return res.status(201).json({ ok: true, note: created });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post(
    '/api/notes/:id/resolve',
    requireAuth,
    requirePermission('notes:resolve'),
    (req, res) => {
      try {
        const now = new Date().toISOString();
        db.prepare(
          'UPDATE notes SET is_open_handover = 0, resolved_by = ?, resolved_at = ?, synced = 0 WHERE id = ?'
        ).run(req.auth.actorLabel, now, req.params.id);
        broadcastUpdate('note_resolve');
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.post('/api/handovers', requireAuth, requirePermission('handover:manage'), (req, res) => {
    try {
      const {
        from_operator,
        to_operator = '',
        shift_name = 'تسليم وردية',
        summary_note = '',
        target_role = '',
      } = req.body || {};

      const senderRole = req.auth.user?.role || 'cctv';
      const resolvedTargetRole = (target_role || '').trim() || senderRole;

      const snap = buildBootstrapData(getLocalDateKey(), null);
      const openItems = [];

      if (resolvedTargetRole === 'hall') {
        for (const s of snap.shortages.filter((sh) => sh.status === 'open' || sh.status === 'ordered')) {
          openItems.push({
            type: 'shortage',
            text: `صنف ناقص بالصالة: "${s.item_name}" (${s.category})`,
          });
        }
      } else {
        for (const t of snap.truckLogs.filter((tr) => tr.status === 'unloading')) {
          openItems.push({
            type: 'truck',
            text: `عربية "${t.supplier_name}" (${t.category}) ما زالت تفرغ أمام الماركت`,
          });
        }
        for (const n of snap.notes.filter((nt) => nt.is_open_handover === 1)) {
          openItems.push({
            type: 'note',
            text: `[${n.location_tag}] ${n.content}`,
          });
        }
        for (const e of snap.employees.filter((em) => em.currentStatus === 'on_break')) {
          openItems.push({
            type: 'break',
            text: `الموظف "${e.name}" (${e.department}) في استراحة حالياً`,
          });
        }
      }

      db.prepare(
        "UPDATE shift_handovers SET acknowledged = 1 WHERE acknowledged = 0 AND (target_role = ? OR target_role = '')"
      ).run(resolvedTargetRole);

      const now = new Date();
      const id = req.body?.id ? String(req.body.id) : crypto.randomUUID();
      const sender =
        req.auth.user?.display_name || (from_operator || '').trim() || req.auth.actorLabel;
      const defaultReceiverLabel =
        resolvedTargetRole === 'security'
          ? 'فرد الأمن للوردية الجديدة'
          : resolvedTargetRole === 'cctv'
          ? 'مراقب الكاميرات للوردية الجديدة'
          : resolvedTargetRole === 'supervisor'
          ? 'مشرف الوردية الجديدة'
          : resolvedTargetRole === 'hall'
          ? 'زميل الصالة للوردية الجديدة'
          : 'مسؤول الوردية الجديدة';

      db.prepare(`
        INSERT INTO shift_handovers (
          id, from_operator, to_operator, from_role, target_role, shift_name, summary_note, open_items_json,
          open_trucks_count, open_notes_count, present_staff_count, acknowledged, acknowledged_at, timestamp, date_key, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?, 0)
      `).run(
        id,
        sender,
        (to_operator || '').trim() || defaultReceiverLabel,
        senderRole,
        resolvedTargetRole,
        shift_name,
        summary_note,
        JSON.stringify(openItems),
        snap.summary.unloadingTrucksCount,
        snap.summary.openHandoverNotesCount,
        snap.summary.presentCount + snap.summary.onBreakCount,
        now.toISOString(),
        getLocalDateKey(now)
      );

      const created = db.prepare('SELECT * FROM shift_handovers WHERE id = ?').get(id);
      broadcastUpdate('handover');
      return res.status(201).json({
        ok: true,
        handover: { ...created, openItems },
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post(
    '/api/handovers/:id/acknowledge',
    requireAuth,
    requirePermission('handover:manage'),
    (req, res) => {
      try {
        const now = new Date().toISOString();
        db.prepare(
          'UPDATE shift_handovers SET acknowledged = 1, acknowledged_at = ?, synced = 0 WHERE id = ?'
        ).run(now, req.params.id);
        broadcastUpdate('handover_ack');
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  // =========================================================================
  // 4. STAFF, SUPPLIERS, SETTINGS, BACKUP & RBAC SECURITY ADMIN ENDPOINTS
  // =========================================================================

  app.post('/api/employees', requireAuth, requirePermission('staff:manage'), (req, res) => {
    try {
      const {
        emp_code,
        name,
        department = 'منسقي ممرات',
        role_title = '',
        system_role = '',
        login_password = '',
        login_enabled = 1,
        shift_start = '08:00',
        shift_end = '20:00',
        avatar_color = '#1A73E8',
        phone = '',
      } = req.body || {};

      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'اسم الموظف مطلوب' });
      }
      const id = req.body?.id ? String(req.body.id) : crypto.randomUUID();
      const rawCustomPass = normalizeDigits(String(login_password || '').trim());
      const cleanCode = normalizeDigits(String(emp_code || '').trim());
      const code = cleanCode || rawCustomPass || generateNextEmpCode(db);
      const effectivePass = rawCustomPass || code;

      const resolvedRole =
        system_role && (ROLES_METADATA[system_role] || system_role === 'none')
          ? system_role
          : inferDefaultRoleFromDepartment(department, role_title);

      if (login_enabled && resolvedRole !== 'none' && effectivePass) {
        const conflict = findPasswordConflict(effectivePass);
        if (conflict) {
          return res.status(400).json({
            error: `الكود / كلمة المرور (${effectivePass}) مستخدم بالفعل لحساب "${conflict.display_name}" — يرجى اختيار كود/باسورد مختلف للموظف`,
          });
        }
      }

      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO employees (id, emp_code, name, department, role_title, system_role, login_enabled, shift_start, shift_end, avatar_color, phone, is_active, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        id,
        code,
        name.trim(),
        department,
        role_title,
        resolvedRole,
        login_enabled ? 1 : 0,
        shift_start,
        shift_end,
        avatar_color,
        phone,
        now
      );

      const created = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
      syncEmployeeLoginAccount(db, created, {
        system_role: resolvedRole,
        login_enabled: login_enabled ? 1 : 0,
        password: effectivePass,
        updatePassword: true,
      });

      recordAuditLog(db, {
        userId: req.auth.user.id,
        userName: req.auth.user.display_name,
        role: req.auth.user.role,
        action: 'إضافة موظف جديد',
        details: `إضافة الموظف "${name.trim()}" (${department}) بكود/باسورد #${effectivePass} وصلاحية (${ROLES_METADATA[resolvedRole]?.shortLabel || resolvedRole})`,
        ip: getClientIp(req),
      });

      broadcastUpdate('employee_add');
      return res.status(201).json({ ok: true, employee: created });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/employees/:id', requireAuth, requirePermission('staff:manage'), (req, res) => {
    try {
      const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'الموظف غير موجود' });

      const {
        emp_code = existing.emp_code,
        name = existing.name,
        department = existing.department,
        role_title = existing.role_title,
        system_role = existing.system_role,
        login_password = '',
        login_enabled = existing.login_enabled ?? 1,
        shift_start = existing.shift_start,
        shift_end = existing.shift_end,
        avatar_color = existing.avatar_color,
        phone = existing.phone,
      } = req.body || {};

      const cleanCode = normalizeDigits(String(emp_code || existing.emp_code).trim());
      const rawCustomPass = normalizeDigits(String(login_password || '').trim());
      const effectivePass = rawCustomPass || cleanCode;

      // If department changed and system_role wasn't explicitly changed, keep explicit or infer
      const resolvedRole =
        system_role && (ROLES_METADATA[system_role] || system_role === 'none')
          ? system_role
          : inferDefaultRoleFromDepartment(department, role_title);

      const linkedUser = db
        .prepare('SELECT id FROM system_users WHERE employee_id = ? LIMIT 1')
        .get(existing.id);

      const passwordChanged =
        Boolean(rawCustomPass) || cleanCode !== String(existing.emp_code || '').trim();

      if (login_enabled && resolvedRole !== 'none' && passwordChanged && effectivePass) {
        const conflict = findPasswordConflict(effectivePass, linkedUser?.id || '');
        if (conflict) {
          return res.status(400).json({
            error: `الكود / كلمة المرور (${effectivePass}) مستخدم بالفعل لحساب "${conflict.display_name}" — اختر رقماً مختلفاً`,
          });
        }
      }

      db.prepare(`
        UPDATE employees
        SET emp_code = ?, name = ?, department = ?, role_title = ?, system_role = ?, login_enabled = ?, shift_start = ?, shift_end = ?, avatar_color = ?, phone = ?, updated_at = ?
        WHERE id = ?
      `).run(
        cleanCode,
        name.trim(),
        department,
        role_title,
        resolvedRole,
        login_enabled ? 1 : 0,
        shift_start,
        shift_end,
        avatar_color,
        phone,
        new Date().toISOString(),
        existing.id
      );

      const updatedEmp = db.prepare('SELECT * FROM employees WHERE id = ?').get(existing.id);
      syncEmployeeLoginAccount(db, updatedEmp, {
        system_role: resolvedRole,
        login_enabled: login_enabled ? 1 : 0,
        password: effectivePass,
        updatePassword: passwordChanged,
      });

      broadcastUpdate('employee_edit');
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/employees/:id', requireAuth, requirePermission('staff:manage'), (req, res) => {
    try {
      const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
      const nowIso = new Date().toISOString();
      db.prepare('UPDATE employees SET is_active = 0, updated_at = ? WHERE id = ?').run(
        nowIso,
        req.params.id
      );
      if (existing) {
        syncEmployeeLoginAccount(db, { ...existing, is_active: 0 });
      }
      recordAuditLog(db, {
        userId: req.auth.user.id,
        userName: req.auth.user.display_name,
        role: req.auth.user.role,
        action: 'أرشفة/حذف موظف',
        details: `حذف الموظف "${existing?.name || req.params.id}" من القائمة النشطة`,
        ip: getClientIp(req),
        severity: 'warning',
      });
      broadcastUpdate('employee_delete');
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Bulk Real-Data Employee Entry (paste multiple names at once!)
  app.post('/api/employees/bulk', requireAuth, requirePermission('staff:manage'), (req, res) => {
    try {
      const {
        lines = [],
        department = 'منسقي ممرات',
        system_role = '',
        shift_start = '08:00',
        shift_end = '20:00',
        avatar_color = '#0B57D0',
      } = req.body || {};

      const cleanLines = (Array.isArray(lines) ? lines : String(lines || '').split('\n'))
        .map((l) => String(l || '').trim())
        .filter(Boolean);

      if (cleanLines.length === 0) {
        return res.status(400).json({ error: 'يرجى كتابة اسم موظف واحد على الأقل' });
      }

      const now = new Date().toISOString();
      const insertStmt = db.prepare(`
        INSERT INTO employees (id, emp_code, name, department, role_title, system_role, login_enabled, shift_start, shift_end, avatar_color, phone, is_active, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1, ?)
      `);

      let nextCodeNum = parseInt(generateNextEmpCode(db), 10) || 101;
      let addedCount = 0;
      const createdIds = [];

      db.exec('BEGIN TRANSACTION');
      try {
        for (const rawLine of cleanLines) {
          // Support optional "الاسم - الوظيفة - الموبايل" per line
          const parts = rawLine.split(/[-–|،,]/).map((p) => p.trim());
          const name = parts[0];
          if (!name) continue;
          const roleTitle = parts[1] || '';
          const phone = parts[2] || '';
          const resolvedRole =
            system_role && (ROLES_METADATA[system_role] || system_role === 'none')
              ? system_role
              : inferDefaultRoleFromDepartment(department, roleTitle);
          let candidateCode = String(nextCodeNum++);
          while (findPasswordConflict(candidateCode)) {
            candidateCode = String(nextCodeNum++);
          }
          const empId = crypto.randomUUID();
          insertStmt.run(
            empId,
            candidateCode,
            name,
            department,
            roleTitle,
            resolvedRole,
            shift_start,
            shift_end,
            avatar_color,
            phone,
            now
          );
          createdIds.push(empId);
          addedCount += 1;
        }
        db.exec('COMMIT');
      } catch (txErr) {
        db.exec('ROLLBACK');
        throw txErr;
      }

      for (const empId of createdIds) {
        const empRow = db.prepare('SELECT * FROM employees WHERE id = ?').get(empId);
        if (empRow) syncEmployeeLoginAccount(db, empRow);
      }

      recordAuditLog(db, {
        userId: req.auth.user.id,
        userName: req.auth.user.display_name,
        role: req.auth.user.role,
        action: 'إضافة جماعية للموظفين',
        details: `إضافة (${addedCount}) موظف في قسم (${department})`,
        ip: getClientIp(req),
      });

      broadcastUpdate('employee_bulk_add');
      return res.status(201).json({ ok: true, addedCount });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/suppliers', requireAuth, requirePermission('suppliers:manage'), (req, res) => {
    try {
      const {
        name,
        category = 'بقالة جافة',
        icon = 'local_shipping',
        color = '#0B57D0',
        phone = '',
        has_pending_return = 0,
        pending_return_note = '',
      } = req.body || {};
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'اسم المورد مطلوب' });
      }
      const id = req.body?.id ? String(req.body.id) : crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO suppliers (id, name, category, icon, color, has_pending_return, pending_return_note, phone, is_active, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        id,
        name.trim(),
        category,
        icon,
        color,
        has_pending_return ? 1 : 0,
        String(pending_return_note || '').trim(),
        phone,
        now
      );

      const created = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
      broadcastUpdate('supplier_add');
      return res.status(201).json({ ok: true, supplier: created });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/suppliers/:id', requireAuth, requirePermission('suppliers:manage'), (req, res) => {
    try {
      const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'المورد غير موجود' });

      const {
        name = existing.name,
        category = existing.category,
        phone = existing.phone,
        color = existing.color,
        has_pending_return = existing.has_pending_return,
        pending_return_note = existing.pending_return_note,
      } = req.body || {};

      db.prepare(`
        UPDATE suppliers
        SET name = ?, category = ?, phone = ?, color = ?, has_pending_return = ?, pending_return_note = ?, updated_at = ?
        WHERE id = ?
      `).run(
        name.trim(),
        category,
        phone,
        color,
        has_pending_return ? 1 : 0,
        String(pending_return_note || '').trim(),
        new Date().toISOString(),
        existing.id
      );

      broadcastUpdate('supplier_edit');
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/suppliers/bulk', requireAuth, requirePermission('suppliers:manage'), (req, res) => {
    try {
      const { lines = [], category = 'بقالة جافة', color = '#0B57D0' } = req.body || {};
      const cleanLines = (Array.isArray(lines) ? lines : String(lines || '').split('\n'))
        .map((l) => String(l || '').trim())
        .filter(Boolean);

      if (cleanLines.length === 0) {
        return res.status(400).json({ error: 'يرجى كتابة اسم شركة/مورد واحد على الأقل' });
      }

      const now = new Date().toISOString();
      const insertStmt = db.prepare(`
        INSERT INTO suppliers (id, name, category, icon, color, has_pending_return, pending_return_note, phone, is_active, updated_at)
        VALUES (?, ?, ?, 'local_shipping', ?, 0, '', ?, 1, ?)
      `);

      let addedCount = 0;
      db.exec('BEGIN TRANSACTION');
      try {
        for (const rawLine of cleanLines) {
          const parts = rawLine.split(/[-–|،,]/).map((p) => p.trim());
          const name = parts[0];
          if (!name) continue;
          const phone = parts[1] || '';
          insertStmt.run(crypto.randomUUID(), name, category, color, phone, now);
          addedCount += 1;
        }
        db.exec('COMMIT');
      } catch (txErr) {
        db.exec('ROLLBACK');
        throw txErr;
      }

      broadcastUpdate('supplier_bulk_add');
      return res.status(201).json({ ok: true, addedCount });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete(
    '/api/suppliers/:id',
    requireAuth,
    requirePermission('suppliers:manage'),
    (req, res) => {
      try {
        db.prepare('UPDATE suppliers SET is_active = 0, updated_at = ? WHERE id = ?').run(
          new Date().toISOString(),
          req.params.id
        );
        broadcastUpdate('supplier_delete');
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  // =========================================================================
  // 4B. HALL WORKERS SHORTAGES (النواقص) & QUICK PRODUCT CATALOG ENDPOINTS
  // =========================================================================

  function ensureCatalogProduct({ name, category = 'بقالة جافة', unit = '', supplier_id = '' }) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return '';
    const existing = db
      .prepare('SELECT * FROM product_catalog WHERE LOWER(name) = LOWER(?) LIMIT 1')
      .get(cleanName);
    const now = new Date().toISOString();
    if (existing) {
      db.prepare(
        `UPDATE product_catalog
         SET is_active = 1,
             usage_count = COALESCE(usage_count, 0) + 1,
             default_unit = CASE WHEN ? != '' THEN ? ELSE default_unit END,
             updated_at = ?
         WHERE id = ?`
      ).run(unit, unit, now, existing.id);
      return existing.id;
    }
    const newId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO product_catalog (id, name, category, default_unit, supplier_id, usage_count, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?)`
    ).run(newId, cleanName, category || 'بقالة جافة', unit || '', supplier_id || '', now);
    return newId;
  }

  app.post(
    '/api/shortages',
    requireAuth,
    requireAnyPermission(['shortages:write', 'shortages:manage', 'records:manage']),
    (req, res) => {
      try {
        const {
          product_id = '',
          item_name,
          category = 'بقالة جافة',
          requested_qty = null,
          unit = '',
          urgency = 'out_of_stock',
          is_suggestion = false,
          supplier_id = '',
          supplier_name = '',
          notes = '',
          auto_save_catalog = true,
          allow_duplicate = false,
        } = req.body || {};

        const cleanName = String(item_name || '').trim();
        if (!cleanName) {
          return res.status(400).json({ error: 'يرجى كتابة أو اختيار اسم الصنف الناقص أو المقترح' });
        }

        const qtyCheck = normalizeRequestedQty(requested_qty);
        if (!qtyCheck.ok) {
          return res.status(400).json({ error: qtyCheck.error });
        }
        const finalQty = qtyCheck.value; // null, 0, or positive number

        const validUrgencies = ['out_of_stock', 'low_stock'];
        const finalUrgency = validUrgencies.includes(urgency) ? urgency : 'out_of_stock';
        const finalIsSuggestion = is_suggestion ? 1 : 0;
        const cleanUnit = String(unit || '').trim().slice(0, 40);
        const cleanCategory = String(category || 'بقالة جافة').trim() || 'بقالة جافة';
        const cleanNotes = String(notes || '').trim().slice(0, 400);

        let resolvedSupplierName = String(supplier_name || '').trim();
        if (supplier_id && !resolvedSupplierName) {
          const sup = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplier_id);
          if (sup) resolvedSupplierName = sup.name;
        }

        const now = new Date();
        const isoNow = now.toISOString();
        const dateKey = getLocalDateKey(now);

        let catalogProductId = String(product_id || '').trim();
        if (auto_save_catalog !== false) {
          catalogProductId = ensureCatalogProduct({
            name: cleanName,
            category: cleanCategory,
            unit: cleanUnit,
            supplier_id,
          });
        }

        // Duplicate prevention: if an 'open' shortage with the exact same item_name exists, update it smoothly!
        if (!allow_duplicate) {
          const existingOpen = db
            .prepare(
              "SELECT * FROM shortages WHERE status = 'open' AND LOWER(item_name) = LOWER(?) LIMIT 1"
            )
            .get(cleanName);
          if (existingOpen) {
            const nextQty = finalQty !== null ? finalQty : existingOpen.requested_qty;
            const nextUnit = cleanUnit || existingOpen.unit || '';
            const nextNotes = cleanNotes || existingOpen.notes || '';
            db.prepare(
              `UPDATE shortages
               SET requested_qty = ?,
                   unit = ?,
                   urgency = ?,
                   is_suggestion = ?,
                   notes = ?,
                   updated_by = ?,
                   updated_at = ?,
                   synced = 0
               WHERE id = ?`
            ).run(
              nextQty,
              nextUnit,
              finalUrgency,
              finalIsSuggestion || existingOpen.is_suggestion || 0,
              nextNotes,
              req.auth.actorLabel,
              isoNow,
              existingOpen.id
            );
            const updated = db.prepare('SELECT * FROM shortages WHERE id = ?').get(existingOpen.id);
            recordAuditLog(db, {
              userId: req.auth.user.id,
              userName: req.auth.user.display_name,
              role: req.auth.user.role,
              action: finalIsSuggestion ? 'تحديث مقترح صنف' : 'تحديث صنف ناقص',
              details: `تحديث "${cleanName}" (${cleanCategory})`,
              ip: getClientIp(req),
            });
            broadcastUpdate('shortage_update');
            return res.status(200).json({ ok: true, shortage: updated, merged: true });
          }
        }

        const id = req.body?.id ? String(req.body.id) : crypto.randomUUID();
        const existingShById = db.prepare('SELECT * FROM shortages WHERE id = ?').get(id);
        if (existingShById) {
          return res.status(200).json({ ok: true, shortage: existingShById, merged: false });
        }
        db.prepare(
          `INSERT INTO shortages (
            id, product_id, item_name, category, requested_qty, unit, urgency, status, is_suggestion,
            supplier_id, supplier_name, notes, recorded_by, recorded_by_role, updated_by,
            resolved_by, resolved_at, timestamp, updated_at, date_key, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, '', '', '', ?, ?, ?, 0)`
        ).run(
          id,
          catalogProductId,
          cleanName,
          cleanCategory,
          finalQty,
          cleanUnit,
          finalUrgency,
          finalIsSuggestion,
          supplier_id || '',
          resolvedSupplierName,
          cleanNotes,
          req.auth.actorLabel,
          req.auth.user.role,
          isoNow,
          isoNow,
          dateKey
        );

        recordAuditLog(db, {
          userId: req.auth.user.id,
          userName: req.auth.user.display_name,
          role: req.auth.user.role,
          action: finalIsSuggestion ? 'إضافة مقترح صنف جديد' : 'إضافة صنف ناقص',
          details: `${finalIsSuggestion ? 'اقتراح صنف' : 'نقص صنف'}: "${cleanName}" (${cleanCategory})${finalQty !== null ? ` — الكمية: ${finalQty} ${cleanUnit}` : ''}`,
          ip: getClientIp(req),
        });

        const created = db.prepare('SELECT * FROM shortages WHERE id = ?').get(id);
        broadcastUpdate('shortage_add');
        return res.status(201).json({ ok: true, shortage: created, merged: false });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.put(
    '/api/shortages/:id',
    requireAuth,
    requireAnyPermission(['shortages:write', 'shortages:manage', 'records:manage']),
    (req, res) => {
      try {
        const existing = db.prepare('SELECT * FROM shortages WHERE id = ?').get(req.params.id);
        if (!existing) {
          return res.status(404).json({ error: 'الصنف غير موجود في النواقص' });
        }

        const canManageAll =
          req.auth.has('shortages:manage') || req.auth.has('records:manage');

        if (!canManageAll && existing.status === 'resolved') {
          return res.status(403).json({
            error: 'هذا الصنف تم توفيره وإغلاقه بالفعل — التعديل متاح للإدارة فقط',
          });
        }

        let nextQty = existing.requested_qty;
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'requested_qty')) {
          const qtyCheck = normalizeRequestedQty(req.body.requested_qty);
          if (!qtyCheck.ok) {
            return res.status(400).json({ error: qtyCheck.error });
          }
          nextQty = qtyCheck.value;
        }

        const nextUnit =
          req.body?.unit !== undefined
            ? String(req.body.unit || '').trim().slice(0, 40)
            : existing.unit;

        const validUrgencies = ['out_of_stock', 'low_stock'];
        const nextUrgency =
          req.body?.urgency && validUrgencies.includes(req.body.urgency)
            ? req.body.urgency
            : existing.urgency;

        const nextNotes =
          req.body?.notes !== undefined
            ? String(req.body.notes || '').trim().slice(0, 400)
            : existing.notes;

        const nextName =
          req.body?.item_name !== undefined && String(req.body.item_name).trim()
            ? String(req.body.item_name).trim()
            : existing.item_name;

        const nextCategory =
          req.body?.category !== undefined && String(req.body.category).trim()
            ? String(req.body.category).trim()
            : existing.category;

        const validStatuses = ['open', 'ordered', 'resolved'];
        const nextStatus =
          canManageAll && req.body?.status && validStatuses.includes(req.body.status)
            ? req.body.status
            : existing.status;

        let nextSupplierId =
          canManageAll && req.body?.supplier_id !== undefined
            ? String(req.body.supplier_id || '')
            : existing.supplier_id;
        let nextSupplierName =
          canManageAll && req.body?.supplier_name !== undefined
            ? String(req.body.supplier_name || '').trim()
            : existing.supplier_name;

        if (canManageAll && nextSupplierId && req.body?.supplier_name === undefined) {
          const sup = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(nextSupplierId);
          if (sup) nextSupplierName = sup.name;
        }

        const nowIso = new Date().toISOString();
        const resolvedBy =
          nextStatus === 'resolved'
            ? existing.resolved_by || req.auth.actorLabel
            : '';
        const resolvedAt =
          nextStatus === 'resolved' ? existing.resolved_at || nowIso : '';

        db.prepare(
          `UPDATE shortages
           SET item_name = ?,
               category = ?,
               requested_qty = ?,
               unit = ?,
               urgency = ?,
               status = ?,
               supplier_id = ?,
               supplier_name = ?,
               notes = ?,
               updated_by = ?,
               resolved_by = ?,
               resolved_at = ?,
               updated_at = ?,
               synced = 0
           WHERE id = ?`
        ).run(
          nextName,
          nextCategory,
          nextQty,
          nextUnit,
          nextUrgency,
          nextStatus,
          nextSupplierId,
          nextSupplierName,
          nextNotes,
          req.auth.actorLabel,
          resolvedBy,
          resolvedAt,
          nowIso,
          existing.id
        );

        const updated = db.prepare('SELECT * FROM shortages WHERE id = ?').get(existing.id);
        broadcastUpdate('shortage_edit');
        return res.json({ ok: true, shortage: updated });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    '/api/shortages/:id/status',
    requireAuth,
    requireAnyPermission(['shortages:manage', 'records:manage']),
    (req, res) => {
      try {
        const existing = db.prepare('SELECT * FROM shortages WHERE id = ?').get(req.params.id);
        if (!existing) {
          return res.status(404).json({ error: 'الصنف غير موجود' });
        }
        const validStatuses = ['open', 'ordered', 'resolved'];
        const nextStatus = validStatuses.includes(req.body?.status)
          ? req.body.status
          : 'resolved';
        const nowIso = new Date().toISOString();
        const resolvedBy = nextStatus === 'resolved' ? req.auth.actorLabel : '';
        const resolvedAt = nextStatus === 'resolved' ? nowIso : '';

        db.prepare(
          `UPDATE shortages
           SET status = ?,
               updated_by = ?,
               resolved_by = ?,
               resolved_at = ?,
               updated_at = ?,
               synced = 0
           WHERE id = ?`
        ).run(nextStatus, req.auth.actorLabel, resolvedBy, resolvedAt, nowIso, existing.id);

        const updated = db.prepare('SELECT * FROM shortages WHERE id = ?').get(existing.id);
        broadcastUpdate('shortage_status');
        return res.json({ ok: true, shortage: updated });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    '/api/shortages/resolve-all',
    requireAuth,
    requireAnyPermission(['shortages:manage', 'records:manage']),
    (req, res) => {
      try {
        const nowIso = new Date().toISOString();
        const category = String(req.body?.category || '').trim();
        let result;
        if (category && category !== 'الكل') {
          result = db
            .prepare(
              `UPDATE shortages
               SET status = 'resolved', resolved_by = ?, resolved_at = ?, updated_at = ?, synced = 0
               WHERE status IN ('open', 'ordered') AND category = ?`
            )
            .run(req.auth.actorLabel, nowIso, nowIso, category);
        } else {
          result = db
            .prepare(
              `UPDATE shortages
               SET status = 'resolved', resolved_by = ?, resolved_at = ?, updated_at = ?, synced = 0
               WHERE status IN ('open', 'ordered')`
            )
            .run(req.auth.actorLabel, nowIso, nowIso);
        }

        recordAuditLog(db, {
          userId: req.auth.user.id,
          userName: req.auth.user.display_name,
          role: req.auth.user.role,
          action: 'اعتماد توفير النواقص جماعياً',
          details: `تم إغلاق (${result.changes}) صنف من قائمة النواقص المفتوحة`,
          ip: getClientIp(req),
        });

        broadcastUpdate('shortages_resolve_all');
        return res.json({ ok: true, count: result.changes });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.delete(
    '/api/shortages/:id',
    requireAuth,
    requirePermission('records:manage'),
    (req, res) => {
      try {
        const existing = db.prepare('SELECT * FROM shortages WHERE id = ?').get(req.params.id);
        if (!existing) {
          return res.status(404).json({ error: 'الصنف غير موجود' });
        }
        db.prepare('DELETE FROM shortages WHERE id = ?').run(existing.id);
        deleteCloudRecord(db, 'shortages', existing.id);

        recordAuditLog(db, {
          userId: req.auth.user.id,
          userName: req.auth.user.display_name,
          role: req.auth.user.role,
          action: 'حذف صنف من النواقص',
          details: `حذف الصنف "${existing.item_name}" (${existing.category})`,
          ip: getClientIp(req),
          severity: 'warning',
        });

        broadcastUpdate('shortage_delete');
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  // Quick Product Catalog Management
  app.post(
    '/api/catalog',
    requireAuth,
    requireAnyPermission(['shortages:manage', 'records:manage']),
    (req, res) => {
      try {
        const { name, category = 'بقالة جافة', default_unit = '', supplier_id = '' } = req.body || {};
        if (!name || !String(name).trim()) {
          return res.status(400).json({ error: 'اسم الصنف مطلوب' });
        }
        const id = ensureCatalogProduct({
          name: String(name).trim(),
          category: String(category || 'بقالة جافة').trim(),
          unit: String(default_unit || '').trim(),
          supplier_id,
        });
        const item = db.prepare('SELECT * FROM product_catalog WHERE id = ?').get(id);
        broadcastUpdate('catalog_add');
        return res.status(201).json({ ok: true, item });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    '/api/catalog/bulk',
    requireAuth,
    requireAnyPermission(['shortages:manage', 'records:manage']),
    (req, res) => {
      try {
        const { lines = [], category = 'بقالة جافة', default_unit = '' } = req.body || {};
        const cleanLines = (Array.isArray(lines) ? lines : String(lines || '').split('\n'))
          .map((l) => String(l || '').trim())
          .filter(Boolean);

        if (cleanLines.length === 0) {
          return res.status(400).json({ error: 'يرجى كتابة اسم صنف واحد على الأقل' });
        }

        let addedCount = 0;
        db.exec('BEGIN TRANSACTION');
        try {
          for (const rawLine of cleanLines) {
            const parts = rawLine.split(/[-–|،,]/).map((p) => p.trim());
            const name = parts[0];
            if (!name) continue;
            const unit = parts[1] || default_unit || '';
            ensureCatalogProduct({ name, category, unit });
            addedCount += 1;
          }
          db.exec('COMMIT');
        } catch (txErr) {
          db.exec('ROLLBACK');
          throw txErr;
        }

        broadcastUpdate('catalog_bulk_add');
        return res.status(201).json({ ok: true, addedCount });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.put(
    '/api/catalog/:id',
    requireAuth,
    requireAnyPermission(['shortages:manage', 'records:manage']),
    (req, res) => {
      try {
        const existing = db
          .prepare('SELECT * FROM product_catalog WHERE id = ?')
          .get(req.params.id);
        if (!existing) return res.status(404).json({ error: 'الصنف غير موجود في الكتالوج' });

        const name = String(req.body?.name ?? existing.name).trim();
        const category = String(req.body?.category ?? existing.category).trim();
        const defaultUnit = String(req.body?.default_unit ?? existing.default_unit).trim();

        db.prepare(
          'UPDATE product_catalog SET name = ?, category = ?, default_unit = ?, updated_at = ? WHERE id = ?'
        ).run(name, category, defaultUnit, new Date().toISOString(), existing.id);

        broadcastUpdate('catalog_edit');
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.delete(
    '/api/catalog/:id',
    requireAuth,
    requireAnyPermission(['shortages:manage', 'records:manage']),
    (req, res) => {
      try {
        db.prepare('UPDATE product_catalog SET is_active = 0, updated_at = ? WHERE id = ?').run(
          new Date().toISOString(),
          req.params.id
        );
        broadcastUpdate('catalog_delete');
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  // =========================================================================
  // 4C. ADMIN FULL RECORD CONTROL (EDIT / DELETE ANY LOG) & RANGE REPORTS
  // =========================================================================

  app.put(
    '/api/attendance/:id',
    requireAuth,
    requirePermission('records:manage'),
    (req, res) => {
      try {
        const existing = db
          .prepare('SELECT * FROM attendance_logs WHERE id = ?')
          .get(req.params.id);
        if (!existing) {
          return res.status(404).json({ error: 'سجل الحضور غير موجود' });
        }

        const validActions = ['check_in', 'break_start', 'break_end', 'check_out'];
        const nextAction = validActions.includes(req.body?.action_type)
          ? req.body.action_type
          : existing.action_type;

        let nextIso = existing.timestamp;
        let nextDateKey = existing.date_key;
        if (req.body?.timestamp) {
          const parsed = new Date(req.body.timestamp);
          if (!Number.isNaN(parsed.getTime())) {
            nextIso = parsed.toISOString();
            nextDateKey = getLocalDateKey(parsed);
          }
        }

        const nextShiftDateKey =
          req.body?.shift_date_key !== undefined && String(req.body.shift_date_key).trim()
            ? String(req.body.shift_date_key).trim()
            : existing.shift_date_key || nextDateKey;

        const nextLate =
          req.body?.late_minutes !== undefined
            ? Math.max(0, Number(normalizeDigits(req.body.late_minutes)) || 0)
            : existing.late_minutes;

        const nextAllowedBreak =
          req.body?.allowed_break_minutes !== undefined
            ? Math.max(0, Number(normalizeDigits(req.body.allowed_break_minutes)) || 0)
            : existing.allowed_break_minutes || 0;

        const nextBreakDuration =
          req.body?.break_duration_minutes !== undefined
            ? Math.max(0, Number(normalizeDigits(req.body.break_duration_minutes)) || 0)
            : existing.break_duration_minutes || 0;

        const nextBreakReason =
          req.body?.break_reason !== undefined
            ? String(req.body.break_reason || '').slice(0, 120)
            : existing.break_reason || '';

        const nextNote =
          req.body?.note !== undefined
            ? String(req.body.note || '').slice(0, 300)
            : existing.note;

        const nextVerified =
          req.body?.verified_by_cctv !== undefined
            ? req.body.verified_by_cctv
              ? 1
              : 0
            : existing.verified_by_cctv;

        db.prepare(
          `UPDATE attendance_logs
           SET action_type = ?, timestamp = ?, date_key = ?, shift_date_key = ?,
               late_minutes = ?, allowed_break_minutes = ?, break_duration_minutes = ?, break_reason = ?,
               note = ?, verified_by_cctv = ?, synced = 0
           WHERE id = ?`
        ).run(
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
          existing.id
        );

        recordAuditLog(db, {
          userId: req.auth.user.id,
          userName: req.auth.user.display_name,
          role: req.auth.user.role,
          action: 'تعديل سجل حضور',
          details: `تعديل حركة الموظف "${existing.employee_name}" (${nextAction})`,
          ip: getClientIp(req),
        });

        const updated = db
          .prepare('SELECT * FROM attendance_logs WHERE id = ?')
          .get(existing.id);
        broadcastUpdate('attendance_edit');
        return res.json({ ok: true, log: updated });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.delete(
    '/api/attendance/:id',
    requireAuth,
    requirePermission('records:manage'),
    (req, res) => {
      try {
        const existing = db
          .prepare('SELECT * FROM attendance_logs WHERE id = ?')
          .get(req.params.id);
        if (!existing) {
          return res.status(404).json({ error: 'سجل الحضور غير موجود' });
        }
        db.prepare('DELETE FROM attendance_logs WHERE id = ?').run(existing.id);
        deleteCloudRecord(db, 'attendance_logs', existing.id);

        recordAuditLog(db, {
          userId: req.auth.user.id,
          userName: req.auth.user.display_name,
          role: req.auth.user.role,
          action: 'حذف سجل حضور',
          details: `حذف حركة (${existing.action_type}) للموظف "${existing.employee_name}"`,
          ip: getClientIp(req),
          severity: 'warning',
        });

        broadcastUpdate('attendance_delete');
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.put('/api/trucks/:id', requireAuth, requirePermission('records:manage'), (req, res) => {
    try {
      const existing = db.prepare('SELECT * FROM truck_logs WHERE id = ?').get(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'سجل العربية غير موجود' });
      }

      const nextSupplierName =
        req.body?.supplier_name !== undefined && String(req.body.supplier_name).trim()
          ? String(req.body.supplier_name).trim()
          : existing.supplier_name;
      const nextCategory =
        req.body?.category !== undefined && String(req.body.category).trim()
          ? String(req.body.category).trim()
          : existing.category;
      const nextPlate =
        req.body?.plate_or_driver !== undefined
          ? String(req.body.plate_or_driver || '').trim()
          : existing.plate_or_driver;
      const nextStatus =
        req.body?.status === 'unloading' || req.body?.status === 'completed'
          ? req.body.status
          : existing.status;
      const validConditions = ['pending', 'complete', 'shortage', 'return_damaged'];
      const nextCondition = validConditions.includes(req.body?.delivery_condition)
        ? req.body.delivery_condition
        : existing.delivery_condition;
      const nextInvoice =
        req.body?.invoice_number !== undefined
          ? String(req.body.invoice_number || '').trim()
          : existing.invoice_number;
      const nextNotes =
        req.body?.notes !== undefined ? String(req.body.notes || '').trim() : existing.notes;
      const nextDuration =
        req.body?.duration_minutes !== undefined
          ? Math.max(0, Number(normalizeDigits(req.body.duration_minutes)) || 0)
          : existing.duration_minutes;

      const departureTime =
        nextStatus === 'completed'
          ? existing.departure_time || new Date().toISOString()
          : '';

      db.prepare(
        `UPDATE truck_logs
         SET supplier_name = ?, category = ?, plate_or_driver = ?, status = ?,
             departure_time = ?, duration_minutes = ?, delivery_condition = ?,
             invoice_number = ?, notes = ?, synced = 0
         WHERE id = ?`
      ).run(
        nextSupplierName,
        nextCategory,
        nextPlate,
        nextStatus,
        departureTime,
        nextDuration,
        nextCondition,
        nextInvoice,
        nextNotes,
        existing.id
      );

      recordAuditLog(db, {
        userId: req.auth.user.id,
        userName: req.auth.user.display_name,
        role: req.auth.user.role,
        action: 'تعديل سجل عربية مورد',
        details: `تعديل سجل عربية "${nextSupplierName}"`,
        ip: getClientIp(req),
      });

      const updated = db.prepare('SELECT * FROM truck_logs WHERE id = ?').get(existing.id);
      broadcastUpdate('truck_edit');
      return res.json({ ok: true, truck: updated });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/trucks/:id', requireAuth, requirePermission('records:manage'), (req, res) => {
    try {
      const existing = db.prepare('SELECT * FROM truck_logs WHERE id = ?').get(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'سجل العربية غير موجود' });
      }
      db.prepare('DELETE FROM truck_logs WHERE id = ?').run(existing.id);
      deleteCloudRecord(db, 'truck_logs', existing.id);

      recordAuditLog(db, {
        userId: req.auth.user.id,
        userName: req.auth.user.display_name,
        role: req.auth.user.role,
        action: 'حذف سجل عربية مورد',
        details: `حذف سجل عربية "${existing.supplier_name}"`,
        ip: getClientIp(req),
        severity: 'warning',
      });

      broadcastUpdate('truck_delete');
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/notes/:id', requireAuth, requirePermission('records:manage'), (req, res) => {
    try {
      const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'الملاحظة غير موجودة' });
      }

      const nextLocation =
        req.body?.location_tag !== undefined && String(req.body.location_tag).trim()
          ? String(req.body.location_tag).trim()
          : existing.location_tag;
      const nextCategory =
        req.body?.category_tag !== undefined && String(req.body.category_tag).trim()
          ? String(req.body.category_tag).trim()
          : existing.category_tag;
      const validSev = ['normal', 'warning', 'urgent'];
      const nextSeverity = validSev.includes(req.body?.severity)
        ? req.body.severity
        : existing.severity;
      const nextDvr =
        req.body?.dvr_timestamp !== undefined && String(req.body.dvr_timestamp).trim()
          ? String(req.body.dvr_timestamp).trim()
          : existing.dvr_timestamp;
      const nextContent =
        req.body?.content !== undefined && String(req.body.content).trim()
          ? String(req.body.content).trim()
          : existing.content;
      const nextOpen =
        req.body?.is_open_handover !== undefined
          ? req.body.is_open_handover
            ? 1
            : 0
          : existing.is_open_handover;

      db.prepare(
        `UPDATE notes
         SET location_tag = ?, category_tag = ?, severity = ?, dvr_timestamp = ?, content = ?, is_open_handover = ?, synced = 0
         WHERE id = ?`
      ).run(
        nextLocation,
        nextCategory,
        nextSeverity,
        nextDvr,
        nextContent,
        nextOpen,
        existing.id
      );

      recordAuditLog(db, {
        userId: req.auth.user.id,
        userName: req.auth.user.display_name,
        role: req.auth.user.role,
        action: 'تعديل ملاحظة مراقبة',
        details: `تعديل ملاحظة [${nextLocation}]`,
        ip: getClientIp(req),
      });

      const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(existing.id);
      broadcastUpdate('note_edit');
      return res.json({ ok: true, note: updated });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/notes/:id', requireAuth, requirePermission('records:manage'), (req, res) => {
    try {
      const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'الملاحظة غير موجودة' });
      }
      db.prepare('DELETE FROM notes WHERE id = ?').run(existing.id);
      deleteCloudRecord(db, 'notes', existing.id);

      recordAuditLog(db, {
        userId: req.auth.user.id,
        userName: req.auth.user.display_name,
        role: req.auth.user.role,
        action: 'حذف ملاحظة مراقبة',
        details: `حذف ملاحظة [${existing.location_tag}]: ${existing.content.slice(0, 60)}`,
        ip: getClientIp(req),
        severity: 'warning',
      });

      broadcastUpdate('note_delete');
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete(
    '/api/handovers/:id',
    requireAuth,
    requirePermission('records:manage'),
    (req, res) => {
      try {
        db.prepare('DELETE FROM shift_handovers WHERE id = ?').run(req.params.id);
        broadcastUpdate('handover_delete');
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  // Comprehensive Multi-Day / Date-Range Reports Hub for Admin & Supervisors
  app.get('/api/reports/range', requireAuth, requirePermission('reports:view'), (req, res) => {
    try {
      const today = getLocalDateKey();
      const rawFrom = String(req.query.from || today).trim();
      const rawTo = String(req.query.to || today).trim();
      const fromDate = rawFrom <= rawTo ? rawFrom : rawTo;
      const toDate = rawFrom <= rawTo ? rawTo : rawFrom;

      const employees = db
        .prepare('SELECT * FROM employees WHERE is_active = 1 ORDER BY department, name')
        .all();
      const suppliers = db
        .prepare('SELECT * FROM suppliers WHERE is_active = 1 ORDER BY name')
        .all();

      const attendanceLogs = db
        .prepare(
          'SELECT * FROM attendance_logs WHERE (date_key >= ? AND date_key <= ?) OR (shift_date_key >= ? AND shift_date_key <= ?) ORDER BY timestamp DESC'
        )
        .all(fromDate, toDate, fromDate, toDate);

      const truckLogs = db
        .prepare(
          'SELECT * FROM truck_logs WHERE date_key >= ? AND date_key <= ? ORDER BY arrival_time DESC'
        )
        .all(fromDate, toDate);

      const canSeeShortagesInReports =
        req.auth.has('shortages:read') ||
        req.auth.has('shortages:write') ||
        req.auth.has('shortages:manage') ||
        req.auth.has('records:manage');

      const shortagesInRange = canSeeShortagesInReports
        ? db
            .prepare(
              `SELECT * FROM shortages
               WHERE (date_key >= ? AND date_key <= ?) OR status IN ('open', 'ordered')
               ORDER BY updated_at DESC`
            )
            .all(fromDate, toDate)
        : [];

      const notes = db
        .prepare(
          'SELECT * FROM notes WHERE date_key >= ? AND date_key <= ? ORDER BY timestamp DESC'
        )
        .all(fromDate, toDate);

      const handovers = db
        .prepare(
          'SELECT * FROM shift_handovers WHERE date_key >= ? AND date_key <= ? ORDER BY timestamp DESC'
        )
        .all(fromDate, toDate);

      // Per-employee performance & attendance report
      const empMap = new Map();
      for (const e of employees) {
        empMap.set(e.id, {
          id: e.id,
          emp_code: e.emp_code || '',
          name: e.name,
          department: e.department,
          daysSet: new Set(),
          checkIns: 0,
          checkOuts: 0,
          breaks: 0,
          totalBreakMinutes: 0,
          lateCount: 0,
          totalLateMinutes: 0,
        });
      }

      for (const log of attendanceLogs) {
        if (!empMap.has(log.employee_id)) {
          empMap.set(log.employee_id, {
            id: log.employee_id,
            emp_code: '',
            name: log.employee_name,
            department: log.department,
            daysSet: new Set(),
            checkIns: 0,
            checkOuts: 0,
            breaks: 0,
            totalBreakMinutes: 0,
            lateCount: 0,
            totalLateMinutes: 0,
          });
        }
        const st = empMap.get(log.employee_id);
        if (log.action_type === 'check_in') {
          st.checkIns += 1;
          st.daysSet.add(log.shift_date_key || log.date_key);
          if (log.late_minutes > 0) {
            st.lateCount += 1;
            st.totalLateMinutes += log.late_minutes;
          }
        } else if (log.action_type === 'check_out') {
          st.checkOuts += 1;
        } else if (log.action_type === 'break_start') {
          st.breaks += 1;
        } else if (log.action_type === 'break_end') {
          st.totalBreakMinutes += Number(log.break_duration_minutes) || 0;
        }
      }

      const employeeStats = Array.from(empMap.values())
        .map(({ daysSet, ...rest }) => ({
          ...rest,
          daysPresent: daysSet.size,
        }))
        .sort((a, b) => b.daysPresent - a.daysPresent || b.totalLateMinutes - a.totalLateMinutes);

      // Supplier deliveries report
      const supMap = new Map();
      for (const s of suppliers) {
        supMap.set(s.name, {
          supplier_name: s.name,
          category: s.category,
          deliveriesCount: 0,
          completedCount: 0,
          totalDuration: 0,
          issuesCount: 0,
          hasPendingReturn: Boolean(s.has_pending_return),
          pendingReturnNote: s.pending_return_note || '',
        });
      }

      for (const t of truckLogs) {
        const key = t.supplier_name;
        if (!supMap.has(key)) {
          supMap.set(key, {
            supplier_name: key,
            category: t.category,
            deliveriesCount: 0,
            completedCount: 0,
            totalDuration: 0,
            issuesCount: 0,
            hasPendingReturn: false,
            pendingReturnNote: '',
          });
        }
        const st = supMap.get(key);
        st.deliveriesCount += 1;
        if (t.status === 'completed') {
          st.completedCount += 1;
          st.totalDuration += t.duration_minutes || 0;
        }
        if (t.delivery_condition === 'shortage' || t.delivery_condition === 'return_damaged') {
          st.issuesCount += 1;
        }
      }

      const supplierStats = Array.from(supMap.values())
        .map((s) => ({
          ...s,
          avgDurationMinutes:
            s.completedCount > 0 ? Math.round(s.totalDuration / s.completedCount) : 0,
        }))
        .filter((s) => s.deliveriesCount > 0 || s.hasPendingReturn)
        .sort((a, b) => b.deliveriesCount - a.deliveriesCount);

      // Shortages breakdown by category & recurring items
      const catMap = new Map();
      const itemFreqMap = new Map();

      for (const sh of shortagesInRange) {
        const cat = sh.category || 'أخرى';
        if (!catMap.has(cat)) {
          catMap.set(cat, { category: cat, total: 0, open: 0, ordered: 0, resolved: 0 });
        }
        const cEntry = catMap.get(cat);
        cEntry.total += 1;
        if (sh.status === 'open') cEntry.open += 1;
        else if (sh.status === 'ordered') cEntry.ordered += 1;
        else cEntry.resolved += 1;

        const normItem = sh.item_name.trim().toLowerCase();
        if (!itemFreqMap.has(normItem)) {
          itemFreqMap.set(normItem, {
            item_name: sh.item_name,
            category: sh.category,
            timesReported: 0,
            latestQty: sh.requested_qty,
            unit: sh.unit || '',
            latestStatus: sh.status,
          });
        }
        itemFreqMap.get(normItem).timesReported += 1;
      }

      const completedTrucks = truckLogs.filter((t) => t.status === 'completed');
      const avgUnloadMinutes =
        completedTrucks.length > 0
          ? Math.round(
              completedTrucks.reduce((acc, t) => acc + (t.duration_minutes || 0), 0) /
                completedTrucks.length
            )
          : 0;

      const uniquePresentSet = new Set(
        attendanceLogs.filter((l) => l.action_type === 'check_in').map((l) => l.employee_id)
      );

      return res.json({
        ok: true,
        period: { from: fromDate, to: toDate },
        totals: {
          totalActiveStaff: employees.length,
          attendanceEvents: attendanceLogs.length,
          uniqueEmployeesPresent: uniquePresentSet.size,
          totalLateInstances: attendanceLogs.filter((l) => l.late_minutes > 0).length,
          totalLateMinutes: attendanceLogs.reduce((s, l) => s + (l.late_minutes || 0), 0),
          breaksCount: attendanceLogs.filter((l) => l.action_type === 'break_start').length,
          totalBreakMinutes: attendanceLogs
            .filter((l) => l.action_type === 'break_end')
            .reduce((s, l) => s + (Number(l.break_duration_minutes) || 0), 0),
          unverifiedCount: attendanceLogs.filter((l) => !l.verified_by_cctv).length,
          trucksTotal: truckLogs.length,
          trucksCompleted: completedTrucks.length,
          trucksUnloading: truckLogs.filter((t) => t.status === 'unloading').length,
          avgUnloadMinutes,
          trucksWithShortage: truckLogs.filter((t) => t.delivery_condition === 'shortage').length,
          trucksWithReturn: truckLogs.filter((t) => t.delivery_condition === 'return_damaged')
            .length,
          shortagesTotal: shortagesInRange.length,
          shortagesOpen: shortagesInRange.filter((s) => s.status === 'open').length,
          shortagesOrdered: shortagesInRange.filter((s) => s.status === 'ordered').length,
          shortagesResolved: shortagesInRange.filter((s) => s.status === 'resolved').length,
          shortagesOutOfStock: shortagesInRange.filter(
            (s) => s.status !== 'resolved' && s.urgency === 'out_of_stock'
          ).length,
          notesTotal: notes.length,
          urgentNotes: notes.filter((n) => n.severity === 'urgent').length,
          warningNotes: notes.filter((n) => n.severity === 'warning').length,
          openHandoverNotes: notes.filter((n) => n.is_open_handover === 1).length,
          handoversTotal: handovers.length,
        },
        employeeStats,
        supplierStats,
        shortagesByCategory: Array.from(catMap.values()).sort((a, b) => b.open - a.open),
        topShortageItems: Array.from(itemFreqMap.values())
          .sort((a, b) => b.timesReported - a.timesReported)
          .slice(0, 20),
        shortagesList: shortagesInRange,
        attendanceLogs,
        truckLogs,
        notes,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Clear test operational logs while preserving real employees, suppliers, catalog, settings & passwords
  app.post('/api/system/clear-logs', requireAuth, requirePermission('users:manage'), (req, res) => {
    try {
      db.exec(`
        DELETE FROM attendance_logs;
        DELETE FROM truck_logs;
        DELETE FROM shortages;
        DELETE FROM notes;
        DELETE FROM shift_handovers;
        DELETE FROM team_messages;
      `);
      recordAuditLog(db, {
        userId: req.auth.user.id,
        userName: req.auth.user.display_name,
        role: req.auth.user.role,
        action: 'تصفير سجلات الحركات التجريبية',
        details: 'تم مسح سجلات الحضور والعربيات والنواقص والملاحظات ورسائل التيم مع الاحتفاظ بالموظفين والموردين وكتالوج الأصناف وكلمات المرور',
        ip: getClientIp(req),
        severity: 'warning',
      });
      broadcastUpdate('logs_cleared');
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Purge any legacy fake seed data on demand
  app.post('/api/system/purge-fake-data', requireAuth, requirePermission('users:manage'), (req, res) => {
    try {
      purgeLegacyFakeSeedData(db);
      recordAuditLog(db, {
        userId: req.auth.user.id,
        userName: req.auth.user.display_name,
        role: req.auth.user.role,
        action: 'تنظيف البيانات الوهمية (Fake Data)',
        details: 'تم حذف أي بيانات تجريبية افتراضية والإبقاء على البيانات الحقيقية فقط',
        ip: getClientIp(req),
        severity: 'warning',
      });
      broadcastUpdate('fake_data_purged');
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // =========================================================================
  // 4D. TEAM & CASHIER REAL-TIME COMMUNICATION (الشات والتنبيهات اللحظية)
  // =========================================================================

  app.get('/api/team-messages', requireAuth, (req, res) => {
    try {
      const channel = String(req.query.channel || '').trim();
      const rows = channel && channel !== 'all'
        ? db
            .prepare(
              'SELECT * FROM team_messages WHERE channel = ? ORDER BY is_pinned DESC, timestamp DESC LIMIT 150'
            )
            .all(channel)
        : db
            .prepare(
              'SELECT * FROM team_messages ORDER BY is_pinned DESC, timestamp DESC LIMIT 150'
            )
            .all();
      return res.json({ ok: true, messages: rows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/team-messages', requireAuth, (req, res) => {
    try {
      if (req.auth.user?.role === 'kiosk') {
        return res.status(403).json({ error: 'غير مسموح في وضع الكشك' });
      }
      const {
        channel = 'general',
        content = '',
        message = '',
        is_urgent = false,
        priority = 'normal',
        is_pinned = false,
      } = req.body || {};

      const cleanContent = String(content || message || '').trim().slice(0, 600);
      if (!cleanContent) {
        return res.status(400).json({ error: 'يرجى كتابة نص الرسالة أو اختيار تنبيه سريع' });
      }

      const validChannels = ['cashier', 'general', 'security'];
      const finalChannel = validChannels.includes(channel) ? channel : 'general';
      const finalUrgent = Boolean(is_urgent || priority === 'urgent');
      const now = new Date();
      const isoNow = now.toISOString();
      const dateKey = getLocalDateKey(now);
      const id = req.body?.id ? String(req.body.id) : crypto.randomUUID();

      const existingMsg = db.prepare('SELECT * FROM team_messages WHERE id = ?').get(id);
      if (existingMsg) {
        return res.status(200).json({ ok: true, message: existingMsg });
      }

      db.prepare(`
        INSERT INTO team_messages (
          id, channel, sender_id, sender_name, sender_role, content, is_urgent, is_pinned, timestamp, date_key, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        id,
        finalChannel,
        req.auth.user.id,
        req.auth.user.display_name,
        req.auth.user.role,
        cleanContent,
        finalUrgent ? 1 : 0,
        is_pinned ? 1 : 0,
        isoNow,
        dateKey
      );

      const channelArabic =
        finalChannel === 'cashier'
          ? 'قناة الكاشيرية'
          : finalChannel === 'security'
          ? 'قناة الأمن والبوابة'
          : 'قناة التيم العام';

      recordAuditLog(db, {
        userId: req.auth.user.id,
        userName: req.auth.user.display_name,
        role: req.auth.user.role,
        action: `رسالة تواصل (${channelArabic})`,
        details: cleanContent,
        ip: getClientIp(req),
        severity: is_urgent ? 'warning' : 'info',
      });

      const created = db.prepare('SELECT * FROM team_messages WHERE id = ?').get(id);
      broadcastUpdate('team_message');
      return res.status(201).json({ ok: true, message: created });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/team-messages/:id/pin', requireAuth, (req, res) => {
    try {
      const existing = db.prepare('SELECT * FROM team_messages WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'الرسالة غير موجودة' });
      const nextPin = existing.is_pinned ? 0 : 1;
      db.prepare('UPDATE team_messages SET is_pinned = ?, synced = 0 WHERE id = ?').run(
        nextPin,
        existing.id
      );
      broadcastUpdate('team_message_pin');
      return res.json({ ok: true, is_pinned: Boolean(nextPin) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/team-messages/:id', requireAuth, (req, res) => {
    try {
      const existing = db.prepare('SELECT * FROM team_messages WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'الرسالة غير موجودة' });
      const canDelete =
        req.auth.has('records:manage') ||
        req.auth.has('users:manage') ||
        existing.sender_id === req.auth.user.id;
      if (!canDelete) {
        return res.status(403).json({ error: 'غير مصرح بحذف هذه الرسالة' });
      }
      db.prepare('DELETE FROM team_messages WHERE id = ?').run(existing.id);
      deleteCloudRecord(db, 'team_messages', existing.id);
      broadcastUpdate('team_message_delete');
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // =========================================================================
  // 4E. PERSONAL PROFILE & INDIVIDUAL / MASTER LOGS
  // =========================================================================

  app.get('/api/profile/me', requireAuth, (req, res) => {
    try {
      const secretHex = getSessionSecret();
      const userRow = db
        .prepare('SELECT * FROM system_users WHERE id = ? LIMIT 1')
        .get(req.auth.user.id);
      const empRow = userRow?.employee_id
        ? db.prepare('SELECT * FROM employees WHERE id = ? LIMIT 1').get(userRow.employee_id)
        : null;
      const myPass = userRow
        ? decryptPasswordForAdmin(userRow.pin_cipher, secretHex) || empRow?.emp_code || ''
        : '';

      const empId = empRow?.id || '';
      const myAttendanceLogs = empId
        ? db
            .prepare(
              'SELECT * FROM attendance_logs WHERE employee_id = ? ORDER BY timestamp DESC LIMIT 80'
            )
            .all(empId)
        : [];

      const myNamePattern = `%${req.auth.user.display_name}%`;
      const myShortages = db
        .prepare(
          'SELECT * FROM shortages WHERE recorded_by LIKE ? ORDER BY timestamp DESC LIMIT 50'
        )
        .all(myNamePattern);

      const myNotes = db
        .prepare('SELECT * FROM notes WHERE recorded_by LIKE ? ORDER BY timestamp DESC LIMIT 50')
        .all(myNamePattern);

      const myAuditLogs = db
        .prepare(
          'SELECT * FROM audit_logs WHERE user_id = ? OR user_id = ? OR user_name LIKE ? ORDER BY timestamp DESC LIMIT 80'
        )
        .all(req.auth.user.id, empId, myNamePattern);

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
          user_id: req.auth.user.id,
          username: req.auth.user.username,
          display_name: req.auth.user.display_name,
          role: req.auth.user.role,
          role_label: req.auth.user.role_label,
          avatar_color: req.auth.user.avatar_color,
          my_password: req.auth.user.role === 'kiosk' ? '' : myPass,
          employee_id: empId,
          emp_code: empRow?.emp_code || '',
          department: empRow?.department || ROLES_METADATA[req.auth.user.role]?.shortLabel || '',
          role_title: empRow?.role_title || ROLES_METADATA[req.auth.user.role]?.label || '',
          shift_start: empRow?.shift_start || '08:00',
          shift_end: empRow?.shift_end || '20:00',
          phone: empRow?.phone || '',
          qr_payload: empRow ? `ZMART:EMP:${empRow.id}` : '',
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
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Per-Employee / Per-User Complete Individual Log
  app.get('/api/logs/person/:id', requireAuth, (req, res) => {
    try {
      const targetId = String(req.params.id || '').trim();
      const canSeeAnyone =
        req.auth.has('audit:view') ||
        req.auth.has('reports:view') ||
        req.auth.has('staff:manage') ||
        req.auth.has('users:manage') ||
        req.auth.has('attendance:read');

      const isSelf =
        targetId === req.auth.user.id ||
        (req.auth.user.employee_id && targetId === req.auth.user.employee_id);

      if (!canSeeAnyone && !isSelf) {
        return res.status(403).json({ error: 'غير مصرح بعرض سجل موظف آخر' });
      }

      let empRow = db.prepare('SELECT * FROM employees WHERE id = ? LIMIT 1').get(targetId);
      let userRow = db.prepare('SELECT * FROM system_users WHERE id = ? LIMIT 1').get(targetId);

      if (empRow && !userRow) {
        userRow = db
          .prepare('SELECT * FROM system_users WHERE employee_id = ? LIMIT 1')
          .get(empRow.id);
      } else if (userRow && !empRow && userRow.employee_id) {
        empRow = db
          .prepare('SELECT * FROM employees WHERE id = ? LIMIT 1')
          .get(userRow.employee_id);
      }

      if (!empRow && !userRow) {
        return res.status(404).json({ error: 'لم يتم العثور على الموظف أو المستخدم' });
      }

      const personName = empRow?.name || userRow?.display_name || '';
      const empId = empRow?.id || '__NO_EMP__';
      const userId = userRow?.id || '__NO_USER__';
      const namePattern = `%${personName}%`;

      const attendanceLogs = db
        .prepare(
          'SELECT * FROM attendance_logs WHERE employee_id = ? ORDER BY timestamp DESC LIMIT 250'
        )
        .all(empId);

      const shortages = db
        .prepare(
          'SELECT * FROM shortages WHERE recorded_by LIKE ? OR updated_by LIKE ? ORDER BY timestamp DESC LIMIT 150'
        )
        .all(namePattern, namePattern);

      const notes = db
        .prepare(
          'SELECT * FROM notes WHERE recorded_by LIKE ? ORDER BY timestamp DESC LIMIT 150'
        )
        .all(namePattern);

      const truckLogs = db
        .prepare(
          'SELECT * FROM truck_logs WHERE recorded_by LIKE ? ORDER BY arrival_time DESC LIMIT 100'
        )
        .all(namePattern);

      const teamMessages = db
        .prepare(
          'SELECT * FROM team_messages WHERE sender_id = ? OR sender_name LIKE ? ORDER BY timestamp DESC LIMIT 100'
        )
        .all(userId, namePattern);

      const auditLogs = db
        .prepare(
          'SELECT * FROM audit_logs WHERE user_id = ? OR user_id = ? OR user_name LIKE ? OR details LIKE ? ORDER BY timestamp DESC LIMIT 250'
        )
        .all(userId, empId, namePattern, namePattern);

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
        isSelf || req.auth.has('users:manage') || req.auth.has('staff:manage');
      const secretHex = getSessionSecret();
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
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Master Full System Audit Log for Admin
  app.get(
    '/api/audit-logs',
    requireAuth,
    requireAnyPermission(['audit:view', 'users:manage', 'reports:view']),
    (req, res) => {
      try {
        const limit = Math.min(2000, Math.max(50, Number(req.query.limit) || 500));
        const search = String(req.query.search || '').trim();
        const roleFilter = String(req.query.role || '').trim();

        let logs = db
          .prepare(`SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ${limit}`)
          .all();

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

        return res.json({ ok: true, auditLogs: logs });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.delete(
    '/api/audit-logs',
    requireAuth,
    requirePermission('users:manage'),
    (req, res) => {
      try {
        db.exec('DELETE FROM audit_logs;');
        recordAuditLog(db, {
          userId: req.auth.user.id,
          userName: req.auth.user.display_name,
          role: req.auth.user.role,
          action: 'تصفير سجل التدقيق الشامل (Master Log)',
          details: 'تم مسح سجل التدقيق القديم بواسطة الأدمن',
          ip: getClientIp(req),
          severity: 'warning',
        });
        broadcastUpdate('audit_cleared');
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.put('/api/settings', requireAuth, requirePermission('settings:manage'), (req, res) => {
    try {
      const allowedKeys = [
        'store_name',
        'branch_name',
        'max_break_minutes',
        'max_unload_minutes',
        'supabase_url',
        'supabase_anon_key',
        'cloud_sync_enabled',
      ];
      const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      for (const key of allowedKeys) {
        if (req.body && req.body[key] !== undefined) {
          if (key === 'supabase_anon_key' && req.body[key] === '***KEEP***') continue;
          stmt.run(key, String(req.body[key]));
        }
      }

      if (req.body?.admin_pin && String(req.body.admin_pin).trim().length >= 1) {
        const cleanNewPass = normalizeDigits(String(req.body.admin_pin).trim());
        const conflict = findPasswordConflict(cleanNewPass, req.auth.user.id);
        if (conflict) {
          return res.status(400).json({
            error: `كلمة المرور هذه مستخدمة بالفعل لحساب "${conflict.display_name}" — يجب أن تكون لكل دور كلمة مرور مختلفة`,
          });
        }
        const { saltHex, hashHex } = hashPin(cleanNewPass);
        const cipher = encryptPasswordForAdmin(cleanNewPass, getSessionSecret());
        db.prepare(
          'UPDATE system_users SET pin_salt = ?, pin_hash = ?, pin_cipher = ?, updated_at = ? WHERE id = ?'
        ).run(saltHex, hashHex, cipher, new Date().toISOString(), req.auth.user.id);
      }

      recordAuditLog(db, {
        userId: req.auth.user.id,
        userName: req.auth.user.display_name,
        role: req.auth.user.role,
        action: 'تحديث إعدادات النظام',
        details: 'تم حفظ إعدادات الفرع والمزامنة وحدود المؤقتات',
        ip: getClientIp(req),
      });

      broadcastUpdate('settings');
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/system/network', requireAuth, requirePermission('settings:manage'), (req, res) => {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push({ name, address: iface.address });
        }
      }
    }
    let schemaSql = '';
    const schemaPath = path.resolve(process.cwd(), 'supabase', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      schemaSql = fs.readFileSync(schemaPath, 'utf8');
    }
    res.json({
      ips,
      apiPort: Number(process.env.PORT || 3001),
      schemaSql,
    });
  });

  app.post('/api/cloud/test', requireAuth, requirePermission('settings:manage'), async (req, res) => {
    const settings = getSettingsMap();
    const url = req.body?.supabase_url ?? settings.supabase_url;
    const key =
      req.body?.supabase_anon_key && req.body.supabase_anon_key !== '***KEEP***'
        ? req.body.supabase_anon_key
        : settings.supabase_anon_key;
    const result = await testCloudConnection(url, key);
    res.json(result);
  });

  app.post('/api/cloud/sync', requireAuth, requirePermission('settings:manage'), async (req, res) => {
    const result = await syncWithCloud(db, uploadsDir);
    if (result.ok) broadcastUpdate('cloud_sync');
    res.json(result);
  });

  app.get('/api/backup/export', requireAuth, requirePermission('backup:manage'), (req, res) => {
    recordAuditLog(db, {
      userId: req.auth.user.id,
      userName: req.auth.user.display_name,
      role: req.auth.user.role,
      action: 'تصدير نسخة احتياطية كاملة',
      details: 'تم تنزيل نسخة احتياطية لقاعدة البيانات',
      ip: getClientIp(req),
    });
    res.json(exportFullBackup(db));
  });

  // Automatic Client-to-Server Cold-Start Rehydration (Keeps Vercel alive before Supabase is linked!)
  app.post('/api/sync/rehydrate', requireAuth, (req, res) => {
    try {
      const canRehydrateAll =
        req.auth.has('staff:manage') ||
        req.auth.has('backup:manage') ||
        req.auth.has('records:manage') ||
        req.auth.user?.role === 'owner' ||
        req.auth.user?.role === 'manager' ||
        req.auth.user?.role === 'supervisor';

      const body = req.body || {};
      const tables = body.tables || body;

      // Only allow non-admin operational roles to rehydrate when server DB is genuinely cold-empty
      const currentCount =
        db.prepare('SELECT COUNT(*) as c FROM employees').get().c +
        db.prepare('SELECT COUNT(*) as c FROM shortages').get().c +
        db.prepare('SELECT COUNT(*) as c FROM attendance_logs').get().c;

      if (!canRehydrateAll && currentCount > 0) {
        return res.json({ ok: true, skipped: true });
      }

      importFullBackup(db, { tables });

      recordAuditLog(db, {
        userId: req.auth.user.id,
        userName: req.auth.user.display_name,
        role: req.auth.user.role,
        action: 'مزامنة تلقائية من ذاكرة الهاتف (Auto-Rehydrate)',
        details: 'استعادة البيانات المحلية المحفوظة على الجهاز بعد إعادة تشغيل الخادم السحابي',
        ip: getClientIp(req),
      });

      broadcastUpdate('client_rehydrate');
      return res.json({ ok: true, restored: true });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/backup/import', requireAuth, requirePermission('backup:manage'), (req, res) => {
    try {
      importFullBackup(db, req.body);
      recordAuditLog(db, {
        userId: req.auth.user.id,
        userName: req.auth.user.display_name,
        role: req.auth.user.role,
        action: 'استعادة نسخة احتياطية كاملة',
        details: 'تم استيراد واستبدال سجلات من ملف نسخة احتياطية',
        ip: getClientIp(req),
        severity: 'warning',
      });
      broadcastUpdate('backup_import');
      res.json({ ok: true, message: 'تم استعادة النسخة الاحتياطية بنجاح!' });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // =========================================================================
  // 5. ADMIN PASSWORD & ROLE MANAGER + DYNAMIC POLICIES + AUDIT LOG
  // =========================================================================

  app.get(
    '/api/rbac/overview',
    requireAuth,
    requireAnyPermission(['users:manage', 'audit:view']),
    (req, res) => {
      const canManageUsers = req.auth.has('users:manage');
      const secretHex = getSessionSecret();
      const users = canManageUsers
        ? db
            .prepare(
              `SELECT id, username, display_name, role, pin_cipher, avatar_color, is_active, employee_id, custom_permissions_json, last_login_at, created_at
               FROM system_users
               ORDER BY is_active DESC, created_at ASC`
            )
            .all()
            .map((u) => {
              const { pin_cipher, custom_permissions_json, ...rest } = u;
              let customPerms = [];
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
            })
        : [];

      const policiesRows = db.prepare('SELECT role, permissions_json FROM role_policies').all();
      const policies = {};
      for (const r of policiesRows) {
        try {
          policies[r.role] = JSON.parse(r.permissions_json);
        } catch {
          policies[r.role] = [];
        }
      }
      policies.owner = ALL_PERMISSIONS.map((p) => p.id);

      const activeSessionsCount = db
        .prepare(
          'SELECT COUNT(*) as c FROM user_sessions WHERE revoked = 0 AND expires_at > ?'
        )
        .get(new Date().toISOString()).c;

      const auditLogs = db
        .prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 500')
        .all();

      res.json({
        rolesMeta: ROLES_METADATA,
        permissionsCatalog: ALL_PERMISSIONS,
        policies,
        users,
        activeSessionsCount,
        auditLogs,
      });
    }
  );

  app.post('/api/rbac/users', requireAuth, requirePermission('users:manage'), (req, res) => {
    try {
      const {
        username,
        display_name,
        role = 'security',
        password,
        pin,
        avatar_color = '#0B57D0',
        custom_permissions = [],
      } = req.body || {};

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

      const conflict = findPasswordConflict(rawPass);
      if (conflict) {
        return res.status(400).json({
          error: `كلمة المرور هذه مخصصة بالفعل لـ "${conflict.display_name}" — اختر كلمة مرور مختلفة ليتم تحديد الدور تلقائياً عند الدخول`,
        });
      }

      const cleanUsername = username?.trim()
        ? username.trim().toLowerCase().replace(/\s+/g, '_')
        : `${role}_${crypto.randomBytes(3).toString('hex')}`;

      const exists = db
        .prepare('SELECT id FROM system_users WHERE username = ?')
        .get(cleanUsername);
      if (exists) {
        return res.status(400).json({ error: 'المعرف مستخدم بالفعل' });
      }

      const validPermIds = new Set(ALL_PERMISSIONS.map((p) => p.id));
      const cleanCustomPerms = Array.isArray(custom_permissions)
        ? custom_permissions.filter((p) => validPermIds.has(p))
        : [];

      const { saltHex, hashHex } = hashPin(rawPass);
      const cipher = encryptPasswordForAdmin(rawPass, getSessionSecret());
      const id = req.body?.id ? String(req.body.id) : crypto.randomUUID();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO system_users (
          id, username, display_name, role, pin_salt, pin_hash, pin_cipher, avatar_color, is_active, custom_permissions_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(
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
        now
      );

      recordAuditLog(db, {
        userId: req.auth.user.id,
        userName: req.auth.user.display_name,
        role: req.auth.user.role,
        action: 'إنشاء كلمة مرور وصلاحية جديدة',
        details: `إنشاء كلمة مرور لـ "${display_name.trim()}" بدور (${ROLES_METADATA[role].label})`,
        ip: getClientIp(req),
      });

      broadcastUpdate('rbac_user_add');
      return res.status(201).json({ ok: true, id });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/rbac/users/:id', requireAuth, requirePermission('users:manage'), (req, res) => {
    try {
      const target = db.prepare('SELECT * FROM system_users WHERE id = ?').get(req.params.id);
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
      } = req.body || {};

      if (!ROLES_METADATA[role]) {
        return res.status(400).json({ error: 'الدور غير صالح' });
      }

      // Guard: Never allow disabling or demoting the last active Owner!
      if (target.role === 'owner' && (role !== 'owner' || !is_active)) {
        const activeOwners = db
          .prepare("SELECT COUNT(*) as c FROM system_users WHERE role = 'owner' AND is_active = 1")
          .get().c;
        if (activeOwners <= 1) {
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
        const conflict = findPasswordConflict(rawPass, target.id);
        if (conflict) {
          return res.status(400).json({
            error: `كلمة المرور هذه مستخدمة بالفعل لـ "${conflict.display_name}" — اختر كلمة مرور مميزة لكل صلاحية`,
          });
        }
        const hashed = hashPin(rawPass);
        saltHex = hashed.saltHex;
        hashHex = hashed.hashHex;
        cipher = encryptPasswordForAdmin(rawPass, getSessionSecret());
      }

      let nextCustomPermsJson = target.custom_permissions_json || '[]';
      if (Array.isArray(custom_permissions)) {
        const validPermIds = new Set(ALL_PERMISSIONS.map((p) => p.id));
        nextCustomPermsJson = JSON.stringify(
          custom_permissions.filter((p) => validPermIds.has(p))
        );
      }

      db.prepare(`
        UPDATE system_users
        SET display_name = ?, role = ?, pin_salt = ?, pin_hash = ?, pin_cipher = ?, avatar_color = ?, is_active = ?, custom_permissions_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        display_name.trim(),
        role,
        saltHex,
        hashHex,
        cipher,
        avatar_color,
        is_active ? 1 : 0,
        nextCustomPermsJson,
        new Date().toISOString(),
        target.id
      );

      if (target.employee_id) {
        db.prepare(
          `UPDATE employees
           SET name = ?,
               system_role = ?,
               login_enabled = ?,
               emp_code = CASE WHEN ? != '' THEN ? ELSE emp_code END,
               updated_at = ?
           WHERE id = ?`
        ).run(
          display_name.trim(),
          role,
          is_active ? 1 : 0,
          rawPass,
          rawPass,
          new Date().toISOString(),
          target.employee_id
        );
      }

      // If account was deactivated or role/password changed, revoke their older sessions for immediate enforcement!
      if (!is_active || role !== target.role || rawPass.length > 0) {
        db.prepare('UPDATE user_sessions SET revoked = 1 WHERE user_id = ? AND id != ?').run(
          target.id,
          req.auth.sessionId
        );
      }

      recordAuditLog(db, {
        userId: req.auth.user.id,
        userName: req.auth.user.display_name,
        role: req.auth.user.role,
        action: 'تحديث كلمة مرور / صلاحية',
        details: `تحديث "${display_name.trim()}" (${ROLES_METADATA[role].label}) - نشط: ${is_active ? 'نعم' : 'لا'}`,
        ip: getClientIp(req),
        severity: !is_active ? 'warning' : 'info',
      });

      broadcastUpdate('rbac_user_update');
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/rbac/users/:id', requireAuth, requirePermission('users:manage'), (req, res) => {
    try {
      const target = db.prepare('SELECT * FROM system_users WHERE id = ?').get(req.params.id);
      if (!target) {
        return res.status(404).json({ error: 'الحساب غير موجود' });
      }

      if (target.role === 'owner' && target.is_active === 1) {
        const activeOwners = db
          .prepare("SELECT COUNT(*) as c FROM system_users WHERE role = 'owner' AND is_active = 1")
          .get().c;
        if (activeOwners <= 1) {
          return res.status(400).json({
            error: 'لا يمكن حذف كلمة مرور المدير الوحيد النشط في النظام!',
          });
        }
      }

      db.prepare('UPDATE user_sessions SET revoked = 1 WHERE user_id = ?').run(target.id);
      db.prepare('DELETE FROM system_users WHERE id = ?').run(target.id);
      deleteCloudRecord(db, 'system_users', target.id);
      if (target.employee_id) {
        db.prepare('UPDATE employees SET login_enabled = 0 WHERE id = ?').run(target.employee_id);
      }

      recordAuditLog(db, {
        userId: req.auth.user.id,
        userName: req.auth.user.display_name,
        role: req.auth.user.role,
        action: 'حذف كلمة مرور وصلاحية',
        details: `حذف حساب "${target.display_name}" (${ROLES_METADATA[target.role]?.label || target.role}) وإبطال جلساته`,
        ip: getClientIp(req),
        severity: 'warning',
      });

      broadcastUpdate('rbac_user_delete');
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put(
    '/api/rbac/policies/:role',
    requireAuth,
    requirePermission('users:manage'),
    (req, res) => {
      try {
        const { role } = req.params;
        if (role === 'owner') {
          return res.status(400).json({ error: 'دور المالك يحتفظ دائماً بكافة الصلاحيات' });
        }
        if (!ROLES_METADATA[role]) {
          return res.status(400).json({ error: 'الدور غير معروف' });
        }

        const validPermIds = new Set(ALL_PERMISSIONS.map((p) => p.id));
        const incoming = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
        const sanitized = incoming.filter((p) => validPermIds.has(p));

        db.prepare(
          'INSERT OR REPLACE INTO role_policies (role, permissions_json, updated_at) VALUES (?, ?, ?)'
        ).run(role, JSON.stringify(sanitized), new Date().toISOString());

        recordAuditLog(db, {
          userId: req.auth.user.id,
          userName: req.auth.user.display_name,
          role: req.auth.user.role,
          action: 'تحديث مصفوفة صلاحيات RBAC',
          details: `تعديل صلاحيات دور (${ROLES_METADATA[role].label}) إلى ${sanitized.length} صلاحية`,
          ip: getClientIp(req),
          severity: 'warning',
        });

        broadcastUpdate('rbac_policy_update');
        return res.json({ ok: true, permissions: sanitized });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    '/api/rbac/sessions/revoke-all',
    requireAuth,
    requirePermission('users:manage'),
    (req, res) => {
      const result = db
        .prepare('UPDATE user_sessions SET revoked = 1 WHERE revoked = 0 AND id != ?')
        .run(req.auth.sessionId);

      recordAuditLog(db, {
        userId: req.auth.user.id,
        userName: req.auth.user.display_name,
        role: req.auth.user.role,
        action: 'إبطال كافة الجلسات النشطة',
        details: `تم تسجيل خروج إجباري لـ (${result.changes}) جهاز/جلسة أخرى`,
        ip: getClientIp(req),
        severity: 'critical',
      });

      broadcastUpdate('sessions_revoked');
      return res.json({ ok: true, revokedCount: result.changes });
    }
  );

  const distDir = path.resolve(__dirname, '..', 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return { app, db };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  const PORT = Number(process.env.PORT || 3001);
  const { app } = createApp();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Zayed Mart Ops RBAC Server running on http://localhost:${PORT}`);
  });
}
