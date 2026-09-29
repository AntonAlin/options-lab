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
import { bsm, bondAnalytics, swapAnnuity, americanOption } from './pricing.js';
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
  reportedNotional: { type: 'number', en: 'Reported notional', sv: 'Rapporterat nominellt värde', aliases: ['reportednotional', 'notionalamount', 'notionalvalue', 'underlyingnotional', 'contractvalue', 'grossnotional', 'rapporteratnominellt', 'nominelltvärde', 'kontraktsvärde', 'underliggandevärde'] },
  reportedDelta: { type: 'number', en: 'Reported delta', sv: 'Rapporterad delta', aliases: ['delta', 'reporteddelta', 'optiondelta', 'brokerdelta', 'rapporteraddelta', 'deltaper'] },
  reportedDeltaExposure: { type: 'number', en: 'Reported delta-adjusted exposure', sv: 'Rapporterad deltajusterad exponering', aliases: ['deltaadjustedexposure', 'deltaexposure', 'deltanotional', 'deltaadjustednotional', 'deltaequivalent', 'commitment', 'deltajusteradexponering', 'deltajusteratbelopp', 'åtagande'] },
  costPrice:   { type: 'number', en: 'Average cost per unit', sv: 'Anskaffningsvärde per enhet (GAV)', aliases: ['costprice', 'averagecost', 'avgcost', 'averageprice', 'unitcost', 'bookcost', 'costbasis', 'purchaseprice', 'gav', 'anskaffningsvärde', 'anskaffningskurs', 'snittkurs', 'inköpskurs', 'genomsnittligtanskaffningsvärde'] },
  strategy:    { type: 'text', en: 'Strategy', sv: 'Strategi', aliases: ['strategy', 'strategi', 'book', 'bok', 'portfoliogroup', 'group', 'grupp'] },
  underlyingClass: { type: 'select', en: 'Underlying', sv: 'Underliggande tillgång', options: ['equity', 'rates', 'commodity', 'fx', 'credit', 'volatility'], aliases: ['underlyingclass', 'underlyingtype', 'underlyingasset', 'tillgångsslag', 'underliggandetyp'] },
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
  mtm:         { type: 'number', en: 'Market value override', sv: 'Marknadsvärde (manuellt)', aliases: ['mtm', 'marketvalue', 'mv', 'fairvalue', 'marknadsvärde', 'värde', 'npv', 'verkligtvärde', 'marketvaluelocal', 'marknadsvärdelokal', 'premiumvalue'] },
  subClass:    { type: 'select', en: 'Look-through class', sv: 'Genomlyst tillgångsslag', options: ['equity', 'fixed_income', 'money_market', 'mixed', 'alternative', 'commodity'], aliases: ['assetclass', 'fundtype', 'category', 'tillgångsklass', 'fondtyp', 'kategori'] },
  equityShare: { type: 'number', en: 'Equity share %', sv: 'Aktieandel %', aliases: ['equityshare', 'equityweight', 'aktieandel'] },
  altType:     { type: 'select', en: 'Alternative type', sv: 'Alternativ typ', options: ['private_equity', 'real_estate', 'hedge_fund', 'infrastructure', 'private_credit', 'crypto', 'other'], aliases: ['alttype', 'subtype', 'strategy', 'strategi', 'undertyp'] },
  liquidityDays:{ type: 'number', en: 'Days to liquidate', sv: 'Dagar att avveckla', aliases: ['liquiditydays', 'redemptiondays', 'noticeperiod', 'likviditetsdagar', 'uppsägningstid'] },
  dirtyPrice:  { type: 'number', en: 'Dirty price % (incl. accrued)', sv: 'Smutsig kurs % (inkl. upplupen ränta)', aliases: ['dirtyprice', 'fullprice', 'priceinclaccrued', 'priceincludingaccrued', 'dirty', 'smutsigkurs', 'kursinklupplupen', 'kursinklupplupenränta'] },
  indexRatio:  { type: 'number', en: 'Index ratio', sv: 'Indexkvot', aliases: ['indexratio', 'indexfactor', 'inflationfactor', 'inflationindexratio', 'indexkvot', 'indexfaktor', 'indexuppräkning'] },
  callDate:    { type: 'date', en: 'Next call date', sv: 'Nästa inlösendag (call)', aliases: ['calldate', 'nextcalldate', 'firstcalldate', 'callable', 'call', 'inlösendag', 'förstainlösendag', 'callbar'] },
  callPrice:   { type: 'number', en: 'Call price %', sv: 'Inlösenkurs vid call %', aliases: ['callprice', 'callpricepct', 'inlösenkursvidcall'] },
  structure:   { type: 'select', en: 'Repayment', sv: 'Amortering', options: ['bullet', 'amortising'], aliases: ['structure', 'repayment', 'amortisation', 'amortization', 'amortering'] },
  leverage:    { type: 'number', en: 'Leverage / participation', sv: 'Hävstång / deltagandegrad', aliases: ['leverage', 'gearing', 'exposurefactor', 'participation', 'participationrate', 'hävstång', 'deltagandegrad', 'faktor'] },
  exercise:    { type: 'select', en: 'Exercise style', sv: 'Lösenstil', options: ['european', 'american'], aliases: ['exercise', 'exercisestyle', 'optionstyle', 'lösenstil', 'lösentyp'] },
  margining:   { type: 'select', en: 'Premium / margining', sv: 'Premie / marginalavräkning', options: ['premium', 'futures'], aliases: ['margining', 'marginstyle', 'premiumstyle', 'settlementstyle', 'marginal'] },
  vega:        { type: 'number', en: 'Vega per vol point', sv: 'Vega per volpunkt', aliases: ['vega', 'veganotional', 'vegaamount'] },
  notes:       { type: 'text', en: 'Notes', sv: 'Anteckningar', aliases: ['notes', 'comment', 'comments', 'anteckning', 'anteckningar', 'kommentar'] }
};

export const OPTION_LABELS = {
  call: { en: 'Call', sv: 'Köp (call)' }, put: { en: 'Put', sv: 'Sälj (put)' },
  equity: { en: 'Equity', sv: 'Aktier' }, rates: { en: 'Interest rates', sv: 'Räntor' }, commodity: { en: 'Commodity', sv: 'Råvara' },
  fx: { en: 'Currency', sv: 'Valuta' }, credit: { en: 'Credit', sv: 'Kredit' }, volatility: { en: 'Volatility (VIX, VSTOXX)', sv: 'Volatilitet (VIX, VSTOXX)' },
  bullet: { en: 'Bullet (repaid at maturity)', sv: 'Rak (återbetalas vid förfall)' }, amortising: { en: 'Amortising (ABS, MBS, CLO)', sv: 'Amorterande (ABS, MBS, CLO)' },
  european: { en: 'European', sv: 'Europeisk' }, american: { en: 'American', sv: 'Amerikansk' },
  premium: { en: 'Premium paid up front', sv: 'Premie betalas direkt' }, futures: { en: 'Futures-style (margined)', sv: 'Terminsstil (marginalavräknas)' },
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
  ccy = majorCcy(ccy);
  if (!ccy || ccy === base || !amtBase) return;
  r.fx[ccy] = (r.fx[ccy] || 0) + amtBase;
}
function addIr01(r, ccy, v) { if (v) r.ir01[ccy] = (r.ir01[ccy] || 0) + v; }

// Prices quoted in minor units: pence (GBX, written GBp), South African cents (ZAC), Israeli agorot (ILA).
export const SUBUNITS = { GBX: ['GBP', 0.01], ZAC: ['ZAR', 0.01], ILA: ['ILS', 0.01] };
export const majorCcy = c => (SUBUNITS[c] ? SUBUNITS[c][0] : c);
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

function bondRisk(p, ctx, { floating = false, government = false, indexLinked = false } = {}) {
  const r = blank(ctx.base);
  const fx = fxOrWarn(p, ctx, r);
  const f = freqOf(p.freq, floating ? 4 : 1);
  // Inflation-linked: prices, coupons and accrued are in real terms; the index ratio turns them into cash.
  const ir = indexLinked ? (isNum(p.indexRatio) && p.indexRatio > 0 ? p.indexRatio : 1) : 1;
  if (indexLinked && !(isNum(p.indexRatio) && p.indexRatio > 0)) r.warnings.push('index_ratio_missing');
  const base = { valuationDate: ctx.valDate, couponPct: num(p.coupon), freq: f, yieldPct: isNum(p.yield) ? p.yield : undefined };
  // A dirty (full) price is turned into a clean one with the accrued interest the schedule implies.
  let clean = isNum(p.price) ? p.price : undefined;
  const pricedTo = mat => bondAnalytics({ ...base, maturity: mat, cleanPrice: clean });
  if (!isNum(clean) && isNum(p.dirtyPrice) && (p.maturity || p.callDate)) {
    const probe = bondAnalytics({ ...base, maturity: p.maturity || p.callDate, cleanPrice: p.dirtyPrice });
    clean = probe ? p.dirtyPrice - probe.accrued : p.dirtyPrice;
  }
  // Callable (incl. perpetual AT1/Tier 2): price to the call date as well and take the worse yield.
  const callFuture = p.callDate && p.callDate > ctx.valDate;
  const toMat = p.maturity ? pricedTo(p.maturity) : null;
  const toCall = callFuture ? bondAnalytics({ ...base, maturity: p.callDate, cleanPrice: clean, redemption: num(p.callPrice, 100) }) : null;
  let a = toMat, workout = 'maturity';
  if (toCall && (!toMat || (isNum(clean) ? toCall.ytm < toMat.ytm : true))) { a = toCall; workout = 'call'; }
  if (!a) {
    r.warnings.push(p.maturity || p.callDate ? 'bond_unpriced' : 'perpetual_no_call');
    const mv = num(p.qty) * num(clean ?? p.price) / 100 * ir * fx;
    Object.assign(r, { mv, exposure: Math.abs(mv), net: mv, assetClass: 'fixed_income' });
    addFx(r, p.ccy, mv, ctx.base);
    return r;
  }
  if (p.structure === 'amortising') r.warnings.push('amortising');
  const mv = (isNum(p.mtm) ? p.mtm : num(p.qty) * a.dirty / 100 * ir) * fx;
  // A floater's rate duration is the time to the next reset; its spread duration is the full thing.
  const rateDur = floating ? Math.min(a.yearsToMaturity, 1 / f) : a.modDur;
  const spreadDur = a.modDur;
  Object.assign(r, {
    mv, exposure: Math.abs(mv), net: mv, assetClass: 'fixed_income',
    cs01: government ? 0 : -mv * spreadDur * 1e-4,
    fi: {
      ytm: floating && isNum(p.yield) ? p.yield / 100 : a.ytm, modDur: rateDur, spreadDur: government ? 0 : spreadDur,
      convexity: floating ? 0 : a.convexity, years: a.yearsToMaturity, rating: p.rating || '', accrued: a.accrued, dirty: a.dirty,
      workout, real: indexLinked
    }
  });
  // Linkers: the duration is to real yields; the rates factor is the closest thing the model has.
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
    fields: [...COMMON, 'qty', 'price', 'costPrice', 'ccy', ...CLASSIFY, 'beta', 'adv', 'strategy', 'notes'],
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
    fields: [...COMMON, 'qty', 'price', 'costPrice', 'ccy', 'subClass', 'equityShare', 'duration', 'leverage', 'beta', ...CLASSIFY, 'adv', 'strategy', 'notes'],
    required: ['name', 'qty', 'price', 'ccy', 'subClass'],
    defaults: { subClass: 'equity', beta: 1 },
    risk(p, ctx) { return fundRisk(p, ctx, 1); }
  },

  fund: {
    en: 'Mutual fund', sv: 'Fond (UCITS/AIF)', group: 'funds', icon: 'FND',
    hint: { en: 'Units × NAV. Redemption settles in a few days, so liquidity defaults to 3 days.', sv: 'Andelar × NAV-kurs. Inlösen tar några dagar, så likviditet sätts som standard till 3 dagar.' },
    fields: [...COMMON, 'qty', 'price', 'costPrice', 'ccy', 'subClass', 'equityShare', 'duration', 'beta', 'liquidityDays', ...CLASSIFY, 'strategy', 'notes'],
    required: ['name', 'qty', 'price', 'ccy', 'subClass'],
    defaults: { subClass: 'mixed', equityShare: 50, liquidityDays: 3, beta: 1 },
    risk(p, ctx) { return fundRisk(p, ctx, 3); }
  },

  govt_bond: {
    en: 'Government bond', sv: 'Statsobligation', group: 'fixed_income', icon: 'GOV',
    hint: { en: 'Quantity = nominal amount. Price = clean price in % of par. Give yield instead of price if that is what you have.', sv: 'Antal = nominellt belopp. Kurs = ren kurs i % av nominellt. Ange avkastning i stället för kurs om det är vad du har.' },
    fields: [...COMMON, 'qty', 'price', 'dirtyPrice', 'costPrice', 'yield', 'ccy', 'coupon', 'freq', 'maturity', 'rating', 'country', 'strategy', 'notes'],
    required: ['name', 'qty', 'ccy', 'maturity'],
    requireOneOf: [['price', 'dirtyPrice', 'yield']],
    defaults: { freq: '1', rating: 'AAA', coupon: 0 },
    labels: { qty: { en: 'Nominal', sv: 'Nominellt belopp' }, price: { en: 'Clean price %', sv: 'Ren kurs %' } },
    risk(p, ctx) { return bondRisk(p, ctx, { government: true }); }
  },

  corp_bond: {
    en: 'Corporate bond', sv: 'Företagsobligation', group: 'fixed_income', icon: 'CRP',
    hint: { en: 'Fixed-coupon credit. Carries both rate duration and spread duration.', sv: 'Kreditobligation med fast kupong. Bär både ränte- och spreadduration.' },
    fields: [...COMMON, 'qty', 'price', 'dirtyPrice', 'costPrice', 'yield', 'ccy', 'coupon', 'freq', 'maturity', 'callDate', 'callPrice', 'structure', 'rating', ...CLASSIFY, 'adv', 'strategy', 'notes'],
    required: ['name', 'issuer', 'qty', 'ccy'],
    requireOneOf: [['price', 'dirtyPrice', 'yield'], ['maturity', 'callDate']],
    defaults: { freq: '1' },
    labels: { qty: { en: 'Nominal', sv: 'Nominellt belopp' }, price: { en: 'Clean price %', sv: 'Ren kurs %' } },
    risk(p, ctx) { return bondRisk(p, ctx); }
  },

  frn: {
    en: 'Floating rate note', sv: 'FRN (rörlig kupong)', group: 'fixed_income', icon: 'FRN',
    hint: { en: 'Coupon = current fixing + margin. Rate duration is time to next reset; spread duration runs to maturity. Typical for Nordic credit funds.', sv: 'Kupong = aktuell fixing + marginal. Räntedurationen är tid till nästa räntesättning; kreditdurationen löper till förfall. Vanligt i nordiska kreditfonder.' },
    fields: [...COMMON, 'qty', 'price', 'dirtyPrice', 'costPrice', 'yield', 'ccy', 'coupon', 'spread', 'freq', 'maturity', 'callDate', 'callPrice', 'structure', 'rating', ...CLASSIFY, 'strategy', 'notes'],
    required: ['name', 'issuer', 'qty', 'ccy'],
    requireOneOf: [['price', 'dirtyPrice'], ['maturity', 'callDate']],
    defaults: { freq: '4' },
    labels: { qty: { en: 'Nominal', sv: 'Nominellt belopp' }, price: { en: 'Clean price %', sv: 'Ren kurs %' }, coupon: { en: 'Current coupon %', sv: 'Aktuell kupong %' } },
    risk(p, ctx) { return bondRisk(p, ctx, { floating: true }); }
  },

  money_market: {
    en: 'Money market / T-bill', sv: 'Penningmarknad / statsskuldväxel', group: 'fixed_income', icon: 'MM',
    hint: { en: 'Discount paper and certificates under a year. Enter price in % of par or the yield.', sv: 'Diskonteringspapper och certifikat under ett år. Ange kurs i % av nominellt eller avkastningen.' },
    fields: [...COMMON, 'qty', 'price', 'dirtyPrice', 'costPrice', 'yield', 'ccy', 'maturity', 'rating', 'country', 'strategy', 'notes'],
    required: ['name', 'qty', 'ccy', 'maturity'],
    requireOneOf: [['price', 'dirtyPrice', 'yield']],
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
    fields: ['name', 'qty', 'ccy', 'issuer', 'maturity', 'rate', 'strategy', 'notes'],
    required: ['qty', 'ccy'],
    defaults: { name: 'Cash' },
    labels: { qty: { en: 'Amount', sv: 'Belopp' }, issuer: { en: 'Bank', sv: 'Bank' }, maturity: { en: 'Maturity (term deposit)', sv: 'Förfall (bunden inlåning)' }, rate: { en: 'Deposit rate %', sv: 'Inlåningsränta %' } },
    risk(p, ctx) {
      const r = cashLike({ ...p, price: 1 }, ctx, 'cash');
      // A term deposit is only available at maturity (break costs aside).
      const days = p.maturity ? Math.ceil(yearsBetween(ctx.valDate, p.maturity) * 365) : 0;
      if (days > 0) r.liqDays = days;
      return r;
    }
  },

  future: {
    en: 'Future', sv: 'Termin (future)', group: 'derivatives', icon: 'FUT',
    hint: { en: 'Contracts × price × multiplier = notional. Daily margined, so market value is ~0 and the notional is the exposure. For bond futures enter the CTD modified duration.', sv: 'Kontrakt × kurs × multiplikator = nominellt värde. Marginalavräknas dagligen, så marknadsvärdet är ~0 och det nominella värdet är exponeringen. För obligationsterminer anges CTD:ns modifierade duration.' },
    fields: [...COMMON, 'qty', 'price', 'multiplier', 'ccy', 'underlyingClass', 'maturity', 'duration', 'beta', 'buyCcy', 'mtm', 'reportedNotional', 'country', 'strategy', 'notes'],
    required: ['name', 'qty', 'price', 'multiplier', 'ccy', 'underlyingClass'],
    defaults: { multiplier: 1, underlyingClass: 'equity', beta: 1 },
    labels: { qty: { en: 'Contracts (negative = short)', sv: 'Kontrakt (negativt = kort)' }, buyCcy: { en: 'Currency bought (FX futures)', sv: 'Köpt valuta (valutaterminer)' }, duration: { en: 'Duration (bond futures)', sv: 'Duration (obligationsterminer)' }, mtm: { en: 'Variation margin (unsettled)', sv: 'Ej avräknad variationsmarginal' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const modelNotional = num(p.qty) * num(p.price) * num(p.multiplier, 1) * fx;
      // The broker's number wins when there is one: it knows the contract spec, we only guess it.
      const repNotional = isNum(p.reportedNotional) ? dirSign(p.qty) * Math.abs(p.reportedNotional) * fx : null;
      const notional = repNotional != null && ctx.useReported !== false ? repNotional : modelNotional;
      // Daily margined: market value is only the unsettled variation margin, a day's move at most.
      // Many custody and PMS files put the notional in their "market value" column; counting that
      // would add the whole exposure to NAV, so anything above a quarter of the notional is ignored.
      let mv = num(p.mtm) * fx;
      if (isNum(p.mtm) && Math.abs(mv) > 0.25 * Math.abs(modelNotional) && modelNotional) { mv = 0; r.warnings.push('mtm_is_notional'); }
      const cls = p.underlyingClass || 'equity';
      r.deriv = derivInfo({ notional, modelNotional, repNotional, delta: 1, modelDelta: 1, deltaExp: notional, modelDeltaExp: modelNotional, repDeltaExp: repNotional, used: repNotional != null && ctx.useReported !== false });
      if (r.deriv.mismatch) r.warnings.push('reported_mismatch');
      Object.assign(r, { mv, exposure: Math.abs(notional), net: notional, assetClass: DERIV_CLASS[cls] || 'mixed', liqDays: 1 });
      if (cls === 'equity') { r.eqDelta = notional; r.beta = num(p.beta, 1); }
      else if (cls === 'rates' && isNum(p.price) && p.price > 80 && p.price <= 110 && num(p.duration, 0) > 0 && num(p.duration, 0) <= 0.5) {
        // Short-term rate future (Euribor, €STR, SOFR, SONIA, STIBOR) quoted 100 − rate: 1 bp is 0.01 of
        // price, and the notional the exchange defines is the tick value spread over the rate period.
        const dv01 = num(p.qty) * num(p.multiplier, 1) * 0.01 * fx;
        addIr01(r, p.ccy, -dv01);
        const nominal = dv01 / (num(p.duration) * 1e-4);
        Object.assign(r, { exposure: Math.abs(nominal), net: nominal, eqDelta: 0 });
        r.fi = { ytm: (100 - p.price) / 100, modDur: num(p.duration), spreadDur: 0, convexity: 0, years: isNum(yearsBetween(ctx.valDate, p.maturity)) ? yearsBetween(ctx.valDate, p.maturity) : null, rating: '', derivative: true };
      }
      else if (cls === 'rates') {
        const dur = num(p.duration, 0);
        if (!dur) r.warnings.push('duration_missing');
        addIr01(r, p.ccy, -notional * dur * 1e-4);
        r.fi = { ytm: null, modDur: dur, spreadDur: 0, convexity: 0, years: isNum(yearsBetween(ctx.valDate, p.maturity)) ? yearsBetween(ctx.valDate, p.maturity) : null, rating: '', derivative: true };
      } else if (cls === 'commodity') r.cmDelta = notional;
      else if (cls === 'credit') r.cs01 = -notional * num(p.duration, 4.5) * 1e-4;
      // VIX / VSTOXX: one index point is one vol point, so the position is pure vega.
      else if (cls === 'volatility') r.vega = num(p.qty) * num(p.multiplier, 1) * fx;
      // An FX future is long the traded currency (buyCcy) and short the quote currency.
      // For everything else only the unsettled margin sits in the contract currency.
      if (cls === 'fx') { addFx(r, p.buyCcy, notional, ctx.base); addFx(r, p.ccy, -notional, ctx.base); if (!p.buyCcy) r.warnings.push('buyccy_missing'); }
      addFx(r, p.ccy, mv, ctx.base);
      return r;
    }
  },

  option: {
    en: 'Option', sv: 'Option', group: 'derivatives', icon: 'OPT',
    hint: { en: 'Priced with Black-Scholes-Merton (Black-76 when the underlying is rates or commodity). Leave price empty to use the model value. Delta-adjusted notional counts as exposure. Listed or OTC: for an OTC option put the counterparty in Issuer, and it counts toward the OTC counterparty limit. A market value from your file overrides premium and model.', sv: 'Prissätts med Black-Scholes-Merton (Black-76 för ränte- och råvaruunderliggande). Lämna kurs tom för modellvärde. Deltajusterat nominellt belopp räknas som exponering. Noterad eller OTC: för en OTC-option anger du motparten som emittent, så räknas den mot gränsen för OTC-motparter. Ett marknadsvärde från filen går före premie och modell.' },
    fields: [...COMMON, 'qty', 'optType', 'strike', 'maturity', 'underlyingPrice', 'vol', 'price', 'costPrice', 'multiplier', 'ccy', 'underlyingClass', 'rate', 'divYield', 'beta', 'duration', 'buyCcy', 'reportedNotional', 'reportedDelta', 'reportedDeltaExposure', 'strategy', 'notes', 'mtm', 'exercise', 'margining'],
    required: ['name', 'qty', 'optType', 'multiplier', 'ccy'],
    // Strike, expiry, spot and vol are needed for the model price and the delta; with a market price
    // (a warrant from a custody file) the position is still valid, and flagged.
    validate: p => (isNum(p.price) || isNum(p.mtm) ? [] : ['strike', 'maturity', 'underlyingPrice', 'vol'].filter(f => !isNum(p[f]) && !p[f]).map(f => ({ field: f, code: 'required' }))),
    defaults: { multiplier: 100, optType: 'call', underlyingClass: 'equity', rate: 2.5, vol: 20, beta: 1, exercise: 'european', margining: 'premium' },
    labels: { issuer: { en: 'Counterparty (OTC only)', sv: 'Motpart (endast OTC)' }, mtm: { en: 'Market value (overrides premium)', sv: 'Marknadsvärde (går före premien)' }, qty: { en: 'Contracts (negative = written)', sv: 'Kontrakt (negativt = utfärdat)' }, divYield: { en: 'Dividend yield % (FX: foreign rate)', sv: 'Utdelningsyield % (valuta: utländsk ränta)' }, buyCcy: { en: 'Underlying currency (FX options; put = short it)', sv: 'Underliggande valuta (valutaoptioner; put = kort)' }, duration: { en: 'Underlying duration (rate options)', sv: 'Underliggande duration (ränteoptioner)' }, price: { en: 'Premium (optional)', sv: 'Premie (valfritt)' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const T = Math.max(0, yearsBetween(ctx.valDate, p.maturity));
      const cls = p.underlyingClass || 'equity';
      const rr = num(p.rate, 2.5) / 100;
      const q = cls === 'rates' || cls === 'commodity' ? rr : num(p.divYield, 0) / 100; // Black-76 on a forward; else BSM/Garman-Kohlhagen
      const S = num(p.underlyingPrice), sig = num(p.vol) / 100;
      const noModel = !(S > 0 && num(p.strike) > 0 && p.maturity && sig > 0);
      const g = noModel ? { price: NaN, delta: 0, gamma: 0, vega: 0, theta: 0 } : bsm(p.optType, S, num(p.strike), T, rr, q, sig);
      // American (single-stock options across most of Europe): early exercise on a binomial tree. Greeks stay Black-Scholes.
      if (p.exercise === 'american') g.price = americanOption(p.optType, S, num(p.strike), T, rr, q, sig);
      const units = num(p.qty) * num(p.multiplier, 1);
      const unitPrice = isNum(p.price) ? p.price : g.price;
      // An option has a real market value (the premium). The file's own figure wins, then the
      // quoted premium, then the model.
      // Futures-style options (Eurex options on futures) are margined daily: no premium changes
      // hands, so the value is only the unsettled variation margin.
      const mv = p.margining === 'futures' ? num(p.mtm) * fx : isNum(p.mtm) ? p.mtm * fx : units * unitPrice * fx;
      // Model first, then let the custodian/broker file override. Magnitudes come from the file,
      // signs from the position itself (long/short × call/put) — files disagree on sign conventions
      // far more often than on size.
      const modelNotional = units * S * fx;
      const modelDeltaExp = modelNotional * g.delta;
      const putSign = p.optType === 'put' ? -1 : 1;
      const repNotional = isNum(p.reportedNotional) ? dirSign(p.qty) * Math.abs(p.reportedNotional) * fx : null;
      const repDelta = isNum(p.reportedDelta) ? putSign * normDelta(p.reportedDelta) : null;
      const repDeltaExp = isNum(p.reportedDeltaExposure) ? dirSign(p.qty) * putSign * Math.abs(p.reportedDeltaExposure) * fx
        : repDelta != null || repNotional != null ? (repNotional ?? modelNotional) * (repDelta ?? g.delta) : null;
      const useRep = repDeltaExp != null && ctx.useReported !== false;
      const deltaNotional = useRep ? repDeltaExp : modelDeltaExp;
      const notionalUsed = repNotional != null && ctx.useReported !== false ? repNotional : modelNotional;
      r.deriv = derivInfo({ notional: notionalUsed, modelNotional, repNotional, delta: notionalUsed ? deltaNotional / notionalUsed : g.delta, modelDelta: g.delta, repDelta, deltaExp: deltaNotional, modelDeltaExp, repDeltaExp, used: useRep });
      Object.assign(r, {
        mv, exposure: Math.abs(deltaNotional), net: deltaNotional, assetClass: DERIV_CLASS[cls] || 'mixed',
        vega: units * g.vega * fx, gamma: units * g.gamma * S * S * fx, liqDays: 1,
        option: { delta: g.delta, model: g.price, T, theta: units * g.theta * fx }
      });
      if (cls === 'equity') { r.eqDelta = deltaNotional; r.beta = num(p.beta, 1); }
      else if (cls === 'commodity') r.cmDelta = deltaNotional;
      else if (cls === 'rates') addIr01(r, p.ccy, -deltaNotional * num(p.duration, 0) * 1e-4);
      else if (cls === 'fx') { addFx(r, p.buyCcy, deltaNotional, ctx.base); addFx(r, p.ccy, -deltaNotional, ctx.base); }
      else if (cls === 'volatility') r.vega += S ? deltaNotional / S : 0; // options on VIX / VSTOXX: delta in vol points
      addFx(r, p.ccy, mv, ctx.base);
      if (noModel) {
        // No inputs for a delta: count the market value as the exposure, which understates a geared
        // warrant, and say so.
        Object.assign(r, { exposure: Math.abs(mv), net: mv * putSign, liqDays: 1 });
        if (cls === 'equity') r.eqDelta = mv * putSign;
        r.warnings.push('greeks_missing');
        return r;
      }
      if (T <= 0) r.warnings.push('expired');
      if (!isNum(p.mtm) && !isNum(p.price) && p.margining !== 'futures') r.warnings.push('model_value');
      if (r.deriv.mismatch) r.warnings.push('reported_mismatch');
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
      // Underlying move per asset class. A rate or credit option is on a bond/futures price, so the
      // rates/spread shock reaches it through the underlying's duration, not only the discount rate.
      const dur = num(p.duration, 0);
      const move = cls === 'equity' ? s.eq * num(p.beta, 1) : cls === 'commodity' ? s.cmd : cls === 'fx' ? (s.fx?.[p.buyCcy] ?? s.fxAll ?? 0)
        : cls === 'rates' ? -dur * (s.rates || 0) / 1e4 : cls === 'credit' ? -dur * ((s.rates || 0) + (s.cs || 0)) / 1e4 : 0;
      const r1 = rr + (s.rates || 0) / 1e4;
      const q1 = cls === 'rates' || cls === 'commodity' ? r1 : q; // Black-76: carry moves with the rate
      const v0 = bsm(p.optType, S, K, T, rr, q, sig).price;
      const v1 = bsm(p.optType, S * (1 + move), K, T, r1, q1, Math.max(0.01, sig + (s.vol || 0) / 100)).price;
      const fxMove = 1 + (s.fx?.[p.ccy] ?? (p.ccy === ctx.base ? 0 : s.fxAll ?? 0));
      const units = num(p.qty) * num(p.multiplier, 1);
      const mv0 = units * (isNum(p.price) ? p.price : v0) * fx0;
      return units * (v1 - v0) * fx0 * fxMove + mv0 * (fxMove - 1);
    }
  },

  fx_forward: {
    en: 'FX forward / swap', sv: 'Valutatermin / swap', group: 'derivatives', icon: 'FXF',
    hint: { en: 'One leg bought, one sold. Typical share-class or portfolio hedge. Value = buy leg − sell leg at spot unless you give a market value.', sv: 'Ett ben köpt, ett sålt. Typisk valutasäkring av andelsklass eller portfölj. Värde = köpben − säljben till spotkurs om du inte anger marknadsvärde.' },
    fields: ['name', 'buyCcy', 'buyAmount', 'sellCcy', 'sellAmount', 'maturity', 'issuer', 'mtm', 'ccy', 'strategy', 'notes'],
    required: ['buyCcy', 'buyAmount', 'sellCcy', 'sellAmount', 'maturity'],
    labels: { issuer: { en: 'Counterparty', sv: 'Motpart' }, ccy: { en: 'Currency of MV override', sv: 'Valuta för manuellt värde' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fb = fxOrWarn(p, ctx, r, p.buyCcy), fs = fxOrWarn(p, ctx, r, p.sellCcy);
      const buy = num(p.buyAmount) * fb, sell = num(p.sellAmount) * fs;
      // Without the counterparty's MTM this is buy leg − sell leg at spot: the forward points are
      // missing, which for a long-dated hedge between currencies with different rates is material.
      const mv = isNum(p.mtm) ? p.mtm * fxOrWarn(p, ctx, r, p.ccy || ctx.base) : buy - sell;
      if (!isNum(p.mtm)) r.warnings.push('fwd_spot_value');
      Object.assign(r, { mv, exposure: Math.max(Math.abs(buy), Math.abs(sell)), net: 0, assetClass: 'currency', liqDays: 1 });
      r.deriv = derivInfo({ notional: buy, modelNotional: buy, delta: 1, modelDelta: 1, deltaExp: 0, modelDeltaExp: 0 });
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
    fields: ['name', 'qty', 'ccy', 'direction', 'fixedRate', 'marketRate', 'freq', 'maturity', 'issuer', 'mtm', 'strategy', 'notes'],
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
      if (!isNum(p.mtm)) r.warnings.push('model_value');
      Object.assign(r, {
        mv, exposure: Math.abs(N), net: sign * N, assetClass: 'fixed_income', liqDays: 1,
        deriv: derivInfo({ notional: sign * N, modelNotional: sign * N, delta: 1, modelDelta: 1, deltaExp: sign * N, modelDeltaExp: sign * N }),
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
    fields: ['name', 'issuer', 'qty', 'ccy', 'protection', 'spread', 'marketSpread', 'maturity', 'rating', 'sector', 'country', 'mtm', 'strategy', 'notes'],
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
      if (!isNum(p.mtm)) r.warnings.push('model_value');
      Object.assign(r, {
        mv, exposure: Math.abs(N), net: -sign * N, assetClass: 'fixed_income', liqDays: 2,
        deriv: derivInfo({ notional: -sign * N, modelNotional: -sign * N, delta: 1, modelDelta: 1, deltaExp: -sign * N, modelDeltaExp: -sign * N }),
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
    fields: [...COMMON, 'qty', 'price', 'costPrice', 'ccy', 'sector', 'adv', 'strategy', 'notes'],
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
    fields: [...COMMON, 'altType', 'qty', 'price', 'costPrice', 'ccy', 'liquidityDays', 'beta', ...CLASSIFY, 'strategy', 'notes'],
    required: ['name', 'altType', 'qty', 'price', 'ccy'],
    defaults: { altType: 'private_equity', qty: 1 },
    labels: { price: { en: 'Valuation / NAV', sv: 'Värdering / NAV' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const mv = num(p.qty) * num(p.price) * fx;
      const betaDefault = { private_equity: 1.1, real_estate: 0.5, hedge_fund: 0.35, infrastructure: 0.45, private_credit: 0.25, crypto: 1.6, other: 0.6 }[p.altType] ?? 0.6;
      Object.assign(r, {
        mv, exposure: Math.abs(mv), net: mv, assetClass: 'alternative', eqDelta: mv, beta: num(p.beta, betaDefault),
        // Default notice periods by kind; crypto trades around the clock.
        liqDays: num(p.liquidityDays, { crypto: 1, hedge_fund: 90, real_estate: 180, private_credit: 365, infrastructure: 365, private_equity: 720 }[p.altType] ?? 180),
        specificVol: p.altType === 'crypto' ? 0.6 : 0.15
      });
      addFx(r, p.ccy, mv, ctx.base);
      return r;
    }
  },

  inflation_linked: {
    en: 'Inflation-linked bond', sv: 'Realränteobligation', group: 'fixed_income', icon: 'ILB',
    hint: { en: 'Linkers (Swedish real-rate bonds, OAT€i, BTP€i, Bund€i, index-linked gilts, TIPS). Price, yield and coupon are real; the index ratio (reference CPI ÷ base CPI) turns them into money. Without it the value is understated.', sv: 'Realränteobligationer (svenska, OAT€i, BTP€i, Bund€i, index-linked gilts, TIPS). Kurs, avkastning och kupong är reala; indexkvoten (referens-KPI ÷ bas-KPI) räknar om dem till pengar. Utan den blir värdet för lågt.' },
    fields: [...COMMON, 'qty', 'price', 'dirtyPrice', 'costPrice', 'yield', 'indexRatio', 'ccy', 'coupon', 'freq', 'maturity', 'rating', 'country', 'strategy', 'notes'],
    required: ['name', 'qty', 'ccy', 'maturity', 'indexRatio'],
    requireOneOf: [['price', 'dirtyPrice', 'yield']],
    defaults: { freq: '1', rating: 'AAA' },
    labels: { qty: { en: 'Nominal (unindexed)', sv: 'Nominellt belopp (ej uppräknat)' }, price: { en: 'Real clean price %', sv: 'Real ren kurs %' }, yield: { en: 'Real yield %', sv: 'Real avkastning %' } },
    risk(p, ctx) {
      const govt = !p.issuer || /(govern|treasur|stat|riksg|kingdom|republic|bund|federal|france|italy|uk|debt management)/i.test(p.issuer);
      return bondRisk(p, ctx, { government: govt, indexLinked: true });
    }
  },

  convertible: {
    en: 'Convertible bond', sv: 'Konvertibel', group: 'fixed_income', icon: 'CB',
    hint: { en: 'A bond that converts into shares. Valued at its market price; the equity delta (0–1, or %) splits the risk between the shares and the bond floor. Without a delta, 0.5 is assumed and flagged.', sv: 'En obligation som kan konverteras till aktier. Värderas till marknadskurs; aktiedeltat (0–1 eller %) delar risken mellan aktien och obligationsgolvet. Utan delta antas 0,5 och flaggas.' },
    fields: [...COMMON, 'qty', 'price', 'dirtyPrice', 'costPrice', 'yield', 'ccy', 'coupon', 'freq', 'maturity', 'callDate', 'callPrice', 'reportedDelta', 'beta', 'rating', ...CLASSIFY, 'adv', 'strategy', 'notes'],
    required: ['name', 'issuer', 'qty', 'ccy', 'maturity'],
    requireOneOf: [['price', 'dirtyPrice']],
    defaults: { freq: '1' },
    labels: { qty: { en: 'Nominal', sv: 'Nominellt belopp' }, price: { en: 'Clean price %', sv: 'Ren kurs %' }, reportedDelta: { en: 'Equity delta (0–1)', sv: 'Aktiedelta (0–1)' } },
    risk(p, ctx) {
      const r = bondRisk(p, ctx);
      const d = isNum(p.reportedDelta) ? normDelta(p.reportedDelta) : 0.5;
      if (!isNum(p.reportedDelta)) r.warnings.push('delta_assumed');
      // The equity part moves with the shares; rates and credit act on the bond floor.
      r.eqDelta = r.mv * d; r.beta = num(p.beta, 1); r.specificVol = ctx.cma.equitySpecificVol;
      for (const c of Object.keys(r.ir01)) r.ir01[c] *= (1 - d);
      r.cs01 *= (1 - d);
      if (r.fi) r.fi.convertible = true;
      return r;
    }
  },

  certificate: {
    en: 'Certificate / structured product', sv: 'Certifikat / strukturerad produkt', group: 'securities', icon: 'CRT',
    hint: { en: 'Exchange-traded certificates and structured products: bull/bear, mini futures, turbos, trackers, bonus certificates, autocalls, capital-protected notes. Value = quantity × price; exposure = value × leverage (negative for bear). “BULL OMX X5” style names give the leverage if the column is empty. The issuer carries the credit risk.', sv: 'Börshandlade certifikat och strukturerade produkter: bull/bear, minilong/minishort, turbos, trackers, bonuscertifikat, autocalls, kapitalskyddade placeringar. Värde = antal × kurs; exponering = värde × hävstång (negativ för bear). Namn som ”BULL OMX X5” ger hävstången om kolumnen saknas. Emittenten bär kreditrisken.' },
    fields: [...COMMON, 'qty', 'price', 'costPrice', 'ccy', 'leverage', 'underlyingClass', 'duration', 'maturity', 'beta', ...CLASSIFY, 'adv', 'strategy', 'notes'],
    required: ['name', 'qty', 'price', 'ccy'],
    defaults: { underlyingClass: 'equity' },
    labels: { issuer: { en: 'Issuer (credit risk)', sv: 'Emittent (kreditrisk)' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const mv = num(p.qty) * num(p.price) * fx;
      let lev = isNum(p.leverage) && p.leverage !== 0 ? p.leverage : null;
      if (lev == null) {
        const m = /\b(BULL|BEAR|LONG|SHORT|MINI\s*[LS])\b.*?\bX\s?(\d+(?:[.,]\d+)?)\b/i.exec(p.name || '');
        if (m) lev = parseFloat(m[2].replace(',', '.')) * (/BEAR|SHORT|MINI\s*S/i.test(m[1]) ? -1 : 1);
        else { lev = /\bBEAR\b|\bSHORT\b/i.test(p.name || '') ? -1 : 1; r.warnings.push('leverage_missing'); }
      }
      const cls = p.underlyingClass || 'equity';
      const net = mv * lev;
      Object.assign(r, { mv, exposure: Math.abs(net), net, assetClass: DERIV_CLASS[cls] || 'equity', liqDays: 1, beta: num(p.beta, 1) });
      if (cls === 'equity') { r.eqDelta = net; r.specificVol = 0.05; }
      else if (cls === 'commodity') r.cmDelta = net;
      else if (cls === 'rates') addIr01(r, p.ccy, -net * num(p.duration, 0) * 1e-4);
      else if (cls === 'credit') r.cs01 = -net * num(p.duration, 4.5) * 1e-4;
      else if (cls === 'volatility') r.vega = net / 100;
      addFx(r, p.ccy, mv, ctx.base);
      return r;
    }
  },

  equity_swap: {
    en: 'Equity swap / CFD / TRS', sv: 'Aktieswap / CFD / TRS', group: 'derivatives', icon: 'EQS',
    hint: { en: 'Contracts for difference, total return swaps, portfolio and equity swaps. Market value is the unrealised result (the MTM), not the size: exposure = quantity × underlying price. Negative quantity = short. Counterparty in Issuer counts toward the OTC counterparty limit.', sv: 'CFD:er, totalavkastningsswappar, portfölj- och aktieswappar. Marknadsvärdet är det orealiserade resultatet (MTM), inte storleken: exponering = antal × underliggande kurs. Negativt antal = kort. Motpart som emittent räknas mot gränsen för OTC-motparter.' },
    fields: ['name', 'ticker', 'isin', 'issuer', 'qty', 'underlyingPrice', 'price', 'mtm', 'costPrice', 'ccy', 'underlyingClass', 'duration', 'maturity', 'beta', 'reportedNotional', ...CLASSIFY, 'strategy', 'notes'],
    required: ['name', 'qty', 'ccy'],
    requireOneOf: [['underlyingPrice', 'price', 'reportedNotional']],
    defaults: { underlyingClass: 'equity' },
    labels: { qty: { en: 'Shares / units (negative = short)', sv: 'Antal (negativt = kort)' }, issuer: { en: 'Counterparty', sv: 'Motpart' }, price: { en: 'Underlying price', sv: 'Underliggande kurs' }, mtm: { en: 'Market value (unrealised P&L)', sv: 'Marknadsvärde (orealiserat resultat)' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const S = isNum(p.underlyingPrice) ? p.underlyingPrice : num(p.price);
      const modelNotional = num(p.qty) * S * fx;
      const repNotional = isNum(p.reportedNotional) ? dirSign(p.qty) * Math.abs(p.reportedNotional) * fx : null;
      const notional = repNotional != null && ctx.useReported !== false ? repNotional : modelNotional;
      // With a cost price the unrealised result is known; otherwise the MTM must come from the file.
      let mv = isNum(p.mtm) ? p.mtm * fx : isNum(p.costPrice) ? num(p.qty) * (S - p.costPrice) * fx : 0;
      if (!isNum(p.mtm) && !isNum(p.costPrice)) r.warnings.push('model_value');
      const cls = p.underlyingClass || 'equity';
      Object.assign(r, { mv, exposure: Math.abs(notional), net: notional, assetClass: DERIV_CLASS[cls] || 'equity', liqDays: 1, beta: num(p.beta, 1) });
      r.deriv = derivInfo({ notional, modelNotional, repNotional, delta: 1, modelDelta: 1, deltaExp: notional, modelDeltaExp: modelNotional, repDeltaExp: repNotional, used: repNotional != null && ctx.useReported !== false });
      if (cls === 'equity') { r.eqDelta = notional; r.specificVol = ctx.cma.equitySpecificVol; }
      else if (cls === 'commodity') r.cmDelta = notional;
      else if (cls === 'rates') addIr01(r, p.ccy, -notional * num(p.duration, 0) * 1e-4);
      else if (cls === 'credit') r.cs01 = -notional * num(p.duration, 4.5) * 1e-4;
      addFx(r, p.ccy, notional + mv, ctx.base);
      return r;
    },
    displayName: p => p.name || `Swap ${p.ticker || ''}`
  },

  ccs: {
    en: 'Cross-currency swap', sv: 'Valutaränteswap (CCS)', group: 'derivatives', icon: 'CCS',
    hint: { en: 'Exchanges interest and principal in two currencies. Enter the leg received (buy) and the leg paid (sell). Give the counterparty’s MTM; without it the value is the final exchange at spot and is flagged. A fixed rate makes the legs carry rate risk; floating legs have almost none.', sv: 'Byter ränta och kapital i två valutor. Ange benet du erhåller (köp) och benet du betalar (sälj). Ange motpartens marknadsvärde; utan det värderas slutväxlingen till spot och flaggas. En fast ränta ger benen ränterisk; rörliga ben har nästan ingen.' },
    fields: ['name', 'issuer', 'buyCcy', 'buyAmount', 'sellCcy', 'sellAmount', 'fixedRate', 'marketRate', 'maturity', 'mtm', 'ccy', 'strategy', 'notes'],
    required: ['buyCcy', 'buyAmount', 'sellCcy', 'sellAmount', 'maturity'],
    labels: { issuer: { en: 'Counterparty', sv: 'Motpart' }, buyAmount: { en: 'Notional received', sv: 'Nominellt belopp som erhålls' }, sellAmount: { en: 'Notional paid', sv: 'Nominellt belopp som betalas' }, fixedRate: { en: 'Fixed rate % (fixed legs)', sv: 'Fast ränta % (fasta ben)' }, ccy: { en: 'Currency of the MTM', sv: 'Valuta för marknadsvärdet' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fb = fxOrWarn(p, ctx, r, p.buyCcy), fs = fxOrWarn(p, ctx, r, p.sellCcy);
      const buy = num(p.buyAmount) * fb, sell = num(p.sellAmount) * fs;
      const mv = isNum(p.mtm) ? p.mtm * fxOrWarn(p, ctx, r, p.ccy || ctx.base) : buy - sell;
      if (!isNum(p.mtm)) r.warnings.push('model_value');
      Object.assign(r, { mv, exposure: Math.max(Math.abs(buy), Math.abs(sell)), net: 0, assetClass: 'currency', liqDays: 1 });
      r.deriv = derivInfo({ notional: buy, modelNotional: buy, delta: 1, modelDelta: 1, deltaExp: 0, modelDeltaExp: 0 });
      addFx(r, p.buyCcy, buy, ctx.base);
      addFx(r, p.sellCcy, -sell, ctx.base);
      if (isNum(p.fixedRate)) {
        const { annuity } = swapAnnuity(ctx.valDate, p.maturity, 1, num(p.marketRate, p.fixedRate));
        addIr01(r, p.buyCcy, -buy * annuity * 1e-4);
        addIr01(r, p.sellCcy, sell * annuity * 1e-4);
      }
      return r;
    },
    displayName: p => p.name || `CCS ${p.buyCcy || '?'}/${p.sellCcy || '?'} ${p.maturity || ''}`
  },

  repo: {
    en: 'Repo / reverse repo', sv: 'Repa / omvänd repa', group: 'cash', icon: 'REP',
    hint: { en: 'Collateralised cash. Positive amount = reverse repo (cash lent against collateral); negative = repo (cash borrowed, which is leverage). Available at maturity; open repos count as next-day.', sv: 'Kontanter mot säkerhet. Positivt belopp = omvänd repa (utlånade kontanter mot säkerhet); negativt = repa (lånade kontanter, alltså hävstång). Tillgängligt vid förfall; öppna repor räknas som nästa dag.' },
    fields: ['name', 'issuer', 'qty', 'ccy', 'rate', 'maturity', 'strategy', 'notes'],
    required: ['qty', 'ccy'],
    defaults: { name: 'Repo' },
    labels: { qty: { en: 'Cash amount (+ lent, − borrowed)', sv: 'Belopp (+ utlånat, − lånat)' }, issuer: { en: 'Counterparty', sv: 'Motpart' }, rate: { en: 'Repo rate %', sv: 'Reporänta %' } },
    risk(p, ctx) {
      const r = cashLike({ ...p, price: 1 }, ctx, 'money_market');
      const days = p.maturity ? Math.ceil(yearsBetween(ctx.valDate, p.maturity) * 365) : 1;
      r.liqDays = Math.max(1, days);
      return r;
    }
  },

  otc: {
    en: 'Other OTC derivative (MTM)', sv: 'Övrigt OTC-derivat (marknadsvärde)', group: 'derivatives', icon: 'OTC',
    hint: { en: 'Swaptions, caps and floors, inflation swaps, variance and volatility swaps, commodity swaps, exotic and barrier options. Not modelled: the market value must come from the counterparty. Risk comes from what you give: delta × notional on the underlying, duration for rates and inflation, vega notional for variance swaps. Exposure (commitment) is the notional.', sv: 'Swaptioner, räntetak och -golv, inflationsswappar, varians- och volatilitetsswappar, råvaruswappar, exotiska optioner och barriäroptioner. Modelleras inte: marknadsvärdet måste komma från motparten. Risken kommer från det du anger: delta × nominellt belopp på underliggande, duration för ränta och inflation, veganominellt belopp för variansswappar. Exponeringen (åtagandet) är det nominella beloppet.' },
    fields: ['name', 'issuer', 'qty', 'ccy', 'mtm', 'underlyingClass', 'reportedDelta', 'duration', 'vega', 'maturity', 'beta', 'strategy', 'notes'],
    required: ['name', 'qty', 'ccy', 'mtm', 'underlyingClass'],
    defaults: { underlyingClass: 'rates' },
    labels: { qty: { en: 'Notional', sv: 'Nominellt belopp' }, issuer: { en: 'Counterparty', sv: 'Motpart' }, mtm: { en: 'Market value (from counterparty)', sv: 'Marknadsvärde (från motpart)' }, reportedDelta: { en: 'Delta (0–1, sign = direction)', sv: 'Delta (0–1, tecken = riktning)' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const N = num(p.qty) * fx;
      const d = isNum(p.reportedDelta) ? (Math.abs(p.reportedDelta) > 1.5 ? p.reportedDelta / 100 : p.reportedDelta) : (p.underlyingClass === 'volatility' ? 0 : 1);
      const net = N * d;
      const cls = p.underlyingClass || 'rates';
      Object.assign(r, { mv: num(p.mtm) * fx, exposure: Math.abs(N), net, assetClass: DERIV_CLASS[cls] || 'mixed', liqDays: 5, beta: num(p.beta, 1) });
      r.deriv = derivInfo({ notional: N, modelNotional: N, delta: d, modelDelta: d, deltaExp: net, modelDeltaExp: net });
      if (cls === 'equity') r.eqDelta = net;
      else if (cls === 'commodity') r.cmDelta = net;
      else if (cls === 'fx') addFx(r, p.ccy, net, ctx.base);
      else if (cls === 'credit') r.cs01 = -net * num(p.duration, 4.5) * 1e-4;
      else if (cls === 'rates') { addIr01(r, p.ccy, -net * num(p.duration, 0) * 1e-4); if (!isNum(p.duration)) r.warnings.push('duration_missing'); }
      else if (cls === 'volatility') r.vega = (isNum(p.vega) ? p.vega : num(p.qty)) * fx;
      if (cls !== 'fx') addFx(r, p.ccy, r.mv, ctx.base);
      return r;
    }
  }
};

// Short positions carry a negative quantity; a zero or missing quantity is treated as long.
const dirSign = q => (num(q) < 0 ? -1 : 1);
// Delta arrives as 0.45, 45 (per cent) or -0.45 depending on the system. Anything above 1 in
// absolute terms has to be per cent — a plain option cannot have a delta above one.
export const normDelta = d => { const a = Math.abs(num(d)); return a > 1.0001 ? Math.min(1, a / 100) : a; };
// Reconciliation block every derivative carries: what we used, what the model says, what the
// file said, and whether the two disagree enough to deserve a look.
export const DELTA_TOL = 0.05, EXPOSURE_TOL = 0.10;
function derivInfo(o) {
  const d = { repNotional: null, repDelta: null, repDeltaExp: null, used: false, ...o };
  d.hasReported = d.repNotional != null || d.repDelta != null || d.repDeltaExp != null;
  d.diffExp = d.repDeltaExp != null ? d.repDeltaExp - d.modelDeltaExp : null;
  d.diffPct = d.diffExp != null && Math.abs(d.modelDeltaExp) > 1e-9 ? d.diffExp / Math.abs(d.modelDeltaExp) : null;
  // Compare in delta units, not exposure: a 0.02 delta gap on a far-OTM put is a 15 % exposure gap
  // and nobody should be paged for it.
  const base = d.repNotional ?? d.modelNotional;
  d.impliedDelta = d.repDeltaExp != null && Math.abs(base) > 1e-9 ? d.repDeltaExp / base : null;
  d.mismatch = (d.impliedDelta != null && Math.abs(d.impliedDelta - d.modelDelta) > DELTA_TOL) ||
    (d.repNotional != null && Math.abs(d.modelNotional) > 1e-9 && Math.abs(d.repNotional / d.modelNotional - 1) > EXPOSURE_TOL);
  return d;
}

const DERIV_CLASS = { equity: 'equity', rates: 'fixed_income', commodity: 'commodity', fx: 'currency', credit: 'fixed_income', volatility: 'alternative' };

function fundRisk(p, ctx, liqDefault) {
  const r = blank(ctx.base);
  const fx = fxOrWarn(p, ctx, r);
  const mv = num(p.qty) * num(p.price) * fx;
  // Leveraged and inverse products (×2, ×3, −1): the exposure is the value times the leverage.
  const lev = isNum(p.leverage) && p.leverage !== 0 ? p.leverage : 1;
  const cls = p.subClass || 'mixed';
  const eqShare = cls === 'equity' ? 1 : cls === 'mixed' ? num(p.equityShare, 50) / 100 : cls === 'alternative' ? 0.5 : 0;
  const bondShare = cls === 'fixed_income' ? 1 : cls === 'mixed' ? 1 - eqShare : 0;
  Object.assign(r, {
    mv, exposure: Math.abs(mv * lev), net: mv * lev, assetClass: cls, eqDelta: mv * eqShare * lev, beta: num(p.beta, 1),
    liqDays: isNum(p.liquidityDays) ? p.liquidityDays : (isNum(p.adv) ? null : liqDefault),
    specificVol: 0.03 // a diversified fund has little stock-specific risk left
  });
  if (cls === 'commodity') r.cmDelta = mv * lev;
  if (bondShare > 0 && !isNum(p.duration) && cls !== 'money_market') r.warnings.push('duration_missing');
  if (bondShare > 0 && isNum(p.duration)) {
    addIr01(r, p.ccy, -mv * lev * bondShare * p.duration * 1e-4);
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
  if (!d && type === 'unknown') return lang === 'sv' ? 'Okänd typ' : 'Unknown type';
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
  equity: ['equity', 'stock', 'share', 'shares', 'commonstock', 'aktie', 'aktier', 'eq', 'ordinaryshare', 'preferred', 'preferenceshare', 'preferensaktie', 'adr', 'gdr', 'depositaryreceipt', 'sdb', 'svenskadepåbevis', 'rights', 'subscriptionrights', 'subscriptionright', 'teckningsrätt', 'teckningsrätter', 'tr', 'bta', 'betaldtecknadaktie', 'interimshare', 'interimaktie', 'reit', 'spac'],
  etf: ['etf', 'exchangetradedfund', 'börshandladfond', 'etp', 'etn', 'exchangetradednote', 'exchangetradedproduct', 'ucitsetf', 'leveragedetf', 'inverseetf', 'hävstångsetf'],
  fund: ['fund', 'mutualfund', 'ucits', 'aif', 'fond', 'fonder', 'sicav', 'unittrust', 'investmentfund', 'oeic', 'fcp', 'moneymarketfund', 'mmf', 'likviditetsfond', 'penningmarknadsfond', 'kortränefond', 'bondfund', 'räntefond', 'obligationsfond', 'equityfund', 'aktiefond', 'mixedfund', 'blandfond', 'balancedfund'],
  govt_bond: ['govtbond', 'governmentbond', 'government', 'sovereign', 'treasury', 'gilt', 'bund', 'oat', 'btp', 'bono', 'dsl', 'statsobligation', 'stat', 'sgb', 'supranational', 'supra', 'agency', 'ssa', 'municipal', 'kommunobligation', 'kommuninvest'],
  corp_bond: ['corpbond', 'corporatebond', 'corporate', 'bond', 'obligation', 'företagsobligation', 'credit', 'hybrid', 'hybridbond', 'highyield', 'hy', 'ig', 'fixedbond', 'covered', 'coveredbond', 'pfandbrief', 'säkerställdobligation', 'bostadsobligation', 'perpetual', 'perp', 'at1', 'additionaltier1', 'coco', 'contingentconvertible', 'tier1', 'tier2', 't2', 'subordinated', 'callable', 'callablebond', 'seniornonpreferred', 'snp', 'greenbond', 'grönobligation', 'abs', 'mbs', 'rmbs', 'cmbs', 'clo', 'securitisation', 'securitization', 'assetbacked'],
  frn: ['frn', 'floater', 'floatingratenote', 'floatingrate', 'frnobligation', 'rörlig', 'rörligränta', 'frncovered'],
  money_market: ['moneymarket', 'tbill', 'bill', 'treasurybill', 'cp', 'commercialpaper', 'ecp', 'cd', 'certificateofdeposit', 'statsskuldväxel', 'ssvx', 'företagscertifikat', 'bankcertifikat', 'penningmarknad', 'btf', 'bot', 'letras'],
  cash: ['cash', 'deposit', 'currentaccount', 'kassa', 'likvida', 'likvidamedel', 'bankkonto', 'inlåning', 'konto', 'termdeposit', 'timedeposit', 'fixeddeposit', 'fastränteplacering', 'placeringskonto', 'bundeninlåning', 'callaccount', 'collateral', 'margin', 'initialmargin', 'säkerhet'],
  future: ['future', 'futures', 'fut', 'termin', 'terminer', 'indexfuture', 'indexterminer', 'bondfuture', 'obligationstermin', 'stir', 'stirfuture', 'euriborfuture', 'sofrfuture', 'soniafuture', 'estrfuture', 'interestratefuture', 'räntetermin', 'commodityfuture', 'råvarutermin', 'dividendfuture', 'utdelningstermin', 'fxfuture', 'valutafuture', 'vixfuture', 'vstoxxfuture', 'volatilityfuture', 'singlestockfuture', 'aktietermin'],
  option: ['option', 'options', 'opt', 'call', 'put', 'warrant', 'warrants', 'optioner', 'indexoption', 'stockoption', 'equityoption', 'aktieoption', 'fxoption', 'currencyoption', 'valutaoption', 'bondoption', 'optiononfuture', 'futuresoption', 'commodityoption', 'otcoption', 'vixoption'],
  fx_forward: ['fxforward', 'forward', 'fxfwd', 'fwd', 'fxswap', 'currencyforward', 'valutatermin', 'valutaswap', 'ndf', 'nondeliverableforward', 'fxspot', 'spot'],
  irs: ['irs', 'swap', 'interestrateswap', 'ränteswap', 'ois', 'overnightindexswap', 'fra', 'forwardrateagreement'],
  cds: ['cds', 'creditdefaultswap', 'kreditswap', 'cdx', 'itraxx', 'cdsindex', 'indexcds'],
  commodity: ['commodity', 'etc', 'gold', 'physical', 'physicalgold', 'råvara', 'råvaror', 'guld', 'silver', 'preciousmetal'],
  alternative: ['alternative', 'alternatives', 'private', 'privateequity', 'pe', 'realestate', 'hedgefund', 'crypto', 'cryptocurrency', 'kryptovaluta', 'bitcoin', 'ethereum', 'onoterat', 'fastighet', 'fastighetsfond', 'alternativ', 'infrastructure', 'privatecredit', 'directlending', 'direktlån', 'unlisted', 'venturecapital', 'fundoffunds'],
  inflation_linked: ['inflationlinked', 'inflationlinkedbond', 'linker', 'ilb', 'indexlinked', 'indexlinkedgilt', 'ilg', 'realränteobligation', 'realobligation', 'realränta', 'tips', 'oati', 'oat€i', 'oatei', 'btpei', 'btp€i', 'btpitalia', 'bundei', 'bund€i', 'dbrei'],
  convertible: ['convertible', 'convertiblebond', 'cb', 'konvertibel', 'konvertibelobligation', 'konvertibler', 'exchangeable', 'exchangeablebond', 'mandatoryconvertible'],
  certificate: ['certificate', 'certifikat', 'bullcertificate', 'bearcertificate', 'bull', 'bear', 'bullbear', 'minifuture', 'minilong', 'minishort', 'turbo', 'turbowarrant', 'knockout', 'knockoutwarrant', 'trackercertificate', 'tracker', 'bonuscertificate', 'discountcertificate', 'structuredproduct', 'strukturerad', 'struktureradprodukt', 'autocall', 'autocallable', 'capitalprotected', 'kapitalskyddad', 'indexobligation', 'aktieobligation', 'marknadsobligation', 'creditlinkednote', 'cln', 'express', 'reverseconvertible'],
  equity_swap: ['equityswap', 'aktieswap', 'cfd', 'contractfordifference', 'contractsfordifference', 'trs', 'totalreturnswap', 'portfolioswap', 'swapequity', 'dividendswap', 'basketswap', 'indexswap'],
  ccs: ['ccs', 'crosscurrencyswap', 'ccirs', 'crosscurrencyinterestrateswap', 'currencyswap', 'basisswap', 'xccy', 'valutaränteswap'],
  repo: ['repo', 'reverserepo', 'repurchaseagreement', 'reverserepurchaseagreement', 'repa', 'omvändrepa', 'tripartyrepo', 'buysellback', 'sellbuyback'],
  otc: ['otc', 'otcderivative', 'swaption', 'payerswaption', 'receiverswaption', 'cap', 'floor', 'collar', 'capfloor', 'interestratecap', 'inflationswap', 'zerocouponinflationswap', 'zciis', 'yoyinflationswap', 'inflationsswap', 'varianceswap', 'volatilityswap', 'varswap', 'volswap', 'correlationswap', 'commodityswap', 'råvaruswap', 'exotic', 'exoticoption', 'barrier', 'barrieroption', 'digital', 'digitaloption', 'binary', 'cliquet', 'asianoption']
};
// A few labels tell more than the type: a warrant is one share per unit, a STIR future is three months
// of rates, a money market fund is money market. Applied to fields the file leaves empty.
const TYPE_PRESETS = {
  warrant: { multiplier: 1 }, warrants: { multiplier: 1 },
  fxoption: { underlyingClass: 'fx', multiplier: 1 }, currencyoption: { underlyingClass: 'fx', multiplier: 1 }, valutaoption: { underlyingClass: 'fx', multiplier: 1 },
  bondoption: { underlyingClass: 'rates' }, vixoption: { underlyingClass: 'volatility' }, commodityoption: { underlyingClass: 'commodity' },
  stockoption: { exercise: 'american' }, equityoption: { exercise: 'american' }, aktieoption: { exercise: 'american' },
  stir: { underlyingClass: 'rates', duration: 0.25 }, stirfuture: { underlyingClass: 'rates', duration: 0.25 }, euriborfuture: { underlyingClass: 'rates', duration: 0.25 },
  sofrfuture: { underlyingClass: 'rates', duration: 0.25 }, soniafuture: { underlyingClass: 'rates', duration: 0.25 }, estrfuture: { underlyingClass: 'rates', duration: 0.25 },
  interestratefuture: { underlyingClass: 'rates' }, räntetermin: { underlyingClass: 'rates' }, bondfuture: { underlyingClass: 'rates' }, obligationstermin: { underlyingClass: 'rates' },
  commodityfuture: { underlyingClass: 'commodity' }, råvarutermin: { underlyingClass: 'commodity' }, fxfuture: { underlyingClass: 'fx' }, valutafuture: { underlyingClass: 'fx' },
  vixfuture: { underlyingClass: 'volatility' }, vstoxxfuture: { underlyingClass: 'volatility' }, volatilityfuture: { underlyingClass: 'volatility' },
  moneymarketfund: { subClass: 'money_market', liquidityDays: 1 }, mmf: { subClass: 'money_market', liquidityDays: 1 }, likviditetsfond: { subClass: 'money_market', liquidityDays: 1 }, penningmarknadsfond: { subClass: 'money_market', liquidityDays: 1 }, kortränefond: { subClass: 'money_market', liquidityDays: 1 },
  bondfund: { subClass: 'fixed_income' }, räntefond: { subClass: 'fixed_income' }, obligationsfond: { subClass: 'fixed_income' },
  equityfund: { subClass: 'equity' }, aktiefond: { subClass: 'equity' }, mixedfund: { subClass: 'mixed' }, blandfond: { subClass: 'mixed' }, balancedfund: { subClass: 'mixed' },
  abs: { structure: 'amortising' }, mbs: { structure: 'amortising' }, rmbs: { structure: 'amortising' }, cmbs: { structure: 'amortising' }, clo: { structure: 'amortising' },
  securitisation: { structure: 'amortising' }, securitization: { structure: 'amortising' }, assetbacked: { structure: 'amortising' },
  bitcoin: { altType: 'crypto' }, ethereum: { altType: 'crypto' }, crypto: { altType: 'crypto' }, cryptocurrency: { altType: 'crypto' }, kryptovaluta: { altType: 'crypto' },
  hedgefund: { altType: 'hedge_fund' }, realestate: { altType: 'real_estate' }, fastighet: { altType: 'real_estate' }, fastighetsfond: { altType: 'real_estate' },
  infrastructure: { altType: 'infrastructure' }, privatecredit: { altType: 'private_credit' }, directlending: { altType: 'private_credit' }, direktlån: { altType: 'private_credit' },
  swaption: { underlyingClass: 'rates' }, payerswaption: { underlyingClass: 'rates' }, receiverswaption: { underlyingClass: 'rates' }, cap: { underlyingClass: 'rates' }, floor: { underlyingClass: 'rates' },
  collar: { underlyingClass: 'rates' }, inflationswap: { underlyingClass: 'rates' }, zerocouponinflationswap: { underlyingClass: 'rates' }, zciis: { underlyingClass: 'rates' },
  varianceswap: { underlyingClass: 'volatility' }, volatilityswap: { underlyingClass: 'volatility' }, varswap: { underlyingClass: 'volatility' }, volswap: { underlyingClass: 'volatility' },
  commodityswap: { underlyingClass: 'commodity' }, råvaruswap: { underlyingClass: 'commodity' }
};
export const typePreset = raw => TYPE_PRESETS[normKey(raw)] || null;
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
  if (def.validate) errs.push(...def.validate(p));
  for (const group of def.requireOneOf || []) {
    const has = f => (FIELDS[f]?.type === 'number' ? isNum(p[f]) : p[f] !== undefined && p[f] !== null && p[f] !== '');
    if (!group.some(has)) errs.push({ field: group[0], code: 'one_of:' + group.join('|') });
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
