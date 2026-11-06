import { Global, Injectable } from '@nestjs/common';
import {
  resolveAllowedWalkieChannels,
  ZAYED_SUPABASE_ANON_KEY,
  ZAYED_SUPABASE_URL,
} from '@zayed-mart/shared';
import type { Response } from 'express';
import { AuthContext } from '../common/decorators';
import { postSupabaseJson } from '../common/supabase-http.util';

interface SseClientEntry {
  res: Response;
  auth: AuthContext;
}

@Injectable()
export class RealtimeService {
  private readonly sseClients = new Set<SseClientEntry>();
  private readonly supabaseUrl: string;
  private readonly supabaseKey: string;
  public readonly isServerless: boolean;

  constructor() {
    this.isServerless = Boolean(
      process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME
    );
    this.supabaseUrl = (
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      ZAYED_SUPABASE_URL
    ).trim();
    this.supabaseKey = (
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      ZAYED_SUPABASE_ANON_KEY
    ).trim();
  }

  public getPublicCloudRealtimeConfig() {
    const publicAnonKey = (
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      ZAYED_SUPABASE_ANON_KEY
    ).trim();
    return {
      enabled: Boolean(this.supabaseUrl && publicAnonKey),
      url: this.supabaseUrl,
      anonKey: publicAnonKey,
      syncTopic: 'zayed_ops_sync_v1',
    };
  }

  registerSseClient(res: Response, auth: AuthContext): () => void {
    const entry: SseClientEntry = { res, auth };
    this.sseClients.add(entry);
    return () => {
      this.sseClients.delete(entry);
    };
  }

  private canAuthReceiveWalkie(auth: AuthContext, channel: string): boolean {
    const allowed = resolveAllowedWalkieChannels(auth.user.role, auth.permissions);
    if (allowed.length === 0) return false;
    if (channel === 'emergency') return true;
    return allowed.includes(channel as any);
  }

  private async sendSupabaseHttpBroadcast(topic: string, event: string, payload: Record<string, any>) {
    if (!this.supabaseUrl || !this.supabaseKey || process.env.ZAYED_DISABLE_CLOUD_BROADCAST === '1') {
      return;
    }
    try {
      const endpoint = `${this.supabaseUrl.replace(/\/+$/, '')}/realtime/v1/api/broadcast`;
      await postSupabaseJson({
        fullUrl: endpoint,
        apiKey: this.supabaseKey,
        body: {
          messages: [
            {
              topic,
              event,
              payload,
            },
          ],
        },
        timeoutMs: 4000,
      });
    } catch {
      // Non-blocking if offline
    }
  }

  async broadcastStoreUpdate(reason = 'change'): Promise<void> {
    const payloadObj = { reason, at: new Date().toISOString() };
    const serialized = JSON.stringify(payloadObj);
    for (const client of this.sseClients) {
      try {
        client.res.write(`event: update\ndata: ${serialized}\n\n`);
      } catch {
        this.sseClients.delete(client);
      }
    }
    await this.sendSupabaseHttpBroadcast('zayed_ops_sync_v1', 'db_change', payloadObj);
  }

  async broadcastWalkieEvent(
    eventName: string,
    payloadObj: Record<string, any>,
    targetChannel: string,
    alsoCloudBroadcast = false
  ): Promise<void> {
    const serialized = JSON.stringify(payloadObj);
    for (const client of this.sseClients) {
      try {
        if (!this.canAuthReceiveWalkie(client.auth, targetChannel)) continue;
        client.res.write(`event: ${eventName}\ndata: ${serialized}\n\n`);
      } catch {
        this.sseClients.delete(client);
      }
    }

    if (alsoCloudBroadcast) {
      const topic = `zayed_walkie_ch_${targetChannel}`;
      await this.sendSupabaseHttpBroadcast(topic, eventName, payloadObj);
      if (targetChannel === 'emergency') {
        for (const ch of ['security', 'warehouse', 'floor']) {
          await this.sendSupabaseHttpBroadcast(`zayed_walkie_ch_${ch}`, eventName, payloadObj);
        }
      }
    }
  }
}
