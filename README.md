# TeraStockX

NASDAQ részvények közérthető pénzügyi elemzése. Kiválasztasz egy céget (pl. **AAPL**), és az oldal százalékokban mutatja meg:

- **Működés** – mennyire nyereséges most
- **Pénzügyi stabilitás** – sok-e az adósság a többi adathoz képest
- **Fejlődés (utóbbi 1 év)** és **Hosszú távú fejlődés**
- **Megbízhatóság** – mennyire kiszámítható
- **Kockázat** – mennyire veszélyes befektetni (alacsonyabb = jobb)
- **Csődkockázat** (alacsony / közepes / magas), **hosszú távú trend**, figyelmeztetések és erősségek
- Minden cég **nyers pénzügyi adatai** táblázatban, CSV / JSON letöltéssel

A pontos sablon és a számítási módszer: [`docs/SABLON.md`](docs/SABLON.md).

## Felépítés

```
index.html                 a weboldal (egyoldalas, keretrendszer nélkül)
assets/css/style.css       dizájn (világos + sötét mód)
assets/js/app.js           felület: lista, cégoldal, nyers adatok, módszertan
assets/js/scoring.js       elemzőmotor (böngészőben és Node-ban is fut)
data/index.json            kereső lista az összes céggel és pontszámaikkal
data/companies/*.json      cégenként a sablonba illesztett nyers adatok
scripts/update-data.mjs    letölti az összes NASDAQ cég adatát a SEC EDGAR-ból
scripts/sec-parse.mjs      SEC XBRL → sablon átalakítás
tests/                     tesztek (npm test)
```

## Helyi futtatás

```bash
npm start            # majd nyisd meg: http://localhost:8000
npm test
```

(Az `index.html` közvetlen megnyitása fájlként nem működik, mert a böngésző nem enged JSON-t betölteni `file://` alól.)

## Adatok frissítése

```bash
SEC_USER_AGENT="Neved email@cimed.hu" npm run update-data          # minden NASDAQ cég (~20–40 perc)
SEC_USER_AGENT="..." node scripts/update-data.mjs --tickers AAPL,MSFT
npm run build-index                                                   # csak az index újraszámolása
```

Jelenleg 3 cég (AAPL, MSFT, NVDA) **demó** adattal szerepel; az első frissítés lecseréli őket a hivatalos SEC adatokra, és hozzáadja a NASDAQ összes többi cégét.

## Online közzététel (GitHub Pages)

A `.github/workflows/deploy.yml` minden `main`-re pusholáskor közzéteszi az oldalt, hétfőnként pedig automatikusan frissíti az adatokat.

1. GitHub → **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → New repository secret**: `SEC_USER_AGENT` = `Neved email@cimed.hu` (a SEC ezt kéri az automatikus letöltésekhez).
3. **Actions → „Adatfrissítés és közzététel” → Run workflow** – az első teljes letöltés elindítása.

Az oldal ezután itt lesz elérhető: `https://m1ksaaa.github.io/Banana/`

> Az értékelések a múltbeli, nyilvános pénzügyi adatokon alapulnak, és nem minősülnek befektetési tanácsnak.
