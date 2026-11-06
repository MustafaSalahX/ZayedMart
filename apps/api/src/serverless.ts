import type { Request, Response } from 'express';
import { createZayedNestApp } from './app.factory';

let cachedExpressHandler: any = null;
let bootPromise: Promise<any> | null = null;

async function getExpressInstance() {
  if (cachedExpressHandler) return cachedExpressHandler;
  if (!bootPromise) {
    bootPromise = createZayedNestApp({ serveSpa: false }).then((nestApp) => {
      cachedExpressHandler = nestApp.getHttpAdapter().getInstance();
      return cachedExpressHandler;
    });
  }
  return bootPromise;
}

export async function serverlessHandler(req: Request, res: Response) {
  if (req.url && !req.url.startsWith('/api') && !req.url.startsWith('/uploads')) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  }
  const instance = await getExpressInstance();
  return instance(req, res);
}

export default serverlessHandler;
