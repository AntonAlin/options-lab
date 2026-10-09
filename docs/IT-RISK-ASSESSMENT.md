# Nexus Portfolio Lab: information for IT, risk and compliance

This page answers the questions an IT, risk or compliance function asks before a fund company or other regulated firm uses a tool like this one, including its ICT risk management under DORA (Regulation (EU) 2022/2554). It describes the facts about the software. How your firm classifies and controls it is your firm's decision. What follows about regulation is the developer's reading as of September 2026. It is not legal advice.

## In short

| Question | Answer |
|---|---|
| What is it? | A folder of static files (HTML, JavaScript, CSS). Everything is calculated in the user's browser. There is no back end, no database server and no user accounts. |
| Is it bought? Is there a contract? | No. It is free to use and it is not sold. There is no contract, no SLA and no supplier relationship, only the [licence](../LICENSE). |
| Where does portfolio data go? | Nowhere. It stays in the browser on the user's computer and in files the user chooses to save. No request carries portfolio data. |
| Can it run without internet access? | Yes. Every [release](https://github.com/AntonAlin/options-lab/releases) has an offline zip with all libraries bundled and no web fonts. Hosted internally, it makes no outbound request at all. |
| Can we check what it does? | Yes. The complete source is public. *How we calculate* in the app links each formula to its module. |
| Can we verify the files we host? | Yes. Releases carry a signed build provenance attestation, a CycloneDX SBOM with its own signed attestation, and SHA-256 checksums. |
| How do we know an upgrade did not change our numbers? | Each release has `VALIDATION.md`: 92 risk, compliance and pricing figures on a reference fund, compared with frozen values, plus closed-form pricing checks. Release notes list calculation changes separately. |
| Who supports it? | Nobody under contract. There is one maintainer, and bugs and security problems are reported on GitHub. Plan on that basis (see *Support and change* below). |

## How it is classified (a reading, not advice)

For a firm that hosts a tagged offline release on its own infrastructure, the tool is best treated as an **ICT asset the firm runs itself**, within its own ICT risk management framework (DORA art. 6–11: identify the asset, protect it, back it up and plan for its failure). The developer provides no ongoing ICT service to the firm: no hosting, no data processing, no support. Whether your firm also records it in the register of information on ICT third-party arrangements (art. 28) is for your compliance function to decide. Many firms record free software they depend on there anyway.

Using the public site at `antonalin.github.io/options-lab` is different. The code is then served by GitHub Pages and changes with every change to the repository. For regulated use, host a tagged release instead.

**Criticality.** The tool calculates model estimates with documented simplifications. It should not be the sole system of record for a critical or important function. Typical use is as a check and analysis layer next to the depositary's, administrator's or risk system's figures: pre-trade checks, a second opinion on limits, stress tests and reporting drafts. Reconcile its output against your own systems before relying on it.

## Data flows

| Flow | What | Contains portfolio data? | Removed by the offline release? |
|---|---|---|---|
| Page and code | `index.html`, `js/`, `css/` from wherever it is hosted | No | Served from your own server |
| Plotly (charts) | `cdn.jsdelivr.net`, pinned version, SRI hash | No | Yes, bundled in `vendor/` |
| jsPDF, jspdf-autotable (PDF, on demand) | `cdn.jsdelivr.net`, pinned, SRI | No | Yes, bundled |
| SheetJS (Excel, on demand) | `cdn.sheetjs.com`, pinned 0.20.3, SRI | No | Yes, bundled |
| Inter font | `fonts.googleapis.com`, `fonts.gstatic.com` | No | Yes, dropped (system font used) |
| Market data | `data/market.json` from the site's own address: public ECB, Riksbank, US Treasury/New York Fed and Norges Bank rates. Optionally the organisation's own file instead (Settings → *Market data file*, an https address the organisation chooses; a plain GET without cookies) | No | Included as a snapshot at release time. Rates can also be imported by hand |
| Import model | `js/models/import-model.json` from the site's own address | No | Included |

Nothing is ever uploaded. Files the user opens (holdings, prices, transactions) are read by the browser locally.

## Where data is stored

- **The browser's IndexedDB** on the user's computer, one record per portfolio. It falls back to localStorage only where IndexedDB is unavailable. The app asks the browser to keep this storage persistent. Protection at rest and access control are those of the computer and the user's operating-system profile. Clearing browser data deletes it.
- **A linked file** (Chrome/Edge desktop), which is the recommended setup: a JSON file on a network share or synced folder that the firm already backs up and access-controls. Changes are written about a second after they are made. If the file was changed elsewhere, the user is offered to load it instead of overwriting it.
- **Backup files** (JSON), downloaded by hand or on a daily, weekly or monthly schedule.
- **Exports and PDF reports** are ordinary files and should be handled like other fund documents.

## Integrity and supply chain

- Third-party libraries are pinned to exact versions and loaded with Subresource Integrity (SHA-384) hashes. The browser refuses a file that does not match.
- CI runs the release build on every change. It downloads every library from its CDN, fails if a hash does not match, and fails if a CDN stops sending the CORS header that the integrity check needs.
- Unit tests and a browser smoke test run on every change, and the smoke test opens every page. CodeQL scans the JavaScript on every change to `main` and weekly.
- Releases are built by GitHub Actions from the tagged source and carry a signed build provenance attestation:
  `gh attestation verify nexus-portfolio-lab-vX.Y.Z-offline.zip --repo AntonAlin/options-lab`
- Each release has a CycloneDX SBOM (`nexus-portfolio-lab-vX.Y.Z.cdx.json`) listing every third-party component with version, licence and hash, for your register of ICT third-party components. It is attested to both zips (`--predicate-type https://cyclonedx.org/bom`).
- The build pipeline itself is pinned: every GitHub Action is referenced by full commit SHA, not by a tag that could be moved, and Dependabot proposes updates. CodeQL also scans the workflows. OpenSSF Scorecard publishes an independent rating of these practices.
- There are no runtime dependencies from a package manager: no `node_modules`, no build step, nothing fetched at install.

## Access, accountability and the control log

There are no user accounts. Anyone who can open the page in a browser profile can see and change that profile's workspace. Access control therefore comes from the computer, the operating-system profile, and the permissions on the linked file.

The **Control log** page records who signed off the daily limit check, every breach case (cause, notes, actions, resolution) and every change to a limit or fund rule. Each entry is chained to the one before by a SHA-256 hash, so an entry changed or removed later shows as a broken chain. Because the name is typed in by the user, the log is a tamper-evident record, not an access control. Keep the head hash outside the tool, for example in an e-mail to compliance or in the monthly PDF report. The chain then proves that nothing before it was changed.

## Support and change

- **Support:** none under contract, and one maintainer. Bugs are reported through GitHub issues, security problems privately through GitHub security advisories (see [SECURITY.md](../SECURITY.md)).
- **Fixes:** the licence does not allow modifications, so fixes come from new releases only. If your firm needs to be able to patch the code itself, this tool does not meet that need.
- **Change control:** host a specific tagged release. Upgrade deliberately: read the release notes, verify the attestation, run your own acceptance checks on a copy of your data, then replace the files. Nothing changes on your server unless you change it.
- **Calculation changes are visible:** a change that moves any of the 92 golden figures fails CI until it is accepted on purpose. The pull request must say which figures moved and why, and is labelled `methodology-change`. Release notes list such changes first, and `VALIDATION.md` in each release shows the figures. Compare it between two versions to see what an upgrade changes.
- **Regulatory reading:** a quarterly GitHub issue lists the sources (UCITS Directive, Directive (EU) 2024/927, ESMA guidelines and Q&A, CESR/10-788, Finansinspektionen) to re-check. Closed issues are the record that the check happened.

## Continuity and exit

- There is no supplier that can fail, withdraw the service or change its terms for a copy you already host. An offline release keeps working as long as a current browser can run it.
- All data can be exported in open formats: the whole workspace as JSON, positions as CSV/Excel, the control log as CSV/JSON, reports as PDF. Leaving the tool means exporting and stopping. There is no lock-in and no data held elsewhere.
- The market data depends on a scheduled GitHub Action in this repository (or, with a market data file of the organisation's own, on the organisation's server). Providers other than the ECB are optional: one that fails is left out of the file and positions in that currency fall back to their own rate. A failed download opens a public GitHub issue, and the workflow keeps itself enabled. If it stops anyway, FX rates can be imported from the ECB file by hand (Settings), and positions can carry their own rates.
- Every published market data file is archived on the repository's `market-data` branch, one file per ECB business day, so the rates used on a past date can be reproduced.

## Suggested controls for a firm using it

1. Host a tagged offline release on an internal web server and record the version in the ICT asset inventory.
2. Verify the release's attestation and checksum before you deploy it. Read `VALIDATION.md` and the *Calculation changes* section of the release notes, and file the SBOM with your ICT asset record.
3. Give each user their own browser profile, and link the workspace to a file on a backed-up, access-controlled share.
4. Validate the calculations that matter to you (limits, VaR, stress) against your own systems before relying on them. Document the simplifications listed on *How we calculate* that affect your funds.
5. Use the control log for sign-offs and breach cases, and send its head hash to compliance regularly.
6. Review the use once a year and when upgrading: is it still a check tool rather than the system of record, and do the releases still meet your needs?

## Known limitations

- No authentication, no roles and no four-eyes enforcement in the software itself.
- One user per workspace at a time. Several people working on the same linked file can overwrite each other's changes; the app warns when the file changed elsewhere.
- Model estimates with documented simplifications (see *How we calculate*). Regulatory checks are one reading of the rules as of September 2026 and may be incomplete or wrong.
- Browser support: current Chrome, Edge, Firefox and Safari. The linked file needs Chrome or Edge on desktop.
