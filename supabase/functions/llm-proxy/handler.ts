import { allowedOrigin, proxyTarget } from './policy.ts';

type Dependencies = {
  ownerId: string;
  allowedHosts: string;
  getUserId: (token: string) => Promise<string | undefined>;
  fetch: typeof fetch;
};

export function createProxyHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const cors = new Headers({
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Expose-Headers': 'content-type',
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
    try {
      const upstream = await deps.fetch(target.url, {
        method: target.input.path === 'models' ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${target.input.key}`, 'Content-Type': 'application/json' },
        ...(target.input.path === 'chat/completions' ? { body: JSON.stringify({ ...target.input.payload, stream: true }) } : {}),
        redirect: 'manual',
      });
      cors.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
      return new Response(upstream.body, { status: upstream.status, headers: cors });
    } catch { return fail(502, 'Upstream unavailable'); }
  };
}
