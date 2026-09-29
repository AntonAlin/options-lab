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
import { bsm, bondAnalytics, swapAnnuity, americanOption, amortisingAnalytics, swaption, capFloor, zcInflationSwap, barrierOption, digitalOption } from './pricing.js';
import { isNum, num, freqOf, yearsBetween } from './util.js';

// ---- asset classes, used for allocation and the risk model ----------------------------------
export const ASSET_CLASSES = {
  equity:        { en: 'Equity' },
  fixed_income:  { en: 'Fixed income' },
  money_market:  { en: 'Money market' },
  cash:          { en: 'Cash' },
  commodity:     { en: 'Commodities' },
  currency:      { en: 'Currency' },
  alternative:   { en: 'Alternatives' },
  mixed:         { en: 'Multi-asset' }
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
  nordics: { en: 'Nordics' },
  europe: { en: 'Europe ex Nordics' },
  north_america: { en: 'North America' },
  asia_pacific: { en: 'Asia-Pacific' },
  emerging: { en: 'Emerging markets' },
  global: { en: 'Global' },
  other: { en: 'Other / unknown' }
};
export const regionOf = c => REGION_OF[String(c || '').toUpperCase().trim()] || 'other';

// ---- field catalogue -------------------------------------------------------------------------
// type: text | number | date | select | ccy. `aliases` feed the bulk-upload auto-mapper
// (compared lower-case with spaces/underscores/dots stripped), so add any header your
// custodian or PMS spits out.
export const FIELDS = {
  name:        { type: 'text', en: 'Name', aliases: ['name', 'security', 'securityname', 'instrument', 'instrumentname', 'description', 'namn', 'värdepapper', 'benämning', 'beskrivning'] },
  ticker:      { type: 'text', en: 'Ticker / ID', aliases: ['ticker', 'symbol', 'bloomberg', 'bbgticker', 'ric', 'kortnamn', 'id', 'securityid'] },
  isin:        { type: 'text', en: 'ISIN', aliases: ['isin', 'isincode'] },
  issuer:      { type: 'text', en: 'Issuer', aliases: ['issuer', 'issuername', 'company', 'emittent', 'utgivare', 'bolag', 'counterparty', 'motpart'] },
  type:        { type: 'select', en: 'Instrument type', aliases: ['type', 'instrumenttype', 'securitytype', 'assettype', 'typ', 'instrumenttyp', 'värdepapperstyp'] },
  qty:         { type: 'number', en: 'Quantity', aliases: ['qty', 'quantity', 'shares', 'units', 'position', 'holding', 'antal', 'innehav', 'andelar', 'nominal', 'nominalvalue', 'nominellt', 'facevalue', 'notional', 'contracts', 'kontrakt', 'amount', 'belopp'] },
  price:       { type: 'number', en: 'Price', aliases: ['price', 'lastprice', 'close', 'marketprice', 'kurs', 'pris', 'senastekurs', 'stängningskurs', 'cleanprice', 'premium', 'premie', 'nav', 'navperunit'] },
  ccy:         { type: 'ccy', en: 'Currency', aliases: ['ccy', 'currency', 'cur', 'valuta', 'tradingcurrency', 'handelsvaluta'] },
  multiplier:  { type: 'number', en: 'Multiplier', aliases: ['multiplier', 'contractsize', 'mult', 'multiplikator', 'kontraktsstorlek', 'pointvalue'] },
  sector:      { type: 'text', en: 'Sector', aliases: ['sector', 'gicssector', 'industry', 'sektor', 'bransch', 'industri'] },
  country:     { type: 'text', en: 'Country (ISO)', aliases: ['country', 'countrycode', 'domicile', 'countryofrisk', 'land', 'landskod', 'hemvist', 'Land (ISO)'] },
  rating:      { type: 'text', en: 'Rating', aliases: ['rating', 'creditrating', 'sp', 'moodys', 'kreditbetyg', 'betyg'] },
  beta:        { type: 'number', en: 'Beta', aliases: ['beta'] },
  adv:         { type: 'number', en: 'Avg daily volume', aliases: ['adv', 'avgdailyvolume', 'averagevolume', 'volume', 'snittvolym', 'omsättning', 'volym', 'Snittvolym/dag'] },
  maturity:    { type: 'date', en: 'Maturity / expiry', aliases: ['maturity', 'maturitydate', 'expiry', 'expiration', 'expirydate', 'enddate', 'förfall', 'förfallodag', 'förfallodatum', 'slutdag', 'lösendag'] },
  coupon:      { type: 'number', en: 'Coupon %', aliases: ['coupon', 'couponrate', 'cpn', 'kupong', 'kupongränta', 'ränta'] },
  freq:        { type: 'select', en: 'Payments / year', options: ['1', '2', '4', '12'], aliases: ['freq', 'frequency', 'couponfrequency', 'frekvens', 'kupongfrekvens', 'Betalningar/år'] },
  yield:       { type: 'number', en: 'Yield %', aliases: ['yield', 'ytm', 'yieldtomaturity', 'marketyield', 'effektivränta', 'avkastning', 'ränteläge'] },
  spread:      { type: 'number', en: 'Spread (bp)', aliases: ['spread', 'discountmargin', 'dm', 'quotedmargin', 'marginal', 'spreadbp'] },
  optType:     { type: 'select', en: 'Call / put', options: ['call', 'put'], aliases: ['callput', 'putcall', 'optiontype', 'cp', 'optionstyp', 'köpsälj'] },
  strike:      { type: 'number', en: 'Strike', aliases: ['strike', 'strikeprice', 'exerciseprice', 'lösenpris', 'lösenkurs'] },
  underlyingPrice: { type: 'number', en: 'Underlying price', aliases: ['underlyingprice', 'spot', 'underlying', 'underliggande', 'underliggandekurs', 'spotpris'] },
  vol:         { type: 'number', en: 'Implied vol %', aliases: ['vol', 'iv', 'impliedvol', 'impliedvolatility', 'volatility', 'volatilitet', 'implicitvolatilitet', 'Implicit vol %'] },
  rate:        { type: 'number', en: 'Risk-free rate %', aliases: ['rate', 'riskfreerate', 'rfr', 'riskfriränta'] },
  divYield:    { type: 'number', en: 'Dividend / foreign rate %', aliases: ['divyield', 'dividendyield', 'dividend', 'q', 'foreignrate', 'utdelningsyield', 'utdelning', 'direktavkastning', 'Utdelning / utländsk ränta %'] },
  reportedNotional: { type: 'number', en: 'Reported notional', aliases: ['reportednotional', 'notionalamount', 'notionalvalue', 'underlyingnotional', 'contractvalue', 'grossnotional', 'rapporteratnominellt', 'nominelltvärde', 'kontraktsvärde', 'underliggandevärde', 'Rapporterat nominellt värde'] },
  reportedDelta: { type: 'number', en: 'Reported delta', aliases: ['delta', 'reporteddelta', 'optiondelta', 'brokerdelta', 'rapporteraddelta', 'deltaper'] },
  reportedDeltaExposure: { type: 'number', en: 'Reported delta-adjusted exposure', aliases: ['deltaadjustedexposure', 'deltaexposure', 'deltanotional', 'deltaadjustednotional', 'deltaequivalent', 'commitment', 'deltajusteradexponering', 'deltajusteratbelopp', 'åtagande', 'Rapporterad deltajusterad exponering'] },
  costPrice:   { type: 'number', en: 'Average cost per unit', aliases: ['costprice', 'averagecost', 'avgcost', 'averageprice', 'unitcost', 'bookcost', 'costbasis', 'purchaseprice', 'gav', 'anskaffningsvärde', 'anskaffningskurs', 'snittkurs', 'inköpskurs', 'genomsnittligtanskaffningsvärde', 'Anskaffningsvärde per enhet (GAV)'] },
  strategy:    { type: 'text', en: 'Strategy', aliases: ['strategy', 'strategi', 'book', 'bok', 'portfoliogroup', 'group', 'grupp'] },
  underlyingClass: { type: 'select', en: 'Underlying', options: ['equity', 'rates', 'commodity', 'fx', 'credit', 'volatility'], aliases: ['underlyingclass', 'underlyingtype', 'underlyingasset', 'tillgångsslag', 'underliggandetyp', 'Underliggande tillgång'] },
  duration:    { type: 'number', en: 'Duration (yrs)', aliases: ['duration', 'modifiedduration', 'modduration', 'ctdduration', 'duration(år)', 'durationår'] },
  buyCcy:      { type: 'ccy', en: 'Buy currency', aliases: ['buyccy', 'buycurrency', 'köpvaluta', 'ccy1'] },
  buyAmount:   { type: 'number', en: 'Buy amount', aliases: ['buyamount', 'buynotional', 'köpbelopp', 'amount1'] },
  sellCcy:     { type: 'ccy', en: 'Sell currency', aliases: ['sellccy', 'sellcurrency', 'säljvaluta', 'ccy2'] },
  sellAmount:  { type: 'number', en: 'Sell amount', aliases: ['sellamount', 'sellnotional', 'säljbelopp', 'amount2'] },
  direction:   { type: 'select', en: 'Direction', options: ['receive', 'pay'], aliases: ['direction', 'side', 'payreceive', 'riktning', 'sida'] },
  protection:  { type: 'select', en: 'Protection', options: ['buy', 'sell'], aliases: ['protection', 'buysell', 'protectionside', 'skydd'] },
  fixedRate:   { type: 'number', en: 'Fixed rate %', aliases: ['fixedrate', 'swaprate', 'fastränta', 'contractrate'] },
  marketRate:  { type: 'number', en: 'Market rate %', aliases: ['marketrate', 'currentrate', 'parrate', 'marknadsränta'] },
  marketSpread:{ type: 'number', en: 'Market spread (bp)', aliases: ['marketspread', 'currentspread', 'marknadsspread', 'Marknadsspread (bp)'] },
  mtm:         { type: 'number', en: 'Market value override', aliases: ['mtm', 'marketvalue', 'mv', 'fairvalue', 'marknadsvärde', 'värde', 'npv', 'verkligtvärde', 'marketvaluelocal', 'marknadsvärdelokal', 'premiumvalue', 'Marknadsvärde (manuellt)'] },
  subClass:    { type: 'select', en: 'Look-through class', options: ['equity', 'fixed_income', 'money_market', 'mixed', 'alternative', 'commodity'], aliases: ['assetclass', 'fundtype', 'category', 'tillgångsklass', 'fondtyp', 'kategori', 'Genomlyst tillgångsslag'] },
  equityShare: { type: 'number', en: 'Equity share %', aliases: ['equityshare', 'equityweight', 'aktieandel'] },
  altType:     { type: 'select', en: 'Alternative type', options: ['private_equity', 'real_estate', 'hedge_fund', 'infrastructure', 'private_credit', 'crypto', 'other'], aliases: ['alttype', 'subtype', 'strategy', 'strategi', 'undertyp', 'Alternativ typ'] },
  liquidityDays:{ type: 'number', en: 'Days to liquidate', aliases: ['liquiditydays', 'redemptiondays', 'noticeperiod', 'likviditetsdagar', 'uppsägningstid', 'Dagar att avveckla'] },
  dirtyPrice:  { type: 'number', en: 'Dirty price % (incl. accrued)', aliases: ['dirtyprice', 'fullprice', 'priceinclaccrued', 'priceincludingaccrued', 'dirty', 'smutsigkurs', 'kursinklupplupen', 'kursinklupplupenränta', 'Smutsig kurs % (inkl. upplupen ränta)'] },
  indexRatio:  { type: 'number', en: 'Index ratio', aliases: ['indexratio', 'indexfactor', 'inflationfactor', 'inflationindexratio', 'indexkvot', 'indexfaktor', 'indexuppräkning'] },
  callDate:    { type: 'date', en: 'Next call date', aliases: ['calldate', 'nextcalldate', 'firstcalldate', 'callable', 'call', 'inlösendag', 'förstainlösendag', 'callbar', 'Nästa inlösendag (call)'] },
  callPrice:   { type: 'number', en: 'Call price %', aliases: ['callprice', 'callpricepct', 'inlösenkursvidcall'] },
  structure:   { type: 'select', en: 'Repayment', options: ['bullet', 'amortising'], aliases: ['structure', 'repayment', 'amortisation', 'amortization', 'amortering'] },
  leverage:    { type: 'number', en: 'Leverage / participation', aliases: ['leverage', 'gearing', 'exposurefactor', 'participation', 'participationrate', 'hävstång', 'deltagandegrad', 'hävstångsfaktor', 'Hävstång / deltagandegrad'] },
  exercise:    { type: 'select', en: 'Exercise style', options: ['european', 'american'], aliases: ['exercise', 'exercisestyle', 'optionstyle', 'lösenstil', 'lösentyp'] },
  margining:   { type: 'select', en: 'Premium / margining', options: ['premium', 'futures'], aliases: ['margining', 'marginstyle', 'premiumstyle', 'settlementstyle', 'marginal', 'Premie / marginalavräkning'] },
  vega:        { type: 'number', en: 'Vega per vol point', aliases: ['vega', 'veganotional', 'vegaamount', 'Vega per volpunkt'] },
  tenor:       { type: 'number', en: 'Swap tenor (years)', aliases: ['tenor', 'swaptenor', 'underlyingtenor', 'löptid', 'swaplöptid', 'Swappens löptid (år)'] },
  volType:     { type: 'select', en: 'Vol quote', options: ['normal', 'lognormal'], aliases: ['voltype', 'volquote', 'volatilitytype', 'model', 'Volkvotering'] },
  payerReceiver: { type: 'select', en: 'Payer / receiver', options: ['payer', 'receiver'], aliases: ['payerreceiver', 'swaptiontype', 'payrec', 'betalaremottagare'] },
  capFloor:    { type: 'select', en: 'Cap / floor', options: ['cap', 'floor'], aliases: ['capfloor', 'captype', 'takgolv'] },
  breakeven:   { type: 'number', en: 'Market breakeven inflation %', aliases: ['breakeven', 'breakevenrate', 'marketbreakeven', 'inflationrate', 'breakeveninflation', 'Marknadens break-even-inflation %'] },
  startDate:   { type: 'date', en: 'Start / issue date', aliases: ['startdate', 'effectivedate', 'issuedate', 'tradedate', 'startdatum', 'emissionsdag', 'likviddag', 'Start- / emissionsdag'] },
  exoticKind:  { type: 'select', en: 'Exotic kind', options: ['barrier', 'digital'], aliases: ['exotickind', 'exotictype', 'optionkind', 'exotisktyp'] },
  barrierType: { type: 'select', en: 'Barrier type', options: ['down-and-out', 'down-and-in', 'up-and-out', 'up-and-in'], aliases: ['barriertype', 'knocktype', 'barriärtyp'] },
  barrier:     { type: 'number', en: 'Barrier / stop-loss level', aliases: ['barrier', 'barrierlevel', 'knockout', 'knockoutlevel', 'stoploss', 'stoplosslevel', 'barriär', 'stoplossnivå', 'Barriär / stop loss-nivå'] },
  payout:      { type: 'number', en: 'Digital payout per unit', aliases: ['payout', 'digitalpayout', 'cashpayout', 'utbetalning', 'Digital utbetalning per enhet'] },
  certType:    { type: 'select', en: 'Certificate kind', options: ['leverage', 'knock_out', 'protected', 'tracker'], aliases: ['certtype', 'certificatetype', 'producttype', 'certifikatstyp', 'produkttyp'] },
  cpr:         { type: 'number', en: 'Prepayment speed (CPR %)', aliases: ['cpr', 'prepaymentspeed', 'prepayment', 'förtidsinlösen', 'Förtidsinlösen (CPR %)'] },
  poolFactor:  { type: 'number', en: 'Pool factor', aliases: ['poolfactor', 'factor', 'currentfactor', 'amortisationfactor', 'poolfaktor'] },
  collateralValue: { type: 'number', en: 'Collateral value', aliases: ['collateralvalue', 'collateral', 'collateralmv', 'collateralmarketvalue', 'säkerhet', 'säkerhetsvärde', 'Säkerhetens värde'] },
  haircut:     { type: 'number', en: 'Haircut %', aliases: ['haircut', 'haircutpct', 'värderingsavdrag'] },
  collateralType: { type: 'select', en: 'Collateral type', options: ['cash', 'government', 'equity', 'other'], aliases: ['collateraltype', 'säkerhetstyp'] },
  notes:       { type: 'text', en: 'Notes', aliases: ['notes', 'comment', 'comments', 'anteckning', 'anteckningar', 'kommentar'] }
};

export const OPTION_LABELS = {
  call: { en: 'Call' }, put: { en: 'Put' },
  equity: { en: 'Equity' }, rates: { en: 'Interest rates' }, commodity: { en: 'Commodity' },
  fx: { en: 'Currency' }, credit: { en: 'Credit' }, volatility: { en: 'Volatility (VIX, VSTOXX)' },
  bullet: { en: 'Bullet (repaid at maturity)' }, amortising: { en: 'Amortising (ABS, MBS, CLO)' },
  european: { en: 'European' }, american: { en: 'American' },
  normal: { en: 'Normal (bp, Bachelier)' }, lognormal: { en: 'Lognormal (%, Black)' },
  payer: { en: 'Payer (right to pay fixed)' }, receiver: { en: 'Receiver (right to receive fixed)' },
  cap: { en: 'Cap' }, floor: { en: 'Floor' }, barrier: { en: 'Barrier' }, digital: { en: 'Digital (cash-or-nothing)' },
  'down-and-out': { en: 'Down-and-out' }, 'down-and-in': { en: 'Down-and-in' }, 'up-and-out': { en: 'Up-and-out' }, 'up-and-in': { en: 'Up-and-in' },
  leverage: { en: 'Daily leverage (bull/bear)' }, knock_out: { en: 'Knock-out (mini future, turbo)' },
  protected: { en: 'Capital protected' }, tracker: { en: 'Tracker' },
  government: { en: 'Government bonds' }, other: { en: 'Other' },
  premium: { en: 'Premium paid up front' }, futures: { en: 'Futures-style (margined)' },
  receive: { en: 'Receive fixed' }, pay: { en: 'Pay fixed' },
  buy: { en: 'Buy protection' }, sell: { en: 'Sell protection' },
  fixed_income: { en: 'Fixed income' }, money_market: { en: 'Money market' },
  mixed: { en: 'Multi-asset' }, alternative: { en: 'Alternative' },
  private_equity: { en: 'Private equity' }, real_estate: { en: 'Real estate' },
  hedge_fund: { en: 'Hedge fund' }, infrastructure: { en: 'Infrastructure' },
  private_credit: { en: 'Private credit' }, crypto: { en: 'Crypto asset' }, other: { en: 'Other' },
  '1': { en: 'Annual' }, '2': { en: 'Semi-annual' }, '4': { en: 'Quarterly' }, '12': { en: 'Monthly' }
};
// Swedish option names a file may use (the labels above are what the platform shows).
export const OPTION_ALIASES = {
  '1': ['Årlig'], '2': ['Halvårs'], '4': ['Kvartal'], '12': ['Månad'], call: ['Köp (call)'], put: ['Sälj (put)'], equity: ['Aktier'], rates: ['Räntor'], commodity: ['Råvara'], fx: ['Valuta'], credit: ['Kredit'], volatility: ['Volatilitet (VIX, VSTOXX)'], bullet: ['Rak (återbetalas vid förfall)'], amortising: ['Amorterande (ABS, MBS, CLO)'], european: ['Europeisk'], american: ['Amerikansk'], payer: ['Betalare (rätt att betala fast)'], receiver: ['Mottagare (rätt att erhålla fast)'], cap: ['Räntetak'], floor: ['Räntegolv'], barrier: ['Barriär'], digital: ['Digital (kontant eller inget)'], 'down-and-out': ['Ned-och-ut'], 'down-and-in': ['Ned-och-in'], 'up-and-out': ['Upp-och-ut'], 'up-and-in': ['Upp-och-in'], leverage: ['Daglig hävstång (bull/bear)'], protected: ['Kapitalskyddad'], government: ['Statsobligationer'], other: ['Övrigt'], premium: ['Premie betalas direkt'], futures: ['Terminsstil (marginalavräknas)'], receive: ['Erhåll fast'], pay: ['Betala fast'], buy: ['Köp skydd'], sell: ['Sälj skydd'], fixed_income: ['Räntebärande'], money_market: ['Penningmarknad'], mixed: ['Blandat'], alternative: ['Alternativ'], private_equity: ['Onoterat (PE)'], real_estate: ['Fastigheter'], hedge_fund: ['Hedgefond'], infrastructure: ['Infrastruktur'], private_credit: ['Direktlån'], crypto: ['Kryptotillgång']
};
// Swedish asset class and region names in benchmark files.
export const SEGMENT_ALIASES = {
  assetClass: { equity: ['Aktier'], fixed_income: ['Räntebärande'], money_market: ['Penningmarknad'], cash: ['Likvida medel'], commodity: ['Råvaror'], currency: ['Valuta'], alternative: ['Alternativa'], mixed: ['Blandat'] },
  region: { nordics: ['Norden'], europe: ['Europa exkl. Norden'], north_america: ['Nordamerika'], asia_pacific: ['Asien-Stillahavsområdet'], emerging: ['Tillväxtmarknader'], other: ['Övrigt / okänt'] }
};

// ---- shared risk building blocks --------------------------------------------------------------
// Every risk() returns amounts in BASE currency (ctx.fx converts) with this shape:
//   mv          market value (what the fund owns; derivatives often ~0)
//   exposure    commitment-approach gross exposure (UCITS style), always >= 0
//   net         signed economic exposure to the underlying
//   assetClass  bucket for allocation charts
//   eqDelta     equity-market delta (value change for +1.00 = +100% move), beta-adjusted in the model
//   ir01        value change for +1bp parallel rates move, keyed by currency
//   inf01       value change for +1bp of breakeven inflation, keyed by currency
//   cs01        value change for +1bp credit-spread widening
//   cmDelta     commodity delta
//   fx          { CCY: amount } currency exposure excluding the base currency
//   vega        value change per +1 vol point; gamma: cash gamma, so P&L from a return r is ½·gamma·r²
//   fi          { ytm, modDur, convexity, years, rating } for the fixed-income page, when relevant
//   liqDays     days to liquidate the whole position (null = derive from ADV)
function blank(ccyBase) {
  return { mv: 0, exposure: 0, net: 0, assetClass: 'cash', eqDelta: 0, beta: 1, ir01: {}, inf01: {}, cs01: 0, cmDelta: 0, fx: {}, vega: 0, gamma: 0, fi: null, liqDays: null, specificVol: 0, base: ccyBase, warnings: [] };
}
function addFx(r, ccy, amtBase, base) {
  ccy = majorCcy(ccy);
  if (!ccy || ccy === base || !amtBase) return;
  r.fx[ccy] = (r.fx[ccy] || 0) + amtBase;
}
function addIr01(r, ccy, v) { if (v) r.ir01[ccy] = (r.ir01[ccy] || 0) + v; }
// Value change for +1 bp of breakeven inflation, by currency.
// Risk-free rate for discounting over T years: the position's own rate, else the portfolio's curve
// for that currency (ECB AAA + €STR for EUR), else 2.5 %.
function rfRate(p, ctx, T, field = 'rate') {
  if (isNum(p[field])) return p[field] / 100;
  const z = ctx.zero ? ctx.zero(p.ccy, T) : null;
  return isNum(z) ? z : 0.025;
}
function addInf01(r, ccy, v) { if (v) r.inf01[ccy] = (r.inf01[ccy] || 0) + v; }

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
  // ABS / RMBS / CLO: principal comes back every period, faster with prepayments (CPR).
  let factor = 1;
  if (p.structure === 'amortising' && p.maturity) {
    const am = amortisingAnalytics({ valuationDate: ctx.valDate, maturity: p.maturity, couponPct: num(p.coupon), freq: freqOf(p.freq, 12), cpr: num(p.cpr), cleanPrice: clean, yieldPct: isNum(p.yield) ? p.yield : undefined });
    if (am) { a = am; workout = 'wal'; factor = isNum(p.poolFactor) && p.poolFactor > 0 ? p.poolFactor : 1; }
  }
  if (!a) {
    r.warnings.push(p.maturity || p.callDate ? 'bond_unpriced' : 'perpetual_no_call');
    const mv = num(p.qty) * num(clean ?? p.price) / 100 * ir * fx;
    Object.assign(r, { mv, exposure: Math.abs(mv), net: mv, assetClass: 'fixed_income' });
    addFx(r, p.ccy, mv, ctx.base);
    return r;
  }
  if (p.structure === 'amortising' && !isNum(p.cpr)) r.warnings.push('cpr_missing');
  const mv = (isNum(p.mtm) ? p.mtm : num(p.qty) * factor * a.dirty / 100 * ir) * fx;
  // A floater's rate duration is the time to the next reset; its spread duration is the full thing.
  const rateDur = floating ? Math.min(a.yearsToMaturity, 1 / f) : a.modDur;
  const spreadDur = a.modDur;
  Object.assign(r, {
    mv, exposure: Math.abs(mv), net: mv, assetClass: 'fixed_income',
    cs01: government ? 0 : -mv * spreadDur * 1e-4,
    fi: {
      ytm: floating && isNum(p.yield) ? p.yield / 100 : a.ytm, modDur: rateDur, spreadDur: government ? 0 : spreadDur,
      convexity: floating ? 0 : a.convexity, years: a.yearsToMaturity, rating: p.rating || '', accrued: a.accrued, dirty: a.dirty,
      workout, real: indexLinked, wal: a.wal ?? null,
      // Spread over the AAA government curve at the bond's own maturity (nominal fixed-coupon bonds).
      curveSpreadBp: (() => { const z = !indexLinked && !floating && ctx.zero ? ctx.zero(p.ccy, a.yearsToMaturity) : null; return isNum(z) && isNum(a.ytm) ? (a.ytm - (Math.exp(z) - 1)) * 1e4 : null; })()
    }
  });
  // Real yield = nominal yield − breakeven inflation, so a linker is short nominal rates and long
  // breakeven by the same duration.
  addIr01(r, p.ccy, -mv * rateDur * 1e-4);
  if (indexLinked) addInf01(r, p.ccy, mv * rateDur * 1e-4);
  addFx(r, p.ccy, mv, ctx.base);
  return r;
}

const COMMON = ['name', 'ticker', 'isin', 'issuer'];
const CLASSIFY = ['sector', 'country'];

// ---- the registry ------------------------------------------------------------------------------
export const INSTRUMENTS = {
  equity: {
    en: 'Equity', group: 'securities', icon: 'EQ',
    hint: { en: 'Listed shares. Quantity in shares, price per share.' },
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
    en: 'ETF', group: 'funds', icon: 'ETF',
    hint: { en: 'Set the look-through class so an equity ETF is treated as equity risk and a bond ETF as duration.' },
    fields: [...COMMON, 'qty', 'price', 'costPrice', 'ccy', 'subClass', 'equityShare', 'duration', 'leverage', 'beta', ...CLASSIFY, 'adv', 'strategy', 'notes'],
    required: ['name', 'qty', 'price', 'ccy', 'subClass'],
    defaults: { subClass: 'equity', beta: 1 },
    risk(p, ctx) { return fundRisk(p, ctx, 1); }
  },

  fund: {
    en: 'Mutual fund', group: 'funds', icon: 'FND',
    hint: { en: 'Units × NAV. Redemption settles in a few days, so liquidity defaults to 3 days.' },
    fields: [...COMMON, 'qty', 'price', 'costPrice', 'ccy', 'subClass', 'equityShare', 'duration', 'beta', 'liquidityDays', ...CLASSIFY, 'strategy', 'notes'],
    required: ['name', 'qty', 'price', 'ccy', 'subClass'],
    defaults: { subClass: 'mixed', equityShare: 50, liquidityDays: 3, beta: 1 },
    risk(p, ctx) { return fundRisk(p, ctx, 3); }
  },

  govt_bond: {
    en: 'Government bond', group: 'fixed_income', icon: 'GOV',
    hint: { en: 'Quantity = nominal amount. Price = clean price in % of par. Give yield instead of price if that is what you have.' },
    fields: [...COMMON, 'qty', 'price', 'dirtyPrice', 'costPrice', 'yield', 'ccy', 'coupon', 'freq', 'maturity', 'rating', 'country', 'strategy', 'notes'],
    required: ['name', 'qty', 'ccy', 'maturity'],
    requireOneOf: [['price', 'dirtyPrice', 'yield']],
    defaults: { freq: '1', rating: 'AAA', coupon: 0 },
    labels: { qty: { en: 'Nominal' }, price: { en: 'Clean price %' } },
    risk(p, ctx) { return bondRisk(p, ctx, { government: true }); }
  },

  corp_bond: {
    en: 'Corporate bond', group: 'fixed_income', icon: 'CRP',
    hint: { en: 'Fixed-coupon credit. Carries both rate duration and spread duration.' },
    fields: [...COMMON, 'qty', 'price', 'dirtyPrice', 'costPrice', 'yield', 'ccy', 'coupon', 'freq', 'maturity', 'callDate', 'callPrice', 'structure', 'cpr', 'poolFactor', 'rating', ...CLASSIFY, 'adv', 'strategy', 'notes'],
    required: ['name', 'issuer', 'qty', 'ccy'],
    requireOneOf: [['price', 'dirtyPrice', 'yield'], ['maturity', 'callDate']],
    defaults: { freq: '1' },
    labels: { qty: { en: 'Nominal' }, price: { en: 'Clean price %' } },
    risk(p, ctx) { return bondRisk(p, ctx); }
  },

  frn: {
    en: 'Floating rate note', group: 'fixed_income', icon: 'FRN',
    hint: { en: 'Coupon = current fixing + margin. Rate duration is time to next reset; spread duration runs to maturity. Typical for Nordic credit funds.' },
    fields: [...COMMON, 'qty', 'price', 'dirtyPrice', 'costPrice', 'yield', 'ccy', 'coupon', 'spread', 'freq', 'maturity', 'callDate', 'callPrice', 'structure', 'cpr', 'poolFactor', 'rating', ...CLASSIFY, 'strategy', 'notes'],
    required: ['name', 'issuer', 'qty', 'ccy'],
    requireOneOf: [['price', 'dirtyPrice'], ['maturity', 'callDate']],
    defaults: { freq: '4' },
    labels: { qty: { en: 'Nominal' }, price: { en: 'Clean price %' }, coupon: { en: 'Current coupon %' } },
    risk(p, ctx) { return bondRisk(p, ctx, { floating: true }); }
  },

  money_market: {
    en: 'Money market / T-bill', group: 'fixed_income', icon: 'MM',
    hint: { en: 'Discount paper and certificates under a year. Enter price in % of par or the yield.' },
    fields: [...COMMON, 'qty', 'price', 'dirtyPrice', 'costPrice', 'yield', 'ccy', 'maturity', 'rating', 'country', 'strategy', 'notes'],
    required: ['name', 'qty', 'ccy', 'maturity'],
    requireOneOf: [['price', 'dirtyPrice', 'yield']],
    labels: { qty: { en: 'Nominal' }, price: { en: 'Price %' } },
    risk(p, ctx) {
      const r = bondRisk({ ...p, coupon: 0, freq: 1 }, ctx, { government: !p.issuer || /stat|gov|treas|riksg/i.test(p.issuer) });
      r.assetClass = 'money_market';
      r.liqDays = 1;
      return r;
    }
  },

  cash: {
    en: 'Cash / deposit', group: 'cash', icon: 'CSH',
    hint: { en: 'Quantity = amount in the account currency. Negative for overdraft or unsettled payables.' },
    fields: ['name', 'qty', 'ccy', 'issuer', 'maturity', 'rate', 'strategy', 'notes'],
    required: ['qty', 'ccy'],
    defaults: { name: 'Cash' },
    labels: { qty: { en: 'Amount' }, issuer: { en: 'Bank' }, maturity: { en: 'Maturity (term deposit)' }, rate: { en: 'Deposit rate %' } },
    risk(p, ctx) {
      const r = cashLike({ ...p, price: 1 }, ctx, 'cash');
      // A term deposit is only available at maturity (break costs aside).
      const days = p.maturity ? Math.ceil(yearsBetween(ctx.valDate, p.maturity) * 365) : 0;
      if (days > 0) r.liqDays = days;
      return r;
    }
  },

  future: {
    en: 'Future', group: 'derivatives', icon: 'FUT',
    hint: { en: 'Contracts × price × multiplier = notional. Daily margined, so market value is ~0 and the notional is the exposure. For bond futures enter the CTD modified duration.' },
    fields: [...COMMON, 'qty', 'price', 'multiplier', 'ccy', 'underlyingClass', 'maturity', 'duration', 'beta', 'buyCcy', 'mtm', 'reportedNotional', 'country', 'strategy', 'notes'],
    required: ['name', 'qty', 'price', 'multiplier', 'ccy', 'underlyingClass'],
    defaults: { multiplier: 1, underlyingClass: 'equity', beta: 1 },
    labels: { qty: { en: 'Contracts (negative = short)' }, buyCcy: { en: 'Currency bought (FX futures)' }, duration: { en: 'Duration (bond futures)' }, mtm: { en: 'Variation margin (unsettled)' } },
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
    en: 'Option', group: 'derivatives', icon: 'OPT',
    hint: { en: 'Priced with Black-Scholes-Merton (Black-76 when the underlying is rates or commodity). Leave price empty to use the model value. Delta-adjusted notional counts as exposure. Listed or OTC: for an OTC option put the counterparty in Issuer, and it counts toward the OTC counterparty limit. A market value from your file overrides premium and model.' },
    fields: [...COMMON, 'qty', 'optType', 'strike', 'maturity', 'underlyingPrice', 'vol', 'price', 'costPrice', 'multiplier', 'ccy', 'underlyingClass', 'rate', 'divYield', 'beta', 'duration', 'buyCcy', 'reportedNotional', 'reportedDelta', 'reportedDeltaExposure', 'strategy', 'notes', 'mtm', 'exercise', 'margining'],
    required: ['name', 'qty', 'optType', 'multiplier', 'ccy'],
    // Strike, expiry, spot and vol are needed for the model price and the delta; with a market price
    // (a warrant from a custody file) the position is still valid, and flagged.
    validate: p => (isNum(p.price) || isNum(p.mtm) ? [] : ['strike', 'maturity', 'underlyingPrice', 'vol'].filter(f => !isNum(p[f]) && !p[f]).map(f => ({ field: f, code: 'required' }))),
    defaults: { multiplier: 100, optType: 'call', underlyingClass: 'equity', vol: 20, beta: 1, exercise: 'european', margining: 'premium' },
    labels: { issuer: { en: 'Counterparty (OTC only)' }, mtm: { en: 'Market value (overrides premium)' }, qty: { en: 'Contracts (negative = written)' }, divYield: { en: 'Dividend yield % (FX: foreign rate)' }, buyCcy: { en: 'Underlying currency (FX options; put = short it)' }, duration: { en: 'Underlying duration (rate options)' }, price: { en: 'Premium (optional)' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const T = Math.max(0, yearsBetween(ctx.valDate, p.maturity));
      const cls = p.underlyingClass || 'equity';
      const rr = rfRate(p, ctx, T);
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
      const rr = rfRate(p, ctx, T), q = cls === 'rates' || cls === 'commodity' ? rr : num(p.divYield, 0) / 100;
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
    en: 'FX forward / swap', group: 'derivatives', icon: 'FXF',
    hint: { en: 'One leg bought, one sold. Typical share-class or portfolio hedge. Value = buy leg − sell leg at spot unless you give a market value.' },
    fields: ['name', 'buyCcy', 'buyAmount', 'sellCcy', 'sellAmount', 'maturity', 'issuer', 'mtm', 'ccy', 'strategy', 'notes'],
    required: ['buyCcy', 'buyAmount', 'sellCcy', 'sellAmount', 'maturity'],
    labels: { issuer: { en: 'Counterparty' }, ccy: { en: 'Currency of MV override' } },
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
    en: 'Interest rate swap', group: 'derivatives', icon: 'IRS',
    hint: { en: 'Receive fixed adds duration, pay fixed removes it. Value is estimated from the fixed rate vs the current par rate unless you enter a market value.' },
    fields: ['name', 'qty', 'ccy', 'direction', 'fixedRate', 'marketRate', 'freq', 'maturity', 'issuer', 'mtm', 'strategy', 'notes'],
    required: ['qty', 'ccy', 'direction', 'fixedRate', 'marketRate', 'maturity'],
    defaults: { direction: 'receive', freq: '1' },
    labels: { qty: { en: 'Notional' }, issuer: { en: 'Counterparty / CCP' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const N = num(p.qty) * fx;
      const { annuity, years } = swapAnnuity(ctx.valDate, p.maturity, freqOf(p.freq, 1), num(p.marketRate), ctx.df ? ctx.df(p.ccy) : null);
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
    en: 'Credit default swap', group: 'derivatives', icon: 'CDS',
    hint: { en: 'Selling protection is long credit risk (like owning the bond without the cash). Spread DV01 uses a flat risky annuity.' },
    fields: ['name', 'issuer', 'qty', 'ccy', 'protection', 'spread', 'marketSpread', 'maturity', 'rating', 'sector', 'country', 'mtm', 'strategy', 'notes'],
    required: ['issuer', 'qty', 'ccy', 'protection', 'spread', 'marketSpread', 'maturity'],
    defaults: { protection: 'sell', spread: 100 },
    labels: { qty: { en: 'Notional' }, spread: { en: 'Contract spread (bp)' } },
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
    en: 'Commodity / ETC', group: 'securities', icon: 'CMD',
    hint: { en: 'Physical holdings or exchange-traded commodities. For futures use the Future type.' },
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
    en: 'Alternative / unlisted', group: 'securities', icon: 'ALT',
    hint: { en: 'Private equity, real estate, hedge funds, private credit, crypto. Valued at the last reported NAV; liquidity from the notice period.' },
    fields: [...COMMON, 'altType', 'qty', 'price', 'costPrice', 'ccy', 'liquidityDays', 'beta', ...CLASSIFY, 'strategy', 'notes'],
    required: ['name', 'altType', 'qty', 'price', 'ccy'],
    defaults: { altType: 'private_equity', qty: 1 },
    labels: { price: { en: 'Valuation / NAV' } },
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
    en: 'Inflation-linked bond', group: 'fixed_income', icon: 'ILB',
    hint: { en: 'Linkers (Swedish real-rate bonds, OAT€i, BTP€i, Bund€i, index-linked gilts, TIPS). Price, yield and coupon are real; the index ratio (reference CPI ÷ base CPI) turns them into money. Without it the value is understated.' },
    fields: [...COMMON, 'qty', 'price', 'dirtyPrice', 'costPrice', 'yield', 'indexRatio', 'ccy', 'coupon', 'freq', 'maturity', 'rating', 'country', 'strategy', 'notes'],
    required: ['name', 'qty', 'ccy', 'maturity', 'indexRatio'],
    requireOneOf: [['price', 'dirtyPrice', 'yield']],
    defaults: { freq: '1', rating: 'AAA' },
    labels: { qty: { en: 'Nominal (unindexed)' }, price: { en: 'Real clean price %' }, yield: { en: 'Real yield %' } },
    risk(p, ctx) {
      const govt = !p.issuer || /(govern|treasur|stat|riksg|kingdom|republic|bund|federal|france|italy|uk|debt management)/i.test(p.issuer);
      return bondRisk(p, ctx, { government: govt, indexLinked: true });
    }
  },

  convertible: {
    en: 'Convertible bond', group: 'fixed_income', icon: 'CB',
    hint: { en: 'A bond that converts into shares. Valued at its market price; the equity delta (0–1, or %) splits the risk between the shares and the bond floor. Without a delta, 0.5 is assumed and flagged.' },
    fields: [...COMMON, 'qty', 'price', 'dirtyPrice', 'costPrice', 'yield', 'ccy', 'coupon', 'freq', 'maturity', 'callDate', 'callPrice', 'reportedDelta', 'beta', 'rating', ...CLASSIFY, 'adv', 'strategy', 'notes'],
    required: ['name', 'issuer', 'qty', 'ccy', 'maturity'],
    requireOneOf: [['price', 'dirtyPrice']],
    defaults: { freq: '1' },
    labels: { qty: { en: 'Nominal' }, price: { en: 'Clean price %' }, reportedDelta: { en: 'Equity delta (0–1)' } },
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
    en: 'Certificate / structured product', group: 'securities', icon: 'CRT',
    hint: { en: 'Exchange-traded certificates and structured products: bull/bear, mini futures, turbos, trackers, bonus certificates, autocalls, capital-protected notes. Value = quantity × price; exposure = value × leverage (negative for bear). For autocalls and other payoffs without a model here, put the issuer’s delta in Leverage. “BULL OMX X5” style names give the leverage if the column is empty. The issuer carries the credit risk.' },
    fields: [...COMMON, 'qty', 'price', 'costPrice', 'ccy', 'certType', 'leverage', 'underlyingClass', 'underlyingPrice', 'strike', 'barrier', 'multiplier', 'optType', 'vol', 'rate', 'divYield', 'duration', 'maturity', 'beta', ...CLASSIFY, 'adv', 'strategy', 'notes'],
    required: ['name', 'qty', 'price', 'ccy'],
    defaults: { underlyingClass: 'equity' },
    labels: { issuer: { en: 'Issuer (credit risk)' } },
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
      let net = mv * lev;
      const kind = p.certType || (isNum(p.barrier) && isNum(p.strike) ? 'knock_out' : 'leverage');
      const S = num(p.underlyingPrice);
      if (kind === 'knock_out' && S > 0 && isNum(p.strike)) {
        // Mini future / turbo: value ≈ (spot − financing level) × ratio; exposure is the whole
        // underlying per certificate, and it is gone once the stop-loss is hit.
        const long = p.optType ? p.optType !== 'put' : !/\b(BEAR|SHORT|MINI\s*S|TURBO\s*S)/i.test(p.name || '');
        const phi = long ? 1 : -1, ratio = num(p.multiplier, 1);
        const out = isNum(p.barrier) && phi * (S - p.barrier) <= 0;
        net = out ? 0 : phi * num(p.qty) * ratio * S * fx;
        r.model = { price: out ? 0 : Math.max(0, phi * (S - p.strike)) * ratio, leverage: out ? 0 : S / Math.max(1e-9, phi * (S - p.strike)) };
        if (out) r.warnings.push('knocked_out');
        r.warnings = r.warnings.filter(w => w !== 'leverage_missing');
      } else if (kind === 'protected' && S > 0 && isNum(p.strike) && isNum(p.vol) && p.maturity) {
        // Capital protected: a zero-coupon floor plus participation × at-the-money call per 100.
        const T = Math.max(0, yearsBetween(ctx.valDate, p.maturity)), rr = rfRate(p, ctx, T);
        const part = isNum(p.leverage) ? p.leverage : 1, c = bsm('call', S, num(p.strike), T, rr, num(p.divYield, 0) / 100, num(p.vol) / 100);
        net = num(p.qty) * part * c.delta * S / num(p.strike) * fx;
        r.model = { price: 100 * Math.exp(-rr * T) + part * 100 / num(p.strike) * c.price };
        r.warnings = r.warnings.filter(w => w !== 'leverage_missing');
      }
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
    en: 'Equity swap / CFD / TRS', group: 'derivatives', icon: 'EQS',
    hint: { en: 'Contracts for difference, total return swaps, portfolio and equity swaps. Market value is the unrealised result (the MTM), not the size: exposure = quantity × underlying price. Negative quantity = short. Counterparty in Issuer counts toward the OTC counterparty limit.' },
    fields: ['name', 'ticker', 'isin', 'issuer', 'qty', 'underlyingPrice', 'price', 'mtm', 'costPrice', 'ccy', 'underlyingClass', 'duration', 'maturity', 'beta', 'reportedNotional', ...CLASSIFY, 'strategy', 'notes'],
    required: ['name', 'qty', 'ccy'],
    requireOneOf: [['underlyingPrice', 'price', 'reportedNotional']],
    defaults: { underlyingClass: 'equity' },
    labels: { qty: { en: 'Shares / units (negative = short)' }, issuer: { en: 'Counterparty' }, price: { en: 'Underlying price' }, mtm: { en: 'Market value (unrealised P&L)' } },
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
    en: 'Cross-currency swap', group: 'derivatives', icon: 'CCS',
    hint: { en: 'Exchanges interest and principal in two currencies. Enter the leg received (buy) and the leg paid (sell). Give the counterparty’s MTM; without it the value is the final exchange at spot and is flagged. A fixed rate makes the legs carry rate risk; floating legs have almost none.' },
    fields: ['name', 'issuer', 'buyCcy', 'buyAmount', 'sellCcy', 'sellAmount', 'fixedRate', 'marketRate', 'maturity', 'mtm', 'ccy', 'strategy', 'notes'],
    required: ['buyCcy', 'buyAmount', 'sellCcy', 'sellAmount', 'maturity'],
    labels: { issuer: { en: 'Counterparty' }, buyAmount: { en: 'Notional received' }, sellAmount: { en: 'Notional paid' }, fixedRate: { en: 'Fixed rate % (fixed legs)' }, ccy: { en: 'Currency of the MTM' } },
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
    en: 'Repo / reverse repo', group: 'cash', icon: 'REP',
    hint: { en: 'Collateralised cash. Positive amount = reverse repo (cash lent against collateral); negative = repo (cash borrowed, which is leverage). Available at maturity; open repos count as next-day.' },
    fields: ['name', 'issuer', 'qty', 'ccy', 'rate', 'maturity', 'collateralValue', 'haircut', 'collateralType', 'strategy', 'notes'],
    required: ['qty', 'ccy'],
    defaults: { name: 'Repo', collateralType: 'government' },
    labels: { qty: { en: 'Cash amount (+ lent, − borrowed)' }, issuer: { en: 'Counterparty' }, rate: { en: 'Repo rate %' } },
    risk(p, ctx) {
      const r = cashLike({ ...p, price: 1 }, ctx, 'money_market');
      const days = p.maturity ? Math.ceil(yearsBetween(ctx.valDate, p.maturity) * 365) : 1;
      r.liqDays = Math.max(1, days);
      // Counterparty exposure after collateral: cash lent minus collateral received (after haircut),
      // or, in a repo, collateral posted beyond the cash received.
      const fx = ctx.fx(p.ccy), cash = num(p.qty) * num(fx, 0), coll = num(p.collateralValue) * num(fx, 0);
      if (isNum(p.collateralValue)) {
        r.cptyExposure = cash >= 0 ? Math.max(0, cash - coll * (1 - num(p.haircut, 0) / 100)) : Math.max(0, coll - Math.abs(cash));
        if (cash > 0 && coll * (1 - num(p.haircut, 0) / 100) < cash) r.warnings.push('under_collateralised');
      } else { r.cptyExposure = Math.max(0, cash); r.warnings.push('collateral_missing'); }
      return r;
    }
  },

  otc: {
    en: 'Other OTC derivative (MTM)', group: 'derivatives', icon: 'OTC',
    hint: { en: 'Only for what the platform has no model for: Asian, lookback, cliquet, basket, rainbow and quanto options, variance, volatility, correlation and commodity swaps. The market value must come from the counterparty, and the risk is only as good as the delta, duration or vega you give. Swaptions, caps/floors, inflation swaps, variance swaps, barriers and digitals have their own types with models. Exposure (commitment) is the notional.' },
    fields: ['name', 'issuer', 'qty', 'ccy', 'mtm', 'underlyingClass', 'reportedDelta', 'duration', 'vega', 'maturity', 'beta', 'strategy', 'notes'],
    required: ['name', 'qty', 'ccy', 'mtm', 'underlyingClass'],
    defaults: { underlyingClass: 'rates' },
    labels: { qty: { en: 'Notional' }, issuer: { en: 'Counterparty' }, mtm: { en: 'Market value (from counterparty)' }, reportedDelta: { en: 'Delta (0–1, sign = direction)' } },
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
  },

  swaption: {
    en: 'Swaption', group: 'derivatives', icon: 'SWO',
    hint: { en: 'Option to enter an interest rate swap. Bachelier (normal vol in bp, the euro-market quote) or Black (lognormal %). Forward swap rate as the market rate; the counterparty’s MTM, if given, is used as the value. Negative quantity = sold.' },
    fields: ['name', 'issuer', 'qty', 'ccy', 'payerReceiver', 'strike', 'maturity', 'tenor', 'marketRate', 'vol', 'volType', 'freq', 'mtm', 'strategy', 'notes'],
    required: ['qty', 'ccy', 'payerReceiver', 'strike', 'maturity', 'tenor', 'marketRate', 'vol'],
    defaults: { payerReceiver: 'payer', volType: 'normal', freq: '1' },
    labels: { qty: { en: 'Notional (negative = sold)' }, issuer: { en: 'Counterparty' }, strike: { en: 'Strike rate %' }, maturity: { en: 'Option expiry' }, marketRate: { en: 'Forward swap rate %' }, vol: { en: 'Implied vol (bp normal / % lognormal)' } },
    risk(p, ctx) { return rateOptionRisk(p, ctx, 'swaption'); },
    stressPnl(p, ctx, s) { return rateOptionStress(p, ctx, s, 'swaption'); },
    displayName: p => p.name || `${p.payerReceiver === 'receiver' ? 'Receiver' : 'Payer'} ${num(p.strike).toFixed(2)}% ${p.maturity || ''}×${p.tenor || ''}y`
  },

  cap_floor: {
    en: 'Cap / floor', group: 'derivatives', icon: 'CAP',
    hint: { en: 'Strip of options on the floating rate (caplets or floorlets), valued like a swaption on a flat forward. The first period is already fixed and left out.' },
    fields: ['name', 'issuer', 'qty', 'ccy', 'capFloor', 'strike', 'startDate', 'maturity', 'marketRate', 'vol', 'volType', 'freq', 'mtm', 'strategy', 'notes'],
    required: ['qty', 'ccy', 'capFloor', 'strike', 'maturity', 'marketRate', 'vol'],
    defaults: { capFloor: 'cap', volType: 'normal', freq: '4' },
    labels: { qty: { en: 'Notional (negative = sold)' }, issuer: { en: 'Counterparty' }, strike: { en: 'Strike rate %' }, marketRate: { en: 'Forward rate %' }, vol: { en: 'Implied vol (bp normal / % lognormal)' } },
    risk(p, ctx) { return rateOptionRisk(p, ctx, 'cap'); },
    stressPnl(p, ctx, s) { return rateOptionStress(p, ctx, s, 'cap'); },
    displayName: p => p.name || `${p.capFloor === 'floor' ? 'Floor' : 'Cap'} ${num(p.strike).toFixed(2)}% ${p.maturity || ''}`
  },

  inflation_swap: {
    en: 'Inflation swap', group: 'derivatives', icon: 'INF',
    hint: { en: 'Zero-coupon inflation swap: at maturity one side pays the compounded fixed rate, the other the realised inflation. Valued from the market breakeven; its risk is breakeven inflation (a factor of its own) and, a little, nominal rates.' },
    fields: ['name', 'issuer', 'qty', 'ccy', 'direction', 'fixedRate', 'breakeven', 'marketRate', 'maturity', 'mtm', 'strategy', 'notes'],
    required: ['qty', 'ccy', 'direction', 'fixedRate', 'breakeven', 'maturity'],
    defaults: { direction: 'receive' },
    labels: { qty: { en: 'Notional' }, issuer: { en: 'Counterparty' }, direction: { en: 'Receive or pay inflation' }, fixedRate: { en: 'Fixed (contract breakeven) %' }, marketRate: { en: 'Discount rate %' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const T = Math.max(0, yearsBetween(ctx.valDate, p.maturity));
      const o = zcInflationSwap({ receiveInflation: p.direction !== 'pay', T, fixed: num(p.fixedRate) / 100, breakeven: num(p.breakeven) / 100, rate: rfRate(p, ctx, T, 'marketRate') });
      const N = num(p.qty) * fx;
      const mv = isNum(p.mtm) ? p.mtm * fx : N * o.pv;
      Object.assign(r, { mv, exposure: Math.abs(N), net: (p.direction === 'pay' ? -1 : 1) * N, assetClass: 'fixed_income', liqDays: 5 });
      r.deriv = derivInfo({ notional: N, modelNotional: N, delta: 1, modelDelta: 1, deltaExp: r.net, modelDeltaExp: r.net });
      addInf01(r, p.ccy, N * o.dPVdB * 1e-4);
      addIr01(r, p.ccy, N * o.dPVdR * 1e-4);
      r.fi = { ytm: null, modDur: 0, spreadDur: 0, convexity: 0, years: T, rating: '', derivative: true };
      addFx(r, p.ccy, mv, ctx.base);
      return r;
    },
    displayName: p => p.name || `ZC inflation swap ${p.direction === 'pay' ? 'pay' : 'rec'} ${num(p.fixedRate).toFixed(2)}% ${p.maturity || ''}`
  },

  exotic_option: {
    en: 'Barrier / digital option', group: 'derivatives', icon: 'EXO',
    hint: { en: 'Barrier options (knock-in, knock-out, up or down) with the Reiner-Rubinstein formulas, and cash-or-nothing digitals. Delta and vega by revaluation. Knocked-out options are flagged. Negative quantity = sold.' },
    fields: [...COMMON, 'qty', 'exoticKind', 'optType', 'barrierType', 'barrier', 'payout', 'strike', 'maturity', 'underlyingPrice', 'vol', 'rate', 'divYield', 'multiplier', 'price', 'mtm', 'ccy', 'underlyingClass', 'beta', 'strategy', 'notes'],
    required: ['name', 'qty', 'exoticKind', 'optType', 'strike', 'maturity', 'underlyingPrice', 'vol', 'ccy'],
    defaults: { exoticKind: 'barrier', barrierType: 'down-and-out', optType: 'call', multiplier: 1, underlyingClass: 'equity', beta: 1, payout: 1 },
    labels: { issuer: { en: 'Counterparty' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const units = num(p.qty) * num(p.multiplier, 1);
      const S = num(p.underlyingPrice), vol = num(p.vol) / 100;
      const unit = (s, v) => exoticPrice(p, ctx, s, v);
      const model = unit(S, vol);
      const mv = isNum(p.mtm) ? p.mtm * fx : units * (isNum(p.price) ? p.price : model) * fx;
      const h = S * 0.01;
      const delta = (unit(S + h, vol) - unit(S - h, vol)) / (2 * h);
      const gamma = (unit(S + h, vol) - 2 * model + unit(S - h, vol)) / (h * h);
      const vega = (unit(S, vol + 0.01) - unit(S, Math.max(0.0001, vol - 0.01))) / 2;
      const deltaNotional = units * delta * S * fx;
      const cls = p.underlyingClass || 'equity';
      Object.assign(r, { mv, exposure: Math.abs(deltaNotional), net: deltaNotional, assetClass: DERIV_CLASS[cls] || 'mixed', vega: units * vega * fx, gamma: units * gamma * S * S * fx, liqDays: 5, beta: num(p.beta, 1) });
      r.deriv = derivInfo({ notional: units * S * fx, modelNotional: units * S * fx, delta, modelDelta: delta, deltaExp: deltaNotional, modelDeltaExp: deltaNotional });
      if (cls === 'equity') r.eqDelta = deltaNotional; else if (cls === 'commodity') r.cmDelta = deltaNotional; else if (cls === 'fx') { addFx(r, p.buyCcy, deltaNotional, ctx.base); }
      if (p.exoticKind === 'barrier' && isNum(p.barrier)) {
        const down = String(p.barrierType || '').startsWith('down');
        if ((down && S <= p.barrier) || (!down && S >= p.barrier)) r.warnings.push(String(p.barrierType).endsWith('out') ? 'knocked_out' : 'knocked_in');
      }
      addFx(r, p.ccy, mv, ctx.base);
      return r;
    },
    stressPnl(p, ctx, s) {
      const fx0 = ctx.fx(p.ccy);
      if (!isNum(fx0)) return 0;
      const S = num(p.underlyingPrice), vol = num(p.vol) / 100, units = num(p.qty) * num(p.multiplier, 1);
      const cls = p.underlyingClass || 'equity';
      const move = cls === 'equity' ? s.eq * num(p.beta, 1) : cls === 'commodity' ? s.cmd : 0;
      const pnl = units * (exoticPrice(p, ctx, S * (1 + (move || 0)), Math.max(0.01, vol + (s.vol || 0) / 100)) - exoticPrice(p, ctx, S, vol)) * fx0;
      return pnl * (1 + (p.ccy === ctx.base ? 0 : (s.fx?.[p.ccy] ?? s.fxAll ?? 0)));
    }
  },

  sec_lending: {
    en: 'Securities lending', group: 'cash', icon: 'SLB',
    hint: { en: 'A loan of securities the fund keeps owning (they stay in the holdings and in NAV). The loan itself adds counterparty risk: value lent minus collateral after haircut, which counts toward the counterparty limit. Cash collateral that is reinvested belongs in the holdings as the reinvested assets.' },
    fields: ['name', 'isin', 'issuer', 'qty', 'ccy', 'collateralValue', 'haircut', 'collateralType', 'rate', 'maturity', 'strategy', 'notes'],
    required: ['issuer', 'qty', 'ccy', 'collateralValue'],
    defaults: { collateralType: 'government', name: 'Securities loan' },
    labels: { issuer: { en: 'Borrower' }, qty: { en: 'Market value lent' }, isin: { en: 'ISIN lent' }, rate: { en: 'Lending fee %' }, maturity: { en: 'Term (empty = open, recallable)' } },
    risk(p, ctx) {
      const r = blank(ctx.base);
      const fx = fxOrWarn(p, ctx, r);
      const lent = Math.abs(num(p.qty)) * fx, coll = num(p.collateralValue) * fx * (1 - num(p.haircut, 0) / 100);
      Object.assign(r, { mv: 0, exposure: 0, net: 0, assetClass: 'cash', liqDays: p.maturity ? Math.max(1, Math.ceil(yearsBetween(ctx.valDate, p.maturity) * 365)) : 3 });
      r.cptyExposure = Math.max(0, lent - coll);
      r.lent = lent;
      if (coll < lent) r.warnings.push('under_collateralised');
      return r;
    }
  }
};

// The modelled OTC types still accept a file that only has the counterparty's MTM (plus, at best,
// a delta, duration or vega): such a row is valued like 'otc' and flagged, rather than rejected.
// Throwing away a valid position because the pricing inputs are missing would be the worse error.
const MTM_FALLBACK = {
  swaption: { model: ['strike', 'maturity', 'tenor', 'marketRate', 'vol'], cls: () => 'rates' },
  cap_floor: { model: ['strike', 'maturity', 'marketRate', 'vol'], cls: () => 'rates' },
  inflation_swap: { model: ['fixedRate', 'breakeven', 'maturity'], cls: () => 'inflation' },
  exotic_option: { model: ['optType', 'strike', 'maturity', 'underlyingPrice', 'vol'], cls: p => p.underlyingClass || 'equity' }
};
const hasVal = v => v !== undefined && v !== null && v !== '';
const modelInputsMissing = (type, p) => MTM_FALLBACK[type].model.some(f => !hasVal(p[f]));
for (const [type, fb] of Object.entries(MTM_FALLBACK)) {
  const def = INSTRUMENTS[type];
  const own = { risk: def.risk, stressPnl: def.stressPnl, validate: def.validate };
  def.required = def.required.filter(f => !fb.model.includes(f));
  for (const f of ['reportedDelta', 'duration', 'vega']) if (!def.fields.includes(f)) def.fields.splice(def.fields.indexOf('mtm') + 1, 0, f);
  def.validate = p => {
    const errs = own.validate ? own.validate(p) : [];
    if (!modelInputsMissing(type, p)) return errs;
    if (isNum(p.mtm)) return errs;
    return errs.concat(fb.model.filter(f => !hasVal(p[f])).map(f => ({ field: f, code: 'required' })));
  };
  def.risk = (p, ctx) => {
    if (!modelInputsMissing(type, p)) return own.risk(p, ctx);
    const cls = fb.cls(p);
    const r = INSTRUMENTS.otc.risk({ ...p, underlyingClass: cls === 'inflation' ? 'rates' : cls }, ctx);
    if (cls === 'inflation') {
      // Duration on an inflation swap is breakeven duration: move it from nominal rates to inflation.
      // The delta's sign, if given, is the direction; otherwise 'pay' means short inflation.
      const dir = !isNum(p.reportedDelta) && p.direction === 'pay' ? -1 : 1;
      for (const [c, v] of Object.entries(r.ir01)) addInf01(r, c, -v * dir);
      r.ir01 = {};
    }
    r.warnings.push('model_inputs_missing');
    return r;
  };
  def.stressPnl = own.stressPnl ? (p, ctx, sc) => (modelInputsMissing(type, p) ? null : own.stressPnl(p, ctx, sc)) : undefined;
  if (!def.stressPnl) delete def.stressPnl;
}

// ---- shared by the rate options -----------------------------------------------------------------
// Vols: normal quoted in bp (85 = 0.85 %), lognormal in % (25 = 0.25).
function rateOptionValue(p, ctx, kind, fwdShiftBp = 0) {
  const F = num(p.marketRate) / 100 + fwdShiftBp / 1e4, K = num(p.strike) / 100;
  const T = Math.max(0, yearsBetween(ctx.valDate, p.maturity));
  const volType = p.volType === 'lognormal' ? 'lognormal' : 'normal';
  const vol = volType === 'lognormal' ? num(p.vol) / 100 : num(p.vol) / 1e4;
  const df = ctx.df ? ctx.df(p.ccy) : null;
  if (kind === 'swaption') return swaption({ payer: p.payerReceiver !== 'receiver', F, K, T, tenor: num(p.tenor, 1), freq: freqOf(p.freq, 1), vol, volType, df });
  const start = p.startDate ? Math.max(0, yearsBetween(ctx.valDate, p.startDate)) : 0;
  return { ...capFloor({ cap: p.capFloor !== 'floor', F, K, start, tenor: Math.max(0, T - start), freq: freqOf(p.freq, 4), vol, volType, df }), T };
}
function rateOptionRisk(p, ctx, kind) {
  const r = blank(ctx.base);
  const fx = fxOrWarn(p, ctx, r);
  const N = num(p.qty) * fx;
  const o = rateOptionValue(p, ctx, kind);
  const mv = isNum(p.mtm) ? p.mtm * fx : N * o.pv;
  // Rate delta: value change for +1 bp in the forward, and the swap notional that is equivalent to.
  const dv01 = N * o.dPVdF * 1e-4;
  const annuity = kind === 'swaption' ? o.annuity : Math.max(1e-9, Math.max(0, yearsBetween(ctx.valDate, p.maturity)));
  const deltaNotional = N * o.dPVdF / annuity;
  Object.assign(r, { mv, exposure: Math.abs(deltaNotional), net: deltaNotional, assetClass: 'fixed_income', liqDays: 5 });
  r.deriv = derivInfo({ notional: N, modelNotional: N, delta: o.dPVdF / annuity, modelDelta: o.dPVdF / annuity, deltaExp: deltaNotional, modelDeltaExp: deltaNotional });
  addIr01(r, p.ccy, dv01);
  // Rate vega is reported, not put on the VOL factor: that factor is equity implied vol in points.
  r.model = { price: o.pv, vega: N * o.vega, volType: p.volType === 'lognormal' ? 'lognormal' : 'normal' };
  r.fi = { ytm: num(p.marketRate) / 100, modDur: 0, spreadDur: 0, convexity: 0, years: Math.max(0, yearsBetween(ctx.valDate, p.maturity)) + (kind === 'swaption' ? num(p.tenor) : 0), rating: '', derivative: true };
  addFx(r, p.ccy, mv, ctx.base);
  return r;
}
// Full revaluation under a rates shock: options are convex, so first-order DV01 is not enough.
function rateOptionStress(p, ctx, s, kind) {
  const fx0 = ctx.fx(p.ccy);
  if (!isNum(fx0)) return 0;
  const bp = s.ratesBy?.[p.ccy] ?? s.rates ?? 0;
  const pnl = num(p.qty) * (rateOptionValue(p, ctx, kind, bp).pv - rateOptionValue(p, ctx, kind, 0).pv) * fx0;
  return pnl * (1 + (p.ccy === ctx.base ? 0 : (s.fx?.[p.ccy] ?? s.fxAll ?? 0)));
}
function exoticPrice(p, ctx, S, vol) {
  const T = Math.max(0, yearsBetween(ctx.valDate, p.maturity));
  const rr = rfRate(p, ctx, T), q = num(p.divYield, 0) / 100;
  if (p.exoticKind === 'digital') return digitalOption(p.optType, S, num(p.strike), T, rr, q, vol, num(p.payout, 1));
  return barrierOption(p.optType, p.barrierType || 'down-and-out', S, num(p.strike), num(p.barrier), T, rr, q, vol);
}

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
  securities: { en: 'Securities' },
  funds: { en: 'Funds' },
  fixed_income: { en: 'Fixed income' },
  cash: { en: 'Cash' },
  derivatives: { en: 'Derivatives' }
};

// ---- helpers used by the UI and importer ------------------------------------------------------
export function fieldLabel(type, key) {
  return INSTRUMENTS[type]?.labels?.[key]?.en || FIELDS[key]?.en || key;
}
export function typeLabel(type) {
  const d = INSTRUMENTS[type];
  if (!d && type === 'unknown') return 'Unknown type';
  return d ? d.en : type;
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
export const TYPE_ALIASES = {
  equity: ['equity', 'stock', 'share', 'shares', 'commonstock', 'aktie', 'aktier', 'eq', 'ordinaryshare', 'preferred', 'preferenceshare', 'preferensaktie', 'adr', 'gdr', 'depositaryreceipt', 'sdb', 'svenskadepåbevis', 'rights', 'subscriptionrights', 'subscriptionright', 'teckningsrätt', 'teckningsrätter', 'tr', 'bta', 'betaldtecknadaktie', 'interimshare', 'interimaktie', 'reit', 'spac'],
  etf: ['etf', 'exchangetradedfund', 'börshandladfond', 'etp', 'etn', 'exchangetradednote', 'exchangetradedproduct', 'ucitsetf', 'leveragedetf', 'inverseetf', 'hävstångsetf', 'ETF (börshandlad fond)'],
  fund: ['fund', 'mutualfund', 'ucits', 'aif', 'fond', 'fonder', 'sicav', 'unittrust', 'investmentfund', 'oeic', 'fcp', 'moneymarketfund', 'mmf', 'likviditetsfond', 'penningmarknadsfond', 'kortränefond', 'bondfund', 'räntefond', 'obligationsfond', 'equityfund', 'aktiefond', 'mixedfund', 'blandfond', 'balancedfund', 'Fond (UCITS/AIF)'],
  govt_bond: ['govtbond', 'governmentbond', 'government', 'sovereign', 'treasury', 'gilt', 'bund', 'oat', 'btp', 'bono', 'dsl', 'statsobligation', 'stat', 'sgb', 'supranational', 'supra', 'agency', 'ssa', 'municipal', 'kommunobligation', 'kommuninvest'],
  corp_bond: ['corpbond', 'corporatebond', 'corporate', 'bond', 'obligation', 'företagsobligation', 'credit', 'hybrid', 'hybridbond', 'highyield', 'hy', 'ig', 'fixedbond', 'covered', 'coveredbond', 'pfandbrief', 'säkerställdobligation', 'bostadsobligation', 'perpetual', 'perp', 'at1', 'additionaltier1', 'coco', 'contingentconvertible', 'tier1', 'tier2', 't2', 'subordinated', 'callable', 'callablebond', 'seniornonpreferred', 'snp', 'greenbond', 'grönobligation', 'abs', 'mbs', 'rmbs', 'cmbs', 'clo', 'securitisation', 'securitization', 'assetbacked'],
  frn: ['frn', 'floater', 'floatingratenote', 'floatingrate', 'frnobligation', 'rörlig', 'rörligränta', 'frncovered', 'FRN (rörlig kupong)'],
  money_market: ['moneymarket', 'tbill', 'bill', 'treasurybill', 'cp', 'commercialpaper', 'ecp', 'cd', 'certificateofdeposit', 'statsskuldväxel', 'ssvx', 'företagscertifikat', 'bankcertifikat', 'penningmarknad', 'btf', 'bot', 'letras', 'Penningmarknad / statsskuldväxel'],
  cash: ['cash', 'deposit', 'currentaccount', 'kassa', 'likvida', 'likvidamedel', 'bankkonto', 'inlåning', 'konto', 'termdeposit', 'timedeposit', 'fixeddeposit', 'fastränteplacering', 'placeringskonto', 'bundeninlåning', 'callaccount', 'collateral', 'margin', 'initialmargin', 'säkerhet', 'Kassa / inlåning'],
  future: ['future', 'futures', 'fut', 'termin', 'terminer', 'indexfuture', 'indexterminer', 'bondfuture', 'obligationstermin', 'stir', 'stirfuture', 'euriborfuture', 'sofrfuture', 'soniafuture', 'estrfuture', 'interestratefuture', 'räntetermin', 'commodityfuture', 'råvarutermin', 'dividendfuture', 'utdelningstermin', 'fxfuture', 'valutafuture', 'vixfuture', 'vstoxxfuture', 'volatilityfuture', 'singlestockfuture', 'aktietermin', 'Termin (future)'],
  option: ['option', 'options', 'opt', 'call', 'put', 'warrant', 'warrants', 'optioner', 'indexoption', 'stockoption', 'equityoption', 'aktieoption', 'fxoption', 'currencyoption', 'valutaoption', 'bondoption', 'optiononfuture', 'futuresoption', 'commodityoption', 'otcoption', 'vixoption'],
  fx_forward: ['fxforward', 'forward', 'fxfwd', 'fwd', 'fxswap', 'currencyforward', 'valutatermin', 'valutaswap', 'ndf', 'nondeliverableforward', 'fxspot', 'spot', 'Valutatermin / swap'],
  irs: ['irs', 'swap', 'interestrateswap', 'ränteswap', 'ois', 'overnightindexswap', 'fra', 'forwardrateagreement'],
  cds: ['cds', 'creditdefaultswap', 'kreditswap', 'cdx', 'itraxx', 'cdsindex', 'indexcds', 'Kreditswap (CDS)'],
  commodity: ['commodity', 'etc', 'gold', 'physical', 'physicalgold', 'råvara', 'råvaror', 'guld', 'silver', 'preciousmetal', 'Råvara / ETC'],
  alternative: ['alternative', 'alternatives', 'private', 'privateequity', 'pe', 'realestate', 'hedgefund', 'crypto', 'cryptocurrency', 'kryptovaluta', 'bitcoin', 'ethereum', 'onoterat', 'fastighet', 'fastighetsfond', 'alternativ', 'infrastructure', 'privatecredit', 'directlending', 'direktlån', 'unlisted', 'venturecapital', 'fundoffunds', 'Alternativ / onoterat'],
  inflation_linked: ['inflationlinked', 'inflationlinkedbond', 'linker', 'ilb', 'indexlinked', 'indexlinkedgilt', 'ilg', 'realränteobligation', 'realobligation', 'realränta', 'tips', 'oati', 'oat€i', 'oatei', 'btpei', 'btp€i', 'btpitalia', 'bundei', 'bund€i', 'dbrei'],
  convertible: ['convertible', 'convertiblebond', 'cb', 'konvertibel', 'konvertibelobligation', 'konvertibler', 'exchangeable', 'exchangeablebond', 'mandatoryconvertible'],
  certificate: ['certificate', 'certifikat', 'bullcertificate', 'bearcertificate', 'bull', 'bear', 'bullbear', 'minifuture', 'minilong', 'minishort', 'turbo', 'turbowarrant', 'knockout', 'knockoutwarrant', 'trackercertificate', 'tracker', 'bonuscertificate', 'discountcertificate', 'structuredproduct', 'strukturerad', 'struktureradprodukt', 'autocall', 'autocallable', 'capitalprotected', 'kapitalskyddad', 'indexobligation', 'aktieobligation', 'marknadsobligation', 'creditlinkednote', 'cln', 'express', 'reverseconvertible', 'Certifikat / strukturerad produkt'],
  equity_swap: ['equityswap', 'aktieswap', 'cfd', 'contractfordifference', 'contractsfordifference', 'trs', 'totalreturnswap', 'portfolioswap', 'swapequity', 'dividendswap', 'basketswap', 'indexswap', 'Aktieswap / CFD / TRS'],
  ccs: ['ccs', 'crosscurrencyswap', 'ccirs', 'crosscurrencyinterestrateswap', 'currencyswap', 'basisswap', 'xccy', 'valutaränteswap', 'Valutaränteswap (CCS)'],
  repo: ['repo', 'reverserepo', 'repurchaseagreement', 'reverserepurchaseagreement', 'repa', 'omvändrepa', 'tripartyrepo', 'buysellback', 'sellbuyback', 'Repa / omvänd repa'],
  otc: ['otc', 'otcderivative', 'correlationswap', 'varianceswap', 'volatilityswap', 'varswap', 'volswap', 'variansswap', 'volatilitetsswap', 'commodityswap', 'råvaruswap', 'asianoption', 'asian', 'cliquet', 'lookback', 'basketoption', 'rainbow', 'quanto', 'exotic', 'exoticoption', 'structuredswap', 'Övrigt OTC-derivat (marknadsvärde)'],
  swaption: ['swaption', 'swaptions', 'payerswaption', 'receiverswaption', 'bermudanswaption'],
  cap_floor: ['cap', 'floor', 'collar', 'capfloor', 'interestratecap', 'interestratefloor', 'räntetak', 'räntegolv', 'Räntetak / räntegolv'],
  inflation_swap: ['inflationswap', 'zerocouponinflationswap', 'zciis', 'zcis', 'yoyinflationswap', 'inflationsswap', 'hicpswap', 'cpiswap', 'kpiswap'],
  exotic_option: ['barrier', 'barrieroption', 'knockinoption', 'knockoutoption', 'digital', 'digitaloption', 'binary', 'binaryoption', 'barriäroption', 'digitaloptioner', 'Barriär- / digitaloption'],
  sec_lending: ['securitieslending', 'seclending', 'securitiesloan', 'stocklending', 'värdepapperslån', 'aktielån', 'lending', 'slb']
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
  commodityswap: { underlyingClass: 'commodity' }, råvaruswap: { underlyingClass: 'commodity' },
  payerswaption: { payerReceiver: 'payer' }, receiverswaption: { payerReceiver: 'receiver' }, floor: { capFloor: 'floor' }, cap: { capFloor: 'cap' },
  varianceswap: { underlyingClass: 'volatility' }, volatilityswap: { underlyingClass: 'volatility' }, varswap: { underlyingClass: 'volatility' }, volswap: { underlyingClass: 'volatility' }, variansswap: { underlyingClass: 'volatility' }, volatilitetsswap: { underlyingClass: 'volatility' },
  digital: { exoticKind: 'digital' }, digitaloption: { exoticKind: 'digital' }, binary: { exoticKind: 'digital' }, binaryoption: { exoticKind: 'digital' },
  minifuture: { certType: 'knock_out' }, minilong: { certType: 'knock_out', optType: 'call' }, minishort: { certType: 'knock_out', optType: 'put' }, turbo: { certType: 'knock_out' }, turbowarrant: { certType: 'knock_out' }, knockout: { certType: 'knock_out' }, knockoutwarrant: { certType: 'knock_out' },
  capitalprotected: { certType: 'protected' }, kapitalskyddad: { certType: 'protected' }, indexobligation: { certType: 'protected' }, trackercertificate: { certType: 'tracker', leverage: 1 }, tracker: { certType: 'tracker', leverage: 1 }
};
export const typePreset = raw => TYPE_PRESETS[normKey(raw)] || null;
const TYPE_LOOKUP = (() => {
  const m = new Map();
  for (const [id, list] of Object.entries(TYPE_ALIASES)) {
    m.set(normKey(id), id);
    list.forEach(a => m.set(normKey(a), id));
    const d = INSTRUMENTS[id];
    if (d) m.set(normKey(d.en), id);
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
