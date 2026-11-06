import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { getLocalDateKey } from '@zayed-mart/shared';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { getClientIp } from '../common/crypto.util';
import { AuthContext, CurrentAuth } from '../common/decorators';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';

@Controller('api/team-messages')
export class ChatController {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService
  ) {}

  @Get()
  async getMessages(@Query('channel') rawChannel: string | undefined, @Res() res: Response) {
    try {
      const channel = String(rawChannel || '').trim();
      const rows =
        channel && channel !== 'all'
          ? await this.db.queryAll(
              'SELECT * FROM team_messages WHERE channel = ? ORDER BY is_pinned DESC, timestamp DESC LIMIT 150',
              [channel]
            )
          : await this.db.queryAll(
              'SELECT * FROM team_messages ORDER BY is_pinned DESC, timestamp DESC LIMIT 150'
            );
      return res.json({ ok: true, messages: rows });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post()
  async createMessage(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      if (auth.user?.role === 'kiosk') {
        return res.status(403).json({ error: 'غير مسموح في وضع الكشك' });
      }
      const {
        channel = 'general',
        content = '',
        message = '',
        is_urgent = false,
        priority = 'normal',
        is_pinned = false,
      } = body || {};

      const cleanContent = String(content || message || '')
        .trim()
        .slice(0, 600);
      if (!cleanContent) {
        return res.status(400).json({ error: 'يرجى كتابة نص الرسالة أو اختيار تنبيه سريع' });
      }

      const validChannels = ['cashier', 'general', 'security'];
      const finalChannel = validChannels.includes(channel) ? channel : 'general';
      const finalUrgent = Boolean(is_urgent || priority === 'urgent');
      const now = new Date();
      const isoNow = now.toISOString();
      const dateKey = getLocalDateKey(now);
      const id = body?.id ? String(body.id) : crypto.randomUUID();

      const existingMsg = await this.db.queryOne(
        'SELECT * FROM team_messages WHERE id = ?',
        [id]
      );
      if (existingMsg) {
        return res.status(200).json({ ok: true, message: existingMsg });
      }

      await this.db.execute(
        `INSERT INTO team_messages (
          id, channel, sender_id, sender_name, sender_role, content, is_urgent, is_pinned, timestamp, date_key, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          id,
          finalChannel,
          auth.user.id,
          auth.user.display_name,
          auth.user.role,
          cleanContent,
          finalUrgent ? 1 : 0,
          is_pinned ? 1 : 0,
          isoNow,
          dateKey,
        ]
      );

      const channelArabic =
        finalChannel === 'cashier'
          ? 'قناة الكاشيرية'
          : finalChannel === 'security'
          ? 'قناة الأمن والبوابة'
          : 'قناة التيم العام';

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: `رسالة تواصل (${channelArabic})`,
        details: cleanContent,
        ip: getClientIp(req),
        severity: finalUrgent ? 'warning' : 'info',
      });

      const created = await this.db.queryOne('SELECT * FROM team_messages WHERE id = ?', [id]);
      await this.realtime.broadcastStoreUpdate('team_message');
      return res.status(201).json({ ok: true, message: created });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post(':id/pin')
  async togglePin(@Param('id') id: string, @Res() res: Response) {
    try {
      const existing = await this.db.queryOne<any>(
        'SELECT * FROM team_messages WHERE id = ?',
        [id]
      );
      if (!existing) return res.status(404).json({ error: 'الرسالة غير موجودة' });
      const nextPin = Number(existing.is_pinned) ? 0 : 1;
      await this.db.execute('UPDATE team_messages SET is_pinned = ?, synced = 1 WHERE id = ?', [
        nextPin,
        existing.id,
      ]);
      await this.realtime.broadcastStoreUpdate('team_message_pin');
      return res.json({ ok: true, is_pinned: Boolean(nextPin) });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Delete(':id')
  async deleteMessage(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const existing = await this.db.queryOne<any>(
        'SELECT * FROM team_messages WHERE id = ?',
        [id]
      );
      if (!existing) return res.status(404).json({ error: 'الرسالة غير موجودة' });
      const canDelete =
        auth.has('records:manage') ||
        auth.has('users:manage') ||
        existing.sender_id === auth.user.id;
      if (!canDelete) {
        return res.status(403).json({ error: 'غير مصرح بحذف هذه الرسالة' });
      }
      await this.db.execute('DELETE FROM team_messages WHERE id = ?', [existing.id]);
      await this.realtime.broadcastStoreUpdate('team_message_delete');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
}

@Module({
  controllers: [ChatController],
})
export class ChatModule {}
