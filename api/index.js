import { createApp } from '../server/index.js';

let cachedApp = null;

function getServerlessApp() {
  if (!cachedApp) {
    const instance = createApp({ serverless: true });
    cachedApp = instance.app;
  }
  return cachedApp;
}

export default function handler(req, res) {
  if (req.url && !req.url.startsWith('/api') && !req.url.startsWith('/uploads')) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  }
  const app = getServerlessApp();
  return app(req, res);
}
