# Market data sources

`data/market.json` is built by `scripts/market-data.mjs`: the ECB data (FX, the EUR curve, €STR) plus one discount curve per currency from the providers listed in [`market-sources.json`](../market-sources.json). The browser only ever downloads that one file. Providers are only contacted by the job that builds it.

| Provider | Currency | Curve | Overnight | Key needed |
|---|---|---|---|---|
| ECB (always on) | EUR | Euro area AAA government spot curve | €STR | No |
| `riksbank` | SEK | Treasury bills and benchmark government bonds | SWESTR | No |
| `ustreasury` | USD | US Treasury daily par yield curve | SOFR (New York Fed) | No |
| `norgesbank` | NOK | Generic treasury bill and government bond yields | – | No |
| custom | any but EUR | your own CSV or JSON endpoint | optional | as you set it |

A provider that fails, or whose curve does not pass the checks (≥ 4 tenors with one at ≤ 6M and one at ≥ 10Y, rates between −3 % and 15 %, newest date ≤ 7 days old), is left out of that day's file with a warning. Portfolios then drop that curve and use their positions' own rates. Only the ECB data can stop a publish.

> **Status of the new providers.** `ustreasury` and `norgesbank` are tested against recorded file formats, not yet against the live endpoints. The first scheduled run (or `node scripts/market-data.mjs --check`) shows whether they come through. If one is left out, the log says why. They are not `strict` until they have been seen working.

## Configuration

```json
{
  "providers": ["riksbank", "ustreasury", "norgesbank"],
  "strict": ["riksbank"],
  "custom": []
}
```

- `providers`: the built-in providers to use, in order. One currency gets one provider: the first one listed wins.
- `strict`: providers whose failure makes `--strict` exit non-zero (CI's market data job). Use the bare id for custom providers.
- `custom`: your own providers, see below.

Run locally:

```sh
node scripts/market-data.mjs --check                        # everything in market-sources.json
node scripts/market-data.mjs --check --sources=ustreasury   # one provider (the ECB is always fetched)
node scripts/market-data.mjs out.json --config=my-sources.json
```

## A custom provider

A custom provider describes an HTTPS endpoint. The same generic reader handles CSV (any delimiter, decimal comma or point) and JSON:

```json
{
  "id": "internal-dkk",
  "ccy": "DKK",
  "name": "Internal rates service",
  "attribution": "Danish rates: internal rates service.",
  "curve": {
    "url": "https://rates.intra.example/curves/dkk.csv?from={from}&to={to}",
    "headers": { "Authorization": "Bearer ${RATES_TOKEN}" },
    "format": "csv",
    "layout": "wide",
    "dateField": "Date",
    "compounding": "annual"
  },
  "overnight": {
    "url": "https://rates.intra.example/overnight/destr.json",
    "format": "json", "path": "data", "dateField": "date", "valueField": "rate"
  }
}
```

It is published as `custom:internal-dkk`.

### Download options

| Key | Meaning |
|---|---|
| `url` | One download. |
| `urls` | Several downloads read as one (e.g. last year's and this year's file). The provider still works when some of them fail. |
| `series` | One download per tenor: `{ "3M": url, "10Y": url }`. For APIs that serve one series per call (FRED and similar). |
| `headers` | Request headers. |
| `pauseMs` | Pause between downloads, for rate-limited APIs. |

Placeholders in URLs and headers: `{from}` (100 days back), `{to}` / `{today}`, `{year}`, `{prevYear}` and `${ENV_VAR}`. The log and the published file show the template, never the expanded value, so a key in `${…}` stays out of both.

### Reading options

| Key | Meaning | Default |
|---|---|---|
| `format` | `csv`, `json` or `auto` | `auto` |
| `path` | JSON: dot path to the array of records (`observations`, `data.items`) | first array found |
| `layout` | `wide`: a date column and one column per tenor. `long`: one row per date and tenor | `long` if a tenor column exists |
| `dateField` | Date column | `date`, `TIME_PERIOD`, `effectiveDate`, `Datum` … |
| `dateFormat` | `ymd`, `mdy`, `dmy` or `auto` (slash dates decided from the whole column; dots are day first) | `auto` |
| `tenorField` / `valueField` | Long layout: the tenor and value columns | `TENOR` / `OBS_VALUE`, `value`, `rate` … |
| `columns` | Wide layout: header → tenor, when the headers are not tenors themselves (`{ "DK10Y": "10Y" }`) | headers like `3M`, `6 Mo`, `10 Yr` |
| `filter` | Keep only matching records: `{ "INSTRUMENT_TYPE": ["GBON", "TBIL"] }` | – |
| `unit` | `percent` or `decimal` (0.025 for 2.5 %) | `percent` |
| `compounding` | How the source quotes: `continuous`, `annual`, `semiannual`, `quarterly`, `simple`. Every curve in the file is continuous. | `continuous` |

Tenors are written like `ON`, `2W`, `3M`, `6 Mo`, `1.5 Month`, `1Y`, `10 Yr` or `5 years`. The curve uses the tenors quoted on the newest date. A day counts when it has a value for every one of them, and the last 60 complete days are kept.

### Example: FRED with an API key

```json
{
  "id": "fred-cad", "ccy": "CAD", "attribution": "Canadian rates: FRED, Federal Reserve Bank of St. Louis.",
  "curve": {
    "series": {
      "3M":  "https://api.stlouisfed.org/fred/series/observations?series_id=<3M series>&observation_start={from}&api_key=${FRED_API_KEY}&file_type=json",
      "10Y": "https://api.stlouisfed.org/fred/series/observations?series_id=<10Y series>&observation_start={from}&api_key=${FRED_API_KEY}&file_type=json"
    },
    "format": "json", "path": "observations", "compounding": "semiannual", "pauseMs": 500
  }
}
```

Fill in the series ids for the tenors you need (at least four, from ≤ 6M to ≥ 10Y). Then add the key as a repository secret and map it in `.github/workflows/pages.yml`, step *Fetch market data*:

```yaml
        env:
          FRED_API_KEY: ${{ secrets.FRED_API_KEY }}
```

Without the key, the provider is left out with "needs FRED_API_KEY in the environment".

**Check the licence.** Data published with the site is public. Many vendors (Bloomberg, Refinitiv/LSEG, ICE) do not allow redistributing their data on a public website. For vendor data, use your own server (below).

## Your own server as the backend

The script runs anywhere with Node 20+. An organisation can run it on its own server on a schedule, with its own `market-sources.json` (internal rates service, a licensed vendor feed), and serve the result over HTTPS:

```sh
RATES_TOKEN=… node scripts/market-data.mjs /var/www/rates/market.json --config=/etc/nexus/market-sources.json
```

In the app, **Settings → FX rates → Market data file** takes that file's address. The server must send `Access-Control-Allow-Origin` for the site's address (CORS). The request is a plain GET without cookies and carries no portfolio data. The setting is stored in the browser, like every other setting. Clear it to go back to the site's file.

Allowed addresses: `https://…`, a path on the site itself, or `http://localhost` / `http://127.0.0.1` for testing.

## Adding a built-in provider

Built-ins live in `js/marketsources.js` → `BUILTIN`. Most are a single `httpProvider({...})` with the options above. One that needs its own logic (the Riksbank's rate limit) implements `fetch(ctx)` and `build(raw)`, where `build` returns `{ id, ccy, curve, overnight?, attribution, source }`. Add its id to `PUBLISHED_SOURCES` in `js/marketdata.js`, add a fixture and a test in `tests/marketsources.test.mjs`, and list it in `market-sources.json`.
