import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_HOST = '127.0.0.1';
const API_PORT = Number(process.env.PORT || 3001);

let backendReadyAt = 0;
let pendingReadyPromise = null;

function probePort(port = API_PORT, host = API_HOST) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(300);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForBackend(timeoutMs = 12000) {
  if (Date.now() - backendReadyAt < 2000) {
    return true;
  }
  if (await probePort()) {
    backendReadyAt = Date.now();
    return true;
  }
  if (!pendingReadyPromise) {
    pendingReadyPromise = (async () => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 150));
        if (await probePort()) {
          backendReadyAt = Date.now();
          return true;
        }
      }
      return false;
    })().finally(() => {
      pendingReadyPromise = null;
    });
  }
  return pendingReadyPromise;
}

function createApiProxyOptions() {
  return {
    target: `http://${API_HOST}:${API_PORT}`,
    changeOrigin: true,
    async bypass(_req, res) {
      const ready = await waitForBackend();
      if (ready) {
        return null;
      }
      if (res && !res.headersSent && !res.writableEnded) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            ok: false,
            code: 'API_STARTING',
            error: 'جاري تشغيل خادم النظام...',
          })
        );
      }
      return '/';
    },
    configure(proxy) {
      proxy.on('error', () => {
        backendReadyAt = 0;
      });
    },
  };
}

export default defineConfig({
  envDir: path.resolve(__dirname, '../..'),
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': createApiProxyOptions(),
      '/uploads': createApiProxyOptions(),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: ['es2018', 'chrome64'],
    cssTarget: 'chrome64',
  },
});
