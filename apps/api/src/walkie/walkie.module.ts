import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  getLocalDateKey,
  resolveAllowedWalkieChannels,
  VALID_WALKIE_CHANNELS,
  WALKIE_CHANNELS,
  WalkieChannelId,
} from '@zayed-mart/shared';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { getClientIp } from '../common/crypto.util';
import { AuthContext, CurrentAuth, RequirePermission } from '../common/decorators';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';

interface WalkiePresenceEntry {
  peer_id: string;
  user_id: string;
  display_name: string;
  role: string;
  role_label: string;
  avatar_color: string;
  channel: string;
  status: string;
  live_on: boolean;
  mic_mode: string;
  updated_at_ms: number;
}

@Controller('api/walkie')
@RequirePermission('walkie:use')
export class WalkieController {
  private readonly walkiePresenceMap = new Map<string, WalkiePresenceEntry>();
  private readonly walkieSignalInboxMap = new Map<string, any[]>();
  private readonly walkieLiveFramesRing: any[] = [];
  private walkieLiveSeqCounter = 0;

  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService
  ) {}

  private getAllowedChannels(auth: AuthContext): WalkieChannelId[] {
    return resolveAllowedWalkieChannels(auth.user?.role || '', auth.permissions);
  }

  private canTransmitOnChannel(auth: AuthContext, channel: string): boolean {
    const allowed = this.getAllowedChannels(auth);
    if (allowed.length === 0) return false;
    if (channel === 'emergency') return true;
    return allowed.includes(channel as WalkieChannelId);
  }

  private canReceiveChannel(auth: AuthContext, channel: string): boolean {
    const allowed = this.getAllowedChannels(auth);
    if (allowed.length === 0) return false;
    if (channel === 'emergency') return true;
    return allowed.includes(channel as WalkieChannelId);
  }

  private pruneLiveFrames() {
    const cutoff = Date.now() - 8000;
    while (this.walkieLiveFramesRing.length > 0 && this.walkieLiveFramesRing[0].ts_ms < cutoff) {
      this.walkieLiveFramesRing.shift();
    }
    if (this.walkieLiveFramesRing.length > 160) {
      this.walkieLiveFramesRing.splice(0, this.walkieLiveFramesRing.length - 160);
    }
  }

  private enqueueSignalForPeer(targetPeerId: string, envelope: any) {
    if (!targetPeerId) return;
    const now = Date.now();
    const list = (this.walkieSignalInboxMap.get(targetPeerId) || []).filter(
      (item) => now - item.ts_ms < 20000
    );
    list.push(envelope);
    if (list.length > 80) list.splice(0, list.length - 80);
    this.walkieSignalInboxMap.set(targetPeerId, list);
  }

  private drainSignalsForPeer(peerId: string): any[] {
    if (!peerId) return [];
    const list = this.walkieSignalInboxMap.get(peerId);
    if (!list || list.length === 0) return [];
    this.walkieSignalInboxMap.delete(peerId);
    const now = Date.now();
    return list.filter((item) => now - item.ts_ms < 20000);
  }

  private async upsertPersistentPresence(entry: WalkiePresenceEntry) {
    const presenceKey = `${entry.user_id}::${entry.peer_id}`;
    try {
      await this.db.execute(
        `INSERT INTO walkie_presence (
          presence_key, peer_id, user_id, display_name, role, role_label, avatar_color, channel, status, live_on, mic_mode, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (presence_key) DO UPDATE SET
          peer_id = EXCLUDED.peer_id,
          user_id = EXCLUDED.user_id,
          display_name = EXCLUDED.display_name,
          role = EXCLUDED.role,
          role_label = EXCLUDED.role_label,
          avatar_color = EXCLUDED.avatar_color,
          channel = EXCLUDED.channel,
          status = EXCLUDED.status,
          live_on = EXCLUDED.live_on,
          mic_mode = EXCLUDED.mic_mode,
          updated_at_ms = EXCLUDED.updated_at_ms`,
        [
          presenceKey,
          entry.peer_id,
          entry.user_id,
          entry.display_name,
          entry.role,
          entry.role_label,
          entry.avatar_color,
          entry.channel,
          entry.status,
          entry.live_on ? 1 : 0,
          entry.mic_mode,
          entry.updated_at_ms,
        ]
      );
    } catch {
      // Non-fatal if DB transient
    }
  }

  private async removePersistentPresence(peerId: string, userId: string) {
    try {
      if (peerId) {
        await this.db.execute('DELETE FROM walkie_presence WHERE peer_id = ?', [peerId]);
      } else if (userId) {
        await this.db.execute('DELETE FROM walkie_presence WHERE user_id = ?', [userId]);
      }
    } catch {
      // Non-fatal
    }
  }

  private async getActiveUnits(channelFilter = ''): Promise<any[]> {
    const now = Date.now();
    const staleCutoffMs = 45000;
    const mergedByPeer = new Map<string, WalkiePresenceEntry>();

    for (const [key, entry] of this.walkiePresenceMap.entries()) {
      if (now - entry.updated_at_ms > staleCutoffMs) {
        this.walkiePresenceMap.delete(key);
        this.walkieSignalInboxMap.delete(entry.peer_id);
        continue;
      }
      mergedByPeer.set(entry.peer_id, entry);
    }

    try {
      const cutoffMs = now - staleCutoffMs;
      await this.db.execute('DELETE FROM walkie_presence WHERE updated_at_ms < ?', [cutoffMs]);
      const dbRows = await this.db.queryAll<any>(
        'SELECT * FROM walkie_presence WHERE updated_at_ms >= ? ORDER BY updated_at_ms DESC LIMIT 60',
        [cutoffMs]
      );
      for (const r of dbRows) {
        if (!mergedByPeer.has(r.peer_id)) {
          mergedByPeer.set(r.peer_id, {
            peer_id: r.peer_id,
            user_id: r.user_id,
            display_name: r.display_name,
            role: r.role,
            role_label: r.role_label || '',
            avatar_color: r.avatar_color || '#146C2E',
            channel: r.channel || 'security',
            status: r.status || 'listening',
            live_on: Boolean(Number(r.live_on)),
            mic_mode: r.mic_mode || 'vad',
            updated_at_ms: Number(r.updated_at_ms) || now,
          });
        }
      }
    } catch {
      // Fallback to in-memory
    }

    const active: any[] = [];
    for (const entry of mergedByPeer.values()) {
      if (!channelFilter || entry.channel === channelFilter || channelFilter === 'all') {
        active.push({
          peer_id: entry.peer_id,
          user_id: entry.user_id,
          display_name: entry.display_name,
          role: entry.role,
          role_label: entry.role_label,
          avatar_color: entry.avatar_color,
          channel: entry.channel,
          status: entry.status,
          live_on: Boolean(entry.live_on),
          mic_mode: entry.mic_mode || 'vad',
          updated_at: new Date(entry.updated_at_ms).toISOString(),
        });
      }
    }

    active.sort((a, b) => {
      if (a.status === 'talking' && b.status !== 'talking') return -1;
      if (b.status === 'talking' && a.status !== 'talking') return 1;
      if (a.live_on && !b.live_on) return -1;
      if (b.live_on && !a.live_on) return 1;
      return String(a.display_name || '').localeCompare(String(b.display_name || ''), 'ar');
    });
    return active;
  }

  private buildChannelActivitySummary(
    allUnits: any[],
    allowedChannels: WalkieChannelId[]
  ): Record<
    string,
    { count: number; talkingCount: number; talkingNames: string[]; units: any[] }
  > {
    const summary: Record<
      string,
      { count: number; talkingCount: number; talkingNames: string[]; units: any[] }
    > = {};
    for (const chId of allowedChannels) {
      const chUnits = allUnits.filter((u) => u.channel === chId);
      const talkingUnits = chUnits.filter((u) => u.status === 'talking');
      summary[chId] = {
        count: chUnits.length,
        talkingCount: talkingUnits.length,
        talkingNames: talkingUnits.map((u) => u.display_name),
        units: chUnits,
      };
    }
    return summary;
  }

  @Post('presence')
  @HttpCode(200)
  async updatePresence(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const allowedChannels = this.getAllowedChannels(auth);
      if (allowedChannels.length === 0) {
        return res
          .status(403)
          .json({ ok: false, code: 'FORBIDDEN', error: 'اللاسلكي غير مفعّل لهذا الحساب' });
      }

      const rawChannel = String(body?.channel || allowedChannels[0] || 'security').trim();
      const status = String(body?.status || 'listening').trim();
      const peerId = String(body?.peer_id || '').trim().slice(0, 80);
      const liveOn = body?.live_on !== undefined ? Boolean(body.live_on) : true;
      const rawMicMode = String(body?.mic_mode || 'vad').trim();
      const cleanMicMode = ['vad', 'open', 'muted'].includes(rawMicMode) ? rawMicMode : 'vad';
      const presenceKey = peerId ? `${auth.user.id}::${peerId}` : auth.user.id;

      if (status === 'offline') {
        let notifyCh = rawChannel;
        if (peerId) {
          const prev = this.walkiePresenceMap.get(presenceKey);
          if (prev?.channel) notifyCh = prev.channel;
          this.walkiePresenceMap.delete(presenceKey);
          this.walkieSignalInboxMap.delete(peerId);
        } else {
          for (const [k, entry] of this.walkiePresenceMap.entries()) {
            if (entry.user_id === auth.user.id) {
              notifyCh = entry.channel || notifyCh;
              this.walkiePresenceMap.delete(k);
            }
          }
        }
        await this.removePersistentPresence(peerId, auth.user.id);
        const activeUnits = await this.getActiveUnits(notifyCh);
        await this.realtime.broadcastWalkieEvent(
          'walkie_presence',
          { channel: notifyCh, activeUnits },
          notifyCh,
          false
        );
        return res.json({ ok: true, activeUnits });
      }

      if (!this.canTransmitOnChannel(auth, rawChannel)) {
        return res.status(403).json({
          ok: false,
          code: 'FORBIDDEN',
          error: 'عفواً، حسابك مخصص لقناته المعتمدة فقط ولا يملك صلاحية التبديل لهذه القناة',
        });
      }

      const normalizedStatus = status === 'talking' ? 'talking' : 'listening';
      const entry: WalkiePresenceEntry = {
        peer_id: peerId || auth.user.id,
        user_id: auth.user.id,
        display_name: auth.user.display_name,
        role: auth.user.role,
        role_label: auth.user.role_label,
        avatar_color: auth.user.avatar_color || '#146C2E',
        channel: rawChannel,
        status: normalizedStatus,
        live_on: liveOn,
        mic_mode: cleanMicMode,
        updated_at_ms: Date.now(),
      };
      this.walkiePresenceMap.set(presenceKey, entry);
      await this.upsertPersistentPresence(entry);

      const allActiveUnits = await this.getActiveUnits('all');
      const activeUnits = allActiveUnits.filter((u) => u.channel === rawChannel);
      const channelActivitySummary = this.buildChannelActivitySummary(
        allActiveUnits,
        allowedChannels
      );
      await this.realtime.broadcastWalkieEvent(
        'walkie_presence',
        { channel: rawChannel, activeUnits, channelActivitySummary },
        rawChannel,
        false
      );
      return res.json({ ok: true, channel: rawChannel, activeUnits, channelActivitySummary });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('signal')
  @HttpCode(200)
  async sendSignal(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const allowedChannels = this.getAllowedChannels(auth);
      if (allowedChannels.length === 0) {
        return res
          .status(403)
          .json({ ok: false, code: 'FORBIDDEN', error: 'غير مصرح باستخدام اللاسلكي' });
      }

      const targetChannel = String(body?.channel || allowedChannels[0] || 'security').trim();
      if (!VALID_WALKIE_CHANNELS.includes(targetChannel as WalkieChannelId)) {
        return res.status(400).json({ error: 'تردد القناة غير صالح' });
      }
      if (!this.canTransmitOnChannel(auth, targetChannel)) {
        return res.status(403).json({
          ok: false,
          code: 'FORBIDDEN',
          error: 'غير مصرح بالاتصال الحي على هذه القناة',
        });
      }

      const fromPeerId = String(body?.peer_id || auth.user.id).trim().slice(0, 80);
      const targetPeerId = String(body?.target_peer_id || '').trim().slice(0, 80);
      const signalType = String(body?.signal_type || '').trim();
      const validSignalTypes = [
        'join',
        'leave',
        'offer',
        'answer',
        'ice',
        'talking_state',
        'session_open',
        'emergency_alert',
      ];
      if (!validSignalTypes.includes(signalType)) {
        return res.status(400).json({ error: 'نوع إشارة الربط الحي غير صالح' });
      }

      const isEmergencySignal = Boolean(
        targetChannel === 'emergency' ||
          signalType === 'emergency_alert' ||
          body?.is_emergency ||
          body?.data?.is_emergency
      );

      const presenceKey = `${auth.user.id}::${fromPeerId}`;
      if (signalType === 'leave') {
        this.walkiePresenceMap.delete(presenceKey);
        this.walkieSignalInboxMap.delete(fromPeerId);
        await this.removePersistentPresence(fromPeerId, auth.user.id);
      } else {
        const prev = this.walkiePresenceMap.get(presenceKey);
        const nextTalking =
          signalType === 'talking_state'
            ? Boolean(body?.data?.talking)
            : signalType === 'emergency_alert'
            ? true
            : prev?.status === 'talking';
        const rawMicMode = String(body?.data?.mic_mode || prev?.mic_mode || 'vad');
        const entry: WalkiePresenceEntry = {
          peer_id: fromPeerId,
          user_id: auth.user.id,
          display_name: auth.user.display_name,
          role: auth.user.role,
          role_label: auth.user.role_label,
          avatar_color: auth.user.avatar_color || '#146C2E',
          channel: targetChannel,
          status: nextTalking ? 'talking' : 'listening',
          live_on: true,
          mic_mode: ['vad', 'open', 'muted'].includes(rawMicMode) ? rawMicMode : 'vad',
          updated_at_ms: Date.now(),
        };
        this.walkiePresenceMap.set(presenceKey, entry);
        if (
          signalType === 'join' ||
          signalType === 'talking_state' ||
          signalType === 'session_open' ||
          signalType === 'emergency_alert'
        ) {
          await this.upsertPersistentPresence(entry);
        }
      }

      const envelope = {
        id: crypto.randomUUID(),
        channel: targetChannel,
        from_peer_id: fromPeerId,
        target_peer_id: targetPeerId,
        user_id: auth.user.id,
        display_name: auth.user.display_name,
        role: auth.user.role,
        role_label: auth.user.role_label,
        avatar_color: auth.user.avatar_color || '#146C2E',
        signal_type: signalType,
        is_emergency: isEmergencySignal,
        data: body?.data ?? null,
        timestamp: new Date().toISOString(),
        ts_ms: Date.now(),
      };

      const activeUnits = await this.getActiveUnits(isEmergencySignal ? 'all' : targetChannel);
      if (targetPeerId) {
        this.enqueueSignalForPeer(targetPeerId, envelope);
      } else {
        for (const u of activeUnits) {
          if (u.peer_id && u.peer_id !== fromPeerId) {
            this.enqueueSignalForPeer(u.peer_id, envelope);
          }
        }
      }

      const alsoCloud = body?.cloud_sent !== true;
      await this.realtime.broadcastWalkieEvent(
        'walkie_signal',
        envelope,
        targetChannel,
        alsoCloud
      );
      if (
        signalType === 'join' ||
        signalType === 'leave' ||
        signalType === 'talking_state' ||
        signalType === 'session_open' ||
        signalType === 'emergency_alert'
      ) {
        await this.realtime.broadcastWalkieEvent(
          'walkie_presence',
          { channel: targetChannel, activeUnits },
          targetChannel,
          false
        );
      }

      return res.json({ ok: true, activeUnits });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('live-frame')
  @HttpCode(200)
  async sendLiveFrame(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const allowedChannels = this.getAllowedChannels(auth);
      if (allowedChannels.length === 0) {
        return res
          .status(403)
          .json({ ok: false, code: 'FORBIDDEN', error: 'غير مصرح باستخدام اللاسلكي' });
      }

      const targetChannel = String(body?.channel || allowedChannels[0] || 'security').trim();
      if (!VALID_WALKIE_CHANNELS.includes(targetChannel as WalkieChannelId)) {
        return res.status(400).json({ error: 'تردد القناة غير صالح' });
      }
      if (!this.canTransmitOnChannel(auth, targetChannel)) {
        return res.status(403).json({
          ok: false,
          code: 'FORBIDDEN',
          error: 'عفواً، دورك الحالي مصرح له فقط بالبث على قناته المعتمدة',
        });
      }

      const fromPeerId = String(body?.peer_id || auth.user.id).trim().slice(0, 80);
      const ulawB64 = String(body?.ulaw_b64 || '').trim();
      if (!ulawB64 || ulawB64.length < 16 || ulawB64.length > 24000) {
        return res.status(400).json({ error: 'إطار الصوت الحي غير صالح أو يتجاوز الحجم المسموح' });
      }

      const sampleRate = Math.min(16000, Math.max(4000, Number(body?.sample_rate) || 8000));
      const seq = ++this.walkieLiveSeqCounter;
      const nowMs = Date.now();

      const presenceKey = `${auth.user.id}::${fromPeerId}`;
      const prevPresence = this.walkiePresenceMap.get(presenceKey);
      this.walkiePresenceMap.set(presenceKey, {
        peer_id: fromPeerId,
        user_id: auth.user.id,
        display_name: auth.user.display_name,
        role: auth.user.role,
        role_label: auth.user.role_label,
        avatar_color: auth.user.avatar_color || '#146C2E',
        channel: targetChannel,
        status: 'talking',
        live_on: true,
        mic_mode: prevPresence?.mic_mode || 'vad',
        updated_at_ms: nowMs,
      });

      const framePacket = {
        seq,
        channel: targetChannel,
        from_peer_id: fromPeerId,
        sender_id: auth.user.id,
        sender_name: auth.user.display_name,
        sender_role: auth.user.role,
        avatar_color: auth.user.avatar_color || '#146C2E',
        sample_rate: sampleRate,
        ulaw_b64: ulawB64,
        is_emergency: Boolean(body?.is_emergency || targetChannel === 'emergency'),
        ts_ms: nowMs,
      };

      this.pruneLiveFrames();
      this.walkieLiveFramesRing.push(framePacket);

      const alsoCloud = body?.cloud_sent !== true;
      await this.realtime.broadcastWalkieEvent(
        'walkie_live_frame',
        framePacket,
        targetChannel,
        alsoCloud
      );
      return res.json({ ok: true, seq });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('transmit')
  async transmitCall(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const allowedChannels = this.getAllowedChannels(auth);
      if (allowedChannels.length === 0) {
        return res
          .status(403)
          .json({ ok: false, code: 'FORBIDDEN', error: 'غير مصرح باستخدام اللاسلكي' });
      }

      const {
        id: clientId,
        channel: requestedChannel,
        kind = 'voice',
        audio_data = '',
        mime_type = 'audio/webm',
        duration_sec = 0,
        is_emergency = false,
      } = body || {};

      const targetChannel = String(requestedChannel || allowedChannels[0] || 'security').trim();
      if (!VALID_WALKIE_CHANNELS.includes(targetChannel as WalkieChannelId)) {
        return res.status(400).json({ error: 'تردد القناة غير صالح' });
      }

      if (!this.canTransmitOnChannel(auth, targetChannel)) {
        await this.db.recordAuditLog({
          userId: auth.user.id,
          userName: auth.user.display_name,
          role: auth.user.role,
          action: 'رفض إرسال لاسلكي خارج القناة المخصصة',
          details: `محاولة إرسال على (${targetChannel}) بينما القنوات المسموحة هي (${allowedChannels.join(', ')})`,
          ip: getClientIp(req),
          severity: 'warning',
        });
        return res.status(403).json({
          ok: false,
          code: 'FORBIDDEN',
          error: 'عفواً، دورك الحالي مصرح له فقط بالإرسال على قناة الأمن المخصصة له',
        });
      }

      const finalKind = kind === 'ping' ? 'ping' : 'voice';
      let cleanAudio = '';
      let cleanMime = 'audio/webm';
      let cleanDuration = 0;

      if (finalKind === 'voice') {
        if (
          typeof audio_data !== 'string' ||
          !audio_data.startsWith('data:audio/') ||
          audio_data.length < 48
        ) {
          return res.status(400).json({ error: 'المقطع الصوتي غير صالح أو قصير جداً' });
        }
        if (audio_data.length > 950000) {
          return res
            .status(400)
            .json({ error: 'حجم النداء الصوتي يتجاوز الحد المسموح (30 ثانية كحد أقصى)' });
        }
        cleanAudio = audio_data;
        const mimeMatch = audio_data.match(
          /^data:(audio\/[a-z0-9.+=-]+(?:;codecs=[a-z0-9.,_-]+)?);base64,/i
        );
        cleanMime = mimeMatch ? mimeMatch[1] : String(mime_type || 'audio/webm').slice(0, 64);
        const parsedDur = Number(duration_sec);
        cleanDuration = Number.isFinite(parsedDur)
          ? Math.min(35, Math.max(0.4, Math.round(parsedDur * 10) / 10))
          : 1.5;
      }

      const callId = clientId ? String(clientId).slice(0, 80) : crypto.randomUUID();
      const existingCall = await this.db.queryOne(
        'SELECT * FROM walkie_calls WHERE id = ?',
        [callId]
      );
      if (existingCall) {
        return res.status(200).json({ ok: true, call: existingCall });
      }

      const now = new Date();
      const isoNow = now.toISOString();
      const dateKey = getLocalDateKey(now);
      const emergencyFlag = is_emergency || targetChannel === 'emergency' ? 1 : 0;

      await this.db.execute(
        `INSERT INTO walkie_calls (
          id, channel, kind, sender_id, sender_name, sender_role,
          audio_data, mime_type, duration_sec, is_emergency, timestamp, date_key, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          callId,
          targetChannel,
          finalKind,
          auth.user.id,
          auth.user.display_name,
          auth.user.role,
          cleanAudio,
          cleanMime,
          cleanDuration,
          emergencyFlag,
          isoNow,
          dateKey,
        ]
      );

      // Auto-prune calls older than 24h and cap each channel at newest 25 clips
      try {
        const cutoff24h = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
        await this.db.execute('DELETE FROM walkie_calls WHERE timestamp < ?', [cutoff24h]);
        await this.db.execute(
          `DELETE FROM walkie_calls
           WHERE channel = ? AND id NOT IN (
             SELECT id FROM walkie_calls WHERE channel = ? ORDER BY timestamp DESC LIMIT 25
           )`,
          [targetChannel, targetChannel]
        );
      } catch {
        // Non-fatal cleanup
      }

      const txPeerId = String(body?.peer_id || '').trim().slice(0, 80);
      const txPresenceKey = txPeerId ? `${auth.user.id}::${txPeerId}` : auth.user.id;
      const prevTxPresence = this.walkiePresenceMap.get(txPresenceKey);
      const entry: WalkiePresenceEntry = {
        peer_id: txPeerId || prevTxPresence?.peer_id || auth.user.id,
        user_id: auth.user.id,
        display_name: auth.user.display_name,
        role: auth.user.role,
        role_label: auth.user.role_label,
        avatar_color: auth.user.avatar_color || '#146C2E',
        channel: targetChannel,
        status: 'listening',
        live_on: prevTxPresence?.live_on ?? true,
        mic_mode: prevTxPresence?.mic_mode || 'vad',
        updated_at_ms: Date.now(),
      };
      this.walkiePresenceMap.set(txPresenceKey, entry);
      await this.upsertPersistentPresence(entry);

      const created = await this.db.queryOne('SELECT * FROM walkie_calls WHERE id = ?', [
        callId,
      ]);
      const activeUnits = await this.getActiveUnits(targetChannel);

      // Broadcast globally across networks via Supabase Realtime HTTP Broadcast + local SSE!
      await this.realtime.broadcastWalkieEvent(
        'walkie_tx',
        { call: created },
        targetChannel,
        true
      );
      await this.realtime.broadcastWalkieEvent(
        'walkie_presence',
        { channel: targetChannel, activeUnits },
        targetChannel,
        false
      );

      if (finalKind === 'ping' || emergencyFlag) {
        const meta = WALKIE_CHANNELS[targetChannel as WalkieChannelId];
        await this.db.recordAuditLog({
          userId: auth.user.id,
          userName: auth.user.display_name,
          role: auth.user.role,
          action: finalKind === 'ping' ? 'جرس انتباه لاسلكي عاجل' : 'نداء لاسلكي طارئ',
          details: meta ? `${meta.label} (${meta.code})` : targetChannel,
          ip: getClientIp(req),
          severity: emergencyFlag ? 'warning' : 'info',
        });
      }

      return res.status(201).json({ ok: true, call: created, activeUnits });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Get('poll')
  async pollWalkie(
    @Query('channel') rawChannel: string | undefined,
    @Query('listening') listening: string | undefined,
    @Query('peer_id') rawPeerId: string | undefined,
    @Query('live_on') liveOnQuery: string | undefined,
    @Query('since') rawSince: string | undefined,
    @Query('last_frame_seq') rawLastFrameSeq: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const allowedChannels = this.getAllowedChannels(auth);
      if (allowedChannels.length === 0) {
        return res
          .status(403)
          .json({ ok: false, code: 'FORBIDDEN', error: 'غير مصرح باستخدام اللاسلكي' });
      }

      const requestedChannel = String(rawChannel || allowedChannels[0] || 'security').trim();
      const activeChannel = VALID_WALKIE_CHANNELS.includes(requestedChannel as WalkieChannelId)
        ? requestedChannel
        : allowedChannels[0];

      if (!this.canReceiveChannel(auth, activeChannel)) {
        return res.status(403).json({
          ok: false,
          code: 'FORBIDDEN',
          error: 'غير مصرح بالاستماع لهذه القناة',
        });
      }

      const pollPeerId = String(rawPeerId || '').trim().slice(0, 80);
      const liveOnParam = liveOnQuery === '1';

      if (listening === '1' && this.canTransmitOnChannel(auth, activeChannel)) {
        const presenceKey = pollPeerId ? `${auth.user.id}::${pollPeerId}` : auth.user.id;
        const existing = this.walkiePresenceMap.get(presenceKey);
        const keepTalking =
          existing?.status === 'talking' &&
          existing?.channel === activeChannel &&
          Date.now() - existing.updated_at_ms < 8000;
        const entry: WalkiePresenceEntry = {
          peer_id: pollPeerId || auth.user.id,
          user_id: auth.user.id,
          display_name: auth.user.display_name,
          role: auth.user.role,
          role_label: auth.user.role_label,
          avatar_color: auth.user.avatar_color || '#146C2E',
          channel: activeChannel,
          status: keepTalking ? 'talking' : 'listening',
          live_on: liveOnParam || Boolean(existing?.live_on),
          mic_mode: existing?.mic_mode || 'vad',
          updated_at_ms: Date.now(),
        };
        this.walkiePresenceMap.set(presenceKey, entry);
        await this.upsertPersistentPresence(entry);
      }

      const since = String(rawSince || '').trim();
      const calls = since
        ? await this.db.queryAll(
            `SELECT * FROM walkie_calls
             WHERE (channel = ? OR channel = 'emergency' OR is_emergency = 1) AND timestamp > ?
             ORDER BY timestamp ASC
             LIMIT 20`,
            [activeChannel, since]
          )
        : await this.db.queryAll(
            `SELECT * FROM walkie_calls
             WHERE channel = ? OR channel = 'emergency' OR is_emergency = 1
             ORDER BY timestamp DESC
             LIMIT 20`,
            [activeChannel]
          );

      this.pruneLiveFrames();
      const signals = pollPeerId ? this.drainSignalsForPeer(pollPeerId) : [];
      const hasLastSeq = rawLastFrameSeq !== undefined && rawLastFrameSeq !== '';
      const lastFrameSeq = hasLastSeq
        ? Number(rawLastFrameSeq) || 0
        : this.walkieLiveSeqCounter;
      const liveFrames = hasLastSeq
        ? this.walkieLiveFramesRing.filter(
            (f) =>
              f.seq > lastFrameSeq &&
              f.from_peer_id !== (pollPeerId || auth.user.id) &&
              (f.channel === activeChannel || f.channel === 'emergency' || f.is_emergency)
          )
        : [];

      const allActiveUnits = await this.getActiveUnits('all');
      const activeUnits = allActiveUnits.filter((u) => u.channel === activeChannel);
      const channelActivitySummary = this.buildChannelActivitySummary(
        allActiveUnits,
        allowedChannels
      );

      return res.json({
        ok: true,
        serverTime: new Date().toISOString(),
        channel: activeChannel,
        allowedChannels,
        calls,
        signals,
        liveFrames,
        latestFrameSeq: this.walkieLiveSeqCounter,
        activeUnits,
        channelActivitySummary,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Delete('calls/:id')
  async deleteCall(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response
  ) {
    try {
      const existing = await this.db.queryOne<any>(
        'SELECT * FROM walkie_calls WHERE id = ?',
        [id]
      );
      if (!existing) {
        return res.status(404).json({ error: 'النداء غير موجود' });
      }
      const canDelete =
        auth.has('records:manage') ||
        auth.has('users:manage') ||
        existing.sender_id === auth.user.id;
      if (!canDelete) {
        return res.status(403).json({ error: 'غير مصرح بحذف هذا النداء' });
      }
      await this.db.execute('DELETE FROM walkie_calls WHERE id = ?', [existing.id]);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
}

@Module({
  controllers: [WalkieController],
})
export class WalkieModule {}
