# options-lab

Nexus Options Lab Ultimate — en visualiseringsapplikation för optionsstrategier (payoff, Greeks, volatilitetsyta, attribution, Monte Carlo, positionsstorlek m.m.). Europeiska ben prissätts med Black-Scholes-Merton, amerikanska med ett CRR-binomialträd.

Publiceras via GitHub Pages från denna repo (se `.github/workflows/pages.yml`).

## Funktioner

- Multi-leg-byggare med presets (long call/put, straddle, strangle, spreads, butterfly, iron condor, risk reversal, covered call, protective put, collar, calendar, diagonal).
- Underliggande som eget ben (aktie/termin, delta 1) så att covered call, protective put och collar modelleras korrekt.
- Europeiska ben (BSM) och amerikanska ben (Cox-Ross-Rubinstein-binomialträd med förtida lösen) sida vid sida; early-exercise-premien visas per ben.
- Förfallodatum per ben och globalt, räknat från ett värderingsdatum (default idag). Sparade strategier räknar ner av sig själva.
- Volatilitetsyta: skew, smile-krökning och term-lutning ovanpå Std IV (sticky strike), för ben utan egen IV. Kurvan ritas per förfall.
- Flera förfall per strategi: "payoff" utvärderas vid första förfallet, ben med längre löptid prissätts med modellen på återstående tid.
- Payoff, Greeks-profiler, P/L- och Delta-heatmaps, 3D-ytor, tidsdecay, scenario-matris (nu / halvvägs / vid första förfall), A/B-jämförelse.
- P/L-attribution: Delta/Gamma/Theta/Vega/Rho + residual (Taylor) jämfört med sekventiell exakt omprissättning, med vattenfallsdiagram.
- Monte Carlo med valbar modell: GBM, Merton jump-diffusion eller Heston stokastisk vol (antitetiska variabler), jämfört mot det analytiska BSM-svaret.
- Rullning av ben: stäng till valfritt pris, bokför realiserat P/L, öppna nytt ben med Greek-diff före bekräftelse.
- Positionsstorlek: konto, kontraktsmultiplikator, riskbudget, Kelly-fraktion under egen drift (P-mått) och ett grovt Reg-T-liknande marginalkrav.
- POP/EV under riskneutralt mått, integrerat över hela fördelningen. IV-solver (Newton-Raphson + bisektion, arbitragegränser kontrolleras; bisektion mot trädet för amerikanska ben).
- Instrumenttyper: aktie/index (BSM), FX (Garman-Kohlhagen), råvara och ränta (Black-76), warrant med utspädning.
- Ångra/gör om och tangentbordsgenvägar (Ctrl+Z/Y/S/O, siffror för flikar, `[`/`]`, `N` nytt ben, `?` hjälp).
- Spara/ladda lokalt, exportera CSV/JSON, importera JSON, samt delningslänk som återskapar hela strategin (inkl. datum, stil, yta och kontoinställningar).

Appen är `index.html` plus en kompilerad `tailwind.css`. Plotly laddas från CDN.

## Utveckling

Tailwind kompileras i förväg (play-CDN:en är inte avsedd för produktion). Den färdiga `tailwind.css` är incheckad så sidan går att öppna direkt från disk, och Pages-workflowen bygger om den vid deploy.

```bash
npm install
npm run build   # eller: npm run watch
```

Bygg om `tailwind.css` när du lägger till nya Tailwind-klasser i `index.html`.

> **Ansvarsfriskrivning:** Verktyget är endast avsett för utbildningssyfte och illustrerar options­teori. Det utgör inte finansiell rådgivning eller en rekommendation att handla. Byggaren av applikationen tar inget ansvar för riktigheten i beräkningarna eller för beslut och förluster som uppstår vid användning. Använd på egen risk.
