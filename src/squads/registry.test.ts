import { afterEach, expect, it, vi } from 'vitest';
import { registry } from './registry';
import { runPipeline } from '../pipeline/runner';
import { loadSettings, saveSettings } from '../settings';
import { complete } from '../pipeline/llm';
import { checkDraft } from '../pipeline/checks';
vi.mock('../pipeline/llm', () => ({ complete: vi.fn().mockResolvedValue('正文') }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('主人提供的港元TTM金额及推算股息率进入小稿和小核快照，并可作确定性核对事实', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('gtimg')) {
        const fields = Array(65).fill('');
        fields[1] = 'CNOOC';
        fields[2] = '00883';
        fields[3] = '21.7';
        return {
          ok: true,
          arrayBuffer: async () =>
            new TextEncoder().encode(`v_hk00883="${fields.join('~')}";`).buffer,
        };
      }
      return { ok: true, json: async () => ({ success: false }) };
    }),
  );
  const run = await runPipeline(
    registry['zangu-shouxi'],
    '记录分红',
    { baseUrl: 'https://example.com/v1', key: 'test', model: 'test', pool: '00883 中海油 观察池 分红TTM=1.49港元' },
    () => {},
  );
  expect(run.steps.every((step) => step.status === 'done')).toBe(true);
  for (const call of vi.mocked(complete).mock.calls) {
    const payload = JSON.parse(call[2]);
    const cash = payload.snapshot[0].fields.find((f: { label: string }) =>
      f.label.startsWith('近十二月每股现金分红'),
    );
    expect(cash).toMatchObject({ value: 1.49, unit: '港元', source: '主人手动提供' });
    expect(
      payload.snapshot[0].fields.find((f: { label: string }) => f.label.startsWith('股息率')).value,
    ).toBeCloseTo((1.49 / 21.7) * 100);
  }
  expect(vi.mocked(complete)).toHaveBeenCalledTimes(3);
  expect(
    checkDraft('每股分红1.49港元', run.snapshot).some((flag) =>
      flag.问题.startsWith('数字未在快照'),
    ),
  ).toBe(false);
  expect(
    checkDraft('每股分红1.49元', run.snapshot).some((flag) => flag.问题.startsWith('数字未在快照')),
  ).toBe(true);
});
it('已保存的自定义池完整传入流水线及真实解析器，只请求池内代码，传递持仓分类', async () => {
  let raw = '';
  vi.stubGlobal('localStorage', {
    getItem: () => raw || null,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
  });
  saveSettings({
    baseUrl: 'https://example.com/v1',
    key: 'test-key',
    model: 'test-model',
    pool: '000538 云南白药 持仓\n601318 中国平安 观察池',
  });
  const fetcher = vi.fn(async (url: string) => {
    if (url.startsWith('https://qt.gtimg.cn/')) {
      const text = ['601318', '000538']
        .map((code) => {
          const f = Array(65).fill('');
          f[1] = code;
          f[2] = code;
          f[3] = '50';
          return `v_${code}="${f.join('~')}";`;
        })
        .join('\n');
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode(text).buffer };
    }
    const report = new URL(url).searchParams.get('reportName');
    return {
      ok: true,
      json: async () => ({
        success: true,
        result: {
          data:
            report === 'RPT_SHAREBONUS_DET'
              ? []
              : [
                  {
                    REPORT_DATE_NAME: '最新报告',
                    TOTALOPERATEREVE: null,
                    PARENTNETPROFIT: 0,
                    EPSJB: null,
                    ROEJQ: 8,
                  },
                ],
        },
      }),
    };
  });
  vi.stubGlobal('fetch', fetcher);
  const run = await runPipeline(registry['zangu-shouxi'], '选题', loadSettings(), () => {});
  expect(run.steps.every((step) => step.status === 'done')).toBe(true);
  expect(run.snapshot.map((stock) => [stock.code, stock.category])).toEqual([
    ['000538', '持仓'],
    ['601318', '观察池'],
  ]);
  expect(fetcher.mock.calls[0][0]).toBe('https://qt.gtimg.cn/q=sz000538,sh601318');
  expect(fetcher.mock.calls).toHaveLength(5);
  expect(run.snapshot[0].fields.find((f) => f.label === '营业收入')?.value).toBe('缺失');
  expect(run.snapshot[0].fields.find((f) => f.label === '归母净利润')?.value).toBe(0);
  const draftPayload = JSON.parse(vi.mocked(complete).mock.calls[1][2]);
  expect(draftPayload.snapshot.map((stock: { category: string }) => stock.category)).toEqual([
    '持仓',
    '观察池',
  ]);
});
