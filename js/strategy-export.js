// Options Lab → Portfolio Lab. Turns an options strategy into ordinary portfolio positions
// (options, shares or futures) and adds them to a portfolio in the shared localStorage workspace.
// Pure functions; options-lab.html wires them to its UI through window.NexusExport.
import { newPortfolio } from './store.js';
import { uid, addMonthsISO, parseISODate, toISODate, DAY_MS } from './util.js';

export const WORKSPACE_KEY = 'nexus_portfolio_lab_v1';

const CLASS_OF = { equity: 'equity', warrant: 'equity', fx: 'fx', commodity: 'commodity', rate: 'rates' };

function addDaysISO(iso, days) {
  const d = parseISODate(iso);
  return d ? toISODate(new Date(d.getTime() + Math.round(days) * DAY_MS)) : '';
}
const round = (x, d) => { const f = 10 ** d; return Math.round(x * f) / f; };

// input: {
//   strategyName, instrument ('equity'|'fx'|'commodity'|'rate'|'warrant'), valDate (ISO),
//   S, ratePct, divPct, dilution, contractMult, units, ccy, underlying, ticker, fxCcy,
//   legs: [{ type: 'call'|'put'|'stock', side: 'long'|'short', qty, strike, style: 'eu'|'am', days, sigma, theo }]
// }
// Returns { positions, notes } — notes are codes the UI translates.
export function strategyToPositions(input) {
  const {
    strategyName = 'Strategy', instrument = 'equity', valDate, S, ratePct = 0, divPct = 0, dilution = 1,
    contractMult = 100, units = 1, ccy = 'SEK', underlying = '', ticker = '', fxCcy = ''
  } = input;
  const cls = CLASS_OF[instrument] || 'equity';
  const under = (underlying || ticker || 'Underlying').trim();
  const notes = new Set();
  const today = valDate || toISODate(new Date());
  const tag = `Options Lab ${today}`;
  const positions = [];

  for (const leg of input.legs || []) {
    if (!(leg.qty > 0)) continue;
    const sign = leg.side === 'short' ? -1 : 1;
    if (leg.type === 'stock') {
      if (cls === 'equity') {
        positions.push({
          id: uid(), type: 'equity', name: under, ticker: ticker || undefined, issuer: under,
          qty: sign * leg.qty * units * contractMult, price: round(S, 6), ccy, beta: 1, strategy: strategyName, notes: tag
        });
      } else {
        // The "underlying" of an FX, commodity or rate strategy is a forward/future.
        const pos = {
          id: uid(), type: 'future', name: `${under} ${cls === 'fx' ? 'FX' : ''} future`.replace(/\s+/g, ' ').trim(), ticker: ticker || undefined,
          qty: sign * leg.qty * units, price: round(S, 6), multiplier: contractMult, ccy,
          underlyingClass: cls, maturity: addDaysISO(today, leg.days || 30), mtm: 0, beta: 1, strategy: strategyName, notes: tag
        };
        if (cls === 'fx') { pos.buyCcy = fxCcy || undefined; if (!fxCcy) notes.add('fx_ccy_missing'); }
        if (cls === 'rates') notes.add('rate_duration');
        positions.push(pos);
      }
      continue;
    }
    const maturity = leg.expiry || addDaysISO(today, leg.days);
    const pos = {
      id: uid(), type: 'option',
      name: `${under} ${leg.type === 'put' ? 'Put' : 'Call'} ${round(leg.strike, 4)} ${maturity}`,
      ticker: ticker || undefined, issuer: under,
      qty: sign * leg.qty * units, optType: leg.type === 'put' ? 'put' : 'call', strike: round(leg.strike, 6), maturity,
      underlyingPrice: round(S, 6), vol: round(leg.sigma * 100, 4), multiplier: contractMult, ccy,
      underlyingClass: cls, rate: round(ratePct, 4), beta: 1, strategy: strategyName, notes: tag
    };
    if (cls === 'equity' || cls === 'fx') pos.divYield = round(divPct, 4);
    if (cls === 'fx') { pos.buyCcy = fxCcy || undefined; if (!fxCcy) notes.add('fx_ccy_missing'); }
    // Portfolio Lab prices options with Black-Scholes. American legs and diluted warrants are
    // carried at the Options Lab value instead, so the market value matches what you saw.
    if (leg.style === 'am' || (instrument === 'warrant' && dilution < 1)) {
      pos.price = round(leg.theo * (instrument === 'warrant' ? dilution : 1), 6);
      notes.add(leg.style === 'am' ? 'american_fixed_price' : 'warrant_fixed_price');
    }
    positions.push(pos);
  }
  // Clean undefined keys so the stored JSON stays tidy.
  positions.forEach(p => Object.keys(p).forEach(k => p[k] === undefined && delete p[k]));
  return { positions, notes: [...notes] };
}

// ws: the parsed workspace object (or null). target: { portfolioId } or { newName, baseCcy }.
// Returns { ws, portfolioId, created } without touching storage.
export function addToWorkspace(ws, positions, target) {
  const out = ws && typeof ws === 'object' ? JSON.parse(JSON.stringify(ws)) : {};
  out.version = out.version || 1;
  out.settings = out.settings || {};
  out.portfolios = out.portfolios || {};
  let id = target.portfolioId, created = false;
  if (!id || !out.portfolios[id]) {
    const p = newPortfolio({ name: target.newName || 'Options', baseCcy: target.baseCcy || 'SEK', fundType: 'Mandate' });
    out.portfolios[p.id] = p;
    id = p.id; created = true;
  }
  const p = out.portfolios[id];
  p.positions = [...(p.positions || []), ...positions];
  p.updatedAt = new Date().toISOString();
  out.activeId = id;
  return { ws: out, portfolioId: id, created };
}

export function listPortfolios(ws) {
  return Object.values((ws && ws.portfolios) || {}).map(p => ({ id: p.id, name: p.name, baseCcy: p.baseCcy, n: (p.positions || []).length }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export { addMonthsISO };
