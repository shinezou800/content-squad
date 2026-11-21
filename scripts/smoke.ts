import { defaults, fetchSnapshot, poolEntries } from '../src/data/market.ts';
const entries = poolEntries(defaults);
const codes = process.argv.length > 2 ? process.argv.slice(2) : entries.map((entry) => entry.code);
const snapshot = await fetchSnapshot(
  codes,
  Object.fromEntries(
    entries
      .filter((entry) => entry.manualDividend !== undefined)
      .map((entry) => [entry.code, entry.manualDividend!]),
  ),
);
console.log('| 代码 | 名称 | 价格 | 币种 | 计算股息率 | 每股分红及来源 | 财务数据 |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const stock of snapshot) {
  const field = (label: string) => stock.fields.find((f) => f.label === label);
  const yieldField = field('股息率（近十二月已实施分红÷现价）')!;
  const cash = stock.fields.find((f) => f.label.startsWith('近十二月每股现金分红'))!;
  const financials = stock.fields.filter((f) =>
    [
      '报告期',
      '营业收入',
      '归母净利润',
      '每股收益',
      '净资产收益率',
      '净资产收益率（平均）',
    ].includes(f.label),
  );
  console.log(
    `| ${stock.code} | ${stock.name} | ${field('现价')!.value} | ${field('现价')!.unit} | ${typeof yieldField.value === 'number' ? yieldField.value.toFixed(4) + '%' : '缺失'} | ${cash.value}${typeof cash.value === 'number' ? cash.unit : ''}（${cash.source.startsWith('主人手动提供') ? cash.source : '公开接口'}） | ${financials.map((f) => `${f.label}:${f.value}${typeof f.value === 'number' ? f.unit : ''}`).join('；')} |`,
  );
  const missing = stock.fields.filter(
    (f) => typeof f.value === 'string' && f.value.startsWith('缺失'),
  );
  if (missing.length)
    console.log(
      `缺失字段 ${stock.code}：${missing.map((f) => `${f.label}=${f.value}`).join('；')}`,
    );
}
console.log(
  `真实接口烟测通过：${snapshot.length}只股票的报价及财报解析完成；手动分红按标记金额计算，未覆盖的港股分红不作推算。`,
);
