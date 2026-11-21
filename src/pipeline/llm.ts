import type { Settings } from '../settings';
export async function complete(settings: Settings, system: string, user: string) {
  if (!settings.key.trim()) throw new Error('请先在设置中填写 OpenRouter API 密钥。');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (res.status === 401) throw new Error('API 密钥无效或已过期，请在设置中检查。');
  if (res.status === 429)
    throw new Error('免费模型请求过于频繁或额度已用尽，请稍后重试或更换模型。');
  if (!res.ok) throw new Error(`模型请求失败（${res.status}），请稍后重试。`);
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型返回空内容，请重试。');
  return content;
}
