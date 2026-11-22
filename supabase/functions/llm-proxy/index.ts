import { createClient } from 'npm:@supabase/supabase-js@2';
import { createProxyHandler } from './handler.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(createProxyHandler({
  ownerId: Deno.env.get('LLM_PROXY_OWNER_ID') || '',
  allowedHosts: Deno.env.get('LLM_PROXY_ALLOWED_HOSTS') || '',
  getUserId: async (token) => {
    const { data, error } = await supabase.auth.getUser(token);
    return error ? undefined : data.user?.id;
  },
  fetch,
}));
