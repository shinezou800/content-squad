import { defaults, fetchSnapshot, poolCodes } from '../src/data/market.ts';
const codes = process.argv.length > 2 ? process.argv.slice(2) : poolCodes(defaults);
const snapshot = await fetchSnapshot(codes);
console.log('| 代码 | 名称 | 价格 | 币种 | 计算股息率 | 财务数据 |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const stock of snapshot) {
  const field = (label: string) => stock.fields.find((f) => f.label === label);
  const yieldField = field('股息率（近十二月已实施分红÷现价）')!;
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
    `| ${stock.code} | ${stock.name} | ${field('现价')!.value} | ${field('现价')!.unit} | ${typeof yieldField.value === 'number' ? yieldField.value.toFixed(4) + '%' : '缺失'} | ${financials.map((f) => `${f.label}:${f.value}${typeof f.value === 'number' ? f.unit : ''}`).join('；')} |`,
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
  `真实接口烟测通过：${snapshot.length}只股票的报价及财报解析完成；未核实的港股分红不作推算。`,
);
