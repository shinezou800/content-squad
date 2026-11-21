export type Field = {
  label: string;
  value: string | number;
  unit?: string;
  source: string;
  fetchedAt: string;
};
export type PoolCategory = '持仓' | '观察池';
export type Snapshot = { code: string; name: string; category?: PoolCategory; fields: Field[] }[];
export const legacyDefaultPool =
  '601088 中国神华\n600900 长江电力\n600036 招商银行\n601398 工商银行\n601939 建设银行\n601288 农业银行\n601988 中国银行\n601857 中国石油\n600941 中国移动\n601006 大秦铁路\n000895 双汇发展\n000651 格力电器\n000333 美的集团\n600028 中国石化';
export const previousDefaultPool = [
  '601318 中国平安 持仓',
  '601166 兴业银行 持仓',
  '600690 海尔智家 持仓',
  '000538 云南白药 持仓',
  '600036 招商银行 观察池',
  '600887 伊利股份 观察池',
  '601398 工商银行 观察池',
  '600377 宁沪高速 观察池',
  '600900 长江电力 观察池',
  '000333 美的集团 观察池',
  '601088 中国神华 观察池',
  '600941 中国移动 观察池',
  '600050 中国联通 观察池',
  '00883 中海油 观察池',
].join('\n');
export const defaults = previousDefaultPool.replace(
  '00883 中海油 观察池',
  '00883 中海油 观察池 分红TTM=1.49港元',
);
export function poolEntries(pool: string) {
  const entries = pool
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [code, ...rest] = line.split(/\s+/);
      const category: PoolCategory = rest.includes('持仓') ? '持仓' : '观察池';
      const overrides = rest.filter((token) => /^分红TTM/i.test(token));
      if (!overrides.length) return { code, category };
      const match = overrides[0].match(/^分红TTM=(\d+(?:\.\d+)?)(港元|元)$/i);
      const manualDividend = Number(match?.[1]);
      if (
        overrides.length !== 1 ||
        !match ||
        !Number.isFinite(manualDividend) ||
        match[2] !== (code.length === 5 ? '港元' : '元')
      )
        throw new Error('手动分红请填写分红TTM=非负金额及行情币种，如分红TTM=1.49港元。');
      return { code, category, manualDividend };
    });
  if (!entries.length || entries.some(({ code }) => !/^(?:[06]\d{5}|\d{5})$/.test(code)))
    throw new Error('股票池请每行填写六位 A 股或五位港股代码及名称。');
  return entries.filter(
    (entry, index) => entries.findIndex((e) => e.code === entry.code) === index,
  );
}
export function poolCodes(pool: string) {
  return poolEntries(pool).map((entry) => entry.code);
}
export function parseQuotes(text: string) {
  const rows = [...text.matchAll(/v_\w+="([^"]+)"/g)].map((m) => m[1].split('~'));
  if (
    !rows.length ||
    rows.some((f) => f.length < 47 || !Number.isFinite(Number(f[3])) || Number(f[3]) <= 0)
  )
    throw new Error('腾讯行情格式异常或暂无有效价格。');
  return rows;
}
export function parseFinancial(json: unknown): Record<string, string | number> {
  const j = json as { success?: boolean; result?: { data?: Record<string, string | number>[] } };
  const row = j.result?.data?.[0];
  if (!j.success || !row) throw new Error('东方财富未返回财务数据。');
  return row;
}
export function dividendYield(json: unknown, price: number, asOf = new Date()) {
  const j = json as {
    success?: boolean;
    result?: {
      data?: { EX_DIVIDEND_DATE: string; PRETAX_BONUS_RMB: number; ASSIGN_PROGRESS: string }[];
    };
  };
  if (!j.success || !j.result?.data || price <= 0)
    throw new Error('东方财富分红数据不可用，无法计算股息率。');
  const end = asOf.getTime();
  const start = new Date(asOf);
  start.setFullYear(start.getFullYear() - 1);
  const cash = Number(
    j.result.data
      .filter((r) => {
        const t = new Date(r.EX_DIVIDEND_DATE?.replace(' ', 'T')).getTime();
        return r.ASSIGN_PROGRESS === '实施分配' && t > start.getTime() && t <= end;
      })
      .reduce((sum, r) => sum + Number(r.PRETAX_BONUS_RMB || 0) / 10, 0)
      .toFixed(8),
  );
  return { cash, yield: (cash / price) * 100 };
}
export const eastUrl = (report: string, code: string, columns = 'ALL', size = 100) =>
  `https://datacenter.eastmoney.com/securities/api/data/v1/get?${new URLSearchParams({ reportName: report, columns, filter: `(SECURITY_CODE="${code}")`, pageNumber: '1', pageSize: String(size), sortColumns: 'REPORT_DATE', sortTypes: '-1' })}`;
export async function getJson(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`数据请求失败（${r.status}），请稍后重试。`);
  return r.json();
}
export async function fetchSnapshot(
  codes: string[],
  manualDividends: Record<string, number> = {},
): Promise<Snapshot> {
  if (Object.values(manualDividends).some((value) => !Number.isFinite(value) || value < 0))
    throw new Error('手动分红必须为非负有限数值。');
  const quoteUrl = `https://qt.gtimg.cn/q=${codes.map((c) => `${c.length === 5 ? 'hk' : c.startsWith('6') ? 'sh' : 'sz'}${c}`).join(',')}`;
  const res = await fetch(quoteUrl);
  if (!res.ok) throw new Error('腾讯行情请求失败。');
  const rows = parseQuotes(new TextDecoder('gbk').decode(await res.arrayBuffer()));
  const byCode = new Map(rows.map((row) => [row[2], row]));
  if (
    byCode.size !== codes.length ||
    rows.length !== codes.length ||
    codes.some((code) => !byCode.has(code))
  )
    throw new Error('部分股票行情缺失或代码不匹配，请检查股票池。');
  return Promise.all(
    codes.map(async (code) => {
      const f = byCode.get(code)!;
      const hk = code.length === 5;
      const currency = hk ? '港元' : '元';
      const manualDividend = manualDividends[code];
      const manual = manualDividend !== undefined;
      const financialUrl = eastUrl(
        hk ? 'RPT_HKF10_FN_MAININDICATOR' : 'RPT_F10_FINANCE_MAINFINADATA',
        f[2],
        hk
          ? 'SECURITY_CODE,REPORT_TYPE,CURRENCY,OPERATE_INCOME,HOLDER_PROFIT,BASIC_EPS,ROE_AVG'
          : 'SECURITY_CODE,REPORT_DATE_NAME,TOTALOPERATEREVE,PARENTNETPROFIT,EPSJB,ROEJQ',
        1,
      );
      const bonusUrl = eastUrl('RPT_SHAREBONUS_DET', f[2]);
      const financial = getJson(financialUrl).then(parseFinancial);
      const [finance, bonusJson] = await Promise.all([
        hk ? financial.catch(() => ({}) as Record<string, string | number>) : financial,
        hk || manual ? Promise.resolve(null) : getJson(bonusUrl),
      ]);
      const now = new Date();
      const dividend = manual
        ? { cash: manualDividend, yield: (manualDividend / Number(f[3])) * 100 }
        : hk
          ? null
          : dividendYield(bonusJson, Number(f[3]), now);
      const dividendSource = manual ? '主人手动提供' : hk ? financialUrl : bonusUrl;
      const fields: Field[] = [];
      const add = (label: string, value: string | number, unit: string, source: string) =>
        fields.push({ label, value, unit, source, fetchedAt: now.toISOString() });
      for (const [label, index, unit] of [
        ['现价', 3, currency],
        ['前收盘', 4, currency],
        ['涨跌幅', 32, '%'],
        ['市盈率', 39, '倍'],
        ['市净率', 46, '倍'],
        ['总市值', 45, hk ? '亿港元' : '亿元'],
      ] as const)
        add(
          label,
          f[index] && Number.isFinite(Number(f[index])) ? Number(f[index]) : '缺失',
          unit,
          quoteUrl,
        );
      add('行情时间', f[30], '', quoteUrl);
      add(
        manual ? '近十二月每股现金分红（主人手动提供）' : '近十二月每股现金分红（税前）',
        dividend?.cash ?? '缺失（港股分红口径未核实）',
        currency,
        dividendSource,
      );
      add(
        '股息率（近十二月已实施分红÷现价）',
        dividend?.yield ?? '缺失（港股分红口径未核实）',
        '%',
        dividendSource + '；价格来源：' + quoteUrl,
      );
      const financialCurrency = hk
        ? finance.CURRENCY === 'HKD'
          ? '港元'
          : finance.CURRENCY === 'CNY'
            ? '元'
            : ''
        : '元';
      for (const [label, key, unit] of [
        ['报告期', hk ? 'REPORT_TYPE' : 'REPORT_DATE_NAME', ''],
        ['营业收入', hk ? 'OPERATE_INCOME' : 'TOTALOPERATEREVE', financialCurrency],
        ['归母净利润', hk ? 'HOLDER_PROFIT' : 'PARENTNETPROFIT', financialCurrency],
        ['每股收益', hk ? 'BASIC_EPS' : 'EPSJB', financialCurrency],
        [hk ? '净资产收益率（平均）' : '净资产收益率', hk ? 'ROE_AVG' : 'ROEJQ', '%'],
      ])
        add(
          label,
          hk && !financialCurrency && ['OPERATE_INCOME', 'HOLDER_PROFIT', 'BASIC_EPS'].includes(key)
            ? '缺失（财报币种未核实）'
            : (finance[key] ?? '缺失'),
          unit,
          financialUrl,
        );
      return { code: f[2], name: f[1], fields };
    }),
  );
}
