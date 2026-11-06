import {
  Body,
  Controller,
  Get,
  Module,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { getLocalDateKey, normalizeDigits } from '@zayed-mart/shared';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Request, Response } from 'express';
import {
  encryptPasswordForAdmin,
  getClientIp,
  hashPin,
} from '../common/crypto.util';
import {
  AuthContext,
  CurrentAuth,
  Public,
  RequireAnyPermission,
  RequirePermission,
} from '../common/decorators';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../database/storage.service';
import { RealtimeService } from '../realtime/realtime.service';

@Controller('api')
export class BootstrapController {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService
  ) {}

  @Public()
  @Get('health')
  async health() {
    return {
      ok: true,
      framework: 'nestjs',
      monorepo: 'turborepo',
      storageMode: this.db.storageMode,
      cloudRealtime: this.realtime.getPublicCloudRealtimeConfig().enabled,
      serverTime: new Date().toISOString(),
    };
  }

  @Get('events')
  async events(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    (res as any).flushHeaders?.();
    res.write(`event: connected\ndata: {"ok":true}\n\n`);
    if (this.db.isServerless) {
      return res.end();
    }
    const unregister = this.realtime.registerSseClient(res, auth);
    req.on('close', () => {
      unregister();
    });
  }

  @Get('bootstrap')
  async bootstrap(
    @Query('date') date: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const data = await this.db.buildBootstrapData(
        date,
        auth,
        this.realtime.getPublicCloudRealtimeConfig()
      );
      return res.json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('upload')
  @RequireAnyPermission([
    'attendance:write',
    'trucks:write',
    'notes:write',
    'shortages:write',
    'records:manage',
  ])
  async upload(@Body() body: any, @Res() res: Response) {
    try {
      const result = await this.storage.uploadProofDataUrl(body?.dataUrl, body?.prefix);
      if (result.ok === false) {
        return res.status(400).json({ error: result.error });
      }
      return res.json({ ok: true, url: result.url });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Put('settings')
  @RequirePermission('settings:manage')
  async updateSettings(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
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
      for (const key of allowedKeys) {
        if (body && body[key] !== undefined) {
          if (key === 'supabase_anon_key' && body[key] === '***KEEP***') continue;
          await this.db.upsertSetting(key, String(body[key]));
        }
      }

      if (body?.admin_pin && String(body.admin_pin).trim().length >= 1) {
        const cleanNewPass = normalizeDigits(String(body.admin_pin).trim());
        const conflict = await this.db.findPasswordConflict(cleanNewPass, auth.user.id);
        if (conflict) {
          return res.status(400).json({
            error: `كلمة المرور هذه مستخدمة بالفعل لحساب "${conflict.display_name}" — يجب أن تكون لكل دور كلمة مرور مختلفة`,
          });
        }
        const { saltHex, hashHex } = hashPin(cleanNewPass);
        const cipher = encryptPasswordForAdmin(
          cleanNewPass,
          await this.db.getSessionSecret()
        );
        await this.db.execute(
          'UPDATE system_users SET pin_salt = ?, pin_hash = ?, pin_cipher = ?, updated_at = ? WHERE id = ?',
          [saltHex, hashHex, cipher, new Date().toISOString(), auth.user.id]
        );
      }

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تحديث إعدادات النظام',
        details: 'تم حفظ إعدادات الفرع والمزامنة وحدود المؤقتات',
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('settings');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Get('system/network')
  @RequirePermission('settings:manage')
  async getNetworkInfo() {
    const interfaces = os.networkInterfaces();
    const ips: Array<{ name: string; address: string }> = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push({ name, address: iface.address });
        }
      }
    }
    let schemaSql = '';
    const repoRoot = path.resolve(__dirname, '../../../..');
    const schemaPath = path.join(repoRoot, 'supabase', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      schemaSql = fs.readFileSync(schemaPath, 'utf8');
    }
    return {
      ips,
      apiPort: Number(process.env.PORT || 3001),
      storageMode: this.db.storageMode,
      schemaSql,
    };
  }

  @Post('system/clear-logs')
  @RequirePermission('users:manage')
  async clearLogs(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      await this.db.withTransaction(async () => {
        await this.db.execute('DELETE FROM attendance_logs');
        await this.db.execute('DELETE FROM truck_logs');
        await this.db.execute('DELETE FROM shortages');
        await this.db.execute('DELETE FROM notes');
        await this.db.execute('DELETE FROM shift_handovers');
        await this.db.execute('DELETE FROM team_messages');
        await this.db.execute('DELETE FROM walkie_calls');
        await this.db.execute('DELETE FROM walkie_presence');
      });
      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تصفير سجلات الحركات التجريبية',
        details:
          'تم مسح سجلات الحضور والعربيات والنواقص والملاحظات ورسائل التيم مع الاحتفاظ بالموظفين والموردين وكتالوج الأصناف وكلمات المرور',
        ip: getClientIp(req),
        severity: 'warning',
      });
      await this.realtime.broadcastStoreUpdate('logs_cleared');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('system/purge-fake-data')
  @RequirePermission('users:manage')
  async purgeFakeData(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      await this.db.purgeLegacyFakeSeedData();
      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تنظيف البيانات الوهمية (Fake Data)',
        details: 'تم حذف أي بيانات تجريبية افتراضية والإبقاء على البيانات الحقيقية فقط',
        ip: getClientIp(req),
        severity: 'warning',
      });
      await this.realtime.broadcastStoreUpdate('fake_data_purged');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('cloud/test')
  @RequirePermission('settings:manage')
  async testCloud(@Body() body: any) {
    if (this.db.storageMode === 'supabase_postgres') {
      await this.db.queryOne('SELECT 1 as ok');
      return {
        ok: true,
        message: 'متصل مباشرة بقاعدة بيانات Supabase PostgreSQL السحابية بنجاح ✓',
      };
    }
    const rt = this.realtime.getPublicCloudRealtimeConfig();
    const url = (body?.supabase_url || rt.url || '').trim();
    const key =
      body?.supabase_anon_key && body.supabase_anon_key !== '***KEEP***'
        ? body.supabase_anon_key
        : rt.anonKey;
    if (!url || !key) {
      return { ok: false, error: 'بيانات اتصال Supabase غير مكتملة' };
    }
    try {
      const client = createClient(url, key, { auth: { persistSession: false } });
      await client.storage.listBuckets();
      return { ok: true, message: 'اتصال Supabase Realtime نشط وسليم ✓' };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  @Post('cloud/sync')
  @RequirePermission('settings:manage')
  async syncCloud() {
    const nowIso = new Date().toISOString();
    await this.db.upsertSetting('last_cloud_sync', nowIso);
    await this.realtime.broadcastStoreUpdate('cloud_sync');
    return {
      ok: true,
      storageMode: this.db.storageMode,
      syncedAt: nowIso,
      message:
        this.db.storageMode === 'supabase_postgres'
          ? 'البيانات متزامنة لحظياً ومباشرة مع Supabase PostgreSQL بدون أي تعارض ✓'
          : 'تم تحديث إشارة المزامنة بنجاح',
    };
  }

  @Get('backup/export')
  @RequirePermission('backup:manage')
  async exportBackup(@CurrentAuth() auth: AuthContext, @Req() req: Request) {
    await this.db.recordAuditLog({
      userId: auth.user.id,
      userName: auth.user.display_name,
      role: auth.user.role,
      action: 'تصدير نسخة احتياطية كاملة',
      details: 'تم تنزيل نسخة احتياطية لقاعدة البيانات',
      ip: getClientIp(req),
    });
    return this.db.exportFullBackup();
  }

  @Post('backup/import')
  @RequirePermission('backup:manage')
  async importBackup(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      await this.db.importFullBackup(body);
      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'استعادة نسخة احتياطية كاملة',
        details: 'تم استيراد واستبدال سجلات من ملف نسخة احتياطية',
        ip: getClientIp(req),
        severity: 'warning',
      });
      await this.realtime.broadcastStoreUpdate('backup_import');
      return res.json({ ok: true, message: 'تم استعادة النسخة الاحتياطية بنجاح!' });
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  @Post('sync/rehydrate')
  async rehydrate(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    // CRITICAL CONFLICT PREVENTION:
    // Never overwrite authoritative Supabase PostgreSQL with stale browser IndexedDB snapshots!
    if (this.db.storageMode === 'supabase_postgres') {
      return res.json({
        ok: true,
        skipped: true,
        storageMode: 'supabase_postgres',
      });
    }

    try {
      const canRehydrateAll =
        auth.has('staff:manage') ||
        auth.has('backup:manage') ||
        auth.has('records:manage') ||
        auth.user?.role === 'owner' ||
        auth.user?.role === 'manager' ||
        auth.user?.role === 'supervisor';

      const empCount = Number(
        (await this.db.queryOne<{ c: any }>('SELECT COUNT(*) as c FROM employees'))?.c || 0
      );
      const shCount = Number(
        (await this.db.queryOne<{ c: any }>('SELECT COUNT(*) as c FROM shortages'))?.c || 0
      );
      const attCount = Number(
        (await this.db.queryOne<{ c: any }>('SELECT COUNT(*) as c FROM attendance_logs'))?.c || 0
      );

      if (!canRehydrateAll && empCount + shCount + attCount > 0) {
        return res.json({ ok: true, skipped: true });
      }

      const tables = body?.tables || body;
      await this.db.importFullBackup({ tables });
      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'مزامنة تلقائية من ذاكرة الهاتف (Auto-Rehydrate)',
        details: 'استعادة البيانات المحلية المحفوظة على الجهاز',
        ip: getClientIp(req),
      });
      await this.realtime.broadcastStoreUpdate('client_rehydrate');
      return res.json({ ok: true, restored: true });
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  @Get('reports/range')
  @RequirePermission('reports:view')
  async getRangeReport(
    @Query('from') queryFrom: string | undefined,
    @Query('to') queryTo: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const today = getLocalDateKey();
      const rawFrom = String(queryFrom || today).trim();
      const rawTo = String(queryTo || today).trim();
      const fromDate = rawFrom <= rawTo ? rawFrom : rawTo;
      const toDate = rawFrom <= rawTo ? rawTo : rawFrom;

      const employees = await this.db.queryAll<any>(
        'SELECT * FROM employees WHERE is_active = 1 ORDER BY department, name'
      );
      const suppliers = await this.db.queryAll<any>(
        'SELECT * FROM suppliers WHERE is_active = 1 ORDER BY name'
      );
      const attendanceLogs = await this.db.queryAll<any>(
        'SELECT * FROM attendance_logs WHERE (date_key >= ? AND date_key <= ?) OR (shift_date_key >= ? AND shift_date_key <= ?) ORDER BY timestamp DESC',
        [fromDate, toDate, fromDate, toDate]
      );
      const truckLogs = await this.db.queryAll<any>(
        'SELECT * FROM truck_logs WHERE date_key >= ? AND date_key <= ? ORDER BY arrival_time DESC',
        [fromDate, toDate]
      );

      const canSeeShortagesInReports =
        auth.has('shortages:read') ||
        auth.has('shortages:write') ||
        auth.has('shortages:manage') ||
        auth.has('records:manage');

      const shortagesInRange = canSeeShortagesInReports
        ? await this.db.queryAll<any>(
            `SELECT * FROM shortages
             WHERE (date_key >= ? AND date_key <= ?) OR status IN ('open', 'ordered')
             ORDER BY updated_at DESC`,
            [fromDate, toDate]
          )
        : [];

      const notes = await this.db.queryAll<any>(
        'SELECT * FROM notes WHERE date_key >= ? AND date_key <= ? ORDER BY timestamp DESC',
        [fromDate, toDate]
      );
      const handovers = await this.db.queryAll<any>(
        'SELECT * FROM shift_handovers WHERE date_key >= ? AND date_key <= ? ORDER BY timestamp DESC',
        [fromDate, toDate]
      );

      const empMap = new Map<string, any>();
      for (const e of employees) {
        empMap.set(e.id, {
          id: e.id,
          emp_code: e.emp_code || '',
          name: e.name,
          department: e.department,
          daysSet: new Set<string>(),
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
            daysSet: new Set<string>(),
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
          if (Number(log.late_minutes) > 0) {
            st.lateCount += 1;
            st.totalLateMinutes += Number(log.late_minutes);
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

      const supMap = new Map<string, any>();
      for (const s of suppliers) {
        supMap.set(s.name, {
          supplier_name: s.name,
          category: s.category,
          deliveriesCount: 0,
          completedCount: 0,
          totalDuration: 0,
          issuesCount: 0,
          hasPendingReturn: Boolean(Number(s.has_pending_return)),
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
          st.totalDuration += Number(t.duration_minutes || 0);
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

      const catMap = new Map<string, any>();
      const itemFreqMap = new Map<string, any>();

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

        const normItem = String(sh.item_name || '').trim().toLowerCase();
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
              completedTrucks.reduce((acc, t) => acc + Number(t.duration_minutes || 0), 0) /
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
          totalLateInstances: attendanceLogs.filter((l) => Number(l.late_minutes) > 0).length,
          totalLateMinutes: attendanceLogs.reduce(
            (s, l) => s + Number(l.late_minutes || 0),
            0
          ),
          breaksCount: attendanceLogs.filter((l) => l.action_type === 'break_start').length,
          totalBreakMinutes: attendanceLogs
            .filter((l) => l.action_type === 'break_end')
            .reduce((s, l) => s + (Number(l.break_duration_minutes) || 0), 0),
          unverifiedCount: attendanceLogs.filter((l) => !Number(l.verified_by_cctv)).length,
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
          openHandoverNotes: notes.filter((n) => Number(n.is_open_handover) === 1).length,
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
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
}

@Module({
  controllers: [BootstrapController],
})
export class BootstrapModule {}
