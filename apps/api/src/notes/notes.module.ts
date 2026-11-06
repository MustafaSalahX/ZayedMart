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
import { getLocalDateKey, getLocalTimeHMS } from '@zayed-mart/shared';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { getClientIp } from '../common/crypto.util';
import { AuthContext, CurrentAuth, RequirePermission } from '../common/decorators';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';

@Controller('api')
export class NotesController {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService
  ) {}

  @Post('notes')
  @RequirePermission('notes:write')
  async createNote(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const {
        location_tag = 'الصالة والممرات',
        category_tag = 'ملاحظة عامة',
        severity = 'normal',
        dvr_timestamp,
        content = '',
        proof_url = '',
        is_open_handover = false,
      } = body || {};

      const finalContent = String(content || '').trim() || `${category_tag} - ${location_tag}`;
      const now = new Date();
      const isoTime = now.toISOString();
      const dateKey = getLocalDateKey(now);
      const dvrTime = String(dvr_timestamp || '').trim() || getLocalTimeHMS(now);
      const id = body?.id ? String(body.id) : crypto.randomUUID();
      const existingNote = await this.db.queryOne('SELECT * FROM notes WHERE id = ?', [
        id,
      ]);
      if (existingNote) {
        return res.status(200).json({ ok: true, note: existingNote });
      }

      await this.db.execute(
        `INSERT INTO notes (
          id, location_tag, category_tag, severity, dvr_timestamp, content, proof_url,
          recorded_by, is_open_handover, resolved_by, resolved_at, timestamp, date_key, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, 1)`,
        [
          id,
          location_tag,
          category_tag,
          severity,
          dvrTime,
          finalContent,
          proof_url,
          auth.actorLabel,
          is_open_handover ? 1 : 0,
          isoTime,
          dateKey,
        ]
      );

      const created = await this.db.queryOne('SELECT * FROM notes WHERE id = ?', [id]);
      await this.realtime.broadcastStoreUpdate('note_add');
      return res.status(201).json({ ok: true, note: created });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('notes/:id/resolve')
  @RequirePermission('notes:resolve')
  async resolveNote(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const now = new Date().toISOString();
      await this.db.execute(
        'UPDATE notes SET is_open_handover = 0, resolved_by = ?, resolved_at = ?, synced = 1 WHERE id = ?',
        [auth.actorLabel, now, id]
      );
      await this.realtime.broadcastStoreUpdate('note_resolve');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Put('notes/:id')
  @RequirePermission('records:manage')
  async updateNote(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const existing = await this.db.queryOne<any>('SELECT * FROM notes WHERE id = ?', [
        id,
      ]);
      if (!existing) {
        return res.status(404).json({ error: 'الملاحظة غير موجودة' });
      }

      const nextLocation =
        body?.location_tag !== undefined && String(body.location_tag).trim()
          ? String(body.location_tag).trim()
          : existing.location_tag;
      const nextCategory =
        body?.category_tag !== undefined && String(body.category_tag).trim()
          ? String(body.category_tag).trim()
          : existing.category_tag;
      const validSev = ['normal', 'warning', 'urgent'];
      const nextSeverity = validSev.includes(body?.severity)
        ? body.severity
        : existing.severity;
      const nextDvr =
        body?.dvr_timestamp !== undefined && String(body.dvr_timestamp).trim()
          ? String(body.dvr_timestamp).trim()
          : existing.dvr_timestamp;
      const nextContent =
        body?.content !== undefined && String(body.content).trim()
          ? String(body.content).trim()
          : existing.content;
      const nextOpen =
        body?.is_open_handover !== undefined
          ? body.is_open_handover
            ? 1
            : 0
          : Number(existing.is_open_handover || 0);

      await this.db.execute(
        `UPDATE notes
         SET location_tag = ?, category_tag = ?, severity = ?, dvr_timestamp = ?, content = ?, is_open_handover = ?, synced = 1
         WHERE id = ?`,
        [
          nextLocation,
          nextCategory,
          nextSeverity,
          nextDvr,
          nextContent,
          nextOpen,
          existing.id,
        ]
      );

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'تعديل ملاحظة مراقبة',
        details: `تعديل ملاحظة [${nextLocation}]`,
        ip: getClientIp(req),
      });

      const updated = await this.db.queryOne('SELECT * FROM notes WHERE id = ?', [
        existing.id,
      ]);
      await this.realtime.broadcastStoreUpdate('note_edit');
      return res.json({ ok: true, note: updated });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Delete('notes/:id')
  @RequirePermission('records:manage')
  async deleteNote(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const existing = await this.db.queryOne<any>('SELECT * FROM notes WHERE id = ?', [
        id,
      ]);
      if (!existing) {
        return res.status(404).json({ error: 'الملاحظة غير موجودة' });
      }
      await this.db.execute('DELETE FROM notes WHERE id = ?', [existing.id]);

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'حذف ملاحظة مراقبة',
        details: `حذف ملاحظة [${existing.location_tag}]: ${String(existing.content || '').slice(0, 60)}`,
        ip: getClientIp(req),
        severity: 'warning',
      });

      await this.realtime.broadcastStoreUpdate('note_delete');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('handovers')
  @RequirePermission('handover:manage')
  async createHandover(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const {
        from_operator,
        to_operator = '',
        shift_name = 'تسليم وردية',
        summary_note = '',
        target_role = '',
      } = body || {};

      const senderRole = auth.user?.role || 'cctv';
      const resolvedTargetRole = String(target_role || '').trim() || senderRole;

      const snap = await this.db.buildBootstrapData(getLocalDateKey(), null);
      const openItems: Array<{ type: string; text: string }> = [];

      if (resolvedTargetRole === 'hall') {
        for (const s of snap.shortages.filter(
          (sh: any) => sh.status === 'open' || sh.status === 'ordered'
        )) {
          openItems.push({
            type: 'shortage',
            text: `صنف ناقص بالصالة: "${s.item_name}" (${s.category})`,
          });
        }
      } else {
        for (const t of snap.truckLogs.filter((tr: any) => tr.status === 'unloading')) {
          openItems.push({
            type: 'truck',
            text: `عربية "${t.supplier_name}" (${t.category}) ما زالت تفرغ أمام الماركت`,
          });
        }
        for (const n of snap.notes.filter((nt: any) => Number(nt.is_open_handover) === 1)) {
          openItems.push({
            type: 'note',
            text: `[${n.location_tag}] ${n.content}`,
          });
        }
        for (const e of snap.employees.filter((em: any) => em.currentStatus === 'on_break')) {
          openItems.push({
            type: 'break',
            text: `الموظف "${e.name}" (${e.department}) في استراحة حالياً`,
          });
        }
      }

      await this.db.execute(
        "UPDATE shift_handovers SET acknowledged = 1 WHERE acknowledged = 0 AND (target_role = ? OR target_role = '')",
        [resolvedTargetRole]
      );

      const now = new Date();
      const id = body?.id ? String(body.id) : crypto.randomUUID();
      const sender =
        auth.user?.display_name || String(from_operator || '').trim() || auth.actorLabel;
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

      await this.db.execute(
        `INSERT INTO shift_handovers (
          id, from_operator, to_operator, from_role, target_role, shift_name, summary_note, open_items_json,
          open_trucks_count, open_notes_count, present_staff_count, acknowledged, acknowledged_at, timestamp, date_key, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?, 1)`,
        [
          id,
          sender,
          String(to_operator || '').trim() || defaultReceiverLabel,
          senderRole,
          resolvedTargetRole,
          shift_name,
          summary_note,
          JSON.stringify(openItems),
          snap.summary.unloadingTrucksCount,
          snap.summary.openHandoverNotesCount,
          snap.summary.presentCount + snap.summary.onBreakCount,
          now.toISOString(),
          getLocalDateKey(now),
        ]
      );

      const created = await this.db.queryOne(
        'SELECT * FROM shift_handovers WHERE id = ?',
        [id]
      );
      await this.realtime.broadcastStoreUpdate('handover');
      return res.status(201).json({
        ok: true,
        handover: { ...created, openItems },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('handovers/:id/acknowledge')
  @RequirePermission('handover:manage')
  async acknowledgeHandover(@Param('id') id: string, @Res() res: Response) {
    try {
      const now = new Date().toISOString();
      await this.db.execute(
        'UPDATE shift_handovers SET acknowledged = 1, acknowledged_at = ?, synced = 1 WHERE id = ?',
        [now, id]
      );
      await this.realtime.broadcastStoreUpdate('handover_ack');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Delete('handovers/:id')
  @RequirePermission('records:manage')
  async deleteHandover(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.db.execute('DELETE FROM shift_handovers WHERE id = ?', [id]);
      await this.realtime.broadcastStoreUpdate('handover_delete');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
}

@Module({
  controllers: [NotesController],
})
export class NotesModule {}
