// ============================================================================================
//  INSTRUMENT REGISTRY
//
//  Every instrument type the platform understands lives in INSTRUMENTS below. A type is one
//  object: its labels, which fields it uses, and a `risk()` function that turns a position into
//  numbers the analytics layer can add up. Forms, bulk-upload templates, column mapping,
//  validation, the holdings table and every analytics page are generated from this file.
//
//  To add a new instrument type: add a field to FIELDS if you need one that is not there yet,
//  then add an entry to INSTRUMENTS. Nothing else has to change. See the README for an example.
// ============================================================================================
import { bsm, bondAnalytics, swapAnnuity } from './pricing.js';
import { isNum, num, freqOf, yearsBetween } from './util.js';

// ---- asset classes, used for allocation and the risk model ----------------------------------
export const ASSET_CLASSES = {
  equity:        { en: 'Equity',            sv: 'Aktier' },
  fixed_income:  { en: 'Fixed income',      sv: 'Räntebärande' },
  money_market:  { en: 'Money market',      sv: 'Penningmarknad' },
  cash:          { en: 'Cash',              sv: 'Likvida medel' },
  commodity:     { en: 'Commodities',       sv: 'Råvaror' },
  currency:      { en: 'Currency',          sv: 'Valuta' },
  alternative:   { en: 'Alternatives',      sv: 'Alternativa' },
  mixed:         { en: 'Multi-asset',       sv: 'Blandat' }
};

export const RATINGS = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D'];
export const ratingScore = r => { const i = RATINGS.indexOf(String(r || '').toUpperCase().trim()); return i < 0 ? null : i + 1; };
export const ratingFromScore = s => (isNum(s) ? RATINGS[Math.min(RATINGS.length, Math.max(1, Math.round(s))) - 1] : '');
export const isInvestmentGrade = r => { const s = ratingScore(r); return s != null && s <= 10; };

const REGION_OF = {
  SE: 'nordics', NO: 'nordics', DK: 'nordics', FI: 'nordics', IS: 'nordics',
  DE: 'europe', FR: 'europe', NL: 'europe', BE: 'europe', LU: 'europe', IE: 'europe', AT: 'europe', CH: 'europe',
  GB: 'europe', ES: 'europe', IT: 'europe', PT: 'europe', PL: 'europe', CZ: 'europe', EU: 'europe', GR: 'europe',
  US: 'north_america', CA: 'north_america',
  JP: 'asia_pacific', AU: 'asia_pacific', NZ: 'asia_pacific', HK: 'asia_pacific', SG: 'asia_pacific', KR: 'asia_pacific', TW: 'asia_pacific',
  CN: 'emerging', IN: 'emerging', BR: 'emerging', MX: 'emerging', ZA: 'emerging', TR: 'emerging', ID: 'emerging', SA: 'emerging', CL: 'emerging',
  XS: 'global', GLOBAL: 'global', WORLD: 'global'
};
export const REGIONS = {
  nordics: { en: 'Nordics', sv: 'Norden' },
  europe: { en: 'Europe ex Nordics', sv: 'Europa exkl. Norden' },
  north_america: { en: 'North America', sv: 'Nordamerika' },
  asia_pacific: { en: 'Asia-Pacific', sv: 'Asien-Stillahavsområdet' },
  emerging: { en: 'Emerging markets', sv: 'Tillväxtmarknader' },
  global: { en: 'Global', sv: 'Global' },
  other: { en: 'Other / unknown', sv: 'Övrigt / okänt' }
};
export const regionOf = c => REGION_OF[String(c || '').toUpperCase().trim()] || 'other';

// ---- field catalogue -------------------------------------------------------------------------
// type: text | number | date | select | ccy. `aliases` feed the bulk-upload auto-mapper
// (compared lower-case with spaces/underscores/dots stripped), so add any header your
// custodian or PMS spits out.
export const FIELDS = {
  name:        { type: 'text', en: 'Name', sv: 'Namn', aliases: ['name', 'security', 'securityname', 'instrument', 'instrumentname', 'description', 'namn', 'värdepapper', 'benämning', 'beskrivning'] },
  ticker:      { type: 'text', en: 'Ticker / ID', sv: 'Ticker / ID', aliases: ['ticker', 'symbol', 'bloomberg', 'bbgticker', 'ric', 'kortnamn', 'id', 'securityid'] },
  isin:        { type: 'text', en: 'ISIN', sv: 'ISIN', aliases: ['isin', 'isincode'] },
  issuer:      { type: 'text', en: 'Issuer', sv: 'Emittent', aliases: ['issuer', 'issuername', 'company', 'emittent', 'utgivare', 'bolag', 'counterparty', 'motpart'] },
  type:        { type: 'select', en: 'Instrument type', sv: 'Instrumenttyp', aliases: ['type', 'instrumenttype', 'securitytype', 'assettype', 'typ', 'instrumenttyp', 'värdepapperstyp'] },
  qty:         { type: 'number', en: 'Quantity', sv: 'Antal', aliases: ['qty', 'quantity', 'shares', 'units', 'position', 'holding', 'antal', 'innehav', 'andelar', 'nominal', 'nominalvalue', 'nominellt', 'facevalue', 'notional', 'contracts', 'kontrakt', 'amount', 'belopp'] },
  price:       { type: 'number', en: 'Price', sv: 'Kurs', aliases: ['price', 'lastprice', 'close', 'marketprice', 'kurs', 'pris', 'senastekurs', 'stängningskurs', 'cleanprice', 'premium', 'premie', 'nav', 'navperunit'] },
  ccy:         { type: 'ccy', en: 'Currency', sv: 'Valuta', aliases: ['ccy', 'currency', 'cur', 'valuta', 'tradingcurrency', 'handelsvaluta'] },
  multiplier:  { type: 'number', en: 'Multiplier', sv: 'Multiplikator', aliases: ['multiplier', 'contractsize', 'mult', 'multiplikator', 'kontraktsstorlek', 'pointvalue'] },
  sector:      { type: 'text', en: 'Sector', sv: 'Sektor', aliases: ['sector', 'gicssector', 'industry', 'sektor', 'bransch', 'industri'] },
  country:     { type: 'text', en: 'Country (ISO)', sv: 'Land (ISO)', aliases: ['country', 'countrycode', 'domicile', 'countryofrisk', 'land', 'landskod', 'hemvist'] },
  rating:      { type: 'text', en: 'Rating', sv: 'Rating', aliases: ['rating', 'creditrating', 'sp', 'moodys', 'kreditbetyg', 'betyg'] },
  beta:        { type: 'number', en: 'Beta', sv: 'Beta', aliases: ['beta'] },
  adv:         { type: 'number', en: 'Avg daily volume', sv: 'Snittvolym/dag', aliases: ['adv', 'avgdailyvolume', 'averagevolume', 'volume', 'snittvolym', 'omsättning', 'volym'] },
  maturity:    { type: 'date', en: 'Maturity / expiry', sv: 'Förfall', aliases: ['maturity', 'maturitydate', 'expiry', 'expiration', 'expirydate', 'enddate', 'förfall', 'förfallodag', 'förfallodatum', 'slutdag', 'lösendag'] },
  coupon:      { type: 'number', en: 'Coupon %', sv: 'Kupong %', aliases: ['coupon', 'couponrate', 'cpn', 'kupong', 'kupongränta', 'ränta'] },
  freq:        { type: 'select', en: 'Payments / year', sv: 'Betalningar/år', options: ['1', '2', '4', '12'], aliases: ['freq', 'frequency', 'couponfrequency', 'frekvens', 'kupongfrekvens'] },
  yield:       { type: 'number', en: 'Yield %', sv: 'Avkastning %', aliases: ['yield', 'ytm', 'yieldtomaturity', 'marketyield', 'effektivränta', 'avkastning', 'ränteläge'] },
  spread:      { type: 'number', en: 'Spread (bp)', sv: 'Spread (bp)', aliases: ['spread', 'discountmargin', 'dm', 'quotedmargin', 'marginal', 'spreadbp'] },
  optType:     { type: 'select', en: 'Call / put', sv: 'Köp / sälj', options: ['call', 'put'], aliases: ['callput', 'putcall', 'optiontype', 'cp', 'optionstyp', 'köpsälj'] },
  strike:      { type: 'number', en: 'Strike', sv: 'Lösenpris', aliases: ['strike', 'strikeprice', 'exerciseprice', 'lösenpris', 'lösenkurs'] },
  underlyingPrice: { type: 'number', en: 'Underlying price', sv: 'Underliggande kurs', aliases: ['underlyingprice', 'spot', 'underlying', 'underliggande', 'underliggandekurs', 'spotpris'] },
  vol:         { type: 'number', en: 'Implied vol %', sv: 'Implicit vol %', aliases: ['vol', 'iv', 'impliedvol', 'impliedvolatility', 'volatility', 'volatilitet', 'implicitvolatilitet'] },
  rate:        { type: 'number', en: 'Risk-free rate %', sv: 'Riskfri ränta %', aliases: ['rate', 'riskfreerate', 'rfr', 'riskfriränta'] },
  divYield:    { type: 'number', en: 'Dividend / foreign rate %', sv: 'Utdelning / utländsk ränta %', aliases: ['divyield', 'dividendyield', 'dividend', 'q', 'foreignrate', 'utdelningsyield', 'utdelning', 'direktavkastning'] },
  strategy:    { type: 'text', en: 'Strategy', sv: 'Strategi', aliases: ['strategy', 'strategi', 'book', 'bok', 'portfoliogroup', 'group', 'grupp'] },
  underlyingClass: { type: 'select', en: 'Underlying', sv: 'Underliggande tillgång', options: ['equity', 'rates', 'commodity', 'fx', 'credit'], aliases: ['underlyingclass', 'underlyingtype', 'underlyingasset', 'tillgångsslag', 'underliggandetyp'] },
  duration:    { type: 'number', en: 'Duration (yrs)', sv: 'Duration (år)', aliases: ['duration', 'modifiedduration', 'modduration', 'ctdduration', 'duration(år)', 'durationår'] },
  buyCcy:      { type: 'ccy', en: 'Buy currency', sv: 'Köpvaluta', aliases: ['buyccy', 'buycurrency', 'köpvaluta', 'ccy1'] },
  buyAmount:   { type: 'number', en: 'Buy amount', sv: 'Köpbelopp', aliases: ['buyamount', 'buynotional', 'köpbelopp', 'amount1'] },
  sellCcy:     { type: 'ccy', en: 'Sell currency', sv: 'Säljvaluta', aliases: ['sellccy', 'sellcurrency', 'säljvaluta', 'ccy2'] },
  sellAmount:  { type: 'number', en: 'Sell amount', sv: 'Säljbelopp', aliases: ['sellamount', 'sellnotional', 'säljbelopp', 'amount2'] },
  direction:   { type: 'select', en: 'Direction', sv: 'Riktning', options: ['receive', 'pay'], aliases: ['direction', 'side', 'payreceive', 'riktning', 'sida'] },
  protection:  { type: 'select', en: 'Protection', sv: 'Skydd', options: ['buy', 'sell'], aliases: ['protection', 'buysell', 'protectionside', 'skydd'] },
  fixedRate:   { type: 'number', en: 'Fixed rate %', sv: 'Fast ränta %', aliases: ['fixedrate', 'swaprate', 'fastränta', 'contractrate'] },
  marketRate:  { type: 'number', en: 'Market rate %', sv: 'Marknadsränta %', aliases: ['marketrate', 'currentrate', 'parrate', 'marknadsränta'] },
  marketSpread:{ type: 'number', en: 'Market spread (bp)', sv: 'Marknadsspread (bp)', aliases: ['marketspread', 'currentspread', 'marknadsspread'] },
  mtm:         { type: 'number', en: 'Market value override', sv: 'Marknadsvärde (manuellt)', aliases: ['mtm', 'marketvalue', 'mv', 'fairvalue', 'marknadsvärde', 'värde', 'npv'] },
  subClass:    { type: 'select', en: 'Look-through class', sv: 'Genomlyst tillgångsslag', options: ['equity', 'fixed_income', 'money_market', 'mixed', 'alternative', 'commodity'], aliases: ['assetclass', 'fundtype', 'category', 'tillgångsklass', 'fondtyp', 'kategori'] },
  equityShare: { type: 'number', en: 'Equity share %', sv: 'Aktieandel %', aliases: ['equityshare', 'equityweight', 'aktieandel'] },
  altType:     { type: 'select', en: 'Alternative type', sv: 'Alternativ typ', options: ['private_equity', 'real_estate', 'hedge_fund', 'infrastructure', 'private_credit', 'crypto', 'other'], aliases: ['alttype', 'subtype', 'strategy', 'strategi', 'undertyp'] },
  liquidityDays:{ type: 'number', en: 'Days to liquidate', sv: 'Dagar att avveckla', aliases: ['liquiditydays', 'redemptiondays', 'noticeperiod', 'likviditetsdagar', 'uppsägningstid'] },
  notes:       { type: 'text', en: 'Notes', sv: 'Anteckningar', aliases: ['notes', 'comment', 'comments', 'anteckning', 'anteckningar', 'kommentar'] }
};

export const OPTION_LABELS = {
  call: { en: 'Call', sv: 'Köp (call)' }, put: { en: 'Put', sv: 'Sälj (put)' },
  equity: { en: 'Equity', sv: 'Aktier' }, rates: { en: 'Interest rates', sv: 'Räntor' }, commodity: { en: 'Commodity', sv: 'Råvara' },
  fx: { en: 'Currency', sv: 'Valuta' }, credit: { en: 'Credit', sv: 'Kredit' },
  receive: { en: 'Receive fixed', sv: 'Erhåll fast' }, pay: { en: 'Pay fixed', sv: 'Betala fast' },
  buy: { en: 'Buy protection', sv: 'Köp skydd' }, sell: { en: 'Sell protection', sv: 'Sälj skydd' },
  fixed_income: { en: 'Fixed income', sv: 'Räntebärande' }, money_market: { en: 'Money market', sv: 'Penningmarknad' },
  mixed: { en: 'Multi-asset', sv: 'Blandat' }, alternative: { en: 'Alternative', sv: 'Alternativ' },
  private_equity: { en: 'Private equity', sv: 'Onoterat (PE)' }, real_estate: { en: 'Real estate', sv: 'Fastigheter' },
  hedge_fund: { en: 'Hedge fund', sv: 'Hedgefond' }, infrastructure: { en: 'Infrastructure', sv: 'Infrastruktur' },
  private_credit: { en: 'Private credit', sv: 'Direktlån' }, crypto: { en: 'Crypto asset', sv: 'Kryptotillgång' }, other: { en: 'Other', sv: 'Övrigt' },
  '1': { en: 'Annual', sv: 'Årlig' }, '2': { en: 'Semi-annual', sv: 'Halvårs' }, '4': { en: 'Quarterly', sv: 'Kvartal' }, '12': { en: 'Monthly', sv: 'Månad' }
};

// ---- shared risk building blocks --------------------------------------------------------------
// Every risk() returns amounts in BASE currency (ctx.fx converts) with this shape:
//   mv          market value (what the fund owns; derivatives often ~0)
//   exposure    commitment-approach gross exposure (UCITS style), always >= 0
//   net         signed economic exposure to the underlying
//   assetClass  bucket for allocation charts
//   eqDelta     equity-market delta (value change for +1.00 = +100% move), beta-adjusted in the model
//   ir01        value change for +1bp parallel rates move, keyed by currency
//   cs01        value change for +1bp credit-spread widening
//   cmDelta     commodity delta
//   fx          { CCY: amount } currency exposure excluding the base currency
//   vega        value change per +1 vol point; gamma: cash gamma, so P&L from a return r is ½·gamma·r²
//   fi          { ytm, modDur, convexity, years, rating } for the fixed-income page, when relevant
//   liqDays     days to liquidate the whole position (null = derive from ADV)
function blank(ccyBase) {
  return { mv: 0, exposure: 0, net: 0, assetClass: 'cash', eqDelta: 0, beta: 1, ir01: {}, cs01: 0, cmDelta: 0, fx: {}, vega: 0, gamma: 0, fi: null, liqDays: null, specificVol: 0, base: ccyBase, warnings: [] };
}
function addFx(r, ccy, amtBase, base) {
  if (!ccy || ccy === base || !amtBase) return;
  r.fx[ccy] = (r.fx[ccy] || 0) + amtBase;
}
function addIr01(r, ccy, v) { if (v) r.ir01[ccy] = (r.ir01[ccy] || 0) + v; }

function fxOrWarn(p, ctx, r, ccy = p.ccy) {
  const x = ctx.fx(ccy);
  if (!isNum(x)) { r.warnings.push('fx_missing:' + ccy); return NaN; }
  return x;
}

function cashLike(p, ctx, assetClass) {
  const r = blank(ctx.base);
  const fx = fxOrWarn(p, ctx, r);
  const mv = num(p.qty) * num(p.price, 1) * fx;
  Object.assign(r, { mv, exposure: Math.abs(mv), net: mv, assetClass, liqDays: 0 });
  addFx(r, p.ccy, mv, ctx.base);
  return r;
}

function bondRisk(p, ctx, { floating = false, government = false } = {}) {
  const r = blank(ctx.base);
  const fx = fxOrWarn(p, ctx, r);
  const a = bondAnalytics({
    valuationDate: ctx.valDate, maturity: p.maturity, couponPct: num(p.coupon), freq: freqOf(p.freq, 1),
    cleanPrice: isNum(p.price) ? p.price : undefined, yieldPct: isNum(p.yield) ? p.yield : undefined
  });
  if (!a) {
    r.warnings.push('bond_unpriced');
    const mv = num(p.qty) * num(p.price) / 100 * fx;
    Object.assign(r, { mv, exposure: Math.abs(mv), net: mv, assetClass: 'fixed_income' });
    addFx(r, p.ccy, mv, ctx.base);
    return r;
  }
  const mv = (isNum(p.mtm) ? p.mtm : num(p.qty) * a.dirty / 100) * fx;
  // A floater's rate duration is the time to the next reset; its spread duration is the full thing.
  const f = freqOf(p.freq, 4);
  const rateDur = floating ? Math.min(a.yearsToMaturity, 1 / f) : a.modDur;
  const spreadDur = a.modDur;
  Object.assign(r, {
    mv, exposure: Math.abs(mv), net: mv, assetClass: 'fixed_income',
    cs01: government ? 0 : -mv * spreadDur * 1e-4,
    fi: {
      ytm: floating && isNum(p.yield) ? p.yield / 100 : a.ytm, modDur: rateDur, spreadDur: government ? 0 : spreadDur,
      convexity: floating ? 0 : a.convexity, years: a.yearsToMaturity, rating: p.rating || '', accrued: a.accrued, dirty: a.dirty
    }
  });
  addIr01(r, p.ccy, -mv * rateDur * 1e-4);
  addFx(r, p.ccy, mv, ctx.base);
  return r;
}

const COMMON = ['name', 'ticker', 'isin', 'issuer'];
const CLASSIFY = ['sector', 'country'];

// ---- the registry ------------------------------------------------------------------------------
export const INSTRUMENTS = {
  equity: {
    en: 'Equity', sv: 'Aktie', group: 'securities', icon: 'EQ',
    hint: { en: 'Listed shares. Quantity in shares, price per share.', sv: 'Noterade aktier. Antal aktier, kurs per aktie.' },
    fields: [...COMMON, 'qty', 'price', 'ccy', ...CLASSIFY, 'beta', 'adv', 'strategy', 'notes'],
    required: ['name', 'qty', 'price', 'ccy'],
    defaults: { beta: 1 },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const mv = num(p.qty) * num(p.price) * fx;
      Object.assign(r, { mv, exposure: Math.abs(mv), net: mv, assetClass: 'equity', eqDelta: mv, beta: num(p.beta, 1), specificVol: ctx.cma.equitySpecificVol });
      addFx(r, p.ccy, mv, ctx.base);
      return r;
    }
  },

  etf: {
    en: 'ETF', sv: 'ETF (börshandlad fond)', group: 'funds', icon: 'ETF',
    hint: { en: 'Set the look-through class so an equity ETF is treated as equity risk and a bond ETF as duration.', sv: 'Ange genomlyst tillgångsslag så att en aktie-ETF behandlas som aktierisk och en ränte-ETF som duration.' },
    fields: [...COMMON, 'qty', 'price', 'ccy', 'subClass', 'equityShare', 'duration', 'beta', ...CLASSIFY, 'adv', 'notes'],
    required: ['name', 'qty', 'price', 'ccy', 'subClass'],
    defaults: { subClass: 'equity', beta: 1 },
    risk(p, ctx) { return fundRisk(p, ctx, 1); }
  },

  fund: {
    en: 'Mutual fund', sv: 'Fond (UCITS/AIF)', group: 'funds', icon: 'FND',
    hint: { en: 'Units × NAV. Redemption settles in a few days, so liquidity defaults to 3 days.', sv: 'Andelar × NAV-kurs. Inlösen tar några dagar, så likviditet sätts som standard till 3 dagar.' },
    fields: [...COMMON, 'qty', 'price', 'ccy', 'subClass', 'equityShare', 'duration', 'beta', 'liquidityDays', ...CLASSIFY, 'notes'],
    required: ['name', 'qty', 'price', 'ccy', 'subClass'],
    defaults: { subClass: 'mixed', equityShare: 50, liquidityDays: 3, beta: 1 },
    risk(p, ctx) { return fundRisk(p, ctx, 3); }
  },

  govt_bond: {
    en: 'Government bond', sv: 'Statsobligation', group: 'fixed_income', icon: 'GOV',
    hint: { en: 'Quantity = nominal amount. Price = clean price in % of par. Give yield instead of price if that is what you have.', sv: 'Antal = nominellt belopp. Kurs = ren kurs i % av nominellt. Ange avkastning i stället för kurs om det är vad du har.' },
    fields: [...COMMON, 'qty', 'price', 'yield', 'ccy', 'coupon', 'freq', 'maturity', 'rating', 'country', 'notes'],
    required: ['name', 'qty', 'ccy', 'maturity'],
    requireOneOf: [['price', 'yield']],
    defaults: { freq: '1', rating: 'AAA', coupon: 0 },
    labels: { qty: { en: 'Nominal', sv: 'Nominellt belopp' }, price: { en: 'Clean price %', sv: 'Ren kurs %' } },
    risk(p, ctx) { return bondRisk(p, ctx, { government: true }); }
  },

  corp_bond: {
    en: 'Corporate bond', sv: 'Företagsobligation', group: 'fixed_income', icon: 'CRP',
    hint: { en: 'Fixed-coupon credit. Carries both rate duration and spread duration.', sv: 'Kreditobligation med fast kupong. Bär både ränte- och spreadduration.' },
    fields: [...COMMON, 'qty', 'price', 'yield', 'ccy', 'coupon', 'freq', 'maturity', 'rating', ...CLASSIFY, 'adv', 'notes'],
    required: ['name', 'issuer', 'qty', 'ccy', 'maturity'],
    requireOneOf: [['price', 'yield']],
    defaults: { freq: '1' },
    labels: { qty: { en: 'Nominal', sv: 'Nominellt belopp' }, price: { en: 'Clean price %', sv: 'Ren kurs %' } },
    risk(p, ctx) { return bondRisk(p, ctx); }
  },

  frn: {
    en: 'Floating rate note', sv: 'FRN (rörlig kupong)', group: 'fixed_income', icon: 'FRN',
    hint: { en: 'Coupon = current fixing + margin. Rate duration is time to next reset; spread duration runs to maturity. Typical for Nordic credit funds.', sv: 'Kupong = aktuell fixing + marginal. Räntedurationen är tid till nästa räntesättning; kreditdurationen löper till förfall. Vanligt i nordiska kreditfonder.' },
    fields: [...COMMON, 'qty', 'price', 'yield', 'ccy', 'coupon', 'spread', 'freq', 'maturity', 'rating', ...CLASSIFY, 'notes'],
    required: ['name', 'issuer', 'qty', 'price', 'ccy', 'maturity'],
    defaults: { freq: '4' },
    labels: { qty: { en: 'Nominal', sv: 'Nominellt belopp' }, price: { en: 'Clean price %', sv: 'Ren kurs %' }, coupon: { en: 'Current coupon %', sv: 'Aktuell kupong %' } },
    risk(p, ctx) { return bondRisk(p, ctx, { floating: true }); }
  },

  money_market: {
    en: 'Money market / T-bill', sv: 'Penningmarknad / statsskuldväxel', group: 'fixed_income', icon: 'MM',
    hint: { en: 'Discount paper and certificates under a year. Enter price in % of par or the yield.', sv: 'Diskonteringspapper och certifikat under ett år. Ange kurs i % av nominellt eller avkastningen.' },
    fields: [...COMMON, 'qty', 'price', 'yield', 'ccy', 'maturity', 'rating', 'country', 'notes'],
    required: ['name', 'qty', 'ccy', 'maturity'],
    requireOneOf: [['price', 'yield']],
    labels: { qty: { en: 'Nominal', sv: 'Nominellt belopp' }, price: { en: 'Price %', sv: 'Kurs %' } },
    risk(p, ctx) {
      const r = bondRisk({ ...p, coupon: 0, freq: 1 }, ctx, { government: !p.issuer || /stat|gov|treas|riksg/i.test(p.issuer) });
      r.assetClass = 'money_market';
      r.liqDays = 1;
      return r;
    }
  },

  cash: {
    en: 'Cash / deposit', sv: 'Kassa / inlåning', group: 'cash', icon: 'CSH',
    hint: { en: 'Quantity = amount in the account currency. Negative for overdraft or unsettled payables.', sv: 'Antal = belopp i kontots valuta. Negativt för checkkredit eller ej likviderade skulder.' },
    fields: ['name', 'qty', 'ccy', 'issuer', 'notes'],
    required: ['qty', 'ccy'],
    defaults: { name: 'Cash' },
    labels: { qty: { en: 'Amount', sv: 'Belopp' }, issuer: { en: 'Bank', sv: 'Bank' } },
    risk(p, ctx) { return cashLike({ ...p, price: 1 }, ctx, 'cash'); }
  },

  future: {
    en: 'Future', sv: 'Termin (future)', group: 'derivatives', icon: 'FUT',
    hint: { en: 'Contracts × price × multiplier = notional. Daily margined, so market value is ~0 and the notional is the exposure. For bond futures enter the CTD modified duration.', sv: 'Kontrakt × kurs × multiplikator = nominellt värde. Marginalavräknas dagligen, så marknadsvärdet är ~0 och det nominella värdet är exponeringen. För obligationsterminer anges CTD:ns modifierade duration.' },
    fields: [...COMMON, 'qty', 'price', 'multiplier', 'ccy', 'underlyingClass', 'maturity', 'duration', 'beta', 'buyCcy', 'mtm', 'country', 'strategy', 'notes'],
    required: ['name', 'qty', 'price', 'multiplier', 'ccy', 'underlyingClass'],
    defaults: { multiplier: 1, underlyingClass: 'equity', beta: 1 },
    labels: { qty: { en: 'Contracts (negative = short)', sv: 'Kontrakt (negativt = kort)' }, buyCcy: { en: 'Currency bought (FX futures)', sv: 'Köpt valuta (valutaterminer)' }, duration: { en: 'Duration (bond futures)', sv: 'Duration (obligationsterminer)' }, mtm: { en: 'Variation margin (unsettled)', sv: 'Ej avräknad variationsmarginal' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const notional = num(p.qty) * num(p.price) * num(p.multiplier, 1) * fx;
      const mv = num(p.mtm) * fx;
      const cls = p.underlyingClass || 'equity';
      Object.assign(r, { mv, exposure: Math.abs(notional), net: notional, assetClass: DERIV_CLASS[cls] || 'mixed', liqDays: 1 });
      if (cls === 'equity') { r.eqDelta = notional; r.beta = num(p.beta, 1); }
      else if (cls === 'rates') {
        const dur = num(p.duration, 0);
        if (!dur) r.warnings.push('duration_missing');
        addIr01(r, p.ccy, -notional * dur * 1e-4);
        r.fi = { ytm: null, modDur: dur, spreadDur: 0, convexity: 0, years: isNum(yearsBetween(ctx.valDate, p.maturity)) ? yearsBetween(ctx.valDate, p.maturity) : null, rating: '', derivative: true };
      } else if (cls === 'commodity') r.cmDelta = notional;
      else if (cls === 'credit') r.cs01 = -notional * num(p.duration, 4.5) * 1e-4;
      // An FX future is long the traded currency (buyCcy) and short the quote currency.
      // For everything else only the unsettled margin sits in the contract currency.
      if (cls === 'fx') { addFx(r, p.buyCcy, notional, ctx.base); addFx(r, p.ccy, -notional, ctx.base); if (!p.buyCcy) r.warnings.push('buyccy_missing'); }
      addFx(r, p.ccy, mv, ctx.base);
      return r;
    }
  },

  option: {
    en: 'Listed option', sv: 'Option', group: 'derivatives', icon: 'OPT',
    hint: { en: 'Priced with Black-Scholes-Merton (Black-76 when the underlying is rates or commodity). Leave price empty to use the model value. Delta-adjusted notional counts as exposure.', sv: 'Prissätts med Black-Scholes-Merton (Black-76 för ränte- och råvaruunderliggande). Lämna kurs tom för modellvärde. Deltajusterat nominellt belopp räknas som exponering.' },
    fields: [...COMMON, 'qty', 'optType', 'strike', 'maturity', 'underlyingPrice', 'vol', 'price', 'multiplier', 'ccy', 'underlyingClass', 'rate', 'divYield', 'beta', 'duration', 'buyCcy', 'strategy', 'notes'],
    required: ['name', 'qty', 'optType', 'strike', 'maturity', 'underlyingPrice', 'vol', 'multiplier', 'ccy'],
    defaults: { multiplier: 100, optType: 'call', underlyingClass: 'equity', rate: 2.5, vol: 20, beta: 1 },
    labels: { qty: { en: 'Contracts (negative = written)', sv: 'Kontrakt (negativt = utfärdat)' }, divYield: { en: 'Dividend yield % (FX: foreign rate)', sv: 'Utdelningsyield % (valuta: utländsk ränta)' }, buyCcy: { en: 'Currency bought (FX options)', sv: 'Köpt valuta (valutaoptioner)' }, duration: { en: 'Underlying duration (rate options)', sv: 'Underliggande duration (ränteoptioner)' }, price: { en: 'Premium (optional)', sv: 'Premie (valfritt)' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const T = Math.max(0, yearsBetween(ctx.valDate, p.maturity));
      const cls = p.underlyingClass || 'equity';
      const rr = num(p.rate, 2.5) / 100;
      const q = cls === 'rates' || cls === 'commodity' ? rr : num(p.divYield, 0) / 100; // Black-76 on a forward; else BSM/Garman-Kohlhagen
      const S = num(p.underlyingPrice), sig = num(p.vol) / 100;
      const g = bsm(p.optType, S, num(p.strike), T, rr, q, sig);
      const units = num(p.qty) * num(p.multiplier, 1);
      const unitPrice = isNum(p.price) ? p.price : g.price;
      const mv = units * unitPrice * fx;
      const deltaNotional = units * g.delta * S * fx;
      Object.assign(r, {
        mv, exposure: Math.abs(deltaNotional), net: deltaNotional, assetClass: DERIV_CLASS[cls] || 'mixed',
        vega: units * g.vega * fx, gamma: units * g.gamma * S * S * fx, liqDays: 1,
        option: { delta: g.delta, model: g.price, T, theta: units * g.theta * fx }
      });
      if (cls === 'equity') { r.eqDelta = deltaNotional; r.beta = num(p.beta, 1); }
      else if (cls === 'commodity') r.cmDelta = deltaNotional;
      else if (cls === 'rates') addIr01(r, p.ccy, -deltaNotional * num(p.duration, 0) * 1e-4);
      else if (cls === 'fx') { addFx(r, p.buyCcy, deltaNotional, ctx.base); addFx(r, p.ccy, -deltaNotional, ctx.base); }
      addFx(r, p.ccy, mv, ctx.base);
      if (T <= 0) r.warnings.push('expired');
      return r;
    },
    // Full revaluation under a stress scenario — delta/gamma would badly misprice a 30 % crash.
    // Returns the P&L in base currency; analytics falls back to sensitivities for types without it.
    stressPnl(p, ctx, s) {
      const cls = p.underlyingClass || 'equity';
      const fx0 = ctx.fx(p.ccy);
      if (!isNum(fx0)) return 0;
      const T = Math.max(0, yearsBetween(ctx.valDate, p.maturity));
      const rr = num(p.rate, 2.5) / 100, q = cls === 'rates' || cls === 'commodity' ? rr : num(p.divYield, 0) / 100;
      const S = num(p.underlyingPrice), sig = num(p.vol) / 100, K = num(p.strike);
      const move = cls === 'equity' ? s.eq * num(p.beta, 1) : cls === 'commodity' ? s.cmd : cls === 'fx' ? (s.fx?.[p.buyCcy] ?? s.fxAll ?? 0) : 0;
      const v0 = bsm(p.optType, S, K, T, rr, q, sig).price;
      const v1 = bsm(p.optType, S * (1 + move), K, T, rr + (s.rates || 0) / 1e4, q, Math.max(0.01, sig + (s.vol || 0) / 100)).price;
      const fxMove = 1 + (s.fx?.[p.ccy] ?? (p.ccy === ctx.base ? 0 : s.fxAll ?? 0));
      const units = num(p.qty) * num(p.multiplier, 1);
      const mv0 = units * (isNum(p.price) ? p.price : v0) * fx0;
      return units * (v1 - v0) * fx0 * fxMove + mv0 * (fxMove - 1);
    }
  },

  fx_forward: {
    en: 'FX forward / swap', sv: 'Valutatermin / swap', group: 'derivatives', icon: 'FXF',
    hint: { en: 'One leg bought, one sold. Typical share-class or portfolio hedge. Value = buy leg − sell leg at spot unless you give a market value.', sv: 'Ett ben köpt, ett sålt. Typisk valutasäkring av andelsklass eller portfölj. Värde = köpben − säljben till spotkurs om du inte anger marknadsvärde.' },
    fields: ['name', 'buyCcy', 'buyAmount', 'sellCcy', 'sellAmount', 'maturity', 'issuer', 'mtm', 'ccy', 'notes'],
    required: ['buyCcy', 'buyAmount', 'sellCcy', 'sellAmount', 'maturity'],
    labels: { issuer: { en: 'Counterparty', sv: 'Motpart' }, ccy: { en: 'Currency of MV override', sv: 'Valuta för manuellt värde' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fb = fxOrWarn(p, ctx, r, p.buyCcy), fs = fxOrWarn(p, ctx, r, p.sellCcy);
      const buy = num(p.buyAmount) * fb, sell = num(p.sellAmount) * fs;
      const mv = isNum(p.mtm) ? p.mtm * fxOrWarn(p, ctx, r, p.ccy || ctx.base) : buy - sell;
      Object.assign(r, { mv, exposure: Math.max(Math.abs(buy), Math.abs(sell)), net: 0, assetClass: 'currency', liqDays: 1 });
      addFx(r, p.buyCcy, buy, ctx.base);
      addFx(r, p.sellCcy, -sell, ctx.base);
      // Rate differential exposure is second order at fund level; the tenor is shown in the table.
      return r;
    },
    displayName: p => p.name || `${p.buyCcy || '?'}/${p.sellCcy || '?'} ${p.maturity || ''}`
  },

  irs: {
    en: 'Interest rate swap', sv: 'Ränteswap', group: 'derivatives', icon: 'IRS',
    hint: { en: 'Receive fixed adds duration, pay fixed removes it. Value is estimated from the fixed rate vs the current par rate unless you enter a market value.', sv: 'Erhåll fast ger duration, betala fast tar bort den. Värdet uppskattas från fast ränta mot aktuell swapränta om du inte anger marknadsvärde.' },
    fields: ['name', 'qty', 'ccy', 'direction', 'fixedRate', 'marketRate', 'freq', 'maturity', 'issuer', 'mtm', 'notes'],
    required: ['qty', 'ccy', 'direction', 'fixedRate', 'marketRate', 'maturity'],
    defaults: { direction: 'receive', freq: '1' },
    labels: { qty: { en: 'Notional', sv: 'Nominellt belopp' }, issuer: { en: 'Counterparty / CCP', sv: 'Motpart / CCP' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const N = num(p.qty) * fx;
      const { annuity, years } = swapAnnuity(ctx.valDate, p.maturity, freqOf(p.freq, 1), num(p.marketRate));
      const sign = p.direction === 'pay' ? -1 : 1;
      const est = sign * N * (num(p.fixedRate) - num(p.marketRate)) / 100 * annuity;
      const mv = isNum(p.mtm) ? p.mtm * fx : est;
      Object.assign(r, {
        mv, exposure: Math.abs(N), net: sign * N, assetClass: 'fixed_income', liqDays: 1,
        fi: { ytm: num(p.marketRate) / 100, modDur: sign * annuity, spreadDur: 0, convexity: 0, years, rating: '', derivative: true }
      });
      addIr01(r, p.ccy, -sign * N * annuity * 1e-4);
      addFx(r, p.ccy, mv, ctx.base);
      return r;
    },
    displayName: p => p.name || `IRS ${p.direction === 'pay' ? 'pay' : 'rec'} ${num(p.fixedRate).toFixed(2)}% ${p.maturity || ''}`
  },

  cds: {
    en: 'Credit default swap', sv: 'Kreditswap (CDS)', group: 'derivatives', icon: 'CDS',
    hint: { en: 'Selling protection is long credit risk (like owning the bond without the cash). Spread DV01 uses a flat risky annuity.', sv: 'Att sälja skydd är lång kreditrisk (som att äga obligationen utan kapital). Spread-DV01 använder en platt riskjusterad annuitet.' },
    fields: ['name', 'issuer', 'qty', 'ccy', 'protection', 'spread', 'marketSpread', 'maturity', 'rating', 'sector', 'country', 'mtm', 'notes'],
    required: ['issuer', 'qty', 'ccy', 'protection', 'spread', 'marketSpread', 'maturity'],
    defaults: { protection: 'sell', spread: 100 },
    labels: { qty: { en: 'Notional', sv: 'Nominellt belopp' }, spread: { en: 'Contract spread (bp)', sv: 'Kontraktsspread (bp)' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const N = num(p.qty) * fx;
      const mkt = num(p.marketSpread), cpn = num(p.spread);
      const { annuity, years } = swapAnnuity(ctx.valDate, p.maturity, 4, 2.5 + mkt / 100);
      const sign = p.protection === 'buy' ? 1 : -1; // buyer gains when spreads widen
      const est = sign * N * (mkt - cpn) * 1e-4 * annuity;
      const mv = isNum(p.mtm) ? p.mtm * fx : est;
      Object.assign(r, {
        mv, exposure: Math.abs(N), net: -sign * N, assetClass: 'fixed_income', liqDays: 2,
        cs01: sign * N * annuity * 1e-4,
        fi: { ytm: null, modDur: 0, spreadDur: -sign * annuity, convexity: 0, years, rating: p.rating || '', derivative: true }
      });
      addFx(r, p.ccy, mv, ctx.base);
      return r;
    },
    displayName: p => p.name || `CDS ${p.issuer || ''} ${p.protection === 'buy' ? '(bought)' : '(sold)'}`
  },

  commodity: {
    en: 'Commodity / ETC', sv: 'Råvara / ETC', group: 'securities', icon: 'CMD',
    hint: { en: 'Physical holdings or exchange-traded commodities. For futures use the Future type.', sv: 'Fysiska innehav eller börshandlade råvaror. Använd typen Termin för terminer.' },
    fields: [...COMMON, 'qty', 'price', 'ccy', 'sector', 'adv', 'notes'],
    required: ['name', 'qty', 'price', 'ccy'],
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const mv = num(p.qty) * num(p.price) * fx;
      Object.assign(r, { mv, exposure: Math.abs(mv), net: mv, assetClass: 'commodity', cmDelta: mv });
      addFx(r, p.ccy, mv, ctx.base);
      return r;
    }
  },

  alternative: {
    en: 'Alternative / unlisted', sv: 'Alternativ / onoterat', group: 'securities', icon: 'ALT',
    hint: { en: 'Private equity, real estate, hedge funds, private credit, crypto. Valued at the last reported NAV; liquidity from the notice period.', sv: 'Onoterat, fastigheter, hedgefonder, direktlån, krypto. Värderas till senast rapporterade NAV; likviditet från uppsägningstiden.' },
    fields: [...COMMON, 'altType', 'qty', 'price', 'ccy', 'liquidityDays', 'beta', ...CLASSIFY, 'notes'],
    required: ['name', 'altType', 'qty', 'price', 'ccy'],
    defaults: { altType: 'private_equity', liquidityDays: 180, qty: 1, beta: 0.6 },
    labels: { price: { en: 'Valuation / NAV', sv: 'Värdering / NAV' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const mv = num(p.qty) * num(p.price) * fx;
      const betaDefault = { private_equity: 1.1, real_estate: 0.5, hedge_fund: 0.35, infrastructure: 0.45, private_credit: 0.25, crypto: 1.6, other: 0.6 }[p.altType] ?? 0.6;
      Object.assign(r, {
        mv, exposure: Math.abs(mv), net: mv, assetClass: 'alternative', eqDelta: mv, beta: num(p.beta, betaDefault),
        liqDays: num(p.liquidityDays, 180), specificVol: p.altType === 'crypto' ? 0.6 : 0.15
      });
      addFx(r, p.ccy, mv, ctx.base);
      return r;
    }
  }
};

const DERIV_CLASS = { equity: 'equity', rates: 'fixed_income', commodity: 'commodity', fx: 'currency', credit: 'fixed_income' };

function fundRisk(p, ctx, liqDefault) {
  const r = blank(ctx.base);
  const fx = fxOrWarn(p, ctx, r);
  const mv = num(p.qty) * num(p.price) * fx;
  const cls = p.subClass || 'mixed';
  const eqShare = cls === 'equity' ? 1 : cls === 'mixed' ? num(p.equityShare, 50) / 100 : cls === 'alternative' ? 0.5 : 0;
  const bondShare = cls === 'fixed_income' ? 1 : cls === 'mixed' ? 1 - eqShare : 0;
  Object.assign(r, {
    mv, exposure: Math.abs(mv), net: mv, assetClass: cls, eqDelta: mv * eqShare, beta: num(p.beta, 1),
    liqDays: isNum(p.liquidityDays) ? p.liquidityDays : (isNum(p.adv) ? null : liqDefault),
    specificVol: 0.03 // a diversified fund has little stock-specific risk left
  });
  if (cls === 'commodity') r.cmDelta = mv;
  if (bondShare > 0 && isNum(p.duration)) {
    addIr01(r, p.ccy, -mv * bondShare * p.duration * 1e-4);
    r.fi = { ytm: null, modDur: p.duration, spreadDur: 0, convexity: 0, years: null, rating: p.rating || '', fund: true, weight: bondShare };
  }
  if (cls === 'money_market') r.liqDays = isNum(p.liquidityDays) ? p.liquidityDays : 1;
  addFx(r, p.ccy, mv, ctx.base);
  return r;
}

export const GROUPS = {
  securities: { en: 'Securities', sv: 'Värdepapper' },
  funds: { en: 'Funds', sv: 'Fonder' },
  fixed_income: { en: 'Fixed income', sv: 'Räntebärande' },
  cash: { en: 'Cash', sv: 'Likvida medel' },
  derivatives: { en: 'Derivatives', sv: 'Derivat' }
};

// ---- helpers used by the UI and importer ------------------------------------------------------
export function fieldLabel(type, key, lang) {
  const o = INSTRUMENTS[type]?.labels?.[key];
  return (o && (o[lang] || o.en)) || FIELDS[key]?.[lang] || FIELDS[key]?.en || key;
}
export function typeLabel(type, lang) {
  const d = INSTRUMENTS[type];
  return d ? (d[lang] || d.en) : type;
}
export function displayName(p) {
  const d = INSTRUMENTS[p.type];
  return (d?.displayName ? d.displayName(p) : p.name) || p.ticker || p.isin || '—';
}
export function allFieldKeys() {
  const s = new Set(['type']);
  Object.values(INSTRUMENTS).forEach(d => d.fields.forEach(f => s.add(f)));
  return [...s];
}

// Map free-text type values ("Aktie", "Corp bond", "BOND_CORP", "FX Fwd"...) to registry ids.
const TYPE_ALIASES = {
  equity: ['equity', 'stock', 'share', 'shares', 'commonstock', 'aktie', 'aktier', 'eq', 'ordinaryshare', 'preferred', 'adr', 'gdr'],
  etf: ['etf', 'exchangetradedfund', 'börshandladfond', 'etp'],
  fund: ['fund', 'mutualfund', 'ucits', 'aif', 'fond', 'fonder', 'sicav', 'unittrust', 'investmentfund'],
  govt_bond: ['govtbond', 'governmentbond', 'government', 'sovereign', 'treasury', 'gilt', 'bund', 'statsobligation', 'stat', 'sgb', 'supranational', 'agency', 'municipal', 'kommunobligation'],
  corp_bond: ['corpbond', 'corporatebond', 'corporate', 'bond', 'obligation', 'företagsobligation', 'credit', 'hybrid', 'highyield', 'hy', 'ig', 'fixedbond', 'covered', 'coveredbond', 'säkerställdobligation', 'bostadsobligation'],
  frn: ['frn', 'floater', 'floatingratenote', 'floatingrate', 'frnobligation', 'rörlig', 'rörligränta'],
  money_market: ['moneymarket', 'tbill', 'bill', 'treasurybill', 'cp', 'commercialpaper', 'cd', 'certificate', 'statsskuldväxel', 'ssvx', 'företagscertifikat', 'certifikat', 'penningmarknad'],
  cash: ['cash', 'deposit', 'currentaccount', 'kassa', 'likvida', 'likvidamedel', 'bankkonto', 'inlåning', 'konto'],
  future: ['future', 'futures', 'fut', 'termin', 'terminer', 'indexfuture', 'bondfuture'],
  option: ['option', 'options', 'opt', 'call', 'put', 'warrant', 'optioner'],
  fx_forward: ['fxforward', 'forward', 'fxfwd', 'fwd', 'fxswap', 'currencyforward', 'valutatermin', 'valutaswap', 'ndf'],
  irs: ['irs', 'swap', 'interestrateswap', 'ränteswap', 'ois'],
  cds: ['cds', 'creditdefaultswap', 'kreditswap', 'cdx', 'itraxx'],
  commodity: ['commodity', 'etc', 'gold', 'physical', 'råvara', 'råvaror', 'guld'],
  alternative: ['alternative', 'alternatives', 'private', 'privateequity', 'pe', 'realestate', 'hedgefund', 'crypto', 'onoterat', 'fastighet', 'alternativ', 'infrastructure', 'privatecredit']
};
const TYPE_LOOKUP = (() => {
  const m = new Map();
  for (const [id, list] of Object.entries(TYPE_ALIASES)) {
    m.set(normKey(id), id);
    list.forEach(a => m.set(normKey(a), id));
    const d = INSTRUMENTS[id];
    if (d) { m.set(normKey(d.en), id); m.set(normKey(d.sv), id); }
  }
  return m;
})();
export function normKey(s) { return String(s ?? '').toLowerCase().replace(/[\s_\-./()%]+/g, ''); }
export function resolveType(raw) { return TYPE_LOOKUP.get(normKey(raw)) || null; }

// Validate one position. Returns [{ field, code }] — codes are translated by the UI.
export function validatePosition(p) {
  const errs = [];
  const def = INSTRUMENTS[p.type];
  if (!def) return [{ field: 'type', code: 'unknown_type' }];
  for (const f of def.required) {
    const v = p[f];
    // A non-numeric value in a number field is reported once, as 'number', by the loop below.
    if (v === undefined || v === null || v === '') errs.push({ field: f, code: 'required' });
  }
  for (const group of def.requireOneOf || []) {
    if (!group.some(f => isNum(p[f]))) errs.push({ field: group[0], code: 'one_of:' + group.join('|') });
  }
  for (const f of def.fields) {
    const spec = FIELDS[f], v = p[f];
    if (v === undefined || v === null || v === '') continue;
    if (spec.type === 'number' && !isNum(v)) errs.push({ field: f, code: 'number' });
    if (spec.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errs.push({ field: f, code: 'date' });
    if (spec.type === 'ccy' && !/^[A-Z]{3}$/.test(v)) errs.push({ field: f, code: 'ccy' });
    if (spec.type === 'select' && spec.options && !spec.options.includes(String(v))) errs.push({ field: f, code: 'option' });
  }
  if (def.fields.includes('rating') && p.rating && ratingScore(p.rating) == null) errs.push({ field: 'rating', code: 'rating' });
  return errs;
}
