import { allowedOrigin, proxyTarget } from './policy.ts';

type Dependencies = {
  ownerId: string;
  allowedHosts: string;
  getUserId: (token: string) => Promise<string | undefined>;
  fetch: typeof fetch;
  heartbeatMs?: number;
};

function heartbeat(body: ReadableStream<Uint8Array>, interval: number): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let timer: ReturnType<typeof setInterval>;
  let ended = false;
  let lastByte = -1;
  let boundary = true;
  let lastArrival = Date.now();
  const finish = () => { ended = true; clearInterval(timer); };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => {
        if (!ended && boundary && Date.now() - lastArrival >= interval)
          controller.enqueue(new TextEncoder().encode(': ping\n\n'));
      }, interval);
      void (async () => {
        try {
          while (!ended) {
            const { value, done } = await reader.read();
            if (ended) return;
            if (done) { finish(); controller.close(); return; }
            if (value.length) {
              lastArrival = Date.now();
              for (const byte of value) {
                boundary = lastByte === 10 && byte === 10;
                lastByte = byte;
              }
            }
            controller.enqueue(value);
          }
        } catch (error) {
          if (!ended) { finish(); controller.error(error); }
        } finally { reader.releaseLock(); }
      })();
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason);
    },
  });
}

export function createProxyHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const cors = new Headers({
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Expose-Headers': 'content-type, x-llm-proxy-error',
      'Vary': 'Origin',
      'Cache-Control': 'no-store',
    });
    if (origin && allowedOrigin(origin)) cors.set('Access-Control-Allow-Origin', origin);
    const fail = (status: number, error: string) => Response.json({ error }, { status, headers: cors });
    if (origin && !allowedOrigin(origin)) return fail(403, 'Origin not allowed');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return fail(405, 'Method not allowed');
    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1];
    if (!token || token.startsWith('sb_')) return fail(401, 'Authentication required');
    if (!deps.ownerId) return fail(503, 'Proxy not configured');
    let userId: string | undefined;
    try { userId = await deps.getUserId(token); } catch { return fail(401, 'Invalid session'); }
    if (!userId) return fail(401, 'Invalid session');
    if (userId !== deps.ownerId) return fail(403, 'Owner access required');
    let target;
    try { target = proxyTarget(await request.json(), deps.allowedHosts); }
    catch { return fail(403, 'Invalid or forbidden endpoint'); }
    let upstream: Response;
    try {
      upstream = await deps.fetch(target.url, {
        method: target.input.path === 'models' ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${target.input.key}`, 'Content-Type': 'application/json' },
        ...(target.input.path === 'chat/completions' ? { body: JSON.stringify({ ...target.input.payload, stream: true }) } : {}),
        redirect: 'manual',
      });
    } catch (error) {
      cors.set('X-LLM-Proxy-Error', 'upstream-network');
      let detail = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      const payload = JSON.stringify(target.input.payload);
      if (payload) detail = detail.split(payload).join('[redacted]');
      if (target.input.key) detail = detail.split(target.input.key).join('[redacted]');
      return fail(502, `Upstream unavailable: ${detail}`.slice(0, 200));
    }
    if (!upstream.ok) cors.set('X-LLM-Proxy-Error', 'upstream-http');
    cors.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
    const body = upstream.ok && upstream.body && target.input.path === 'chat/completions'
      ? heartbeat(upstream.body, deps.heartbeatMs ?? 10_000) : upstream.body;
    return new Response(body, { status: upstream.status, headers: cors });
  };
}
