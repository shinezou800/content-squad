import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { loadSettings, saveSettings, type Settings } from './settings';
import { fetchModels } from './pipeline/models';
import { registry as builtInRegistry } from './squads/registry';
import { midRegistry as builtInMids } from './squads/mid';
import { getRegistry, getMidRegistry, validateMidMembers } from './squads/custom';
import { isCheckStep, pipelineCards, squadName, stepPresentation } from './squads/presentation';
import { runContentLine } from './pipeline/selection';
import { LocalStorageRuns, SupabaseRuns, type Run } from './storage';
import { supabase } from './storage/supabase';
import type { User } from '@supabase/supabase-js';
import { CloudSettings } from './CloudSettings';
import { CustomSquadSettings } from './CustomSquadSettings';
import { hasReachedFinalStep } from './pipeline/runner';
import { poolCodes } from './data/market';
import './style.css';
const localRuns = new LocalStorageRuns();
function App() {
  const [, setRegistryVersion] = useState(0);
  const registry = getRegistry();
  const midRegistry = getMidRegistry();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const ownerId = user?.id;
  const storage = useMemo(
    () => (supabase && ownerId ? new SupabaseRuns(supabase, ownerId) : localRuns),
    [ownerId],
  );
  const activeStorage = useRef(storage);
  activeStorage.current = storage;
  const [page, setPage] = useState<'work' | 'settings' | 'history'>('work');
  const [settings, setSettings] = useState(loadSettings);
  const [topic, setTopic] = useState('');
  const [selectedSquad, setSelectedSquad] = useState('zangu-shouxi');
  const [run, setRun] = useState<Run>();
  const [history, setHistory] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [settingsSaveError, setSettingsSaveError] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let changed = false;
    let currentUserId: string | undefined;
    function applyUser(nextUser: User | null) {
      if (currentUserId !== nextUser?.id) {
        setTopic('');
        setRun(undefined);
        setHistory([]);
        setMessage('');
      }
      currentUserId = nextUser?.id;
      setUser(nextUser);
      setAuthReady(true);
    }
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      changed = true;
      if (active) {
        applyUser(session?.user ?? null);
      }
    });
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active || changed) return;
        if (error) setMessage('云端登录状态读取失败，当前使用本地历史。');
        applyUser(data.session?.user ?? null);
      })
      .catch(() => {
        if (active && !changed) {
          setMessage('云端登录状态读取失败，当前使用本地历史。');
          setAuthReady(true);
        }
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!authReady) return;
    let active = true;
    setRun(undefined);
    setHistory([]);
    storage
      .list()
      .then((rows) => {
        if (active) setHistory(rows);
      })
      .catch((error) => {
        if (active)
          setMessage(
            storage === localRuns
              ? '本地历史读取失败，请检查浏览器存储。'
              : (error as Error).message,
          );
      });
    return () => {
      active = false;
    };
  }, [storage, authReady]);
  async function persist(value: Run) {
    await storage.save(value);
    const rows = await storage.list();
    if (activeStorage.current === storage) setHistory(rows);
  }
  async function start() {
    if (lock.current || !authReady) return;
    const runSettings = loadSettings();
    try {
      if (!topic.trim()) throw new Error('先写下这次想聊的选题。');
      if (!Object.hasOwn(registry, selectedSquad) && !Object.hasOwn(midRegistry, selectedSquad))
        throw new Error('内容线已删除，请选择有效内容线后运行。');
      if (Object.hasOwn(midRegistry, selectedSquad)) {
        const error = validateMidMembers(midRegistry[selectedSquad].squads, registry);
        if (error) throw new Error(error);
      }
      if (!runSettings.key.trim()) throw new Error('请先在设置中填写并保存 API 密钥。');
      poolCodes(runSettings.pool);
    } catch (e) {
      setMessage((e as Error).message);
      return;
    }
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const emit = (progress: Run) => {
        if (activeStorage.current === storage) setRun(progress);
      };
      const next = await runContentLine(selectedSquad, topic.trim(), runSettings, emit);
      if (activeStorage.current !== storage) {
        setMessage('账号状态已变化，本次运行未保存，请在当前账号重新运行。');
        return;
      }
      await persist(next);
    } catch (error) {
      setMessage(
        storage !== localRuns && error instanceof Error
          ? error.message
          : '运行或保存失败，请检查网络与浏览器存储空间。',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function updateRun(next: Run) {
    setRun(next);
    try {
      await persist(next);
    } catch (error) {
      setMessage(
        storage !== localRuns && error instanceof Error
          ? error.message
          : '保存失败，请检查本地存储空间，并及时复制正文。',
      );
    }
  }
  async function loadModels() {
    setLoadingModels(true);
    setMessage('');
    try {
      const list = await fetchModels(settings, loadSettings());
      if (!list.length) throw new Error();
      setModels(list);
      setMessage(`已载入 ${list.length} 个模型。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '模型列表加载失败，可直接填写模型名称。');
    } finally {
      setLoadingModels(false);
    }
  }
  const labels = { pending: '等候中', running: '进行中', done: '已完成', failed: '未完成' };
  return (
    <div className="shell">
      <header>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage('work');
          }}
        >
          <span className="brand-icon">攒</span>
          <span>
            内容小团<small>攒股收息 · 创作工作室</small>
          </span>
        </a>
        <span className="local-badge">● {user ? '云端工作空间' : '本地工作空间'}</span>
      </header>
      <nav aria-label="主导航">
        {(
          [
            ['work', '创作工作台'],
            ['history', '作品档案'],
            ['settings', '偏好设置'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={page === id ? 'active' : ''}
            onClick={() => {
              setPage(id);
              setMessage('');
            }}
          >
            {label}
            {id === 'history' && <span className="count">{history.length}</span>}
          </button>
        ))}
      </nav>
      <main>
        {message && (
          <div className="notice" role="status">
            {message}
          </div>
        )}
        {page === 'work' && (
          <>
            <section className="intro">
              <div className="eyebrow">一人主理，三位小伙伴</div>
              <h1>
                好内容，从一份
                <br className="mobile-break" />
                扎实的记录开始。
              </h1>
              <p>
                {Object.hasOwn(registry, selectedSquad)
                  ? registry[selectedSquad].description
                  : Object.hasOwn(midRegistry, selectedSquad)
                    ? '多条内容线依次协作，汇总快照后复核。'
                    : '内容线已删除，请重新选择。'}
              </p>
              <span className="tag">{squadName(run?.squadId ?? selectedSquad)}</span>
              <span className="tag muted">固定顺序 · 单次协作</span>
            </section>
            <section className="panel topic-panel">
              <label htmlFor="squad-choice" className="squad-label">
                选择内容线
              </label>
              <select
                id="squad-choice"
                disabled={busy}
                value={selectedSquad}
                onChange={(e) => {
                  setSelectedSquad(e.target.value);
                  setRun(undefined);
                }}
              >
                {!Object.hasOwn(registry, selectedSquad) &&
                  !Object.hasOwn(midRegistry, selectedSquad) && (
                    <option value={selectedSquad} disabled>
                      未知内容线（已删除，请重新选择）
                    </option>
                  )}
                {[
                  {
                    label: '小团',
                    values: Object.values(registry).filter((s) =>
                      Object.hasOwn(builtInRegistry, s.id),
                    ),
                  },
                  {
                    label: '中团',
                    values: Object.values(midRegistry).filter((s) =>
                      Object.hasOwn(builtInMids, s.id),
                    ),
                  },
                  {
                    label: '自定义小团',
                    values: Object.values(registry).filter(
                      (s) => !Object.hasOwn(builtInRegistry, s.id),
                    ),
                  },
                  {
                    label: '自定义中团',
                    values: Object.values(midRegistry).filter(
                      (s) => !Object.hasOwn(builtInMids, s.id),
                    ),
                  },
                ].map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.values.map((s) => (
                      <option key={s.id} value={s.id}>
                        {group.label}：{s.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <div className="section-heading">
                <h2>
                  <span className="section-number">01</span> 交给小团一个选题
                </h2>
                <span className="subtle">你来定方向</span>
              </div>
              <label htmlFor="topic" className="sr-only">
                本次选题
              </label>
              <textarea
                id="topic"
                value={topic}
                disabled={busy}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="例如：记录一下观察池里高股息公司的现金流与分红情况……"
                rows={3}
              />
              <div className="topic-bottom">
                <span className="subtle">只记录，不荐股。每个数字都要有出处。</span>
                <button className="primary" disabled={busy || !authReady} onClick={start}>
                  {busy
                    ? Object.hasOwn(midRegistry, selectedSquad)
                      ? '中团正在协作…'
                      : '小团正在协作…'
                    : run?.steps.some((s) => s.status === 'failed')
                      ? '重新运行整条内容线 ↗'
                      : '开始本次创作 ↗'}
                </button>
              </div>
            </section>
            <section className="pipeline-section">
              <div className="section-heading">
                <h2>
                  <span className="section-number">02</span>{' '}
                  {Object.hasOwn(midRegistry, run?.squadId ?? selectedSquad)
                    ? '中团协作线'
                    : '小团协作线'}
                </h2>
                <span className="subtle">依次推进，不跳步</span>
              </div>
              <div className="pipeline">
                {pipelineCards(run?.squadId ?? selectedSquad, run?.steps).map((role) => {
                  const step = run?.steps.find((s) => s.roleId === role.id);
                  const final = role.id === 'final';
                  const ready = hasReachedFinalStep(run);
                  return (
                    <div
                      key={role.id}
                      className={`role-card ${step?.status === 'running' ? 'running' : ''}`}
                    >
                      <div className={'avatar avatar-' + role.avatarIndex}>{role.avatar}</div>
                      <div className="role-body">
                        <h3>
                          {role.name}
                          <span>{role.title}</span>
                        </h3>
                        <p>{role.description}</p>
                        <span className={`status ${step?.status || ''}`}>
                          {final
                            ? ready
                              ? '等待拍板'
                              : '等候中'
                            : step
                              ? labels[step.status]
                              : '等候中'}
                        </span>
                      </div>
                      {step?.error && <p className="error">{step.error}</p>}
                    </div>
                  );
                })}
              </div>
            </section>
            {run && (
              <>
                {run.snapshot.length > 0 && (
                  <section className="panel">
                    <h2>
                      数据快照 <span className="subtle">所有数字的共同底稿</span>
                    </h2>
                    <p className="subtle">
                      本次运行的归档快照；修改股票池后需重新运行，不会改写历史记录。
                      股息率采用近十二月每股现金分红 ÷
                      腾讯现价；手动分红标为“主人手动提供”，不代表接口核实。行情时间与抓取时间可能不同。
                    </p>
                    {run.snapshot.map((stock) => (
                      <details key={stock.code}>
                        <summary>
                          {stock.name}{' '}
                          <span className="subtle">
                            {stock.code} · {stock.category ?? '未标记'} · 展开来源明细
                          </span>
                        </summary>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>字段</th>
                                <th>数值</th>
                                <th>来源 / 抓取时间</th>
                              </tr>
                            </thead>
                            <tbody>
                              {stock.fields.map((f) => (
                                <tr key={f.label}>
                                  <td>{f.label}</td>
                                  <td>
                                    {typeof f.value === 'number'
                                      ? Number(f.value.toFixed(4)).toLocaleString('zh-CN')
                                      : f.value}
                                    {typeof f.value === 'number' ? f.unit : ''}
                                  </td>
                                  <td>
                                    {f.source.startsWith('主人手动提供') ? (
                                      <span>
                                        主人手动提供
                                        {f.source.includes('；价格来源：')
                                          ? '；现价：腾讯行情'
                                          : ''}
                                      </span>
                                    ) : (
                                      <a
                                        href={f.source.split('；')[0]}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {f.source.includes('gtimg') &&
                                        !f.source.includes('eastmoney')
                                          ? '腾讯行情'
                                          : '东方财富'}
                                      </a>
                                    )}
                                    <small>{new Date(f.fetchedAt).toLocaleString('zh-CN')}</small>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    ))}
                  </section>
                )}
                {run.steps
                  .filter((s) => s.output)
                  .map((step) => (
                    <details className="panel" key={step.roleId} open={isCheckStep(step.roleId)}>
                      <summary>
                        {stepPresentation(step.roleId, run.squadId).name} · 工作记录
                      </summary>
                      <pre className={isCheckStep(step.roleId) ? 'review' : ''}>{step.output}</pre>
                    </details>
                  ))}
                {hasReachedFinalStep(run) && (
                  <section className="panel">
                    <div className="section-heading">
                      <h2>
                        <span className="section-number">03</span> 主理人审稿
                      </h2>
                      <span className="tag">
                        {run.status === 'approved' ? '已拍板 · 已定稿' : '待审稿'}
                      </span>
                    </div>
                    <p className="subtle">
                      核对记录已附在文末。请逐项复核、编辑并移除不用于发布的内容；编辑后需要重新拍板。
                    </p>
                    <label htmlFor="final" className="sr-only">
                      可编辑的最终正文
                    </label>
                    <textarea
                      id="final"
                      className="final-text"
                      value={run.finalText}
                      onChange={(e) => {
                        setRun({ ...run, finalText: e.target.value, status: 'draft' });
                      }}
                      onBlur={() => {
                        void updateRun(run);
                      }}
                    />
                    <div className="actions">
                      <button
                        className="secondary"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(run.finalText);
                            setMessage('正文已复制。');
                          } catch {
                            setMessage('复制失败，请长按正文手动复制。');
                          }
                        }}
                      >
                        复制正文
                      </button>
                      <button
                        className="primary"
                        disabled={run.status === 'approved'}
                        onClick={() => updateRun({ ...run, status: 'approved' })}
                      >
                        拍板 / 定稿 ✓
                      </button>
                    </div>
                  </section>
                )}
              </>
            )}
            {!run && (
              <div className="empty-note">
                <span>✧</span>
                <h3>把想法交给小团，把判断留给自己。</h3>
                <p>完成设置后开始第一篇记录，成稿将出现在这里。</p>
                <button className="text-button" onClick={() => setPage('settings')}>
                  先去配置密钥与观察池 →
                </button>
              </div>
            )}
          </>
        )}
        {page === 'settings' && (
          <>
            <section className="intro">
              <div className="eyebrow">只属于这个浏览器</div>
              <h1>把工作台调成你的习惯。</h1>
              <p>密钥与偏好仅保存在本机，不进入作品档案或云端存储。</p>
            </section>
            <form
              className="panel settings"
              onSubmit={(e) => {
                e.preventDefault();
                if (busy) return;
                setSettingsSaveError('');
                setMessage('');
                try {
                  poolCodes(settings.pool);
                  if (!settings.model.trim()) throw new Error('请填写模型名称。');
                  const poolChanged = loadSettings().pool !== settings.pool;
                  saveSettings(settings);
                  setSettings(loadSettings());
                  if (poolChanged) setRun(undefined);
                  setMessage(
                    poolChanged
                      ? '设置已保存。旧快照已收起，请重新运行以使用新股票池。'
                      : '设置已保存在此浏览器。',
                  );
                } catch (e) {
                  setSettingsSaveError((e as Error).message);
                }
              }}
            >
              <h2>模型连接</h2>
              <label>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={settings.useProxy}
                  onChange={(e) => setSettings({ ...settings, useProxy: e.target.checked })}
                />
                经云端转发（接口不允许浏览器直连时勾选）
              </label>
              <p className="subtle">需要先登录；密钥随每次请求转发，不在云端存储。</p>
              <label htmlFor="base-url">API 地址</label>
              <input
                id="base-url"
                value={settings.baseUrl}
                onChange={(e) => {
                  setSettings({ ...settings, baseUrl: e.target.value });
                  setModels([]);
                }}
              />
              <p className="subtle">
                可改为其他 OpenAI 兼容接口（如 AMD Token Factory）；更改后请填写新接口的密钥和模型名称。
              </p>
              <label htmlFor="key">API 密钥</label>
              <input
                id="key"
                type="password"
                autoComplete="off"
                value={settings.key}
                onChange={(e) => setSettings({ ...settings, key: e.target.value })}
                placeholder="在此输入密钥"
              />
              <p className="subtle">
                密钥仅发送到此处填写的 API 地址，请勿在共享设备保存。快照与选题会发送给所选模型。
              </p>
              <label htmlFor="model-list">模型列表</label>
              <div className="model-row">
                <select
                  id="model-list"
                  value={settings.model}
                  onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                >
                  {[...new Set([settings.model, ...models])].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="secondary"
                  disabled={loadingModels}
                  onClick={loadModels}
                >
                  {loadingModels ? '加载中…' : '载入模型列表'}
                </button>
              </div>
              <label htmlFor="model">模型名称（可手动覆盖）</label>
              <input
                id="model"
                value={settings.model}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
              />
              <p className="subtle">免费模型的可用性由服务方决定，可在此填写其他模型标识。</p>
              <hr />
              <h2>观察池记录</h2>
              <label htmlFor="pool">股票池 · 每行代码、名称、持仓或观察池</label>
              <textarea
                id="pool"
                rows={14}
                value={settings.pool}
                disabled={busy}
                onChange={(e) => setSettings({ ...settings, pool: e.target.value })}
              />
              <p className="subtle">
                默认四只持仓、十只观察股。A 股用六位代码，港股用五位代码（如
                00883），港股行情以港元计。每行末尾可标记“持仓”或“观察池”；未标记时视为观察池。保存后，新运行仅抓取此列表。
                可附加“分红TTM=1.49港元”覆盖近十二月每股现金分红，币种须与行情一致；来源标为“主人手动提供”。默认中海油使用此数值。
              </p>
              {settingsSaveError && (
                <p id="settings-save-error" className="error" role="alert">
                  {settingsSaveError}
                </p>
              )}
              <button
                className="primary"
                type="submit"
                disabled={busy}
                aria-describedby={settingsSaveError ? 'settings-save-error' : undefined}
              >
                保存本地设置
              </button>
            </form>
            <CustomSquadSettings
              disabled={busy}
              onChange={() => setRegistryVersion((value) => value + 1)}
            />
            <CloudSettings user={user} disabled={busy || !authReady} />
          </>
        )}
        {page === 'history' && (
          <>
            <section className="intro">
              <div className="eyebrow">每一次认真记录，都值得留存</div>
              <h1>作品档案</h1>
              <p>
                {user
                  ? '当前使用云端历史，退出后可查看本机作品。'
                  : '仅保存在当前浏览器。清除网站数据会同时删除记录。'}
              </p>
            </section>
            {!history.length ? (
              <div className="empty-note">还没有作品，去工作台写下第一个选题吧。</div>
            ) : (
              history.map((item) => (
                <button
                  className="history-card panel"
                  disabled={busy}
                  key={item.id}
                  onClick={() => {
                    setRun(item);
                    setTopic(item.topic);
                    setSelectedSquad(item.squadId);
                    setPage('work');
                  }}
                >
                  <span className="tag">
                    {item.status === 'approved'
                      ? '已定稿'
                      : item.steps.some((s) => s.status === 'failed')
                        ? '运行中断'
                        : '草稿'}
                  </span>
                  <h2>{item.topic}</h2>
                  <p className="subtle">
                    {new Date(item.createdAt).toLocaleString('zh-CN')} · {squadName(item.squadId)} →
                  </p>
                </button>
              ))
            )}
          </>
        )}
      </main>
      <footer>
        记录有依据，决策有边界。<span>模拟盘记录 · 非投资建议</span>
      </footer>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
