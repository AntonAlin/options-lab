# GitHub settings that cannot live in code

The workflows, labels, Dependabot, release notes, PR template and rulesets are files in this repository. A few settings exist only on github.com. Set them once, as a repository admin, and check them again when anything about the repository changes.

## 1. Rulesets: Settings → Rules → Rulesets → New ruleset → Import a ruleset

Import each file in [`.github/rulesets/`](../.github/rulesets):

| File | What it does |
|---|---|
| `history.json` | `main` and `market-data` can never be force-pushed or deleted, not even by an admin. The commit history and the market data archive stay an audit trail. |
| `release-tags.json` | A `v*` tag can never be moved or deleted. Build provenance ties a release to a tag, so the tag must mean the same thing forever. |
| `release-tags-create.json` | Only admins can create `v*` tags, and so publish releases. |
| `main.json` | Changes reach `main` through a pull request with green CI (unit tests and golden figures, smoke test, Lighthouse, release dry run, CodeQL) and no new high-severity CodeQL alert. |

Be honest about `main.json`: with a single maintainer, it lets repository admins bypass the rules, otherwise nobody could merge. It enforces the checks on everyone else, and it starts to matter fully once a second person can approve. Then remove the bypass and set `required_approving_review_count` to 1.

The status check names in `main.json` must match the job names in `ci.yml` and `codeql.yml`. Update both together.

## 2. Settings → Advanced Security (Code security)

- **Dependabot alerts** and **Dependabot security updates**: on.
- **Secret scanning** and **Push protection**: on. A pushed credential is blocked before it lands.
- **Private vulnerability reporting**: on (SECURITY.md relies on it).
- **CodeQL**: leave the advanced setup (`codeql.yml`) in charge, so do not turn on the default setup as well.

## 3. Settings → General → Releases

- **Immutable releases**: on, if your plan offers it. Assets and the tag of a published release can then not be changed. This complements `release-tags.json`.

## 4. Settings → Actions → General

- **Workflow permissions**: *Read repository contents permission*. Each workflow asks for exactly what it needs.
- **Allow GitHub Actions to create and approve pull requests**: off.
- **Require actions to be pinned to a full-length commit SHA**: on, if offered. Every workflow already complies, so this keeps it that way.

## 5. Settings → Environments → github-pages

- **Deployment branches and tags**: *Selected branches*, `main` only.

## 6. Labels

Run the **Labels** workflow once (Actions → Labels → Run workflow). It also runs whenever `.github/labels.json` changes on `main`. The labeler, Dependabot, the market data alert and the release notes need these labels.

## 7. Check it worked

- Actions: CI, CodeQL, Scorecard and Deploy GitHub Pages are green on `main`.
- After the first scheduled deploy, the `market-data` branch has a file for the newest ECB date.
- The Scorecard badge in the README shows a score (the first run can take a day to appear).
- Open a test pull request that changes `js/pricing.js`: it gets the `methodology-change` label, and CI fails if a golden figure moved.
