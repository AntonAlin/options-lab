# Hosting on Cloudflare Pages behind Cloudflare Access

The site is published by `.github/workflows/pages.yml` to **Cloudflare Pages** and protected by **Cloudflare Access**: nobody sees the page, its code or `data/market.json` without logging in first. Access is free for up to 50 users.

The workflow refuses to deploy unless an anonymous request to the site is redirected to the Access login, and checks it again after the deploy. So set up Access **first** (step 2), then the deploy (step 3).

Nothing in the app changes: everything it loads from the site is on the same domain and carries the Access cookie. The login controls who can open the hosted copy. Portfolio data never reaches Cloudflare either way; it stays in the browser and in the user's own data sources.

## 1. Cloudflare account and Zero Trust

1. Create a free account at <https://dash.cloudflare.com>.
2. Open **Zero Trust** in the dashboard and pick a team name (it becomes `<team>.cloudflareaccess.com`). Choose the **Free** plan; it asks for a card but does not charge for up to 50 users.
3. Note the **Account ID** (dashboard home → the account's menu → *Copy account ID*, or the right-hand column of any zone's overview).

## 2. The Access application (the login)

Zero Trust → **Access → Applications → Add an application → Self-hosted**:

- **Application name:** Nexus Portfolio Lab.
- **Session duration:** e.g. 24 hours.
- **Public hostnames** (add each):
  - `options-lab.pages.dev` (your project name if you change it, see step 3)
  - `*.options-lab.pages.dev` (preview and per-commit deployment URLs)
  - your custom domain, if you use one (step 4)
- **Policy:** *Add a policy* → name *Allowed people*, action **Allow**, include **Emails** with the addresses that may log in (or **Emails ending in** `@yourdomain` for a whole domain).
- **Login methods:** *One-time PIN* works out of the box: the user types their e-mail and gets a code. To log in with GitHub or Google instead, add it under Zero Trust → **Settings → Authentication → Login methods** first, then tick it here.

Save. Opening `https://options-lab.pages.dev` in a private window should now show the Cloudflare Access login, even before anything is deployed.

## 3. Deploy from GitHub

1. **API token:** dashboard → *My Profile → API Tokens → Create Token → Create Custom Token*. Permission **Account → Cloudflare Pages → Edit**, limited to your account. No other permissions.
2. In GitHub: **Settings → Secrets and variables → Actions**:
   - Secrets: `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID`.
   - Variables (optional): `CLOUDFLARE_PAGES_PROJECT` if the project should not be called `options-lab` (lower-case letters, digits and dashes; the name must be free on pages.dev, so use the same name in the Access hostnames), and `SITE_URL` for a custom domain, e.g. `https://nexus.example.com`.
3. **Settings → Environments → cloudflare-pages** (created by the first run, or create it now): *Deployment branches and tags* → *Selected branches* → `main`. The secrets can also be put on this environment instead of the repository, so only a deploy from `main` can read them.
4. Run **Actions → Deploy to Cloudflare Pages → Run workflow**. The first run creates the Pages project. After that it deploys on every push to `main` and every business day with fresh ECB data, as before.

If the run stops at *Require the Cloudflare Access login before deploying*, the hostname it names is not covered by the Access application: add it in step 2.

## 4. Custom domain (optional)

A custom domain needs its DNS zone on Cloudflare (free plan is enough).

1. Add the hostname to the Access application first (step 2).
2. Pages → the project → **Custom domains → Set up a custom domain**, e.g. `nexus.example.com`. Cloudflare creates the DNS record.
3. Set the repository variable `SITE_URL` to `https://nexus.example.com`, so the workflow checks that hostname as well.

Keep `options-lab.pages.dev` in the Access application: it stays reachable next to the custom domain.

## 5. Switch off GitHub Pages

The workflow no longer deploys to GitHub Pages, but the last GitHub Pages deployment stays online until it is removed: **Settings → Pages → Unpublish site** (or set *Source* to *None*), and remove the custom domain there if it pointed to GitHub. The `github-pages` environment under **Settings → Environments** can be deleted.

## Check it worked

- A private browser window on each hostname shows the Access login; after logging in with an allowed address the app opens.
- An address that is not in the policy gets *That account does not have access*.
- The Actions run is green, including both Access checks.
- Zero Trust → **Logs → Access** lists the logins.

## Good to know

- The source code stays public in this repository; the login protects the hosted copy, not the code.
- Access only lets the people in the policy through; removing someone there locks them out at the next session expiry (or immediately, with *Revoke existing tokens* on the application).
- If the market data download fails, the workflow publishes the last good file from the `market-data` branch, as the site can no longer be read anonymously.
