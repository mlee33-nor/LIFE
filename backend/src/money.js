// Income across side jobs (RSA, eBay, Upwork, plus DoorDash from its own tab).
//
// Entries are { kind: 'income', source, amount, period?, basis?, note? }:
//   - period 'YYYY-MM' = a month's total ("RSA: $1,800 in September")
//   - no period = one payment/sale on the entry's day ("eBay sale, $12 profit")
// A month total replaces that source's individual entries for the month, so a
// report never double counts. Amounts are what was reported (eBay = profit).

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round2 = (n) => Math.round(n * 100) / 100;
const KNOWN = { rsa: 'RSA', ebay: 'eBay', upwork: 'Upwork', doordash: 'DoorDash' };
export const SOURCES = ['RSA', 'eBay', 'Upwork', 'DoorDash'];

export function sourceName(raw) {
  const key = String(raw ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return KNOWN[key] ?? (String(raw ?? '').trim() || 'Other');
}

export const monthOf = (date) => String(date ?? '').slice(0, 7);
export const normPeriod = (v) => {
  const m = String(v ?? '').match(/^(\d{4})-(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}` : null;
};

// incomes: [{ source, amount, date, period?, basis?, note? }] (from interpret);
// daily: day records (for DoorDash net profit).
export function moneySummary(daily, incomes = [], { today } = {}) {
  const thisMonth = monthOf(today);
  const lastMonth = (() => {
    const d = new Date(`${thisMonth}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();

  const cells = new Map(); // `${month}|${source}` -> { total: n|null, items: n }
  const cell = (month, source) => {
    const k = `${month}|${source}`;
    if (!cells.has(k)) cells.set(k, { month, source, total: null, items: 0, entries: 0 });
    return cells.get(k);
  };
  for (const e of incomes) {
    if (!isNum(e.amount)) continue;
    const source = sourceName(e.source);
    const month = e.period ?? monthOf(e.date);
    const c = cell(month, source);
    if (e.period) c.total = round2((c.total ?? 0) + e.amount);
    else { c.items = round2(c.items + e.amount); c.entries++; }
  }
  for (const d of daily) {
    const net = d.doordash?.net_after_expenses ?? d.doordash?.net_profit;
    if (isNum(net)) { const c = cell(monthOf(d.date), 'DoorDash'); c.items = round2(c.items + net); c.entries++; }
  }
  const amountOf = (c) => (c.total !== null ? c.total : c.entries ? c.items : null);

  const months = [...new Set([...cells.values()].map((c) => c.month))].sort();
  const byMonth = months.map((month) => {
    const by_source = {};
    for (const c of cells.values()) if (c.month === month && amountOf(c) !== null) by_source[c.source] = amountOf(c);
    const total = round2(Object.values(by_source).reduce((a, b) => a + b, 0));
    return { month, by_source, total };
  });
  const names = [...new Set([...SOURCES, ...[...cells.values()].map((c) => c.source)])];
  const sources = names.map((source) => {
    const of = (month) => { const c = cells.get(`${month}|${source}`); return c ? amountOf(c) : null; };
    const all = [...cells.values()].filter((c) => c.source === source).map(amountOf).filter(isNum);
    return {
      source,
      this_month: of(thisMonth),
      last_month: of(lastMonth),
      all_time: all.length ? round2(all.reduce((a, b) => a + b, 0)) : null,
      months_logged: all.length,
    };
  });
  return {
    this_month: thisMonth,
    last_month: lastMonth,
    months: byMonth,
    sources,
    totals: {
      this_month: byMonth.find((m) => m.month === thisMonth)?.total ?? null,
      last_month: byMonth.find((m) => m.month === lastMonth)?.total ?? null,
    },
    entries: incomes.filter((e) => isNum(e.amount)).map((e) => ({ ...e, source: sourceName(e.source) }))
      .sort((a, b) => String(b.period ?? b.date).localeCompare(String(a.period ?? a.date))),
  };
}
