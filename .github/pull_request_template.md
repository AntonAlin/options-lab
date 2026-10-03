## What and why

<!-- One or two sentences. Link the issue if there is one. -->

## Does this change a number?

- [ ] **No.** `npm test` passes and `tests/fixtures/golden-expected.json` is unchanged.
- [ ] **Yes, on purpose.** I ran `node scripts/golden.mjs --update` and list every figure that moved, by how much and why:

| Figure | Before | After | Why |
|---|---:|---:|---|
|  |  |  |  |

If yes:
- [ ] *How we calculate* (`js/methodology.js`) describes the new calculation
- [ ] The User guide (`js/guide.js`) is still right
- [ ] Regulatory basis, if any (article, guideline, Q&A), and the label `regulatory`:

## Checks

- [ ] No real portfolio, client or counterparty data in code, fixtures, screenshots or this description
- [ ] New third-party code is pinned (SRI hash for a CDN library, commit SHA for an action)
