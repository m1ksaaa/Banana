# TeraStockX

**Fundamental analysis of every Nasdaq-listed company — in English, Magyar, Deutsch, Français and Español.**

A Nasdaq összes vállalatának fundamentális elemzése tíz befektetési szempont szerint, auditált SEC-jelentések alapján:

| Szempont | Mit mér |
|---|---|
| Jövedelmezőség | árrések, ROIC, ROE, ROA |
| Cash flow minősége | FCF-árrés, FCF-konverzió, eredményhatárolás, részvényalapú juttatás |
| Mérlegerő | nettó adósság/EBITDA, adósság/saját tőke, kamatfedezet, Altman Z'' |
| Likviditás | likviditási ráta, gyorsráta, pénzeszköz-ráta |
| Növekedés (1 év) | árbevétel, üzemi eredmény, EPS, FCF |
| Hosszú távú növekedés | 5 éves CAGR-ek, egy részvényre jutó saját tőke |
| Kiszámíthatóság | nyereséges évek, volatilitás, Piotroski F-pontszám |
| Tőkeallokáció | hígítás / visszavásárlás, részvényesi hozam, osztalékfedezet |
| Értékeltség | P/E, EV/EBIT, FCF-hozam, P/S, PEG (TTM-adatokon) |
| Kockázat | fundamentális + piaci (volatilitás, max. visszaesés) + jelzések |

Emellett: csődkockázat, hosszú távú trend, befektetési profil (minőségi, növekedési, érték, osztalék, spekulatív), szektoron belüli rangsor, 27-féle figyelmeztetés és erősség, vállalat-összehasonlítás, figyelőlista, nyers pénzügyi kimutatások CSV/JSON letöltéssel. Bankokra, biztosítókra és REIT-ekre külön mérce vonatkozik.

A teljes adatsablon és a pontozás minden küszöbértéke: **[`docs/SABLON.md`](docs/SABLON.md)** (a kódból generálva).

## Felépítés

```
index.html                    egyoldalas webalkalmazás (keretrendszer nélkül)
assets/css/style.css          üveghatású, kékes-fekete dizájn (mobil, tablet, laptop)
assets/img/                   logó és illusztráció
assets/js/app.js              felület: lista, cégoldal, összehasonlítás, módszertan
assets/js/scoring.js          elemzőmotor (böngészőben és Node-ban is fut)
assets/js/charts.js           grafikonok
assets/js/i18n/               nyelvi fájlok: en (alapértelmezett), hu, de, fr, es
data/index.json               kereső lista pontszámokkal
data/companies/*.json         vállalatonként a sablonba illesztett adatok
scripts/update-data.mjs       adatletöltő (SEC EDGAR + Nasdaq + árfolyam-előzmények)
scripts/sec-parse.mjs         SEC XBRL → sablon (éves, TTM, legfrissebb mérleg)
scripts/sectors.mjs           SIC-kód → szektor és elemzési profil
scripts/market.mjs            árfolyam, piaci kapitalizáció, havi árfolyam-előzmények
scripts/gen-docs.mjs          docs/SABLON.md generálása
tests/                        tesztek (npm test)
```

## Helyi futtatás

```bash
npm start        # http://localhost:8000
npm test
npm run docs     # docs/SABLON.md újragenerálása
```

## Adatfrissítés

```bash
SEC_USER_AGENT="Név email@cim.hu" npm run update-data                 # minden Nasdaq-vállalat (~40–70 perc)
SEC_USER_AGENT="..." node scripts/update-data.mjs --tickers AAPL,MSFT
node scripts/update-data.mjs --skip-prices                             # árfolyam-előzmények nélkül
npm run build-index                                                    # csak az index újraszámolása
```

Az árfolyam- és piaci adatok (Nasdaq, Yahoo Finance, Stooq) opcionálisak: ha egy forrás nem érhető el, az értékeltség és a piaci kockázat kimarad, a többi szempont változatlanul számolódik.

## Online közzététel (GitHub Pages)

A `.github/workflows/deploy.yml` minden `main`-re pusholáskor közzéteszi az oldalt, hétfőnként pedig frissíti az adatokat.

1. **Settings → Pages → Source: GitHub Actions**
2. **Settings → Secrets and variables → Actions → New repository secret:** `SEC_USER_AGENT` = `Név email@cim.hu`
3. **Actions → „Adatfrissítés és közzététel” → Run workflow**

Az oldal címe: `https://m1ksaaa.github.io/Banana/`

> Az értékelések múltbeli, nyilvános pénzügyi adatokon alapulnak, és nem minősülnek befektetési tanácsnak.
