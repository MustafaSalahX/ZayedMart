import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { AppModule } from './app.module';
import { StorageService } from './database/storage.service';

const repoRoot = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(repoRoot, '.env.local') });
dotenv.config({ path: path.join(repoRoot, '.env') });

export interface CreateNestAppOptions {
  serveSpa?: boolean;
  quietLogs?: boolean;
}

export async function createZayedNestApp(
  options: CreateNestAppOptions = {}
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: options.quietLogs ? ['error'] : ['error', 'warn', 'log'],
  });

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.disable('x-powered-by');
  expressApp.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  expressApp.use(cors());
  expressApp.use(express.json({ limit: '10mb' }));
  expressApp.use(express.urlencoded({ extended: true, limit: '10mb' }));

  await app.init();

  const storage = app.get(StorageService);
  if (fs.existsSync(storage.uploadsDir)) {
    expressApp.use('/uploads', express.static(storage.uploadsDir));
  }

  if (options.serveSpa !== false) {
    const webDistDir = path.join(repoRoot, 'apps', 'web', 'dist');
    const indexHtml = path.join(webDistDir, 'index.html');
    if (fs.existsSync(webDistDir) && fs.existsSync(indexHtml)) {
      expressApp.use(express.static(webDistDir));
      expressApp.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (req.method !== 'GET') return next();
        if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
        res.sendFile(indexHtml);
      });
    }
  }

  return app;
}
