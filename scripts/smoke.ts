import {
  parseQuotes,
  parseFinancial,
  dividendYield,
  eastUrl,
  getJson,
} from '../src/data/market.ts';
const codes = ['601088', '000895', '600900'];
const response = await fetch('https://qt.gtimg.cn/q=sh601088,sz000895,sh600900');
if (!response.ok) throw new Error(`行情请求失败 ${response.status}`);
const rows = parseQuotes(new TextDecoder('gbk').decode(await response.arrayBuffer()));
if (rows.length !== codes.length) throw new Error('行情数量不匹配');
for (const row of rows) {
  const finance = parseFinancial(
    await getJson(
      eastUrl(
        'RPT_F10_FINANCE_MAINFINADATA',
        row[2],
        'SECURITY_CODE,REPORT_DATE_NAME,TOTALOPERATEREVE,PARENTNETPROFIT,EPSJB,ROEJQ',
        1,
      ),
    ),
  );
  const div = dividendYield(await getJson(eastUrl('RPT_SHAREBONUS_DET', row[2])), Number(row[3]));
  if (!finance.REPORT_DATE_NAME || !Number.isFinite(div.yield)) throw new Error('解析结果不完整');
  console.log(
    `${row[2]} ${row[1]} | 现价 ${row[3]} | 腾讯字段64 ${row[64]}% | 近十二月税前每股分红 ${div.cash.toFixed(4)}元 | 计算股息率 ${div.yield.toFixed(4)}% | ${finance.REPORT_DATE_NAME} 营收 ${finance.TOTALOPERATEREVE} 归母净利润 ${finance.PARENTNETPROFIT} EPS ${finance.EPSJB} ROE ${finance.ROEJQ}`,
  );
}
console.log('真实接口烟测通过：3只股票的腾讯GBK行情、东方财富财报和分红解析完成。');
