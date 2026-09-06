# options-lab

Nexus Options Lab Ultimate — en visualiseringsapplikation för europeiska optioner (payoff, Greeks, Monte Carlo, volatilitetsytor m.m.) baserad på Black-Scholes-Merton.

Publiceras via GitHub Pages från denna repo (se `.github/workflows/pages.yml`).

## Funktioner

- Multi-leg-byggare med presets (long call/put, straddle, strangle, spreads, butterfly, iron condor, risk reversal, collar, calendar, diagonal).
- Flera förfall per strategi: "payoff" utvärderas vid första förfallet, ben med längre löptid prissätts med BSM på återstående tid.
- Payoff, Greeks-profiler, P/L- och Delta-heatmaps, 3D-ytor, tidsdecay, scenario-matris (nu / halvvägs / vid första förfall), A/B-jämförelse, Monte Carlo (antitetiska variabler).
- POP/EV under riskneutralt mått, integrerat över hela fördelningen. IV-solver (Newton-Raphson + bisektion, arbitragegränser kontrolleras).
- Instrumenttyper: aktie/index (BSM), FX (Garman-Kohlhagen), råvara och ränta (Black-76), warrant med utspädning.
- Spara/ladda lokalt, exportera CSV/JSON, importera JSON, samt delningslänk som återskapar hela strategin.

Appen är `index.html` plus en kompilerad `tailwind.css`. Plotly laddas från CDN.

## Utveckling

Tailwind kompileras i förväg (play-CDN:en är inte avsedd för produktion). Den färdiga `tailwind.css` är incheckad så sidan går att öppna direkt från disk, och Pages-workflowen bygger om den vid deploy.

```bash
npm install
npm run build   # eller: npm run watch
```

Bygg om `tailwind.css` när du lägger till nya Tailwind-klasser i `index.html`.

> **Ansvarsfriskrivning:** Verktyget är endast avsett för utbildningssyfte och illustrerar options­teori. Det utgör inte finansiell rådgivning eller en rekommendation att handla. Byggaren av applikationen tar inget ansvar för riktigheten i beräkningarna eller för beslut och förluster som uppstår vid användning. Använd på egen risk.
