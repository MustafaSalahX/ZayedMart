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
import { getLocalDateKey, normalizeRequestedQty } from '@zayed-mart/shared';
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

@Controller('api')
export class ShortagesController {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService
  ) {}

  @Post('shortages')
  @RequireAnyPermission(['shortages:write', 'shortages:manage', 'records:manage'])
  async createShortage(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
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
      } = body || {};

      const cleanName = String(item_name || '').trim();
      if (!cleanName) {
        return res
          .status(400)
          .json({ error: 'يرجى كتابة أو اختيار اسم الصنف الناقص أو المقترح' });
      }

      const qtyCheck = normalizeRequestedQty(requested_qty);
      if (qtyCheck.ok === false) {
        return res.status(400).json({ error: qtyCheck.error });
      }
      const finalQty = qtyCheck.value;

      const validUrgencies = ['out_of_stock', 'low_stock'];
      const finalUrgency = validUrgencies.includes(urgency) ? urgency : 'out_of_stock';
      const finalIsSuggestion = is_suggestion ? 1 : 0;
      const cleanUnit = String(unit || '').trim().slice(0, 40);
      const cleanCategory = String(category || 'بقالة جافة').trim() || 'بقالة جافة';
      const cleanNotes = String(notes || '').trim().slice(0, 400);

      let resolvedSupplierName = String(supplier_name || '').trim();
      if (supplier_id && !resolvedSupplierName) {
        const sup = await this.db.queryOne<{ name: string }>(
          'SELECT name FROM suppliers WHERE id = ?',
          [supplier_id]
        );
        if (sup) resolvedSupplierName = sup.name;
      }

      const now = new Date();
      const isoNow = now.toISOString();
      const dateKey = getLocalDateKey(now);

      let catalogProductId = String(product_id || '').trim();
      if (auto_save_catalog !== false) {
        catalogProductId = await this.db.ensureCatalogProduct({
          name: cleanName,
          category: cleanCategory,
          unit: cleanUnit,
          supplier_id,
        });
      }

      if (!allow_duplicate) {
        const existingOpen = await this.db.queryOne<any>(
          "SELECT * FROM shortages WHERE status = 'open' AND LOWER(item_name) = LOWER(?) LIMIT 1",
          [cleanName]
        );
        if (existingOpen) {
          const nextQty = finalQty !== null ? finalQty : existingOpen.requested_qty;
          const nextUnit = cleanUnit || existingOpen.unit || '';
          const nextNotes = cleanNotes || existingOpen.notes || '';
          await this.db.execute(
            `UPDATE shortages
             SET requested_qty = ?,
                 unit = ?,
                 urgency = ?,
                 is_suggestion = ?,
                 notes = ?,
                 updated_by = ?,
                 updated_at = ?,
                 synced = 1
             WHERE id = ?`,
            [
              nextQty,
              nextUnit,
              finalUrgency,
              finalIsSuggestion || Number(existingOpen.is_suggestion || 0),
              nextNotes,
              auth.actorLabel,
              isoNow,
              existingOpen.id,
            ]
          );
          const updated = await this.db.queryOne(
            'SELECT * FROM shortages WHERE id = ?',
            [existingOpen.id]
          );
          await this.db.recordAuditLog({
            userId: auth.user.id,
            userName: auth.user.display_name,
            role: auth.user.role,
            action: finalIsSuggestion ? 'تحديث مقترح صنف' : 'تحديث صنف ناقص',
            details: `تحديث "${cleanName}" (${cleanCategory})`,
            ip: getClientIp(req),
          });
          await this.realtime.broadcastStoreUpdate('shortage_update');
          return res.status(200).json({ ok: true, shortage: updated, merged: true });
        }
      }

      const id = body?.id ? String(body.id) : crypto.randomUUID();
      const existingShById = await this.db.queryOne(
        'SELECT * FROM shortages WHERE id = ?',
        [id]
      );
      if (existingShById) {
        return res
          .status(200)
          .json({ ok: true, shortage: existingShById, merged: false });
      }

      await this.db.execute(
        `INSERT INTO shortages (
          id, product_id, item_name, category, requested_qty, unit, urgency, status, is_suggestion,
          supplier_id, supplier_name, notes, recorded_by, recorded_by_role, updated_by,
          resolved_by, resolved_at, timestamp, updated_at, date_key, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, '', '', '', ?, ?, ?, 1)`,
        [
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
          auth.actorLabel,
          auth.user.role,
          isoNow,
          isoNow,
          dateKey,
        ]
      );

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: finalIsSuggestion ? 'إضافة مقترح صنف جديد' : 'إضافة صنف ناقص',
        details: `${finalIsSuggestion ? 'اقتراح صنف' : 'نقص صنف'}: "${cleanName}" (${cleanCategory})${finalQty !== null ? ` — الكمية: ${finalQty} ${cleanUnit}` : ''}`,
        ip: getClientIp(req),
      });

      const created = await this.db.queryOne('SELECT * FROM shortages WHERE id = ?', [id]);
      await this.realtime.broadcastStoreUpdate('shortage_add');
      return res.status(201).json({ ok: true, shortage: created, merged: false });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Put('shortages/:id')
  @RequireAnyPermission(['shortages:write', 'shortages:manage', 'records:manage'])
  async updateShortage(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const existing = await this.db.queryOne<any>(
        'SELECT * FROM shortages WHERE id = ?',
        [id]
      );
      if (!existing) {
        return res.status(404).json({ error: 'الصنف غير موجود في النواقص' });
      }

      const canManageAll = auth.has('shortages:manage') || auth.has('records:manage');
      if (!canManageAll && existing.status === 'resolved') {
        return res.status(403).json({
          error: 'هذا الصنف تم توفيره وإغلاقه بالفعل — التعديل متاح للإدارة فقط',
        });
      }

      let nextQty = existing.requested_qty;
      if (body && Object.prototype.hasOwnProperty.call(body, 'requested_qty')) {
        const qtyCheck = normalizeRequestedQty(body.requested_qty);
        if (qtyCheck.ok === false) {
          return res.status(400).json({ error: qtyCheck.error });
        }
        nextQty = qtyCheck.value;
      }

      const nextUnit =
        body?.unit !== undefined
          ? String(body.unit || '').trim().slice(0, 40)
          : existing.unit;

      const validUrgencies = ['out_of_stock', 'low_stock'];
      const nextUrgency =
        body?.urgency && validUrgencies.includes(body.urgency)
          ? body.urgency
          : existing.urgency;

      const nextNotes =
        body?.notes !== undefined
          ? String(body.notes || '').trim().slice(0, 400)
          : existing.notes;

      const nextName =
        body?.item_name !== undefined && String(body.item_name).trim()
          ? String(body.item_name).trim()
          : existing.item_name;

      const nextCategory =
        body?.category !== undefined && String(body.category).trim()
          ? String(body.category).trim()
          : existing.category;

      const validStatuses = ['open', 'ordered', 'resolved'];
      const nextStatus =
        canManageAll && body?.status && validStatuses.includes(body.status)
          ? body.status
          : existing.status;

      const nextSupplierId =
        canManageAll && body?.supplier_id !== undefined
          ? String(body.supplier_id || '')
          : existing.supplier_id;
      let nextSupplierName =
        canManageAll && body?.supplier_name !== undefined
          ? String(body.supplier_name || '').trim()
          : existing.supplier_name;

      if (canManageAll && nextSupplierId && body?.supplier_name === undefined) {
        const sup = await this.db.queryOne<{ name: string }>(
          'SELECT name FROM suppliers WHERE id = ?',
          [nextSupplierId]
        );
        if (sup) nextSupplierName = sup.name;
      }

      const nowIso = new Date().toISOString();
      const resolvedBy =
        nextStatus === 'resolved' ? existing.resolved_by || auth.actorLabel : '';
      const resolvedAt =
        nextStatus === 'resolved' ? existing.resolved_at || nowIso : '';

      await this.db.execute(
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
             synced = 1
         WHERE id = ?`,
        [
          nextName,
          nextCategory,
          nextQty,
          nextUnit,
          nextUrgency,
          nextStatus,
          nextSupplierId,
          nextSupplierName,
          nextNotes,
          auth.actorLabel,
          resolvedBy,
          resolvedAt,
          nowIso,
          existing.id,
        ]
      );

      const updated = await this.db.queryOne('SELECT * FROM shortages WHERE id = ?', [
        existing.id,
      ]);
      await this.realtime.broadcastStoreUpdate('shortage_edit');
      return res.json({ ok: true, shortage: updated });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('shortages/resolve-all')
  @RequireAnyPermission(['shortages:manage', 'records:manage'])
  async resolveAll(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const nowIso = new Date().toISOString();
      const category = String(body?.category || '').trim();
      let result: { changes: number };
      if (category && category !== 'الكل') {
        result = await this.db.execute(
          `UPDATE shortages
           SET status = 'resolved', resolved_by = ?, resolved_at = ?, updated_at = ?, synced = 1
           WHERE status IN ('open', 'ordered') AND category = ?`,
          [auth.actorLabel, nowIso, nowIso, category]
        );
      } else {
        result = await this.db.execute(
          `UPDATE shortages
           SET status = 'resolved', resolved_by = ?, resolved_at = ?, updated_at = ?, synced = 1
           WHERE status IN ('open', 'ordered')`,
          [auth.actorLabel, nowIso, nowIso]
        );
      }

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'اعتماد توفير النواقص جماعياً',
        details: `تم إغلاق (${result.changes}) صنف من قائمة النواقص المفتوحة`,
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('shortages_resolve_all');
      return res.json({ ok: true, count: result.changes });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('shortages/:id/status')
  @RequireAnyPermission(['shortages:manage', 'records:manage'])
  async updateStatus(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const existing = await this.db.queryOne<any>(
        'SELECT * FROM shortages WHERE id = ?',
        [id]
      );
      if (!existing) {
        return res.status(404).json({ error: 'الصنف غير موجود' });
      }
      const validStatuses = ['open', 'ordered', 'resolved'];
      const nextStatus = validStatuses.includes(body?.status)
        ? body.status
        : 'resolved';
      const nowIso = new Date().toISOString();
      const resolvedBy = nextStatus === 'resolved' ? auth.actorLabel : '';
      const resolvedAt = nextStatus === 'resolved' ? nowIso : '';

      await this.db.execute(
        `UPDATE shortages
         SET status = ?,
             updated_by = ?,
             resolved_by = ?,
             resolved_at = ?,
             updated_at = ?,
             synced = 1
         WHERE id = ?`,
        [nextStatus, auth.actorLabel, resolvedBy, resolvedAt, nowIso, existing.id]
      );

      const updated = await this.db.queryOne('SELECT * FROM shortages WHERE id = ?', [
        existing.id,
      ]);
      await this.realtime.broadcastStoreUpdate('shortage_status');
      return res.json({ ok: true, shortage: updated });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Delete('shortages/:id')
  @RequirePermission('records:manage')
  async deleteShortage(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const existing = await this.db.queryOne<any>(
        'SELECT * FROM shortages WHERE id = ?',
        [id]
      );
      if (!existing) {
        return res.status(404).json({ error: 'الصنف غير موجود' });
      }
      await this.db.execute('DELETE FROM shortages WHERE id = ?', [existing.id]);

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'حذف صنف من النواقص',
        details: `حذف الصنف "${existing.item_name}" (${existing.category})`,
        ip: getClientIp(req),
        severity: 'warning',
      });

      await this.realtime.broadcastStoreUpdate('shortage_delete');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('catalog')
  @RequireAnyPermission(['shortages:manage', 'records:manage'])
  async createCatalogItem(@Body() body: any, @Res() res: Response) {
    try {
      const {
        name,
        category = 'بقالة جافة',
        default_unit = '',
        supplier_id = '',
      } = body || {};
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'اسم الصنف مطلوب' });
      }
      const id = await this.db.ensureCatalogProduct({
        name: String(name).trim(),
        category: String(category || 'بقالة جافة').trim(),
        unit: String(default_unit || '').trim(),
        supplier_id,
      });
      const item = await this.db.queryOne(
        'SELECT * FROM product_catalog WHERE id = ?',
        [id]
      );
      await this.realtime.broadcastStoreUpdate('catalog_add');
      return res.status(201).json({ ok: true, item });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('catalog/bulk')
  @RequireAnyPermission(['shortages:manage', 'records:manage'])
  async bulkCatalog(@Body() body: any, @Res() res: Response) {
    try {
      const { lines = [], category = 'بقالة جافة', default_unit = '' } = body || {};
      const cleanLines = (Array.isArray(lines) ? lines : String(lines || '').split('\n'))
        .map((l) => String(l || '').trim())
        .filter(Boolean);

      if (cleanLines.length === 0) {
        return res
          .status(400)
          .json({ error: 'يرجى كتابة اسم صنف واحد على الأقل' });
      }

      let addedCount = 0;
      for (const rawLine of cleanLines) {
        const parts = rawLine.split(/[-–|،,]/).map((p: string) => p.trim());
        const name = parts[0];
        if (!name) continue;
        const unit = parts[1] || default_unit || '';
        await this.db.ensureCatalogProduct({ name, category, unit });
        addedCount += 1;
      }

      await this.realtime.broadcastStoreUpdate('catalog_bulk_add');
      return res.status(201).json({ ok: true, addedCount });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Put('catalog/:id')
  @RequireAnyPermission(['shortages:manage', 'records:manage'])
  async updateCatalog(
    @Param('id') id: string,
    @Body() body: any,
    @Res() res: Response
  ) {
    try {
      const existing = await this.db.queryOne<any>(
        'SELECT * FROM product_catalog WHERE id = ?',
        [id]
      );
      if (!existing) {
        return res.status(404).json({ error: 'الصنف غير موجود في الكتالوج' });
      }

      const name = String(body?.name ?? existing.name).trim();
      const category = String(body?.category ?? existing.category).trim();
      const defaultUnit = String(body?.default_unit ?? existing.default_unit).trim();

      await this.db.execute(
        'UPDATE product_catalog SET name = ?, category = ?, default_unit = ?, updated_at = ? WHERE id = ?',
        [name, category, defaultUnit, new Date().toISOString(), existing.id]
      );

      await this.realtime.broadcastStoreUpdate('catalog_edit');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Delete('catalog/:id')
  @RequireAnyPermission(['shortages:manage', 'records:manage'])
  async deleteCatalog(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.db.execute(
        'UPDATE product_catalog SET is_active = 0, updated_at = ? WHERE id = ?',
        [new Date().toISOString(), id]
      );
      await this.realtime.broadcastStoreUpdate('catalog_delete');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
}

@Module({
  controllers: [ShortagesController],
})
export class ShortagesModule {}
