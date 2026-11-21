import { useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { cloudError, supabase } from './storage/supabase';

export function CloudSettings({ user, disabled }: { user: User | null; disabled: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function login(event: FormEvent) {
    event.preventDefault();
    if (!supabase || busy || disabled) return;
    setBusy(true);
    setError('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      setPassword('');
    } catch (e) {
      setError(cloudError(e));
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    if (!supabase || busy || disabled) return;
    setBusy(true);
    setError('');
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (e) {
      setError(cloudError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings">
      <h2>云端同步</h2>
      <p className="subtle">
        登录后，作品历史与保存使用云端；退出后使用本机历史。不会自动上传本地作品，模型密钥与偏好始终留在本机。
      </p>
      {!supabase ? (
        <p>尚未配置云端连接，当前仅使用本地存储。</p>
      ) : user ? (
        <>
          <p className="account-email">已登录：{user.email}</p>
          <button className="secondary" disabled={busy || disabled} onClick={logout}>
            {busy ? '处理中…' : '退出云端账号'}
          </button>
        </>
      ) : (
        <form onSubmit={login}>
          <label htmlFor="cloud-email">邮箱</label>
          <input
            id="cloud-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy || disabled}
          />
          <label htmlFor="cloud-password">密码</label>
          <input
            id="cloud-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy || disabled}
          />
          <p className="subtle">
            仅限管理员预先建立并授权的账号，不提供注册入口。共享设备使用后请退出。
          </p>
          <button className="primary" disabled={busy || disabled} type="submit">
            {busy ? '登录中…' : '登录云端'}
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
