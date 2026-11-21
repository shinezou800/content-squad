import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const supabase =
  url && key && key.startsWith('sb_publishable_') ? createClient(url, key) : null;

export function cloudError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'invalid_credentials') return '邮箱或密码不正确，请重试。';
  if (code === 'email_not_confirmed') return '邮箱尚未确认，请联系管理员。';
  if (code === 'over_request_rate_limit') return '请求过于频繁，请稍后再试。';
  if (code === '42501') return '没有云端访问权限，请联系管理员检查授权名单。';
  return '云端操作失败，请检查网络、登录状态与云端配置后重试。';
}
