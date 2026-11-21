import { expect, it } from 'vitest';
import { parseQuotes, parseFinancial, dividendYield, poolCodes } from './market';
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
});
