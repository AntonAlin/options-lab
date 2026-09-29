// The user guide: how to work the platform, page by page. Plain data like methodology.js — the
// Guide page renders it and the test checks that every block exists in both languages.
//
// Section: { id, title, intro?, blocks: [...] }. Block kinds, all texts as { en, sv }:
//   { h }              subheading
//   { p }              paragraph
//   { steps: [...] }   numbered steps
//   { list: [...] }    bullet list
//   { note, tone }     highlighted box; tone 'ok' | 'warn' | 'info'
//   { code }           monospace example (not translated)
//   { link: 'route', label } button to a page of the app
//   { href, label }    button to an external page (opens in a new tab)

export const REPO_URL = 'https://github.com/AntonAlin/options-lab';

export const GUIDE = [
  {
    id: 'privacy',
    title: { en: 'Your data stays inside your organisation', sv: 'Din data stannar inom organisationen' },
    blocks: [
      { note: { en: 'Nexus Portfolio Lab has no server, no database and no user accounts. Holdings, transactions and prices are read, calculated and stored on the computer you are using. Nothing about your portfolios is ever sent to us or to anyone else.', sv: 'Nexus Portfolio Lab har ingen server, ingen databas och inga användarkonton. Innehav, transaktioner och kurser läses, beräknas och sparas på datorn du använder. Ingenting om dina portföljer skickas någonsin till oss eller till någon annan.' }, tone: 'ok' },
      { p: { en: 'That is a design choice, not a setting: the platform is built so that portfolio data has nowhere to go. It is the reason the platform works the way it does.', sv: 'Det är ett designval, inte en inställning: plattformen är byggd så att portföljdata inte har någonstans att ta vägen. Det är skälet till att plattformen fungerar som den gör.' } },
      { h: { en: 'How it is done', sv: 'Hur det går till' } },
      { list: [
        { en: 'Every calculation runs in your browser. Valuation, VaR, stress tests, compliance and the PDF report are computed by code on your own computer.', sv: 'Varje beräkning körs i din webbläsare. Värdering, VaR, stresstester, placeringsregler och PDF-rapporten räknas fram av kod på din egen dator.' },
        { en: 'The connected file is read where it lies. The browser reads your holdings file directly from your disk or your organisation\'s network share. It is not uploaded anywhere — the file never leaves the machine, and the original stays under your organisation\'s access rights, backup and audit trail. That is why a connected file is the recommended way to work.', sv: 'Den kopplade filen läses där den ligger. Webbläsaren läser innehavsfilen direkt från din disk eller organisationens nätverksdisk. Den laddas inte upp någonstans — filen lämnar aldrig datorn, och originalet ligger kvar under organisationens behörigheter, säkerhetskopiering och spårbarhet. Därför är en kopplad fil det rekommenderade arbetssättet.' },
        { en: '“Upload” in Bulk upload only means reading a file into this browser. Nothing is transmitted.', sv: '”Ladda upp” i Massuppladdning betyder bara att en fil läses in i den här webbläsaren. Ingenting skickas.' },
        { en: 'The workspace is kept in the browser\'s local storage on this computer, and in files you choose to save (linked file, backups, exports, PDFs).', sv: 'Arbetsytan sparas i webbläsarens lokala lagring på den här datorn, och i filer du själv väljer att spara (kopplad fil, säkerhetskopior, exporter, PDF:er).' }
      ] },
      { h: { en: 'What does go over the network — and why it carries no portfolio data', sv: 'Vad som går över nätverket — och varför det inte innehåller portföljdata' } },
      { list: [
        { en: 'Loading the page itself, the Inter font (Google Fonts) and code libraries from public CDNs: Plotly for charts, SheetJS when you read or write Excel, jsPDF when you export a PDF. These are downloads of code; nothing is sent with them. Plotly and jsPDF are pinned to exact versions and checked with integrity hashes.', sv: 'Själva sidan, typsnittet Inter (Google Fonts) och kodbibliotek från publika CDN:er: Plotly för diagram, SheetJS när du läser eller skriver Excel, jsPDF när du exporterar PDF. Det är nedladdningar av kod; ingenting skickas med. Plotly och jsPDF är låsta till exakta versioner och kontrolleras med integritetshashar.' },
        { en: 'ECB reference FX rates from api.frankfurter.app — only when you click “Fetch latest ECB rates” in Settings. The request asks for public rates and contains nothing about you or your holdings.', sv: 'ECB:s referenskurser från api.frankfurter.app — bara när du klickar på ”Hämta senaste ECB-kurser” i Inställningar. Anropet frågar efter publika kurser och innehåller ingenting om dig eller dina innehav.' }
      ] },
      { h: { en: 'Your part: keep the files inside the organisation', sv: 'Din del: håll filerna inom organisationen' } },
      { p: { en: 'Where you save files decides where the data is. The platform cannot see that for you.', sv: 'Var du sparar filer avgör var datan finns. Det kan plattformen inte se åt dig.' } },
      { list: [
        { en: 'Keep the connected file, the linked file and backups on storage your organisation controls: a network share, the company OneDrive/SharePoint or another approved location — not a personal cloud account or a USB stick.', sv: 'Ha den kopplade filen, den länkade filen och säkerhetskopior på lagring som organisationen kontrollerar: en nätverksdisk, företagets OneDrive/SharePoint eller annan godkänd plats — inte ett privat molnkonto eller ett USB-minne.' },
        { en: 'The automatic backup is saved to your Downloads folder. Move it to approved storage, or turn it off in Settings if a linked file already covers you.', sv: 'Den automatiska säkerhetskopian sparas i mappen Hämtade filer. Flytta den till godkänd lagring, eller stäng av den i Inställningar om en kopplad fil redan täcker dig.' },
        { en: 'PDF reports and CSV/Excel exports are ordinary files. Treat them like any other client or fund document.', sv: 'PDF-rapporter och CSV/Excel-exporter är vanliga filer. Hantera dem som vilket fond- eller kunddokument som helst.' },
        { en: 'On a shared computer, use “Delete everything” in Settings when you are done, or use your own browser profile.', sv: 'På en delad dator: använd ”Radera allt” i Inställningar när du är klar, eller använd en egen webbläsarprofil.' }
      ] },
      { h: { en: 'Check it yourself: the source code is public', sv: 'Kontrollera själv: källkoden är publik' } },
      { p: { en: 'You do not have to take our word for any of this. The complete source code is public on GitHub, so your IT department, risk function or compliance can read exactly what the platform does, confirm that no portfolio data is sent anywhere, and check every formula on “How we calculate” — each module named there links to its file.', sv: 'Du behöver inte ta vårt ord för något av detta. Hela källkoden är publik på GitHub, så er IT-avdelning, riskfunktion eller compliance kan läsa exakt vad plattformen gör, bekräfta att ingen portföljdata skickas någonstans och kontrollera varje formel på ”Så räknar vi” — varje modul som nämns där länkar till sin fil.' } },
      { p: { en: 'Public to read is not the same as open source. The licence lets anyone use the platform freely — at work too, with any number of users — host an unmodified copy internally and use the reports and analyses it produces however they like. It may never be sold, modified, built upon or republished (see LICENSE in the repository).', sv: 'Publik att läsa är inte samma sak som öppen källkod. Licensen låter vem som helst använda plattformen fritt — även i jobbet, med hur många användare som helst — driftsätta en oförändrad kopia internt och använda rapporterna och analyserna den tar fram hur man vill. Den får aldrig säljas, ändras, byggas vidare på eller återpubliceras (se LICENSE i repot).' } },
      { href: REPO_URL, label: { en: 'View the source code on GitHub', sv: 'Visa källkoden på GitHub' } },
      { h: { en: 'For IT: running with no external requests at all', sv: 'För IT: köra helt utan externa anrop' } },
      { p: { en: 'The platform is a folder of static files with no back end, and the licence allows your organisation to host an unmodified copy on an internal web server. The one change allowed is pointing the library addresses (in index.html, js/importer.js and js/report.js) and the font link to internal copies. After that the only outbound request left is the optional ECB button.', sv: 'Plattformen är en mapp med statiska filer utan serverdel, och licensen tillåter organisationen att driftsätta en oförändrad kopia på en intern webbserver. Den enda ändring som är tillåten är att peka om biblioteksadresserna (i index.html, js/importer.js och js/report.js) och typsnittslänken till interna kopior. Därefter återstår bara det valfria ECB-anropet.' } }
    ]
  },
  {
    id: 'start',
    title: { en: 'Getting started', sv: 'Kom igång' },
    blocks: [
      { p: { en: 'Open the site in Chrome or Edge on a desktop computer — that is where every feature works, including the connected file. Firefox and Safari work too, but without the connected or linked file.', sv: 'Öppna sidan i Chrome eller Edge på en dator — där fungerar allt, också den kopplade filen. Firefox och Safari fungerar också, men utan kopplad eller länkad fil.' } },
      { steps: [
        { en: 'Choose language (English/Svenska) and light or dark theme in the top bar.', sv: 'Välj språk (English/Svenska) och ljust eller mörkt tema i toppraden.' },
        { en: 'Try the demo fund first if you want to see every page filled in: “Explore the demo fund” on the start page, or ⋮ → Load demo portfolio.', sv: 'Prova gärna demofonden först för att se alla sidor ifyllda: ”Utforska demofonden” på startsidan, eller ⋮ → Ladda demoportfölj.' },
        { en: 'Get your own holdings in: connect a file (recommended), upload one, or start an empty portfolio with “New” and add instruments by hand. See the next section.', sv: 'Få in dina egna innehav: koppla en fil (rekommenderas), ladda upp en, eller starta en tom portfölj med ”Ny” och lägg till instrument för hand. Se nästa avsnitt.' },
        { en: 'Check the base currency and FX rates in Settings. Fetch ECB rates with one click; the fallback rates are placeholders.', sv: 'Kontrollera basvaluta och valutakurser i Inställningar. Hämta ECB:s kurser med ett klick; reservkurserna är bara platshållare.' },
        { en: 'Load price history if you want performance, historical VaR, correlations and the risk class (SRI).', sv: 'Läs in kurshistorik om du vill ha avkastning, historisk VaR, korrelationer och riskklass (SRI).' }
      ] },
      { h: { en: 'The top bar', sv: 'Toppraden' } },
      { list: [
        { en: 'Portfolio selector: every portfolio in the workspace. “New” creates one; ⋮ renames, duplicates, exports as JSON, loads the demo or deletes.', sv: 'Portföljväljaren: alla portföljer i arbetsytan. ”Ny” skapar en; ⋮ byter namn, duplicerar, exporterar som JSON, laddar demon eller tar bort.' },
        { en: 'Valuation date: the date bonds, options and swaps are valued at. Empty means today. For a portfolio fed by a connected file this becomes “Snapshot”: the date in the file you are looking at.', sv: 'Värderingsdag: dagen obligationer, optioner och swappar värderas per. Tomt betyder i dag. För en portfölj från en kopplad fil blir detta ”Datum i filen”: vilket datum i filen du tittar på.' },
        { en: 'The chip next to it is the base currency; change it in Settings.', sv: 'Etiketten bredvid är basvalutan; den ändras i Inställningar.' }
      ] },
      { p: { en: 'Ctrl+Z (⌘Z) undoes the last change to holdings or settings. The sidebar footer always shows where your data is saved and how old the last backup is.', sv: 'Ctrl+Z (⌘Z) ångrar senaste ändringen av innehav eller inställningar. Sidofältets nederkant visar alltid var datan sparas och hur gammal senaste säkerhetskopian är.' } }
    ]
  },
  {
    id: 'connect',
    title: { en: 'Connected file — the recommended way to work', sv: 'Kopplad fil — det rekommenderade arbetssättet' },
    blocks: [
      { note: { en: 'The browser reads the file directly from your computer or network share and never sends it anywhere. The file stays where your organisation keeps it, and the platform follows it.', sv: 'Webbläsaren läser filen direkt från din dator eller nätverksdisk och skickar den aldrig någonstans. Filen ligger kvar där organisationen har den, och plattformen följer den.' }, tone: 'ok' },
      { h: { en: 'The file', sv: 'Filen' } },
      { p: { en: 'CSV or Excel (.xlsx, .xls), one row per holding per date, with a header row. Title rows above the header are fine.', sv: 'CSV eller Excel (.xlsx, .xls), en rad per innehav och datum, med en rubrikrad. Titelrader ovanför rubriken går bra.' } },
      { list: [
        { en: 'First column: the date the row applies to — 2026-09-29, 29.09.2026, 20260929 or an Excel date. Rows without a date (totals, notes) are skipped and counted.', sv: 'Första kolumnen: datumet raden gäller — 2026-09-29, 29.09.2026, 20260929 eller ett Exceldatum. Rader utan datum (summor, noteringar) hoppas över och räknas.' },
        { en: 'Optional portfolio column: Portfolio, Fund, Account, Mandate, Client (or Portfölj, Fond, Konto, Depå, Mandat, Kund). Each value becomes its own portfolio. Without it, the whole file is one portfolio named after the file.', sv: 'Valfri portföljkolumn: Portfölj, Fond, Konto, Depå, Mandat, Kund (eller Portfolio, Fund, Account, Mandate, Client). Varje värde blir en egen portfölj. Utan den är hela filen en portfölj med filens namn.' },
        { en: 'The other columns as in Bulk upload: name, ISIN, ticker, type, quantity, price, currency, maturity, coupon and so on, with English or Swedish headers.', sv: 'Övriga kolumner som i Massuppladdning: namn, ISIN, ticker, typ, antal, kurs, valuta, förfall, kupong och så vidare, med svenska eller engelska rubriker.' }
      ] },
      { p: { en: 'Example:', sv: 'Exempel:' } },
      { code: 'Date;Portfolio;Name;ISIN;Type;Quantity;Price;Currency\n2026-09-28;Fund A;Volvo B;SE0000115446;Equity;1000;250,5;SEK\n2026-09-28;Fund B;Apple;US0378331005;Equity;10;230;USD\n2026-09-29;Fund A;Volvo B;SE0000115446;Equity;1200;255;SEK\n2026-09-29;Fund B;Apple;US0378331005;Equity;12;232;USD' },
      { h: { en: 'Connecting', sv: 'Koppla' } },
      { steps: [
        { en: 'Go to Bulk upload (or Settings, or the start page) and click “Connect a file…”.', sv: 'Gå till Massuppladdning (eller Inställningar, eller startsidan) och klicka på ”Koppla fil…”.' },
        { en: 'Pick the file. The browser asks once for permission to read it.', sv: 'Välj filen. Webbläsaren frågar en gång om tillstånd att läsa den.' },
        { en: 'One portfolio per value in the portfolio column appears in the portfolio selector, each showing its latest date.', sv: 'En portfölj per värde i portföljkolumnen dyker upp i portföljväljaren, var och en på sitt senaste datum.' }
      ] },
      { h: { en: 'Day to day', sv: 'I vardagen' } },
      { list: [
        { en: 'Save the file as usual (from Excel, your PMS or the custodian export). The platform checks it every few seconds while the tab is visible, and when you return to the tab. New dates and new portfolios appear on their own.', sv: 'Spara filen som vanligt (från Excel, ert PMS eller depåbankens export). Plattformen kontrollerar den med några sekunders mellanrum medan fliken syns, och när du går tillbaka till fliken. Nya datum och nya portföljer dyker upp av sig själva.' },
        { en: '“Snapshot” in the top bar picks the date. “Latest” follows new dates; pick an older date to pin it (“date pinned”). Pick “Latest” again to follow the file.', sv: '”Datum i filen” i toppraden väljer datum. ”Senaste” följer nya datum; välj ett äldre datum för att låsa det (”datum låst”). Välj ”Senaste” igen för att följa filen.' },
        { en: 'Prices across the dates in the file are added to each portfolio\'s price history, so performance and historical risk build up as the file grows.', sv: 'Kurserna över datumen i filen läggs till i varje portföljs kurshistorik, så avkastning och historisk risk byggs upp i takt med att filen växer.' },
        { en: 'Holdings in a connected portfolio are replaced whenever the file changes. Correct the file, not the Holdings page.', sv: 'Innehaven i en kopplad portfölj ersätts varje gång filen ändras. Rätta i filen, inte på sidan Innehav.' },
        { en: 'After a browser restart a banner asks you to click “Reconnect” — the browser requires fresh permission once per session.', sv: 'Efter omstart av webbläsaren ber en banner dig klicka på ”Återanslut” — webbläsaren kräver nytt tillstånd en gång per session.' },
        { en: '“Disconnect” stops following the file. The portfolios stay with the data they have. Connecting the same file again picks them up.', sv: '”Koppla bort” slutar följa filen. Portföljerna finns kvar med den data de har. Kopplar du samma fil igen tas de upp på nytt.' }
      ] },
      { h: { en: 'When the columns are not recognised', sv: 'När kolumnerna inte känns igen' } },
      { p: { en: 'Load the same file once in Bulk upload, map the columns and save an import template. The connected file uses a matching template automatically (the card says which one). Rows with validation errors are kept and flagged on the Holdings page, so nothing disappears silently.', sv: 'Läs in samma fil en gång i Massuppladdning, mappa kolumnerna och spara en importmall. Den kopplade filen använder en matchande mall automatiskt (kortet visar vilken). Rader med valideringsfel behålls och flaggas på sidan Innehav, så ingenting försvinner i tysthet.' } },
      { link: 'import', label: { en: 'Go to Bulk upload', sv: 'Till Massuppladdning' } }
    ]
  },
  {
    id: 'upload',
    title: { en: 'Bulk upload and import templates', sv: 'Massuppladdning och importmallar' },
    blocks: [
      { p: { en: 'For one-off files: CSV, TSV, Excel (xlsx, xls, ods), JSON, XML, or cells pasted from Excel. The file is read in this browser only.', sv: 'För enstaka filer: CSV, TSV, Excel (xlsx, xls, ods), JSON, XML eller celler inklistrade från Excel. Filen läses bara i den här webbläsaren.' } },
      { steps: [
        { en: 'Drop the file on “Choose a file” or click it. Delimiter, decimal comma and header row are detected.', sv: 'Släpp filen på ”Välj fil” eller klicka. Avgränsare, decimalkomma och rubrikrad känns igen.' },
        { en: 'Check the column mapping. Each column shows sample values; pick the field it holds or “ignore”. Number columns can be scaled (×100, ÷1000, sign flip); date columns can have their own format.', sv: 'Kontrollera kolumnmappningen. Varje kolumn visar exempelvärden; välj fältet den innehåller eller ”ignorera”. Talkolumner kan skalas (×100, ÷1000, byt tecken); datumkolumner kan ha eget format.' },
        { en: '“Mandatory datapoints” lists every required field for the instrument types in the file and where it comes from. Fill a missing one with a fixed value for all rows.', sv: '”Obligatoriska datapunkter” listar varje krävt fält för instrumenttyperna i filen och var det hämtas. Fyll ett saknat fält med ett fast värde för alla rader.' },
        { en: 'Map your own type codes (e.g. EQ_ORD → Equity, CASH_ACC → skip) under “Instrument type codes”.', sv: 'Mappa egna typkoder (t.ex. EQ_ORD → Aktie, CASH_ACC → hoppa över) under ”Egna typkoder”.' },
        { en: 'Review the preview: valid rows, rows with errors and why. Choose the mode — Add, Update existing (matches on ISIN, then ticker, then name — use it for a daily price file) or Replace — and import.', sv: 'Granska förhandsvisningen: giltiga rader, rader med fel och varför. Välj läge — Lägg till, Uppdatera befintliga (matchar på ISIN, sedan ticker, sedan namn — använd det för en daglig kursfil) eller Ersätt — och importera.' },
        { en: 'Save the mapping as an import template. It is recognised from the column headers next time, even if the columns move, and applied automatically. Templates can be downloaded and shared with colleagues as JSON.', sv: 'Spara mappningen som importmall. Den känns igen på kolumnrubrikerna nästa gång, även om kolumnerna flyttas, och används automatiskt. Mallar kan laddas ner och delas med kollegor som JSON.' }
      ] },
      { p: { en: 'Blank Excel and CSV templates with an instruction sheet are under “Templates”, also one per instrument type.', sv: 'Tomma Excel- och CSV-mallar med instruktionsblad finns under ”Mallar”, också en per instrumenttyp.' } }
    ]
  },
  {
    id: 'holdings',
    title: { en: 'Holdings', sv: 'Innehav' },
    blocks: [
      { p: { en: '15 instrument types: equity, ETF, mutual fund, government bond, corporate bond, FRN, money market, cash, future, listed option, FX forward/swap, interest rate swap, CDS, commodity/ETC and alternative/unlisted. Each has its own form, required fields and live valuation preview.', sv: '15 instrumenttyper: aktie, ETF, fond, statsobligation, företagsobligation, FRN, penningmarknad, kassa, termin, noterad option, valutatermin/-swap, ränteswap, CDS, råvara/ETC och alternativ/onoterat. Var och en har eget formulär, obligatoriska fält och direkt värdering.' } },
      { list: [
        { en: '“+ Add instrument” opens the form; click a row to edit it.', sv: '”+ Lägg till instrument” öppnar formuläret; klicka på en rad för att redigera.' },
        { en: 'Search and filter by type; sort by any column. Rows with errors are marked, and the sidebar badge counts them.', sv: 'Sök och filtrera på typ; sortera på valfri kolumn. Rader med fel markeras, och märket i sidofältet räknar dem.' },
        { en: 'Export the holdings to CSV or Excel.', sv: 'Exportera innehaven till CSV eller Excel.' },
        { en: 'Positions with a currency that has no FX rate are valued at zero until you add a rate — the dashboard warns you.', sv: 'Innehav i en valuta utan valutakurs värderas till noll tills du lägger in en kurs — översikten varnar.' }
      ] },
      { h: { en: 'Price history', sv: 'Kurshistorik' } },
      { p: { en: 'Daily prices drive performance, historical VaR, correlations, tracking error and the risk class. Load a wide file (Date | series | series …) or a long one (Date | Ticker | Price). Series are matched to holdings by ISIN, ticker or name, or by hand. Add FX series (e.g. USDSEK) for currency risk and a benchmark column for relative figures. New files are merged by date. A connected file with several dates fills this in by itself.', sv: 'Dagliga kurser driver avkastning, historisk VaR, korrelationer, tracking error och riskklass. Läs in en bred fil (Datum | serie | serie …) eller en lång (Datum | Ticker | Kurs). Serierna matchas mot innehaven på ISIN, ticker eller namn, eller för hand. Lägg till valutaserier (t.ex. USDSEK) för valutarisk och en jämförelseindexkolumn för relativa mått. Nya filer slås ihop per datum. En kopplad fil med flera datum fyller i detta av sig själv.' } }
    ]
  },
  {
    id: 'pnl',
    title: { en: 'Cost & P&L and NAV & units', sv: 'Anskaffning & resultat samt NAV & andelar' },
    blocks: [
      { p: { en: 'Cost & P&L shows average cost, unrealised P&L against today\'s value with the currency effect split out, and realised P&L for the year, 12 months and all time. Give a cost price per position, or import a transaction log (buys and sells with fees and trade-day FX; Swedish or English headers). A reconciliation flag shows when the log does not add up to the held quantity.', sv: 'Anskaffning & resultat visar genomsnittligt anskaffningsvärde, orealiserat resultat mot dagens värde med valutaeffekten separat, och realiserat resultat för året, 12 månader och totalt. Ange en anskaffningskurs per innehav eller läs in en transaktionslogg (köp och sälj med courtage och affärsdagens valutakurs; svenska eller engelska rubriker). En avstämningsflagga visar när loggen inte summerar till innehavd kvantitet.' } },
      { p: { en: 'NAV & units gives an indicative NAV per unit for each share class, with fee accrual, and simulates what a subscription or redemption does to cash, liquidity and limits. Enter share classes, units outstanding and fees on that page.', sv: 'NAV & andelar ger ett indikativt andelsvärde per andelsklass, med avgiftsupplupning, och simulerar vad en teckning eller inlösen gör med kassa, likviditet och placeringsregler. Ange andelsklasser, utestående andelar och avgifter på den sidan.' } }
    ]
  },
  {
    id: 'oversight',
    title: { en: 'Daily oversight: changes, pre-trade and attribution', sv: 'Daglig uppföljning: förändringar, pre-trade och attribution' },
    blocks: [
      { p: { en: 'These pages work on holdings over time. A connected file gives one snapshot per date automatically; for other portfolios, click “Save holdings as snapshot” on Changes & track record each day you update the holdings (the latest 90 are kept).', sv: 'De här sidorna arbetar med innehav över tid. En kopplad fil ger automatiskt en ögonblicksbild per datum; för andra portföljer klickar du på ”Spara innehaven som ögonblicksbild” på Förändringar & historik varje dag du uppdaterar innehaven (de senaste 90 sparas).' } },
      { h: { en: 'Changes & track record — the morning check', sv: 'Förändringar & historik — morgonkollen' } },
      { list: [
        { en: 'Pick two dates (default: the latest two). You see the holdings-based return, the NAV change, estimated net flows (subscriptions minus redemptions) and turnover.', sv: 'Välj två datum (förval: de två senaste). Du ser innehavsbaserad avkastning, NAV-förändring, uppskattade nettoflöden (teckningar minus inlösen) och omsättning.' },
        { en: 'Key figures side by side: VaR, duration, equity delta, liquidity, largest issuer, limit breaches — with the change coloured red where it got worse.', sv: 'Nyckeltal sida vid sida: VaR, duration, aktiedelta, likviditet, största emittent, regelbrott — med förändringen i rött där det blivit sämre.' },
        { en: 'Limits that changed status, and the holdings that were bought or sold, with each move split into price effect and trade effect.', sv: 'Regler som ändrat status, och innehaven som köpts eller sålts, med varje förändring uppdelad i priseffekt och affärseffekt.' },
        { en: 'Track record: the fund\'s own chained return across every date, with volatility, drawdown, turnover and the largest contributors and detractors.', sv: 'Historik: fondens egen länkade avkastning över alla datum, med volatilitet, drawdown, omsättning och de största positiva och negativa bidragen.' }
      ] },
      { h: { en: 'Pre-trade — before you place the order', sv: 'Pre-trade — innan du lägger ordern' } },
      { steps: [
        { en: 'Add a trade on a holding (target weight, change in quantity or new quantity) or a new instrument.', sv: 'Lägg till en affär i ett innehav (målvikt, förändring i antal eller nytt antal) eller ett nytt instrument.' },
        { en: 'Choose which cash account pays for it.', sv: 'Välj vilket kassakonto som betalar.' },
        { en: 'Read the impact: risk, duration, liquidity, largest issuer and every limit before and after. A limit the trade would breach shows in red — that is an active breach you would be creating.', sv: 'Läs effekten: risk, duration, likviditet, största emittent och varje regel före och efter. En regel som affären skulle bryta visas i rött — det vore ett aktivt brott du själv orsakar.' },
        { en: 'Apply the trades to the holdings if you want (undo is one click). For a portfolio fed by a connected file, put the trades in the file instead.', sv: 'Genomför affärerna i innehaven om du vill (ångra är ett klick). För en portfölj från en kopplad fil lägger du in affärerna i filen i stället.' }
      ] },
      { h: { en: 'Attribution — explaining the result', sv: 'Attribution — att förklara resultatet' } },
      { steps: [
        { en: 'Choose the segments: asset class, sector, region, country or currency.', sv: 'Välj segment: tillgångsslag, sektor, region, land eller valuta.' },
        { en: 'Paste or upload the benchmark\'s weight and return per segment for the period (the index factsheet has them). “Download template” gives a file with your portfolio\'s segments filled in.', sv: 'Klistra in eller ladda upp indexets vikt och avkastning per segment för perioden (indexets faktablad har dem). ”Ladda ner mall” ger en fil med portföljens segment ifyllda.' },
        { en: 'Pick the same period. The page splits the active return into allocation, selection and interaction per segment.', sv: 'Välj samma period. Sidan delar upp den aktiva avkastningen i allokering, selektion och samspel per segment.' }
      ] },
      { h: { en: 'Limit history and liquidity stress test', sv: 'Regelhistorik och likviditetsstresstest' } },
      { list: [
        { en: 'Compliance → Limit history shows every limit on every date and classes each breach as active (a trade caused it — correct at once) or passive (the market did — correct as a priority, in the unitholders\' interest). Useful evidence for the depositary and the board.', sv: 'Placeringsregler → Regelhistorik visar varje regel på varje datum och klassar varje brott som aktivt (en affär orsakade det — rättas omedelbart) eller passivt (marknaden orsakade det — rättas med förtur, i andelsägarnas intresse). Bra underlag för förvaringsinstitut och styrelse.' },
        { en: 'Liquidity → Liquidity stress test runs redemption shocks of 5–30 % (and your own) against what can be sold in the horizon, and shows the fund left for the remaining investors when the most liquid assets are sold first — in line with ESMA\'s guidelines.', sv: 'Likviditet → Likviditetsstresstest kör inlösenchocker på 5–30 % (och en egen) mot det som kan säljas inom horisonten, och visar fonden som blir kvar för övriga andelsägare när det likvidaste säljs först — i linje med ESMA:s riktlinjer.' }
      ] },
      { link: 'changes', label: { en: 'Go to Changes & track record', sv: 'Till Förändringar & historik' } }
    ]
  },
  {
    id: 'analytics',
    title: { en: 'Analytics, page by page', sv: 'Analys, sida för sida' },
    blocks: [
      { list: [
        { en: 'Dashboard — NAV, key risk figures, alerts (missing FX, limit breaches, errors) and the largest holdings at a glance.', sv: 'Översikt — NAV, nyckeltal för risk, varningar (saknade valutakurser, regelbrott, fel) och de största innehaven i en blick.' },
        { en: 'Asset allocation — economic exposure per asset class: holdings plus the derivative overlay. Set mandate targets and ranges per class to see breaches and active weights.', sv: 'Tillgångsfördelning — ekonomisk exponering per tillgångsslag: innehav plus derivatöverlägget. Ange mandatmål och intervall per tillgångsslag för att se överträdelser och aktiva vikter.' },
        { en: 'Exposure — market value against economic exposure, sector, region, country, issuer and currency before and after hedges, plus concentration (top 10, HHI, effective N).', sv: 'Exponering — marknadsvärde mot ekonomisk exponering, sektor, region, land, emittent och valuta före och efter säkring, samt koncentration (topp 10, HHI, effektivt antal).' },
        { en: 'Derivatives — notional, delta and delta-adjusted exposure per derivative, the model next to what your broker or custodian reported (columns reportedNotional, reportedDelta, reportedDeltaExposure). Differences are flagged.', sv: 'Derivat — nominellt belopp, delta och deltajusterad exponering per derivat, modellen bredvid det mäklaren eller förvaringsinstitutet rapporterat (kolumnerna reportedNotional, reportedDelta, reportedDeltaExposure). Avvikelser flaggas.' },
        { en: 'Risk — risk contributions by asset class, parametric and historical VaR/ES (confidence, horizon and headline method are selectable), contributions by factor and position, sensitivities and correlations. Historical figures need price history.', sv: 'Risk — riskbidrag per tillgångsslag, parametrisk och historisk VaR/ES (konfidensnivå, horisont och huvudmetod går att välja), bidrag per faktor och innehav, känsligheter och korrelationer. Historiska mått kräver kurshistorik.' },
        { en: 'Fixed income — yield, modified and spread duration, convexity, DV01/CS01, maturity and rating profiles, DV01 ladder and rate risk per currency; swaps and bond futures included.', sv: 'Räntebärande — avkastning, modifierad duration och spreadduration, konvexitet, DV01/CS01, löptids- och ratingprofil, DV01-trappa och ränterisk per valuta; swappar och obligationsterminer ingår.' },
        { en: 'Performance — today\'s holdings back-cast over the loaded history: return, volatility, Sharpe, Sortino, drawdown, benchmark statistics, monthly table and a 3D risk–return map.', sv: 'Avkastning — dagens innehav bakåtberäknade över inläst historik: avkastning, volatilitet, Sharpe, Sortino, drawdown, statistik mot jämförelseindex, månadstabell och en 3D-karta över risk och avkastning.' },
        { en: 'Stress tests — 11 historical and hypothetical scenarios, and your own with sliders. Options are fully repriced.', sv: 'Stresstester — 11 historiska och hypotetiska scenarier, och egna med reglage. Optioner omvärderas fullt ut.' },
        { en: 'Liquidity — days to liquidate from average daily volume and a participation rate you set, and a liquidation profile under normal and stressed conditions. Add average daily volume to holdings for better estimates.', sv: 'Likviditet — dagar att avveckla utifrån genomsnittlig dagsvolym och en andel du anger, samt en avvecklingsprofil under normala och stressade förhållanden. Lägg till genomsnittlig dagsvolym på innehaven för bättre uppskattningar.' },
        { en: 'Cash-flow calendar — coupons, redemptions, FX settlements, swap and CDS payments and expiries, exportable to CSV and your calendar (.ics).', sv: 'Kassaflödeskalender — kuponger, förfall, valutalikvider, swap- och CDS-betalningar och lösendagar, exporterbar till CSV och din kalender (.ics).' },
        { en: 'Risk class (SRI) — PRIIPs SRI and UCITS SRRI from price history, with recommended holding period and credit risk measure as settings.', sv: 'Riskklass (SRI) — PRIIPs SRI och UCITS SRRI från kurshistorik, med rekommenderad innehavsperiod och kreditriskmått som inställningar.' },
        { en: 'Compliance — UCITS-style limits (issuer, 5/10/40, government, deposits, funds, commitment, counterparty, liquidity, illiquid assets) plus optional internal limits. Switch each on or off and set its value to match your prospectus.', sv: 'Placeringsregler — UCITS-gränser (emittent, 5/10/40, stat, inlåning, fonder, åtagande, motpart, likviditet, illikvida tillgångar) plus valfria interna gränser. Slå på eller av och ange värdet så att det stämmer med fondbestämmelserna.' }
      ] },
      { p: { en: 'Every formula and simplification behind these numbers is on “How we calculate”.', sv: 'Varje formel och förenkling bakom siffrorna finns på ”Så räknar vi”.' } },
      { link: 'methodology', label: { en: 'How we calculate', sv: 'Så räknar vi' } }
    ]
  },
  {
    id: 'report',
    title: { en: 'PDF report', sv: 'PDF-rapport' },
    blocks: [
      { steps: [
        { en: 'Open PDF report and choose the sections to include.', sv: 'Öppna PDF-rapport och välj vilka avsnitt som ska med.' },
        { en: 'Write the manager commentary if you want one.', sv: 'Skriv en förvaltarkommentar om du vill.' },
        { en: 'Generate. The A4 PDF is built in your browser and saved where you choose — it is not sent anywhere.', sv: 'Skapa. A4-PDF:en byggs i din webbläsare och sparas där du väljer — den skickas ingenstans.' }
      ] }
    ]
  },
  {
    id: 'settings',
    title: { en: 'Settings and keeping data safe', sv: 'Inställningar och datasäkerhet' },
    blocks: [
      { list: [
        { en: 'Portfolio: name, base currency, manager, fund type, valuation date and risk-free rate.', sv: 'Portfölj: namn, basvaluta, förvaltare, fondtyp, värderingsdag och riskfri ränta.' },
        { en: 'FX rates: fetch ECB reference rates or type your own. Rates are stored per portfolio.', sv: 'Valutakurser: hämta ECB:s referenskurser eller skriv in egna. Kurserna sparas per portfölj.' },
        { en: 'Risk model assumptions: the long-run volatilities and correlations the parametric model uses when there is no price history.', sv: 'Riskmodellens antaganden: de långsiktiga volatiliteter och korrelationer som den parametriska modellen använder när kurshistorik saknas.' },
        { en: 'Connected file: the read side — see above.', sv: 'Kopplad källfil: läsriktningen — se ovan.' },
        { en: 'Linked file: the save side. The whole workspace (JSON) or the active portfolio (CSV/Excel) is written to a file on your organisation\'s storage about a second after every change. Recommended so the browser is not the only copy.', sv: 'Kopplad fil: sparriktningen. Hela arbetsytan (JSON) eller den aktiva portföljen (CSV/Excel) skrivs till en fil på organisationens lagring ungefär en sekund efter varje ändring. Rekommenderas så att webbläsaren inte är enda kopian.' },
        { en: 'Backups: “Download backup” saves a JSON of everything; “Restore from backup” merges one back. The automatic backup (daily, weekly, monthly or off) downloads when no linked file is set.', sv: 'Säkerhetskopior: ”Ladda ner säkerhetskopia” sparar en JSON med allt; ”Återställ från säkerhetskopia” läser tillbaka en. Den automatiska säkerhetskopian (daglig, veckovis, månadsvis eller av) laddas ner när ingen kopplad fil finns.' }
      ] },
      { note: { en: 'The browser copy is lost if someone clears the browser\'s site data. Keep a linked file or regular backups on your organisation\'s storage.', sv: 'Webbläsarens kopia försvinner om någon rensar webbplatsdata i webbläsaren. Ha en kopplad fil eller regelbundna säkerhetskopior på organisationens lagring.' }, tone: 'warn' }
    ]
  },
  {
    id: 'faq',
    title: { en: 'Troubleshooting', sv: 'Felsökning' },
    blocks: [
      { list: [
        { en: '“Connect a file” is missing — you are not in Chrome or Edge on a desktop. Use Bulk upload instead.', sv: '”Koppla fil” saknas — du använder inte Chrome eller Edge på en dator. Använd Massuppladdning i stället.' },
        { en: '“No date column found” — the first column must hold a date on every holding row. Check that Excel has not turned dates into text in an unusual format.', sv: '”Ingen datumkolumn hittades” — första kolumnen måste ha ett datum på varje innehavsrad. Kontrollera att Excel inte gjort om datumen till text i ett ovanligt format.' },
        { en: '“Column headers were not recognised” — map the file once in Bulk upload and save an import template, then connect again.', sv: '”Kolumnrubrikerna kändes inte igen” — mappa filen en gång i Massuppladdning och spara en importmall, och koppla sedan igen.' },
        { en: 'The connected file is not updating — the file must be saved (not only edited) and the tab visible. Click “Read now” on the card to force it.', sv: 'Den kopplade filen uppdateras inte — filen måste sparas (inte bara redigeras) och fliken synas. Klicka på ”Läs nu” på kortet för att tvinga fram en läsning.' },
        { en: 'My edits on Holdings disappeared — the portfolio comes from a connected file, which replaces holdings on every change. Edit the file.', sv: 'Mina ändringar i Innehav försvann — portföljen kommer från en kopplad fil som ersätter innehaven vid varje ändring. Ändra i filen.' },
        { en: 'A position is valued at zero — its currency has no FX rate, or a required field is missing (see the error on the row).', sv: 'Ett innehav värderas till noll — valutan saknar kurs, eller ett obligatoriskt fält saknas (se felet på raden).' },
        { en: 'Performance and historical VaR are empty — load price history, or connect a file with at least two dates.', sv: 'Avkastning och historisk VaR är tomma — läs in kurshistorik, eller koppla en fil med minst två datum.' },
        { en: 'Changes & track record says it needs two dates — connect a file with several dates, or save a snapshot today and another on a later valuation date.', sv: 'Förändringar & historik säger att det behövs två datum — koppla en fil med flera datum, eller spara en ögonblicksbild i dag och en till på ett senare värderingsdatum.' },
        { en: 'Attribution shows a segment as “not in benchmark” — the names differ. Use the names shown in the table, or download the template.', sv: 'Attribution visar ett segment som ”ej i index” — namnen skiljer sig åt. Använd namnen som visas i tabellen, eller ladda ner mallen.' },
        { en: 'The same file cannot be both connected (read) and linked (save) as CSV/Excel — the platform would read its own output. Use different files.', sv: 'Samma fil kan inte både vara kopplad källfil (läsa) och kopplad fil (spara) som CSV/Excel — plattformen skulle läsa sin egen utdata. Använd olika filer.' }
      ] }
    ]
  }
];
