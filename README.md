# Market data archive

One file per ECB business day: `YYYY/YYYY-MM-DD.json`, the exact `data/market.json` the site served after that day's
download (ECB reference rates, euro curve, €STR and, when available, the Riksbank curve). Written by
`.github/workflows/pages.yml`; the file name is the newest ECB date in the file. Never edited by hand.
