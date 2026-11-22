import { describe, expect, it } from 'vitest';
import { checkDraft, checkNumbers, filterModelCheck } from './checks';
import type { Snapshot } from '../data/market';
const snapshot: Snapshot = [
  {
    code: '601088',
    name: '中国神华',
    fields: [
      { label: '现价', value: 52, source: '腾讯', fetchedAt: '今天' },
      { label: '收入', value: 296031000000, unit: '元', source: '东方财富', fetchedAt: '今天' },
      { label: '股息率', value: 3.8653846, source: '东方财富', fetchedAt: '今天' },
    ],
  },
];
const wrap = (text: string) =>
  `⚠️ 模拟盘记录。${text}\n持仓披露：未提供。\n非投资建议。数据来源：腾讯行情、东方财富。`;
describe('派生数字与完整披露回归', () => {
  const data: Snapshot = [{ code: '601088', name: '中国神华', fields: [
    { label: '每股分红', value: 1.49, unit: '元', source: '手动', fetchedAt: '' },
    { label: '每股收益', value: 3.04, unit: '元', source: '接口', fetchedAt: '' },
  ] }];
  it('派息指标只接受分红作分子，通用比值保留双向运算', () => {
    for (const metric of ['派息覆盖', '分红覆盖', '派息率', '支付率']) {
      expect(checkNumbers(`${metric}2.04`, data)).toHaveLength(1);
      expect(checkNumbers(`${metric}0.49`, data)).toEqual([]);
    }
    expect(checkNumbers('比值2.04', data)).toEqual([]);
  });
  it('Markdown强调不作为乘法运算符', () => {
    for (const metric of ['**派息覆盖**', '*派息覆盖*', '__派息覆盖__', '_派息覆盖_']) {
      expect(checkNumbers(`${metric}0.49`, data)).toEqual([]);
      expect(checkNumbers(`${metric}4.53`, data)).toHaveLength(1);
    }
    expect(checkNumbers('1.49 * 3.04 = 4.53', data)).toEqual([]);
  });
  it('百分比字段合计不再次乘以一百', () => {
    const percentages: Snapshot = [{ code: '601088', name: '中国神华', fields: [
      { label: '收益率甲', value: 3.2, unit: '%', source: '接口', fetchedAt: '' },
      { label: '收益率乙', value: 5.4, unit: '%', source: '接口', fetchedAt: '' },
    ] }];
    expect(checkNumbers('合计8.60%', percentages)).toEqual([]);
    expect(checkNumbers('合计860%', percentages)).toHaveLength(1);
  });
  it('显式运算优先于收益率等指标名称', () => {
    const percentages: Snapshot = [{ code: '601088', name: '中国神华', fields: [
      { label: '收益率甲', value: 3.2, unit: '%', source: '接口', fetchedAt: '' },
      { label: '收益率乙', value: 5.4, unit: '%', source: '接口', fetchedAt: '' },
    ] }];
    expect(checkNumbers('收益率差额2.20%', percentages)).toEqual([]);
    expect(checkNumbers('收益率差额168.75%', percentages)).toHaveLength(1);
    expect(checkNumbers('收益率合计8.60%', percentages)).toEqual([]);
    expect(checkNumbers('收益率乘积17.28', percentages)).toEqual([]);
    expect(checkNumbers('收益率比值168.75%', percentages)).toEqual([]);
  });
  it.each([0.93, 0.98, 0.59, 0.69, 0.44, 0.28, 0.49])('允许分红除以EPS得到的派息覆盖 %s', (ratio) => {
    const stock = structuredClone(data);
    stock[0].fields[0].value = ratio * 3.04;
    expect(checkNumbers(`派息覆盖 ${ratio.toFixed(2)}`, stock)).toEqual([]);
  });
  it.each(['派息覆盖0.49', '派息率49.01%', '合计4.53元', '差额1.55元', '乘积4.53元'])('核对快照运算 %s', (text) => {
    expect(checkNumbers(text, data)).toEqual([]);
  });
  it('保留错误派生数、无运算上下文数字、错误币种和零分母的标记', () => {
    for (const text of ['派息覆盖0.77', '现价4.53元', '合计4.53港元', '派息覆盖999'])
      expect(checkNumbers(text, data)).toHaveLength(1);
    const zero = structuredClone(data);
    zero[0].fields[1].value = 0;
    expect(checkNumbers('派息覆盖0.49', zero)).toHaveLength(1);
    expect(checkNumbers('派息覆盖0.49', [])).toHaveLength(1);
    expect(checkNumbers('', data)).toEqual([]);
  });
  it('不跨币种推算覆盖率', () => {
    const mixed = structuredClone(data);
    mixed[0].fields[0].unit = '港元';
    expect(checkNumbers('派息覆盖0.49', mixed)).toHaveLength(1);
  });
  it.each(['11 月 20 日', '2026 年 11 月 20 日', '2026年', '11月', '20日', '9时30分', '9点30分'])('排除日期时间 %s 但保留数据数字', (date) => {
    expect(checkNumbers(`${date}，现价999元`, []).map((f) => f.原文)).toEqual(['999']);
  });
  it.each(['⚠', '⚠️'])('从完整正文发现 %s 声明及持仓披露', (warning) => {
    const draft = `──────── AI手记 ────────\n# 实测记录\n${warning} 前置声明\n${'这是实测说明。'.repeat(30)}模拟盘记录。\n持仓披露 ：未提供。\n非投资建议。数据来源 ：腾讯。\n${'这是流程记录。'.repeat(80)}`;
    expect(checkDraft(draft, [])).toEqual([]);
  });
  it('缺失声明或持仓披露仍标记', () => {
    expect(checkDraft('模拟盘记录。持仓披露：无。非投资建议。数据来源：腾讯。', []).map((f) => f.问题)).toEqual(['开篇需有 ⚠️ 前置声明及模拟盘记录']);
    expect(checkDraft('⚠️ 模拟盘记录。非投资建议。数据来源：腾讯。', []).map((f) => f.问题)).toEqual(['结尾缺少持仓披露']);
  });
});
describe('模型核对数值容差', () => {
  it.each([
    ['主人手动提供每股分红1.49港元', '接口核实每股分红1.49港元', '事实不符'],
    ...['来源', '口径', '出处', '手动', '接口', '单位', '币种'].map((word) => ['股息率4.91%', '4.908510638297872%', `${word}不符`]),
  ])('保留来源或口径更正 %s / %s / %s', (原文, 数据源值, 问题) => {
    const result = JSON.stringify([{ 原文, 数据源值, 问题 }]);
    expect(filterModelCheck(result)).toBe(result);
  });
  it.each([
    ['股息率4.91%', '股息率4.908510638297872%'],
    ['股息率7.00%', '6.9975%'],
    ['收入760.79亿', '收入760.78709亿'],
  ])('相同或空上下文仍过滤舍入差异 %s / %s', (原文, 数据源值) => {
    expect(JSON.parse(filterModelCheck(JSON.stringify([{ 原文, 数据源值, 问题: '数值不符' }])))).toEqual([]);
  });
  it.each([
    ['4.91%', '4.908510638297872%'],
    ['7.00%', '6.9975%'],
    ['760.79亿', '760.78709亿'],
    ['760.79亿元', '76078709000元'],
    ['33,502.19亿元', '33502.19亿元'],
    ['微跌0.45%', '-0.45%'],
  ])('过滤舍入差异 %s / %s', (原文, 数据源值) => {
    expect(JSON.parse(filterModelCheck(JSON.stringify([{ 原文, 数据源值, 问题: '数值不符' }])))).toEqual([]);
  });
  it.each([
    ['4.81%', '4.9085%'], ['PB中位数0.44倍', '0.49倍'],
    ['9.50元', '9.40元'], ['21.70港元', '21.70元'],
    ['4.91%', '4.9085倍'], ['4.91%', '未提供'],
    ['4.91%和7.00%', '4.9085%'], ['4.91%', '4.9085%（估算）'],
    ['2026-11-22 4.91%', '4.9085%'],
  ])('保留差异或不明确项目 %s / %s', (原文, 数据源值) => {
    const result = JSON.stringify([{ 原文, 数据源值, 问题: '需核对' }]);
    expect(filterModelCheck(result)).toBe(result);
  });
  it.each(['[]', '不是JSON', '{}', '[null,{},1]', '[{"原文":"4.91%"}]'])('保留空或不可解析输出 %s', (text) => {
    expect(filterModelCheck(text)).toBe(text);
  });
  it('保留未过滤条目和代码围栏', () => {
    const keep = { 原文: '0.44', 数据源值: '0.49', 问题: '中位数错误' };
    const result = filterModelCheck('```json\n' + JSON.stringify([
      { 原文: '7.00%', 数据源值: '6.9975%', 问题: '不符' }, keep,
    ]) + '\n```');
    expect(result).toBe('```json\n' + JSON.stringify([keep], null, 2) + '\n```');
  });
});
describe('文字方向百分比', () => {
  it.each(['跌', '下跌', '微跌', '下滑', '回落', '涨', '上涨', '微涨'])('%s 紧邻百分数推断符号', (word) => {
    const value = /涨/.test(word) ? 0.45 : -0.45;
    const data: Snapshot = [{ code: '601398', name: '工商银行', fields: [
      { label: '涨跌幅', value, unit: '%', source: '腾讯', fetchedAt: '' },
    ] }];
    expect(checkNumbers(`${word} 0.45%`, data)).toEqual([]);
    expect(checkDraft(wrap(`${word}0.45%`), data)).toEqual([]);
    data[0].fields[0].value = /涨/.test(word) ? 0.55 : -0.55;
    expect(checkNumbers(`${word}0.45%`, data)).toHaveLength(1);
  });
});
describe('确定性核对', () => {
  const timestamps = [
    '2026-11-22T01:20:06Z',
    '2026-11-22T01:20:06',
    '2026-11-22T01:20:06.123Z',
    '2026-11-22T01:20:06.123',
    '2026-11-22T01:20:06+08:00',
    '2026-11-20 16:14:47',
    '20261120161430',
    '2026-11-22T02:02:16~17Z',
    '2026年11月20日16:14',
    '2026年11月20日16:14:47',
    '2026年11月20日',
    '2026-11-22 02:04 UTC',
    '2026-11-22 02:04',
    '2026-11-22',
    '2026/11/22',
    '2026年11月22日',
    '16:14',
    '16:14:47',
    '00:00',
    '23:59:59',
    '20261120161451~161500',
    '20261120161451～1500',
    '20261120161451-00',
  ];
  it.each(timestamps)('正文时间戳不拆成数字片段：%s', (timestamp) => {
    expect(checkNumbers(`行情时间：${timestamp}。`, [])).toEqual([]);
    expect(checkDraft(wrap(`行情时间：${timestamp}。`), [])).toEqual([]);
    expect(checkNumbers(`${timestamp}；现价999元`, []).map((flag) => flag.原文)).toEqual(['999']);
  });
  it('快照时间戳不提供可匹配的数字片段或紧凑时间值，其他数值仍匹配', () => {
    const data: Snapshot = [
      {
        code: '601398',
        name: '工商银行',
        fields: [
          ...[...timestamps, 20261120161430].map((value) => ({
            label: '时间',
            value,
            source: '腾讯',
            fetchedAt: '',
          })),
          {
            label: '行情',
            value: '2026-11-20 16:14:47；现价4.54元',
            source: '腾讯',
            fetchedAt: '',
          },
        ],
      },
    ];
    expect(checkNumbers('4.54元', data)).toEqual([]);
    expect(checkNumbers('11、22、20、06、20261120161431', data).map((flag) => flag.原文)).toEqual([
      '11',
      '22',
      '20',
      '06',
    ]);
    expect(checkNumbers('2026年3季报', []).map((flag) => flag.原文)).toEqual(['2026', '3']);
  });
  it.each(timestamps)('快照和正文完整剔除时间但保留相邻价格、收益率：%s', (timestamp) => {
    const data: Snapshot = [
      {
        code: '601398',
        name: '工商银行',
        fields: [
          {
            label: '行情',
            value: `${timestamp}；现价9.40元，股息率4.5403%`,
            source: '腾讯',
            fetchedAt: '',
          },
        ],
      },
    ];
    expect(checkNumbers(`${timestamp}；现价9.40元，股息率4.54%`, data)).toEqual([]);
    expect(checkNumbers(`${timestamp}；现价9.50元`, data).map((flag) => flag.原文)).toEqual([
      '9.50',
    ]);
    expect(checkNumbers('11、22、16、14、02、17', data).map((flag) => flag.原文)).toEqual([
      '11',
      '22',
      '16',
      '14',
      '02',
      '17',
    ]);
  });
  it.each([
    '抓取时间2026-11-22',
    '2026-11-22 快照',
    '2026-11-20 盘后',
    '行情取自腾讯接口（20261120161451~161500）',
    '2026年11月20日16:14',
  ])('时间说明不留下日期或区间尾部：%s', (text) => {
    expect(checkNumbers(text, [])).toEqual([]);
    expect(checkDraft(wrap(text), [])).toEqual([]);
  });
  it.each(['24:00', '23:60', '23:59:60', '123:45', '12:345'])(
    '无效独立时间不能被局部剔除：%s',
    (text) => {
      expect(checkNumbers(text, []).map((flag) => flag.原文)).toEqual(text.split(':'));
    },
  );
  it.each(['~', '～', '-'])('行情区间整体剔除，独立六位代码保留：%s', (separator) => {
    for (const tail of ['00', '1500', '161500']) {
      const text = `20261120161451${separator}${tail}；600519 贵州茅台，现价9.50元，股息率4.54%`;
      expect(checkNumbers(text, []).map((flag) => flag.原文)).toEqual(['600519', '9.50', '4.54']);
      const data: Snapshot = [
        {
          code: '600519',
          name: '贵州茅台',
          fields: [
            {
              label: '时间',
              value: `20261120161451${separator}${tail}`,
              source: '腾讯',
              fetchedAt: '',
            },
          ],
        },
      ];
      expect(checkNumbers('600519 贵州茅台', data)).toEqual([]);
      expect(checkNumbers('161500', data).map((flag) => flag.原文)).toEqual(['161500']);
    }
  });
  const scenario =
    '若PE回升至6.5倍，对应价格约18.07元；若PB修复至0.6倍，参考每股净资产约40.6元，对应价格约24.36元，仅作数字推演。';
  it('情景句包括分号后的全部数字，不影响单独句子的直接价格检查', () => {
    const data: Snapshot = [
      {
        code: '601398',
        name: '工商银行',
        fields: [{ label: '现价', value: 9.4, unit: '元', source: '腾讯', fetchedAt: '' }],
      },
    ];
    expect(checkNumbers(scenario, [])).toEqual([]);
    expect(checkDraft(wrap(scenario), [])).toEqual([]);
    expect(checkNumbers(`${scenario}现价9.50元。`, data).map((flag) => flag.原文)).toEqual([
      '9.50',
    ]);
    expect(checkDraft(wrap(`现价9.50元。${scenario}`), data).map((flag) => flag.原文)).toEqual([
      '9.50',
    ]);
    expect(checkNumbers(`现价9.40元。${scenario}`, data)).toEqual([]);
  });
  it.each([
    '若',
    '如果',
    '假设',
    '对应价格',
    '仅作数字推演',
    '推演',
    '情景演算',
    '不是买入计划',
    '测算',
    '回升至',
    '修复至',
  ])('情景标记在句中任意位置使本句数字跳过：%s', (marker) => {
    expect(checkNumbers(`9.50元；${marker}；6.5倍`, [])).toEqual([]);
    expect(checkNumbers(`9.50元；6.5倍；${marker}`, [])).toEqual([]);
  });
  it.each(['。', '！', '？', '\n'])('情景过滤不跨句边界：%j', (separator) => {
    expect(checkNumbers(`假设6.5倍${separator}现价9.50元`, []).map((flag) => flag.原文)).toEqual([
      '9.50',
    ]);
    expect(checkNumbers(`现价9.50元${separator}假设6.5倍`, []).map((flag) => flag.原文)).toEqual([
      '9.50',
    ]);
  });
  it.each(['9.40元', '4.54%'])('保留原句界，前句末尾单位不影响后句负号：%s', (prefix) => {
    const data: Snapshot = [{
      code: '601398', name: '工商银行',
      fields: [
        { label: '现价', value: 9.4, unit: '元', source: '腾讯', fetchedAt: '' },
        { label: '股息率', value: 4.54, unit: '%', source: '腾讯', fetchedAt: '' },
        { label: '涨跌幅', value: -1.2, unit: '%', source: '腾讯', fetchedAt: '' },
      ],
    }];
    for (const delimiter of ['。', '！', '？']) {
      const draft = `${prefix}${delimiter}-1.2%`;
      expect(checkNumbers(draft, data)).toEqual([]);
      expect(checkDraft(wrap(draft), data)).toEqual([]);
      expect(checkNumbers(`${prefix}${delimiter}假设99元${delimiter}-1.2%`, data)).toEqual([]);
      expect(checkNumbers(`${prefix}${delimiter}+1.2%`, data)).toHaveLength(1);
    }
  });
  it('情景过滤只用于正文，快照情景字符串仍可提供匹配数值', () => {
    const data: Snapshot = [
      {
        code: '601398',
        name: '工商银行',
        fields: [{ label: '说明', value: '测算9.40元', source: '腾讯', fetchedAt: '' }],
      },
    ];
    expect(checkNumbers('现价9.40元', data)).toEqual([]);
    expect(checkNumbers('现价9.50元', data)).toHaveLength(1);
    expect(checkNumbers('', data)).toEqual([]);
  });
  it.each([
    ['33,502.19亿元', 33502.19],
    ['6,959.47亿元', 6959.47],
    ['1,874.82亿元', 1874.82],
    ['1,234,567.89亿元', 1234567.89],
  ])('千位逗号金额整体比较及报错：%s', (text, value) => {
    const data: Snapshot = [
      {
        code: '601398',
        name: '工商银行',
        fields: [{ label: '收入', value, unit: '亿元', source: '测试', fetchedAt: '' }],
      },
    ];
    expect(checkNumbers(text, data)).toEqual([]);
    expect(checkDraft(wrap(text), data)).toEqual([]);
    expect(checkNumbers(text, []).map((flag) => flag.原文)).toEqual([text.replace(/元$/, '')]);
    const stringData: Snapshot = [{ ...data[0], fields: [{ ...data[0].fields[0], value: text }] }];
    expect(checkNumbers(`${value}亿元`, stringData)).toEqual([]);
  });
  it.each(['33,50亿元', '6,9594亿元', '1,87亿元'])('非三位分组逗号不合并成数字：%s', (text) => {
    const value = Number(text.replaceAll(',', '').replace('亿元', ''));
    const data: Snapshot = [
      {
        code: '601398',
        name: '工商银行',
        fields: [{ label: '收入', value, unit: '亿元', source: '测试', fetchedAt: '' }],
      },
    ];
    expect(checkNumbers(text, data)).toHaveLength(2);
  });
  it.each([
    '中位数约 4.96%',
    'PB 中位数 0.44 倍',
    'ROE 中位数 5.59%',
    '平均 4.96%',
    '均值约4.96%',
    '最高 4.96%',
    '最低 4.96%',
    '区间6–7倍',
    '区间 6 倍 – 7 倍',
    '区间 -1.5%～-0.5%',
  ])('派生数值及区间端点不作直接引用检查：%s', (text) => {
    expect(checkNumbers(text, [])).toEqual([]);
    expect(checkDraft(wrap(text), [])).toEqual([]);
  });
  it.each([
    '中位数，现价9.50元',
    '平均。现价9.50元',
    '区间\n现价9.50元',
    '最高！？现价9.50元',
    '最低；现价9.50元',
    '均值、现价9.50元',
    '中位数只是说明文字而非当前价格9.50元',
    '直接引用9.50元',
    '9.50元为中位数',
  ])('派生词不跨分句、长距离或向前豁免直接引用：%s', (text) => {
    expect(checkNumbers(text, []).map((flag) => flag.原文)).toEqual(['9.50']);
  });
  it('约本身不豁免直接引用，正确舍入匹配而错误股息率及价格仍标记', () => {
    const data: Snapshot = [
      {
        code: '601398',
        name: '工商银行',
        fields: [
          { label: '股息率', value: 4.5403, unit: '%', source: '测试', fetchedAt: '' },
          { label: '现价', value: 9.4, unit: '元', source: '测试', fetchedAt: '' },
        ],
      },
    ];
    expect(checkNumbers('股息率约4.54%', data)).toEqual([]);
    expect(checkDraft(wrap('股息率约4.54%'), data)).toEqual([]);
    const wrong: Snapshot = [
      { ...data[0], fields: [{ ...data[0].fields[0], value: 3.9 }, data[0].fields[1]] },
    ];
    expect(checkNumbers('股息率约4.54%', wrong).map((flag) => flag.原文)).toEqual(['4.54']);
    expect(checkDraft(wrap('股息率约4.54%'), wrong)).toHaveLength(1);
    expect(checkNumbers('中位数约4.96%，现价9.50元', data).map((flag) => flag.原文)).toEqual([
      '9.50',
    ]);
  });
  it('派生词过滤仅用于正文，快照字符串仍可为直接引用提供事实', () => {
    const data: Snapshot = [
      {
        code: '601398',
        name: '工商银行',
        fields: [{ label: '统计', value: 'PB 中位数 0.44 倍', source: '测试', fetchedAt: '' }],
      },
    ];
    expect(checkNumbers('PB 为0.44倍', data)).toEqual([]);
  });
  it.each([
    ['4.54%', 4.540295119182747, '%', '4.55%'],
    ['760.79亿', 760.78709, '亿元', '760.78亿'],
    ['760.79亿元', 76078709000, '元', '760.78亿元'],
    ['4.544%', 4.5402, '%', '4.546%'],
    ['-1.23%', -1.234, '%', '-1.24%'],
    ['5元', 4.5402, '元', '4元'],
  ])('按正文精度四舍五入，最多两位小数：%s', (text, value, unit, wrong) => {
    const data: Snapshot = [
      {
        code: '601398',
        name: '工商银行',
        fields: [{ label: '数值', value, unit, source: '测试', fetchedAt: '' }],
      },
    ];
    expect(checkNumbers(text, data)).toEqual([]);
    expect(checkDraft(wrap(text), data)).toEqual([]);
    expect(checkNumbers(wrong, data)).toHaveLength(1);
  });
  it('四舍五入边界不能以近似差值跨越', () => {
    const data: Snapshot = [
      {
        code: '601398',
        name: '工商银行',
        fields: [{ label: '数值', value: 4.5451, unit: '%', source: '测试', fetchedAt: '' }],
      },
    ];
    expect(checkNumbers('4.54%', data)).toHaveLength(1);
    expect(checkNumbers('4.55%', data)).toEqual([]);
  });
  it.each([
    ['1.01%', 1.005, '1.02%'],
    ['-1.13%', -1.125, '-1.14%'],
    ['-1.12%', -1.125, '-1.11%'],
  ])('对称半单位容差接受临界两侧（含负数），越界仍标记：%s', (text, value, wrong) => {
    const data: Snapshot = [
      {
        code: '601398',
        name: '工商银行',
        fields: [{ label: '数值', value, unit: '%', source: '测试', fetchedAt: '' }],
      },
    ];
    expect(checkNumbers(text, data)).toEqual([]);
    expect(checkDraft(wrap(text), data)).toEqual([]);
    expect(checkNumbers(wrong, data)).toHaveLength(1);
  });
  it('大额数值的浮点误差容许量不能掩盖百元差异', () => {
    const data: Snapshot = [{
      code: '601398', name: '工商银行',
      fields: [{ label: '营业收入', value: 296031000000, unit: '元', source: '测试', fetchedAt: '' }],
    }];
    expect(checkNumbers('296031000000元', data)).toEqual([]);
    expect(checkNumbers('296031000100元', data)).toHaveLength(1);
    expect(checkDraft(wrap('296031000100元'), data)).toHaveLength(1);
  });
  it.each([
    '未做任何补全或推算',
    '未补仓',
    '不补仓',
    '今日不再补仓',
    '本次无需补仓',
    '今日未曾补仓',
    '不需补仓',
    '不用补仓',
    '不必补仓',
    '没再补仓',
    '从未补仓',
    '没补仓',
    '未做任何补仓',
    '没有进行补仓',
    '无补仓操作',
    '数据补全',
    '资料补充',
    '收到补贴',
    '政府补助',
    '可以补充资料',
    '补录数据',
  ])('补的否定及非行动用法不误报：%s', (text) => {
    expect(checkDraft(wrap(text), [])).toEqual([]);
  });
  it.each(['补仓', '补一点', '可以补', '该补', '可以补买', '无论涨跌都可以补仓', '不妨补仓'])('补的行动用法仍标记：%s', (text) => {
    expect(checkDraft(wrap(text), []).some((flag) => flag.原文 === '补')).toBe(true);
  });
  it('否定仅作用于当前分句，其他禁词规则不变', () => {
    const flags = checkDraft(wrap('未做任何补全，可以补仓。建议买，应该补一点。'), []);
    expect(flags.filter((flag) => flag.原文 === '补')).toHaveLength(2);
    for (const word of ['建议', '买', '应该'])
      expect(flags.some((flag) => flag.原文 === word)).toBe(true);
  });
  it.each([
    ['600309', '万华化学'],
    ['000002', '万科'],
    ['300014', '亿纬锂能'],
    ['00883', '中海油'],
  ])('股票名开头的万/亿不作为代码的单位：%s %s', (code, name) => {
    const data: Snapshot = [{ code, name, fields: [] }];
    expect(checkDraft(wrap(`${code} ${name}`), data)).toEqual([]);
    expect(checkDraft(wrap(`${code}${name}`), data)).toEqual([]);
  });
  it.each([
    ['2000亿', 2000e8],
    ['收入2000亿的公司', 2000e8],
    ['收入2000亿左右', 2000e8],
    ['3.5万亿元', 3.5e12],
    ['12万股', 12e4],
    ['600309亿元', 600309e8],
  ])('正常数量单位仍换算：%s', (text, value) => {
    const data: Snapshot = [
      {
        code: '600309',
        name: '万华化学',
        fields: [
          {
            label: '数值',
            value,
            unit: text.endsWith('元') ? '元' : undefined,
            source: '测试',
            fetchedAt: '今天',
          },
        ],
      },
    ];
    expect(checkDraft(wrap(text), data)).toEqual([]);
    for (const wrongValue of [value / 10000, Number(text.match(/\d+(?:\.\d+)?/)![0])]) {
      const wrong: Snapshot = [
        { ...data[0], fields: [{ ...data[0].fields[0], value: wrongValue }] },
      ];
      expect(checkDraft(wrap(text), wrong).some((f) => f.问题.startsWith('数字未在快照'))).toBe(
        true,
      );
    }
  });
  it.each(['元', ' 元', '人民币元', ' 人民币', ' RMB', ' rmb'])(
    '港元快照拒绝人民币变体：%s',
    (suffix) => {
      const data: Snapshot = [
        {
          code: '00883',
          name: '中海油',
          fields: [{ label: '现价', value: 21.7, unit: '港元', source: '腾讯', fetchedAt: '今天' }],
        },
      ];
      expect(
        checkDraft(wrap(`21.7${suffix}`), data).some((f) => f.问题.startsWith('数字未在快照')),
      ).toBe(true);
    },
  );
  it.each(['港元', ' 港元', '港币', ' 港币', ' HKD', ' hkd'])(
    '港元快照接受港元变体：%s',
    (suffix) => {
      const data: Snapshot = [
        {
          code: '00883',
          name: '中海油',
          fields: [{ label: '现价', value: 21.7, unit: '港元', source: '腾讯', fetchedAt: '今天' }],
        },
      ];
      expect(checkDraft(wrap(`21.7${suffix}`), data)).toEqual([]);
    },
  );
  it.each(['元', '人民币', '人民币元', 'RMB', '港元', '港币', 'HKD'])(
    '快照单位及字符串也归一化：%s',
    (unit) => {
      const hk = ['港元', '港币', 'HKD'].includes(unit);
      for (const field of [{ value: 21.7, unit }, { value: `21.7 ${unit}` }]) {
        const data: Snapshot = [
          {
            code: '00883',
            name: '股票',
            fields: [{ label: '现价', ...field, source: '腾讯', fetchedAt: '今天' }],
          },
        ];
        expect(checkDraft(wrap(`21.7 ${hk ? 'HKD' : 'RMB'}`), data)).toEqual([]);
        expect(
          checkDraft(wrap(`21.7 ${hk ? 'RMB' : 'HKD'}`), data).some((f) =>
            f.问题.startsWith('数字未在快照'),
          ),
        ).toBe(true);
      }
    },
  );
  it.each([
    [21.7, '港元', '21.7港元', '21.7元'],
    [21.7, '元', '21.7元', '21.7港元'],
    [10314, '亿港元', '10314亿港元', '10314亿元'],
    ['21.7港元', undefined, '21.7港元', '21.7元'],
  ])('人民币与港元不能混用：%s %s', (value, unit, matching, wrong) => {
    const data: Snapshot = [
      {
        code: '00883',
        name: '中海油',
        fields: [
          { label: '价格或市值', value, unit, source: '腾讯', fetchedAt: '今天' },
          { label: '无币种同值', value: 21.7, unit: '倍', source: '腾讯', fetchedAt: '今天' },
        ],
      },
    ];
    expect(checkDraft(wrap(matching), data)).toEqual([]);
    expect(checkDraft(wrap(wrong), data).some((f) => f.问题.startsWith('数字未在快照'))).toBe(true);
  });
  it.each(['30元-40元', '30-40', '30%-40%', '30倍-40倍', '30元 -40元', '30 -40'])(
    '范围连接符不作为负号：%s',
    (range) => {
      const data: Snapshot = [
        {
          code: '601088',
          name: '中国神华',
          fields: [30, 40].map((value) => ({
            label: '数值',
            value,
            source: '腾讯',
            fetchedAt: '今天',
          })),
        },
      ];
      expect(checkDraft(wrap(range), data)).toEqual([]);
      const rangeData: Snapshot = [
        {
          ...data[0],
          fields: [{ label: '区间', value: range, source: '腾讯', fetchedAt: '今天' }],
        },
      ];
      expect(checkDraft(wrap('30元、40元'), rangeData)).toEqual([]);
      expect(checkDraft(wrap('-40元'), rangeData).some((f) => f.原文 === '-40')).toBe(true);
    },
  );
  it.each(['今日-1.23%', '-1.23%', '今日 -1.23%', '涨跌：-1.23%'])(
    '文本后的负号仍保留：%s',
    (text) => {
      const data: Snapshot = [
        {
          code: '601088',
          name: '中国神华',
          fields: [{ label: '涨跌幅', value: '-1.23%', source: '腾讯', fetchedAt: '今天' }],
        },
      ];
      expect(checkDraft(wrap(text), data)).toEqual([]);
      const positive: Snapshot = [{ ...data[0], fields: [{ ...data[0].fields[0], value: 1.23 }] }];
      expect(checkDraft(wrap(text), positive).some((f) => f.原文 === '-1.23')).toBe(true);
      const textSnapshot: Snapshot = [
        { ...data[0], fields: [{ ...data[0].fields[0], value: text }] },
      ];
      expect(checkDraft(wrap('-1.23%'), textSnapshot)).toEqual([]);
    },
  );
  it.each([-1.23, '-1.23%'])('保留快照和正文的负号：%s', (value) => {
    const data: Snapshot = [
      {
        code: '601088',
        name: '中国神华',
        fields: [{ label: '涨跌幅', value, unit: '%', source: '腾讯', fetchedAt: '今天' }],
      },
    ];
    expect(checkDraft(wrap('-1.23%'), data)).toEqual([]);
    expect(checkDraft(wrap('1.23%'), data).some((f) => f.原文 === '1.23')).toBe(true);
  });
  it('负数不能匹配快照中的正数', () => {
    const data: Snapshot = [
      {
        code: '601088',
        name: '中国神华',
        fields: [{ label: '涨跌幅', value: 1.23, unit: '%', source: '腾讯', fetchedAt: '今天' }],
      },
    ];
    expect(checkDraft(wrap('-1.23%'), data).some((f) => f.原文 === '-1.23')).toBe(true);
  });
  it.each([
    [2000, '亿元', '2000亿', '2000元'],
    ['2000', '亿元', '2000亿', '2000元'],
    [2000, '万元', '2000万', '2000元'],
    [2, '万亿元', '20000亿', '2元'],
    ['2000亿元', undefined, '2000亿', '2000元'],
  ])('按快照单位统一基数：%s %s', (value, unit, matching, wrong) => {
    const data: Snapshot = [
      {
        code: '601088',
        name: '中国神华',
        fields: [{ label: '市值', value, unit, source: '腾讯', fetchedAt: '今天' }],
      },
    ];
    expect(checkDraft(wrap(matching), data)).toEqual([]);
    expect(checkDraft(wrap(wrong), data).some((f) => f.问题.startsWith('数字未在快照'))).toBe(true);
  });
  it('允许必需短语、四舍五入与单位换算', () =>
    expect(
      checkDraft(
        wrap(
          '观察池记录：601088 现价52元，收入2960.31亿元，股息率3.87%。情景演算、不是买入计划、更不推荐跟风。',
        ),
        snapshot,
      ),
    ).toEqual([]));
  it('空正文标记前置声明及双披露缺失', () =>
    expect(checkDraft('', []).map((f) => f.问题)).toHaveLength(3));
  it('标记禁词及快照外数字', () => {
    const flags = checkDraft(wrap('你应该买，建议补仓。现价999元。'), snapshot);
    expect(flags.some((f) => f.原文 === '999')).toBe(true);
    for (const word of ['应该', '买', '建议', '补'])
      expect(flags.some((f) => f.原文 === word)).toBe(true);
  });
  it('不会接受只有免责声明但没有持仓和数据来源的结尾', () =>
    expect(checkDraft('⚠️ 模拟盘记录。非投资建议。', [])).toHaveLength(2));
});
