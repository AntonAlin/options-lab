// Cost basis and profit & loss. Two sources, in order of preference:
//   1. a transaction log on the portfolio (p.transactions) — buys and sells per position, which
//      gives the running quantity, the average cost and the realised P&L on every sale;
//   2. the position's own `costPrice` (average cost per unit in the instrument currency), for
//      holdings loaded from a custodian file without any trade history.
// Average-cost method throughout ("genomsnittsmetoden"): each buy re-averages the cost, each
// sale realises (price − average) × quantity − fees. Fees on a buy go into the cost. FIFO is not
// offered. Pure functions, covered by tests/core.test.mjs.
import { displayName, normKey } from './instruments.js';
import { isNum, num, sum, uid, parseISODate, toISODate } from './util.js';
import { parseNumber, parseDate, detectDecimal } from './importer.js';

// Types where quantity × price × unit is a cash amount. Futures settle daily and swaps/forwards
// have no purchase price, so they are out; their P&L is the MTM the holdings already show.
export const PNL_TYPES = new Set(['equity', 'etf', 'fund', 'commodity', 'alternative', 'govt_bond', 'corp_bond', 'frn', 'money_market', 'option']);
export const TX_SIDES = ['buy', 'sell'];

// Cash value of one unit at price 1: bonds and bills are quoted in % of par, options per contract.
export function unitOf(pos) {
  if (['govt_bond', 'corp_bond', 'frn', 'money_market'].includes(pos.type)) return 0.01;
  if (pos.type === 'option') return num(pos.multiplier, 1);
  return 1;
}

// Running book for one position from its transactions (sorted by date). Quantities are signed so a
// short position works the same way: closing part of it realises against the average.
// tx: { date, side, qty (>0), price, fees, fx } — fx = base currency per instrument currency on the
// trade date; falls back to `fxNow` so the FX effect only appears when it was recorded.
export function lotBook(txs, unit, fxNow = 1) {
  let q = 0, avg = 0, avgBase = 0; // avg = average cost per unit (local) incl. fees; avgBase in base ccy
  let realised = 0, realisedBase = 0, fees = 0;
  const rows = [];
  for (const tx of [...txs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const fx = isNum(tx.fx) && tx.fx > 0 ? tx.fx : fxNow;
    const dq = (tx.side === 'sell' ? -1 : 1) * Math.abs(num(tx.qty));
    const px = num(tx.price) * unit, fee = num(tx.fees);
    fees += fee;
    let r = 0, rBase = 0;
    if (!dq) { rows.push({ ...tx, qtyAfter: q, avgAfter: avg, realised: 0, realisedBase: 0 }); continue; }
    if (q === 0 || Math.sign(q) === Math.sign(dq)) {
      // Opening or adding: the fee is part of the cost (spread over the units bought).
      const feePerUnit = fee / Math.abs(dq) * (dq > 0 ? 1 : -1);
      avgBase = (q * avgBase + dq * (px + feePerUnit) * fx) / (q + dq);
      avg = (q * avg + dq * (px + feePerUnit)) / (q + dq);
      q += dq;
    } else {
      // Closing (possibly through zero): realise on the overlap, re-open the rest at the trade price.
      const closing = Math.min(Math.abs(dq), Math.abs(q)) * Math.sign(q);
      const feeClose = fee * Math.abs(closing) / Math.abs(dq);
      r = closing * (px - avg) - feeClose;
      rBase = closing * (px * fx - avgBase) - feeClose * fx;
      q -= closing;
      const rest = dq + closing; // what is left of the trade after closing
      if (rest) {
        const feeRest = fee - feeClose;
        avg = px + feeRest / Math.abs(rest) * (rest > 0 ? 1 : -1);
        avgBase = avg * fx;
        q = rest;
      } else if (q === 0) { avg = 0; avgBase = 0; }
    }
    realised += r; realisedBase += rBase;
    rows.push({ ...tx, qtyAfter: q, avgAfter: avg, realised: r, realisedBase: rBase });
  }
  return { qty: q, avg, avgBase, costLocal: q * avg, costBase: q * avgBase, realised, realisedBase, fees, rows };
}

// Per-position cost and P&L for the whole portfolio. `v` is valuePortfolio(p).
export function pnlAnalysis(v, p, { from = null } = {}) {
  const txs = p.transactions || [];
  const byPos = new Map();
  for (const tx of txs) { if (!byPos.has(tx.posId)) byPos.set(tx.posId, []); byPos.get(tx.posId).push(tx); }
  const rows = [];
  for (const x of v.valid) {
    if (!PNL_TYPES.has(x.pos.type)) continue;
    const pos = x.pos, unit = unitOf(pos), fx = v.ctx.fx(pos.ccy);
    if (!isNum(fx)) continue;
    const list = byPos.get(pos.id) || [];
    const book = list.length ? lotBook(list, unit, fx) : null;
    const qty = num(pos.qty);
    const avg = book ? book.avg : isNum(pos.costPrice) ? pos.costPrice * unit : null;
    if (avg == null && !book) { rows.push({ x, pos, name: x.name, covered: false, qty, book: null }); continue; }
    // Cost in base: from the book when it has one, else today's FX (no FX effect to show).
    const costLocal = qty * avg;
    const costBase = book && book.qty === qty ? book.costBase : costLocal * fx;
    const mv = x.r.mv;
    const priceNow = isNum(pos.price) ? pos.price * unit : (qty ? mv / fx / qty : 0);
    const unrealised = mv - costBase;
    const unrealisedLocal = (priceNow - avg) * qty * fx; // at today's FX
    const period = book ? book.rows.filter(r => !from || r.date >= from) : [];
    rows.push({
      x, pos, name: x.name, covered: true, qty, unit, avg, avgPerUnit: avg / unit, costLocal, costBase, mv, fx,
      unrealised, unrealisedPct: costBase ? unrealised / Math.abs(costBase) : 0, fxEffect: unrealised - unrealisedLocal,
      realisedBase: book ? book.realisedBase : 0, realisedPeriod: sum(period.map(r => r.realisedBase)), fees: book ? book.fees * fx : 0,
      book, bookQty: book ? book.qty : null, mismatch: !!book && Math.abs(book.qty - qty) > 1e-9, source: book ? 'transactions' : 'costPrice'
    });
  }
  const covered = rows.filter(r => r.covered);
  const orphans = txs.filter(tx => !v.valid.some(x => x.pos.id === tx.posId));
  const tot = {
    costBase: sum(covered.map(r => r.costBase)), mv: sum(covered.map(r => r.mv)),
    unrealised: sum(covered.map(r => r.unrealised)), fxEffect: sum(covered.map(r => r.fxEffect)),
    realisedAll: sum(covered.map(r => r.realisedBase)), realisedPeriod: sum(covered.map(r => r.realisedPeriod)),
    fees: sum(covered.map(r => r.fees))
  };
  tot.unrealisedPct = tot.costBase ? tot.unrealised / Math.abs(tot.costBase) : 0;
  tot.total = tot.unrealised + tot.realisedAll;
  return {
    rows: rows.sort((a, b) => (b.covered ? Math.abs(b.unrealised) : -1) - (a.covered ? Math.abs(a.unrealised) : -1)),
    covered, uncovered: rows.filter(r => !r.covered), tot, from,
    eligible: v.valid.filter(x => PNL_TYPES.has(x.pos.type)).length, txCount: txs.length, orphans,
    mismatches: covered.filter(r => r.mismatch).length
  };
}

// ---- transactions from a file ----------------------------------------------------------------------
const TX_ALIASES = {
  date: ['date', 'tradedate', 'transactiondate', 'datum', 'affärsdag', 'affärsdatum', 'handelsdag', 'settlementdate'],
  side: ['side', 'type', 'transactiontype', 'buysell', 'action', 'typ', 'köpsälj', 'transaktionstyp', 'händelse'],
  qty: ['qty', 'quantity', 'shares', 'units', 'nominal', 'antal', 'volym', 'kontrakt', 'contracts'],
  price: ['price', 'tradeprice', 'executionprice', 'kurs', 'pris', 'avslutskurs'],
  fees: ['fees', 'fee', 'commission', 'courtage', 'avgift', 'avgifter', 'brokerage'],
  fx: ['fx', 'fxrate', 'exchangerate', 'valutakurs', 'växelkurs'],
  ccy: ['ccy', 'currency', 'valuta'],
  isin: ['isin'], ticker: ['ticker', 'symbol', 'kortnamn'], name: ['name', 'security', 'instrument', 'namn', 'värdepapper'],
  note: ['note', 'notes', 'comment', 'reference', 'anteckning', 'referens']
};
const SELL_WORDS = /^(sell|sale|sold|s|sälj|såld|försäljning|redeem|redemption|inlösen|short)$/i;
const BUY_WORDS = /^(buy|bought|b|köp|köpt|purchase|subscribe|subscription|teckning|cover)$/i;

// rows: header + body as the importer returns them. Positions are matched on ISIN, then ticker,
// then name; an unmatched row is returned in `unmatched` with its reason.
export function parseTransactions(rows, positions) {
  if (!rows || rows.length < 2) return { txs: [], unmatched: [] };
  const head = rows[0].map(h => normKey(h));
  const col = {};
  for (const [field, aliases] of Object.entries(TX_ALIASES)) {
    const i = head.findIndex(h => aliases.includes(h));
    if (i >= 0) col[field] = i;
  }
  if (col.date == null || col.qty == null || col.price == null) return { txs: [], unmatched: [], error: 'columns' };
  const dec = detectDecimal(rows.slice(1).flatMap(r => [r[col.qty], r[col.price]]), '.');
  const find = (key, val) => positions.find(p => p[key] && normKey(p[key]) === normKey(val));
  const txs = [], unmatched = [];
  rows.slice(1).forEach((r, i) => {
    if (!r.some(c => String(c ?? '').trim() !== '')) return;
    const cell = f => (col[f] == null ? '' : r[col[f]]);
    const pos = (cell('isin') && find('isin', cell('isin'))) || (cell('ticker') && find('ticker', cell('ticker'))) || (cell('name') && (find('name', cell('name')) || find('ticker', cell('name')) || find('isin', cell('name'))));
    const date = parseDate(cell('date'));
    const qtyRaw = parseNumber(cell('qty'), dec), price = parseNumber(cell('price'), dec);
    const sideText = String(cell('side') ?? '').trim();
    const side = SELL_WORDS.test(sideText) || (!sideText && qtyRaw < 0) ? 'sell' : BUY_WORDS.test(sideText) || !sideText ? 'buy' : null;
    const reason = !pos ? 'no_position' : !date ? 'bad_date' : !(Math.abs(qtyRaw) > 0) || !isNum(price) ? 'bad_number' : !side ? 'bad_side' : '';
    if (reason) { unmatched.push({ line: i + 2, raw: r, reason }); return; }
    const fx = parseNumber(cell('fx'), dec), fees = parseNumber(cell('fees'), dec);
    txs.push({ id: uid('tx'), posId: pos.id, date, side, qty: Math.abs(qtyRaw), price, fees: isNum(fees) ? Math.abs(fees) : 0, ...(isNum(fx) && fx > 0 ? { fx } : {}), note: String(cell('note') ?? '').trim() });
  });
  return { txs, unmatched };
}

export function transactionsCSVRows(p) {
  const byId = new Map(p.positions.map(x => [x.id, x]));
  const head = ['date', 'side', 'name', 'isin', 'ticker', 'qty', 'price', 'ccy', 'fees', 'fx', 'note'];
  const body = [...(p.transactions || [])].sort((a, b) => (a.date < b.date ? -1 : 1)).map(tx => {
    const pos = byId.get(tx.posId) || {};
    return [tx.date, tx.side, pos.type ? displayName(pos) : '', pos.isin || '', pos.ticker || '', tx.qty, tx.price, pos.ccy || '', tx.fees || 0, tx.fx ?? '', tx.note || ''];
  });
  return [head, ...body];
}

export const startOfYear = iso => toISODate(new Date(Date.UTC(parseISODate(iso).getUTCFullYear(), 0, 1)));
