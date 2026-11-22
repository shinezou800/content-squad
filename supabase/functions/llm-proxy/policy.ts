export function allowedOrigin(origin: string): boolean {
  return origin === 'https://shinezou800.github.io' || /^http:\/\/localhost(?::\d+)?$/.test(origin);
}

export type ProxyInput = { baseUrl: string; path: 'chat/completions' | 'models'; key: string; payload?: Record<string, unknown> };

export function proxyTarget(input: unknown, allowedHosts: string): { url: string; input: ProxyInput } {
  if (!input || typeof input !== 'object') throw new Error('Invalid request');
  const body = input as ProxyInput;
  if (typeof body.baseUrl !== 'string' || typeof body.key !== 'string' || /[\r\n]/.test(body.key))
    throw new Error('Invalid request');
  if (body.path !== 'models' && body.path !== 'chat/completions') throw new Error('Invalid path');
  if (body.path === 'chat/completions' && (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)))
    throw new Error('Invalid payload');
  const url = new URL(body.baseUrl);
  const hosts = allowedHosts.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (!body.baseUrl.startsWith('https://') || url.protocol !== 'https:' || url.username || url.password ||
      /[?#]/.test(body.baseUrl) || (url.port && url.port !== '443') || !hosts.includes(url.hostname))
    throw new Error('Forbidden endpoint');
  url.pathname = url.pathname.replace(/\/+$/, '') + '/' + body.path;
  return { url: url.toString(), input: body };
}
