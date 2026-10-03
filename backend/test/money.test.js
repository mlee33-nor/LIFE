import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moneySummary, sourceName } from '../src/money.js';
import { interpret } from '../src/interpret.js';
import { mapSheetRows, parseCsv } from '../src/sheet.js';

test('source names are normalized', () => {
  assert.deepEqual(['rsa', 'Ebay', 'e-bay', 'UPWORK', 'Etsy'].map(sourceName), ['RSA', 'eBay', 'eBay', 'Upwork', 'Etsy']);
});

test('month totals, single sales, DoorDash net, this/last month', () => {
  const at = (d) => new Date(`${d}T12:00:00-07:00`);
  const { daily, incomes } = interpret([
    { id: '1', tracker: 'life', at: at('2026-10-03'), data: { kind: 'income', source: 'RSA', amount: 1800, period: '2026-09' } },
    { id: '2', tracker: 'life', at: at('2026-10-03'), data: { kind: 'income', source: 'RSA', amount: 1200, period: '2026-08' } },
    { id: '3', tracker: 'life', at: at('2026-10-03'), data: { kind: 'income', source: 'ebay', amount: 45, period: '2026-09' } },
    { id: '4', tracker: 'life', at: at('2026-09-10'), data: { kind: 'income', source: 'eBay', amount: 20 } }, // replaced by the month total
    { id: '5', tracker: 'life', at: at('2026-10-02'), data: { kind: 'income', source: 'eBay', amount: '12.5' } },
    { id: '6', tracker: 'life', at: at('2026-09-27'), data: { kind: 'dash', net_profit: 9.15 } },
  ]);
  const m = moneySummary(daily, incomes, { today: '2026-10-03' });
  assert.deepEqual(m.months.map((x) => [x.month, x.by_source, x.total]), [
    ['2026-08', { RSA: 1200 }, 1200],
    ['2026-09', { RSA: 1800, eBay: 45, DoorDash: 9.15 }, 1854.15],
    ['2026-10', { eBay: 12.5 }, 12.5],
  ]);
  const src = Object.fromEntries(m.sources.map((s) => [s.source, [s.this_month, s.last_month, s.all_time]]));
  assert.deepEqual(src.RSA, [null, 1800, 3000]);
  assert.deepEqual(src.eBay, [12.5, 45, 57.5]);
  assert.deepEqual(src.Upwork, [null, null, null]);
  assert.deepEqual([m.totals.this_month, m.totals.last_month], [12.5, 1854.15]);
});

test('sheet Money rows: monthly total or a single payment', () => {
  const rows = parseCsv(['row_id,date,time_local,timezone,tracker,category,event,label,value,unit,outcome,status',
    'm1,2026-09-01,,,Money,income,monthly,RSA,1800,,,reported',
    'm2,2026-10-02,14:00,,Money,income,sale,eBay,12,,profit,reported',
    'm3,2026-10-03,,,Money,income,monthly,Upwork,300,2026-09,,reported'].join('\n'));
  const r = interpret(mapSheetRows(rows).map((e, i) => ({ id: String(i), tracker: e.tracker, at: new Date(e.at), data: e.data })));
  assert.deepEqual(r.incomes.map((x) => [x.source, x.amount, x.period, x.date]),
    [['RSA', 1800, '2026-09', '2026-09-01'], ['eBay', 12, null, '2026-10-02'], ['Upwork', 300, '2026-09', '2026-10-03']]);
});
