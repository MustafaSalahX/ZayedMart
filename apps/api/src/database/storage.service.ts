import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ZAYED_SUPABASE_URL } from '@zayed-mart/shared';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateImageMagicBytes } from '../common/crypto.util';

@Injectable()
export class StorageService {
  private supabaseAdmin: SupabaseClient | null = null;
  public readonly uploadsDir: string;
  public readonly isServerless: boolean;

  constructor() {
    this.isServerless = Boolean(
      process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME
    );
    this.uploadsDir = this.resolveUploadsDir();

    const url = (
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      ZAYED_SUPABASE_URL
    ).trim();
    const serviceKey = (
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      ''
    ).trim();

    if (url && serviceKey) {
      this.supabaseAdmin = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
  }

  private resolveUploadsDir(): string {
    if (process.env.ZAYED_UPLOADS_DIR) {
      fs.mkdirSync(process.env.ZAYED_UPLOADS_DIR, { recursive: true });
      return process.env.ZAYED_UPLOADS_DIR;
    }
    if (!this.isServerless) {
      try {
        const repoRoot = path.resolve(__dirname, '../../../..');
        const dir = path.join(repoRoot, 'data', 'uploads');
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      } catch {
        // fallback below
      }
    }
    const tmpDir = path.join(os.tmpdir(), 'zayed-mart-data', 'uploads');
    fs.mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
  }

  async uploadProofDataUrl(
    dataUrl: string,
    prefix = 'proof'
  ): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      return { ok: false, error: 'صيغة الصورة غير صالحة' };
    }
    const match = dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
    if (!match) {
      return { ok: false, error: 'يرجى رفع صورة بصيغة JPG أو PNG أو WebP' };
    }

    const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const buffer = Buffer.from(match[2], 'base64');

    if (!validateImageMagicBytes(buffer, ext)) {
      return { ok: false, error: 'محتوى ملف الصورة غير سليم أو يتجاوز الحجم المسموح' };
    }

    const safePrefix = String(prefix || 'proof').replace(/[^a-z0-9_-]/gi, '') || 'proof';
    const fileName = `${safePrefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;

    if (this.supabaseAdmin) {
      try {
        const storagePath = `proofs/${fileName}`;
        const { error } = await this.supabaseAdmin.storage
          .from('zayed-proofs')
          .upload(storagePath, buffer, {
            contentType: mimeType,
            upsert: true,
          });
        if (!error) {
          const { data } = this.supabaseAdmin.storage
            .from('zayed-proofs')
            .getPublicUrl(storagePath);
          if (data?.publicUrl) {
            return { ok: true, url: data.publicUrl };
          }
        }
      } catch {
        // Fallback below if storage upload fails transiently
      }
    }

    if (this.isServerless) {
      return { ok: true, url: dataUrl };
    }

    try {
      const fullPath = path.join(this.uploadsDir, fileName);
      fs.writeFileSync(fullPath, buffer);
      return { ok: true, url: `/uploads/${fileName}` };
    } catch {
      return { ok: true, url: dataUrl };
    }
  }
}
