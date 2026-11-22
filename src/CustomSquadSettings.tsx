import { useState } from 'react';
import {
  createCustomId,
  getRegistry,
  loadCustomSquads,
  loadCustomMids,
  saveCustomSquads,
  saveCustomMids,
  parseCustomCodes,
  validateName,
  validateCodes,
  validateMidMembers,
} from './squads/custom';

export function CustomSquadSettings({
  disabled,
  onChange,
}: {
  disabled: boolean;
  onChange(): void;
}) {
  const squads = loadCustomSquads();
  const mids = loadCustomMids();
  const registry = getRegistry();
  const [lineId, setLineId] = useState<string>();
  const [name, setName] = useState('');
  const [codes, setCodes] = useState('');
  const [prompt, setPrompt] = useState('');
  const [lineError, setLineError] = useState('');
  const [midId, setMidId] = useState<string>();
  const [midName, setMidName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [midError, setMidError] = useState('');
  function resetLine() {
    setLineId(undefined);
    setName('');
    setCodes('');
    setPrompt('');
    setLineError('');
  }
  function resetMid() {
    setMidId(undefined);
    setMidName('');
    setMembers([]);
    setMidError('');
  }
  function move(index: number, offset: number) {
    const next = [...members];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setMembers(next);
  }
  return (
    <section className="custom-manager" aria-label="内容线管理">
      <h2>内容线管理</h2>
      <p className="subtle">
        定义仅保存在此浏览器，不改变股票池，不同步云端。删除后历史稿件仍保留；引用已删除小团的中团需重新编辑。
      </p>
      <div className="panel settings">
        <h3>自定义小团</h3>
        <ul className="custom-list">
          {squads.map((s) => (
            <li key={s.id}>
              <strong>{s.name}</strong>
              <p className="subtle">{s.codes.join('、')}</p>
              <div className="actions">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setLineId(s.id);
                    setName(s.name);
                    setCodes(s.codes.join('\n'));
                    setPrompt(s.extraPrompt ?? '');
                    setLineError('');
                  }}
                >
                  编辑 {s.name}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `删除「${s.name}」？历史稿件仍保留，引用它的中团需重新选择成员。`,
                      )
                    )
                      return;
                    if (!saveCustomSquads(squads.filter((item) => item.id !== s.id))) {
                      setLineError('保存失败，请检查浏览器存储空间。');
                      return;
                    }
                    if (lineId === s.id) resetLine();
                    onChange();
                  }}
                >
                  删除 {s.name}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled) return;
            const error = validateName(name, squads, mids, lineId) || validateCodes(codes);
            if (error) {
              setLineError(error);
              return;
            }
            const item = {
              id: lineId ?? createCustomId(),
              name: name.trim(),
              codes: parseCustomCodes(codes).codes,
              extraPrompt: prompt,
            };
            const next = lineId
              ? squads.map((s) => (s.id === lineId ? item : s))
              : [...squads, item];
            if (!saveCustomSquads(next)) {
              setLineError('保存失败，请检查浏览器存储空间。');
              return;
            }
            resetLine();
            onChange();
          }}
        >
          <fieldset disabled={disabled}>
            <legend>{lineId ? '编辑小团' : '新建小团'}</legend>
            <label htmlFor="custom-name">名称</label>
            <input id="custom-name" value={name} onChange={(e) => setName(e.target.value)} />
            <label htmlFor="custom-codes">股票代码</label>
            <textarea
              id="custom-codes"
              rows={4}
              value={codes}
              onChange={(e) => setCodes(e.target.value)}
            />
            <p className="subtle">
              每行一个，或用逗号、空格分隔。A 股六位，港股五位；重复代码自动去重。
            </p>
            <label htmlFor="custom-prompt">补充提示词（可选）</label>
            <textarea
              id="custom-prompt"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <p className="subtle">只追加到小稿提示词末尾</p>
            {lineError && (
              <p className="error" role="alert">
                {lineError}
              </p>
            )}
            <div className="actions">
              <button className="primary" type="submit">
                保存内容线
              </button>
              <button type="button" onClick={resetLine}>
                取消编辑小团
              </button>
            </div>
          </fieldset>
        </form>
      </div>
      <div className="panel settings">
        <h3>自定义中团</h3>
        <ul className="custom-list">
          {mids.map((m) => (
            <li key={m.id}>
              <strong>{m.name}</strong>
              <p className="subtle">
                {m.squads
                  .map((id) => (Object.hasOwn(registry, id) ? registry[id].name : '未知内容线'))
                  .join(' → ')}
              </p>
              <div className="actions">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setMidId(m.id);
                    setMidName(m.name);
                    setMembers(m.squads);
                    setMidError('');
                  }}
                >
                  编辑 {m.name}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (!window.confirm(`删除「${m.name}」？历史稿件仍保留。`)) return;
                    if (!saveCustomMids(mids.filter((item) => item.id !== m.id))) {
                      setMidError('保存失败，请检查浏览器存储空间。');
                      return;
                    }
                    if (midId === m.id) resetMid();
                    onChange();
                  }}
                >
                  删除 {m.name}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled) return;
            const error =
              validateName(midName, squads, mids, midId) || validateMidMembers(members, registry);
            if (error) {
              setMidError(error);
              return;
            }
            const item = {
              id: midId ?? createCustomId(true),
              name: midName.trim(),
              squads: members,
            };
            const next = midId ? mids.map((m) => (m.id === midId ? item : m)) : [...mids, item];
            if (!saveCustomMids(next)) {
              setMidError('保存失败，请检查浏览器存储空间。');
              return;
            }
            resetMid();
            onChange();
          }}
        >
          <fieldset disabled={disabled}>
            <legend>{midId ? '编辑中团' : '新建中团'}</legend>
            <label htmlFor="custom-mid-name">中团名称</label>
            <input
              id="custom-mid-name"
              value={midName}
              onChange={(e) => setMidName(e.target.value)}
            />
            <p>选择至少两条不同内容线，按勾选顺序执行：</p>
            {Object.values(registry).map((s) => (
              <label className="line-choice" key={s.id}>
                <input
                  type="checkbox"
                  checked={members.includes(s.id)}
                  onChange={(e) =>
                    setMembers(
                      e.target.checked ? [...members, s.id] : members.filter((id) => id !== s.id),
                    )
                  }
                />
                <span>{s.name}</span>
              </label>
            ))}
            <ol className="custom-list">
              {members.map((id, index) => (
                <li key={id}>
                  <span>
                    {index + 1}.{' '}
                    {Object.hasOwn(registry, id) ? registry[id].name : '未知内容线（已删除）'}
                  </span>
                  <div className="actions">
                    <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>
                      上移
                    </button>
                    <button
                      type="button"
                      disabled={index === members.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      下移
                    </button>
                    <button
                      type="button"
                      onClick={() => setMembers(members.filter((member) => member !== id))}
                    >
                      移除
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            {midError && (
              <p className="error" role="alert">
                {midError}
              </p>
            )}
            <div className="actions">
              <button className="primary" type="submit">
                保存中团
              </button>
              <button type="button" onClick={resetMid}>
                取消编辑中团
              </button>
            </div>
          </fieldset>
        </form>
      </div>
    </section>
  );
}
