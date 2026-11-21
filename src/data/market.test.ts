import { afterEach, expect, it, vi } from 'vitest';
import {
  parseQuotes,
  parseFinancial,
  dividendYield,
  poolCodes,
  poolEntries,
  fetchSnapshot,
} from './market';
afterEach(() => vi.unstubAllGlobals());
it('解析腾讯字段并拒绝空或损坏响应', () => {
  const fields = Array(65).fill('');
  fields[1] = '中国神华';
  fields[2] = '601088';
  fields[3] = '52.00';
  fields[64] = '3.87';
  expect(parseQuotes(`v_sh601088="${fields.join('~')}";`)[0][64]).toBe('3.87');
  expect(() => parseQuotes('')).toThrow();
  expect(() => parseQuotes('v_sh601088="1~2"')).toThrow();
});
it('解析财报及错误响应', () => {
  expect(parseFinancial({ success: true, result: { data: [{ EPSJB: 2.062 }] } }).EPSJB).toBe(2.062);
  expect(() => parseFinancial({ success: true, result: { data: [] } })).toThrow();
  expect(() => parseFinancial({ success: false })).toThrow();
});
it('仅计算近一年已实施分红，每十股派息转为每股', () => {
  const data = [
    ['2026-10-26', 9.8, '实施分配'],
    ['2026-07-13', 10.3, '实施分配'],
    ['2025-11-10', 9.8, '实施分配'],
    ['2027-01-01', 10, '实施分配'],
    ['2026-11-01', 10, '董事会预案'],
  ].map(([EX_DIVIDEND_DATE, PRETAX_BONUS_RMB, ASSIGN_PROGRESS]) => ({
    EX_DIVIDEND_DATE,
    PRETAX_BONUS_RMB,
    ASSIGN_PROGRESS,
  }));
  expect(dividendYield({ success: true, result: { data } }, 52, new Date('2026-11-21'))).toEqual({
    cash: 2.01,
    yield: (2.01 / 52) * 100,
  });
  expect(dividendYield({ success: true, result: { data: [] } }, 52).yield).toBe(0);
  expect(() => dividendYield({}, 52)).toThrow();
});
it('股票池去重和校验', () => {
  expect(poolCodes('601088 中国神华\n601088')).toEqual(['601088']);
  expect(() => poolCodes('')).toThrow();
  expect(() => poolCodes('hello')).toThrow();
  expect(poolEntries('601318 中国平安 持仓\n00883 中海油 观察池\n601318')).toEqual([
    { code: '601318', category: '持仓' },
    { code: '00883', category: '观察池' },
  ]);
  expect(poolCodes('  \n00883 中海油\n  ')).toEqual(['00883']);
});
function quote(code: string) {
  const fields = Array(80).fill('');
  fields[1] = code;
  fields[2] = code;
  fields[3] = '21.7';
  fields[45] = '10314';
  fields[46] = 'CNOOC';
  return `v_hk${code}="${fields.join('~')}";`;
}
it.each([true, false])(
  '港股行情用 hk 与港元，财报按源币种映射，分红不猜测：财报可用=%s',
  async (available) => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('gtimg'))
        return {
          ok: true,
          arrayBuffer: async () => new TextEncoder().encode(quote('00883')).buffer,
        };
      return {
        ok: true,
        json: async () =>
          available
            ? {
                success: true,
                result: {
                  data: [
                    {
                      REPORT_TYPE: '最新报告',
                      CURRENCY: 'HKD',
                      OPERATE_INCOME: 500,
                      HOLDER_PROFIT: null,
                      BASIC_EPS: 2.51,
                      ROE_AVG: 14.4,
                    },
                  ],
                },
              }
            : { success: false },
      };
    });
    vi.stubGlobal('fetch', fetcher);
    const [stock] = await fetchSnapshot(['00883']);
    expect(fetcher.mock.calls[0][0]).toBe('https://qt.gtimg.cn/q=hk00883');
    expect(fetcher.mock.calls).toHaveLength(2);
    expect(stock.fields.find((f) => f.label === '现价')).toMatchObject({
      value: 21.7,
      unit: '港元',
    });
    expect(stock.fields.find((f) => f.label === '总市值')).toMatchObject({
      value: 10314,
      unit: '亿港元',
    });
    expect(stock.fields.find((f) => f.label === '市净率')?.value).toBe('缺失');
    expect(stock.fields.find((f) => f.label === '营业收入')?.value).toBe(
      available ? 500 : '缺失（财报币种未核实）',
    );
    expect(stock.fields.find((f) => f.label === '归母净利润')?.value).toMatch(/^缺失/);
    expect(
      stock.fields.find((f) => f.label === '股息率（近十二月已实施分红÷现价）')?.value,
    ).toMatch(/^缺失/);
  },
);
it('行情返回相同条数但代码不一致时拒绝，不静默使用其他股票', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(quote('00001')).buffer,
    }),
  );
  await expect(fetchSnapshot(['00883'])).rejects.toThrow('代码不匹配');
});
it('手动分红解析为每股TTM金额，未标记的自定义池不隐式覆盖', () => {
  expect(poolEntries('00883 中海油 观察池 分红TTM=1.49港元')[0]).toMatchObject({
    manualDividend: 1.49,
  });
  expect(poolEntries('601318 中国平安 持仓 分红TTM=0元')[0]).toMatchObject({ manualDividend: 0 });
  expect(poolEntries('00883 中海油')[0].manualDividend).toBeUndefined();
});
it.each([
  '分红TTM=-1港元',
  '分红TTM=NaN港元',
  '分红TTM=1.49元',
  '分红TTM=1.49',
  '分红TTM=1港元 分红TTM=2港元',
])('拒绝无效或币种不符的手动分红：%s', (override) => {
  expect(() => poolEntries(`00883 中海油 ${override}`)).toThrow('手动分红');
});
it.each([
  ['00883', 1.49, '港元'],
  ['00883', 0, '港元'],
  ['601318', 2.73, '元'],
])('手动分红覆盖按代码生效并保留单位与来源：%s %s', async (code, cash, currency) => {
  const fetcher = vi.fn(async (url: string) =>
    url.includes('gtimg')
      ? { ok: true, arrayBuffer: async () => new TextEncoder().encode(quote(code)).buffer }
      : { ok: true, json: async () => ({ success: true, result: { data: [{}] } }) },
  );
  vi.stubGlobal('fetch', fetcher);
  const [stock] = await fetchSnapshot([code], { [code]: cash });
  expect(fetcher.mock.calls).toHaveLength(2);
  expect(stock.fields.find((f) => f.label.startsWith('近十二月每股现金分红'))).toMatchObject({
    value: cash,
    unit: currency,
    source: '主人手动提供',
  });
  const yieldField = stock.fields.find((f) => f.label.startsWith('股息率'))!;
  expect(yieldField.value).toBeCloseTo((cash / 21.7) * 100);
  expect(yieldField.source).toContain('主人手动提供；价格来源：https://qt.gtimg.cn/');
  expect(stock.fields.find((f) => f.label === '市净率')?.value).toBe('缺失');
  expect(stock.fields.find((f) => f.label === '营业收入')?.value).toMatch(/^缺失/);
});
it.each([-1, NaN, Infinity])('抓取前拒绝无效手动金额：%s', async (value) => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(fetchSnapshot(['00883'], { '00883': value })).rejects.toThrow('手动分红');
  expect(fetcher).not.toHaveBeenCalled();
});
