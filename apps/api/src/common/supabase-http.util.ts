import { ZAYED_SUPABASE_ANON_KEY, ZAYED_SUPABASE_URL } from '@zayed-mart/shared';
import http from 'node:http';
import https from 'node:https';

const DEFAULT_RPC_BRIDGE_KEY =
  'zm_cloud_rpc_bridge_v2_efeioijgxjyyqplfusub_91a8f3c4e7b2d605';

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 15000,
  maxSockets: 20,
  family: 4,
} as any);

const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 15000,
  maxSockets: 20,
  family: 4,
} as any);

export function getResolvedSupabaseConfig() {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ZAYED_SUPABASE_URL
  )
    .trim()
    .replace(/\/+$/, '');

  const apiKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ZAYED_SUPABASE_ANON_KEY
  ).trim();

  const rpcKey = (process.env.SUPABASE_RPC_BRIDGE_KEY || DEFAULT_RPC_BRIDGE_KEY).trim();

  return { url, apiKey, rpcKey };
}

function sendJsonOnce<T = any>(options: {
  fullUrl: string;
  apiKey: string;
  body: Record<string, any>;
  timeoutMs?: number;
}): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(options.fullUrl);
    const isHttps = parsed.protocol === 'https:';
    const payload = JSON.stringify(options.body);
    const reqModule = isHttps ? https : http;

    const req = reqModule.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        family: 4,
        agent: isHttps ? httpsAgent : httpAgent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Connection: 'keep-alive',
          apikey: options.apiKey,
          Authorization: `Bearer ${options.apiKey}`,
        },
        timeout: options.timeoutMs || 10000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode || 500;
          if (status >= 200 && status < 300) {
            if (!raw) return resolve({} as T);
            try {
              return resolve(JSON.parse(raw) as T);
            } catch {
              return resolve({} as T);
            }
          }
          reject(new Error(`Supabase HTTP ${status}: ${raw.slice(0, 280)}`));
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Supabase HTTP request timed out'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

export async function postSupabaseJson<T = any>(options: {
  fullUrl: string;
  apiKey: string;
  body: Record<string, any>;
  timeoutMs?: number;
}): Promise<T> {
  try {
    return await sendJsonOnce<T>(options);
  } catch (err: any) {
    const code = err?.code || '';
    if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT') {
      return await sendJsonOnce<T>(options);
    }
    throw err;
  }
}

export async function execSupabaseRpcSql<T = any>(
  sql: string,
  params: any[] = []
): Promise<{ rows: T[]; changes: number }> {
  const { url, apiKey, rpcKey } = getResolvedSupabaseConfig();
  const res = await postSupabaseJson<{ ok: boolean; rows?: T[]; changes?: number }>({
    fullUrl: `${url}/rest/v1/rpc/zayed_rpc_exec`,
    apiKey,
    body: {
      p_key: rpcKey,
      p_sql: sql,
      p_params: params.map((p) => (p === undefined ? null : p)),
    },
  });
  return {
    rows: Array.isArray(res?.rows) ? res.rows : [],
    changes: Number(res?.changes || 0),
  };
}

export async function execSupabaseRpcBatch(
  statements: Array<{ sql: string; params?: any[] }>
): Promise<Array<{ rows: any[]; changes: number }>> {
  if (!statements || statements.length === 0) return [];
  const { url, apiKey, rpcKey } = getResolvedSupabaseConfig();
  const res = await postSupabaseJson<{
    ok: boolean;
    results?: Array<{ rows?: any[]; changes?: number }>;
  }>({
    fullUrl: `${url}/rest/v1/rpc/zayed_rpc_batch`,
    apiKey,
    body: {
      p_key: rpcKey,
      p_statements: statements.map((st) => ({
        sql: st.sql,
        params: (st.params || []).map((p) => (p === undefined ? null : p)),
      })),
    },
  });
  return (res?.results || []).map((r) => ({
    rows: Array.isArray(r?.rows) ? r.rows : [],
    changes: Number(r?.changes || 0),
  }));
}
