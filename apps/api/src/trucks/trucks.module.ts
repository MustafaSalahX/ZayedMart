import {
  Body,
  Controller,
  Delete,
  Module,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { getLocalDateKey, normalizeDigits } from '@zayed-mart/shared';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { getClientIp } from '../common/crypto.util';
import { AuthContext, CurrentAuth, RequirePermission } from '../common/decorators';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';

@Controller('api')
export class TrucksController {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService
  ) {}

  @Post('trucks/arrive')
  @RequirePermission('trucks:write')
  async arrive(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const {
        supplier_id = '',
        supplier_name,
        category = 'بقالة جافة',
        plate_or_driver = '',
        invoice_number = '',
        notes = '',
        arrival_proof_url = '',
      } = body || {};

      let resolvedName = String(supplier_name || '').trim();
      let resolvedCategory = category;

      if (supplier_id) {
        const sup = await this.db.queryOne<any>('SELECT * FROM suppliers WHERE id = ?', [
          supplier_id,
        ]);
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
      const autoVerified = auth.has('attendance:verify') ? 1 : 0;
      const id = body?.id ? String(body.id) : crypto.randomUUID();
      const existingTrk = await this.db.queryOne('SELECT * FROM truck_logs WHERE id = ?', [
        id,
      ]);
      if (existingTrk) {
        return res.status(200).json({ ok: true, truck: existingTrk });
      }

      await this.db.execute(
        `INSERT INTO truck_logs (
          id, supplier_id, supplier_name, category, plate_or_driver, status,
          arrival_time, departure_time, duration_minutes, date_key, delivery_condition,
          invoice_number, notes, arrival_proof_url, completion_proof_url,
          recorded_by, verified_by_cctv, synced
        ) VALUES (?, ?, ?, ?, ?, 'unloading', ?, '', 0, ?, 'pending', ?, ?, ?, '', ?, ?, 1)`,
        [
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
          auth.actorLabel,
          autoVerified,
        ]
      );

      const created = await this.db.queryOne('SELECT * FROM truck_logs WHERE id = ?', [
        id,
      ]);
      await this.realtime.broadcastStoreUpdate('truck_arrive');
      return res.status(201).json({ ok: true, truck: created });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('trucks/:id/complete')
  @RequirePermission('trucks:write')
  async complete(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const existing = await this.db.queryOne<any>(
        'SELECT * FROM truck_logs WHERE id = ?',
        [id]
      );
      if (!existing) {
        return res.status(404).json({ error: 'سجل العربية غير موجود' });
      }

      const {
        delivery_condition = 'complete',
        invoice_number,
        notes,
        completion_proof_url = '',
        clear_previous_return = false,
      } = body || {};

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
            ? `${existing.notes} | عند الاستلام (${auth.actorLabel}): ${notes}`
            : notes
          : existing.notes;

      const finalInvoice =
        invoice_number !== undefined && invoice_number !== ''
          ? invoice_number
          : existing.invoice_number;

      await this.db.execute(
        `UPDATE truck_logs
         SET status = 'completed',
             departure_time = ?,
             duration_minutes = ?,
             delivery_condition = ?,
             invoice_number = ?,
             notes = ?,
             completion_proof_url = ?,
             synced = 1
         WHERE id = ?`,
        [
          departureIso,
          durationMin,
          delivery_condition,
          finalInvoice,
          mergedNotes,
          completion_proof_url || existing.completion_proof_url,
          existing.id,
        ]
      );

      if (existing.supplier_id) {
        if (delivery_condition === 'return_damaged' || delivery_condition === 'shortage') {
          const reason =
            notes ||
            (delivery_condition === 'return_damaged'
              ? 'يوجد مرتجع أو بضاعة تالفة مسجلة في آخر توريد'
              : 'يوجد عجز/نواقص مسجلة في آخر توريد');
          await this.db.execute(
            'UPDATE suppliers SET has_pending_return = 1, pending_return_note = ?, updated_at = ? WHERE id = ?',
            [reason, departureIso, existing.supplier_id]
          );
        } else if (clear_previous_return && auth.has('suppliers:clear_return')) {
          await this.db.execute(
            "UPDATE suppliers SET has_pending_return = 0, pending_return_note = '', updated_at = ? WHERE id = ?",
            [departureIso, existing.supplier_id]
          );
        }
      }

      const updated = await this.db.queryOne('SELECT * FROM truck_logs WHERE id = ?', [
        existing.id,
      ]);
      await this.realtime.broadcastStoreUpdate('truck_complete');
      return res.json({ ok: true, truck: updated });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('trucks/:id/verify')
  @RequirePermission('attendance:verify')
  async verifyTruck(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.db.execute(
        'UPDATE truck_logs SET verified_by_cctv = 1, synced = 1 WHERE id = ?',
        [id]
      );
      await this.realtime.broadcastStoreUpdate('truck_verify');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Put('trucks/:id')
  @RequirePermission('records:manage')
  async updateTruck(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const existing = await this.db.queryOne<any>(
        'SELECT * FROM truck_logs WHERE id = ?',
        [id]
      );
      if (!existing) {
        return res.status(404).json({ error: 'سجل العربية غير موجود' });
      }

      const nextSupplierName =
        body?.supplier_name !== undefined && String(body.supplier_name).trim()
          ? String(body.supplier_name).trim()
          : existing.supplier_name;
      const nextCategory =
        body?.category !== undefined && String(body.category).trim()
          ? String(body.category).trim()
          : existing.category;
      const nextPlate =
        body?.plate_or_driver !== undefined
          ? String(body.plate_or_driver || '').trim()
          : existing.plate_or_driver;
      const nextStatus =
        body?.status === 'unloading' || body?.status === 'completed'
          ? body.status
          : existing.status;
      const validConditions = ['pending', 'complete', 'shortage', 'return_damaged'];
      const nextCondition = validConditions.includes(body?.delivery_condition)
        ? body.delivery_condition
        : existing.delivery_condition;
      const nextInvoice =
        body?.invoice_number !== undefined
          ? String(body.invoice_number || '').trim()
          : existing.invoice_number;
      const nextNotes =
        body?.notes !== undefined ? String(body.notes || '').trim() : existing.notes;
      const nextDuration =
        body?.duration_minutes !== undefined
          ? Math.max(0, Number(normalizeDigits(body.duration_minutes)) || 0)
          : Number(existing.duration_minutes || 0);

      const departureTime =
        nextStatus === 'completed'
          ? existing.departure_time || new Date().toISOString()
          : '';

      await this.db.execute(
        `UPDATE truck_logs
         SET supplier_name = ?, category = ?, plate_or_driver = ?, status = ?,
             departure_time = ?, duration_minutes = ?, delivery_condition = ?,
             invoice_number = ?, notes = ?, synced = 1
         WHERE id = ?`,
        [
          nextSupplierName,
          nextCategory,
          nextPlate,
          nextStatus,
          departureTime,
          nextDuration,
          nextCondition,
          nextInvoice,
          nextNotes,
          existing.id,
        ]
      );

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تعديل سجل عربية مورد',
        details: `تعديل سجل عربية "${nextSupplierName}"`,
        ip: getClientIp(req),
      });

      const updated = await this.db.queryOne('SELECT * FROM truck_logs WHERE id = ?', [
        existing.id,
      ]);
      await this.realtime.broadcastStoreUpdate('truck_edit');
      return res.json({ ok: true, truck: updated });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Delete('trucks/:id')
  @RequirePermission('records:manage')
  async deleteTruck(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const existing = await this.db.queryOne<any>(
        'SELECT * FROM truck_logs WHERE id = ?',
        [id]
      );
      if (!existing) {
        return res.status(404).json({ error: 'سجل العربية غير موجود' });
      }
      await this.db.execute('DELETE FROM truck_logs WHERE id = ?', [existing.id]);

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'حذف سجل عربية مورد',
        details: `حذف سجل عربية "${existing.supplier_name}"`,
        ip: getClientIp(req),
        severity: 'warning',
      });

      await this.realtime.broadcastStoreUpdate('truck_delete');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('suppliers')
  @RequirePermission('suppliers:manage')
  async createSupplier(@Body() body: any, @Res() res: Response) {
    try {
      const {
        name,
        category = 'بقالة جافة',
        icon = 'local_shipping',
        color = '#0B57D0',
        phone = '',
        has_pending_return = 0,
        pending_return_note = '',
      } = body || {};
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'اسم المورد مطلوب' });
      }
      const id = body?.id ? String(body.id) : crypto.randomUUID();
      const now = new Date().toISOString();
      await this.db.execute(
        `INSERT INTO suppliers (
          id, name, category, icon, color, has_pending_return, pending_return_note, phone, is_active, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          category = EXCLUDED.category,
          phone = EXCLUDED.phone,
          is_active = 1,
          updated_at = EXCLUDED.updated_at`,
        [
          id,
          String(name).trim(),
          category,
          icon,
          color,
          has_pending_return ? 1 : 0,
          String(pending_return_note || '').trim(),
          phone,
          now,
        ]
      );

      const created = await this.db.queryOne('SELECT * FROM suppliers WHERE id = ?', [id]);
      await this.realtime.broadcastStoreUpdate('supplier_add');
      return res.status(201).json({ ok: true, supplier: created });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('suppliers/bulk')
  @RequirePermission('suppliers:manage')
  async bulkSuppliers(@Body() body: any, @Res() res: Response) {
    try {
      const { lines = [], category = 'بقالة جافة', color = '#0B57D0' } = body || {};
      const cleanLines = (Array.isArray(lines) ? lines : String(lines || '').split('\n'))
        .map((l) => String(l || '').trim())
        .filter(Boolean);

      if (cleanLines.length === 0) {
        return res
          .status(400)
          .json({ error: 'يرجى كتابة اسم شركة/مورد واحد على الأقل' });
      }

      const now = new Date().toISOString();
      let addedCount = 0;

      await this.db.withTransaction(async (client) => {
        for (const rawLine of cleanLines) {
          const parts = rawLine.split(/[-–|،,]/).map((p: string) => p.trim());
          const name = parts[0];
          if (!name) continue;
          const phone = parts[1] || '';
          await this.db.execute(
            `INSERT INTO suppliers (id, name, category, icon, color, has_pending_return, pending_return_note, phone, is_active, updated_at)
             VALUES (?, ?, ?, 'local_shipping', ?, 0, '', ?, 1, ?)`,
            [crypto.randomUUID(), name, category, color, phone, now],
            client
          );
          addedCount += 1;
        }
      });

      await this.realtime.broadcastStoreUpdate('supplier_bulk_add');
      return res.status(201).json({ ok: true, addedCount });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Put('suppliers/:id')
  @RequirePermission('suppliers:manage')
  async updateSupplier(
    @Param('id') id: string,
    @Body() body: any,
    @Res() res: Response
  ) {
    try {
      const existing = await this.db.queryOne<any>(
        'SELECT * FROM suppliers WHERE id = ?',
        [id]
      );
      if (!existing) return res.status(404).json({ error: 'المورد غير موجود' });

      const {
        name = existing.name,
        category = existing.category,
        phone = existing.phone,
        color = existing.color,
        has_pending_return = existing.has_pending_return,
        pending_return_note = existing.pending_return_note,
      } = body || {};

      await this.db.execute(
        `UPDATE suppliers
         SET name = ?, category = ?, phone = ?, color = ?, has_pending_return = ?, pending_return_note = ?, updated_at = ?
         WHERE id = ?`,
        [
          String(name).trim(),
          category,
          phone,
          color,
          has_pending_return ? 1 : 0,
          String(pending_return_note || '').trim(),
          new Date().toISOString(),
          existing.id,
        ]
      );

      await this.realtime.broadcastStoreUpdate('supplier_edit');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Delete('suppliers/:id')
  @RequirePermission('suppliers:manage')
  async deleteSupplier(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.db.execute(
        'UPDATE suppliers SET is_active = 0, updated_at = ? WHERE id = ?',
        [new Date().toISOString(), id]
      );
      await this.realtime.broadcastStoreUpdate('supplier_delete');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('suppliers/:id/clear-return')
  @RequirePermission('suppliers:clear_return')
  async clearReturn(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const sup = await this.db.queryOne<{ name: string }>(
        'SELECT name FROM suppliers WHERE id = ?',
        [id]
      );
      await this.db.execute(
        "UPDATE suppliers SET has_pending_return = 0, pending_return_note = '', updated_at = ? WHERE id = ?",
        [new Date().toISOString(), id]
      );

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تسوية مرتجع مورد',
        details: `مسح تنبيه المرتجع للمورد (${sup?.name || id})`,
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('supplier_return_clear');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
}

@Module({
  controllers: [TrucksController],
})
export class TrucksModule {}
