# Security

Nexus Portfolio Lab runs entirely in the browser: it has no server, no accounts and sends no portfolio data anywhere. The security questions that matter are therefore about the code itself — for example a way to make the page send data out, run someone else's script, or read files it should not.

## Reporting a problem

Report it privately through **[Security → Report a vulnerability](https://github.com/AntonAlin/options-lab/security/advisories/new)** on GitHub, not as a public issue. Describe what you found and how to reproduce it; never include real portfolio or client data.

## What is checked automatically

- Every change runs the unit tests and a browser smoke test (GitHub Actions, `ci.yml`).
- CodeQL scans the JavaScript for security and quality problems on every change to `main` and weekly (`codeql.yml`).
- Third-party libraries are pinned to exact versions; Plotly and jsPDF are loaded with Subresource Integrity hashes, and the release build refuses to bundle a library whose hash does not match.
- Releases carry a signed build provenance attestation: `gh attestation verify <file> --repo AntonAlin/options-lab` proves a zip was built by this repository's workflow from its tagged source.
