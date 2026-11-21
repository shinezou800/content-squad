export type Field = { label: string; value: string | number; unit?: string; source: string; fetchedAt: string };
export type Snapshot = { code: string; name: string; fields: Field[] }[];
export const defaults = '601088 中国神华\n600900 长江电力\n600036 招商银行\n601398 工商银行\n601939 建设银行\n601288 农业银行\n601988 中国银行\n601857 中国石油\n600941 中国移动\n601006 大秦铁路\n000895 双汇发展\n000651 格力电器\n000333 美的集团\n600028 中国石化';
export function poolCodes(pool: string) {
  const codes = pool.trim().split('\n').filter(Boolean).map(l => l.trim().split(/\s+/)[0]);
  if (!codes.length || codes.some(c => !/^[06]\d{5}$/.test(c))) throw new Error('股票池请每行填写一个六位 A 股代码及名称。');
  return [...new Set(codes)];
}
export function parseQuotes(text: string) {
  const rows = [...text.matchAll(/v_\w+="([^"]+)"/g)].map(m => m[1].split('~'));
  if (!rows.length || rows.some(f => f.length < 47 || !Number.isFinite(Number(f[3])) || Number(f[3]) <= 0)) throw new Error('腾讯行情格式异常或暂无有效价格。');
  return rows;
}
export function parseFinancial(json: unknown): Record<string, string | number> {
  const j = json as { success?: boolean; result?: { data?: Record<string, string | number>[] } };
  const row = j.result?.data?.[0];
  if (!j.success || !row) throw new Error('东方财富未返回财务数据。');
  return row;
}
export function dividendYield(json: unknown, price: number, asOf = new Date()) {
  const j = json as { success?: boolean; result?: { data?: { EX_DIVIDEND_DATE: string; PRETAX_BONUS_RMB: number; ASSIGN_PROGRESS: string }[] } };
  if (!j.success || !j.result?.data || price <= 0) throw new Error('东方财富分红数据不可用，无法计算股息率。');
  const end = asOf.getTime(); const start = new Date(asOf); start.setFullYear(start.getFullYear() - 1);
  const cash = Number(j.result.data.filter(r => { const t = new Date(r.EX_DIVIDEND_DATE?.replace(' ', 'T')).getTime(); return r.ASSIGN_PROGRESS === '实施分配' && t > start.getTime() && t <= end; }).reduce((sum, r) => sum + Number(r.PRETAX_BONUS_RMB || 0) / 10, 0).toFixed(8));
  return { cash, yield: cash / price * 100 };
}
export const eastUrl = (report: string, code: string, columns = 'ALL', size = 100) => `https://datacenter.eastmoney.com/securities/api/data/v1/get?${new URLSearchParams({ reportName: report, columns, filter: `(SECURITY_CODE="${code}")`, pageNumber: '1', pageSize: String(size), sortColumns: 'REPORT_DATE', sortTypes: '-1' })}`;
export async function getJson(url: string) { const r = await fetch(url); if (!r.ok) throw new Error(`数据请求失败（${r.status}），请稍后重试。`); return r.json(); }
export async function fetchSnapshot(codes: string[]): Promise<Snapshot> {
  const quoteUrl = `https://qt.gtimg.cn/q=${codes.map(c => `${c.startsWith('6') ? 'sh' : 'sz'}${c}`).join(',')}`;
  const res = await fetch(quoteUrl); if (!res.ok) throw new Error('腾讯行情请求失败。');
  const rows = parseQuotes(new TextDecoder('gbk').decode(await res.arrayBuffer()));
  if (rows.length !== codes.length) throw new Error('部分股票行情缺失，请检查股票池。');
  return Promise.all(rows.map(async f => {
    const financialUrl = eastUrl('RPT_F10_FINANCE_MAINFINADATA', f[2], 'SECURITY_CODE,REPORT_DATE_NAME,TOTALOPERATEREVE,PARENTNETPROFIT,EPSJB,ROEJQ', 1);
    const bonusUrl = eastUrl('RPT_SHAREBONUS_DET', f[2]);
    const [financeJson, bonusJson] = await Promise.all([getJson(financialUrl), getJson(bonusUrl)]);
    const finance = parseFinancial(financeJson); const now = new Date(); const dividend = dividendYield(bonusJson, Number(f[3]), now);
    const fields: Field[] = [];
    const add = (label: string, value: string | number, unit: string, source: string) => fields.push({ label, value, unit, source, fetchedAt: now.toISOString() });
    for (const [label, index, unit] of [['现价',3,'元'],['前收盘',4,'元'],['涨跌幅',32,'%'],['市盈率',39,'倍'],['市净率',46,'倍'],['总市值',45,'亿元']] as const) add(label, f[index] && Number.isFinite(Number(f[index])) ? Number(f[index]) : '暂无', unit, quoteUrl);
    add('行情时间', f[30], '', quoteUrl);
    add('近十二月每股现金分红（税前）', dividend.cash, '元', bonusUrl);
    add('股息率（近十二月已实施分红÷现价）', dividend.yield, '%', bonusUrl + '；价格来源：' + quoteUrl);
    for (const [label,key,unit] of [['报告期','REPORT_DATE_NAME',''],['营业收入','TOTALOPERATEREVE','元'],['归母净利润','PARENTNETPROFIT','元'],['每股收益','EPSJB','元'],['净资产收益率','ROEJQ','%']]) add(label, finance[key] ?? '暂无', unit, financialUrl);
    return { code: f[2], name: f[1], fields };
  }));
}
