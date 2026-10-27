# TeraStockX elemzési sablon (v1)

Ez a dokumentum írja le pontosan, hogyan kerül egy cég az oldalra. Minden cégnél ugyanaz a három lépés történik:

```
 Nyers adatok (SEC 10-K)  →  Sablon JSON  →  Elemzőmotor  →  Megjelenítés
 data.sec.gov                data/companies/   assets/js/      index.html
                             <TICKER>.json     scoring.js
```

1. **Adatgyűjtés**: a `scripts/update-data.mjs` letölti a NASDAQ összes részvényének listáját, majd minden céghez a SEC EDGAR hivatalos éves (10-K / 20-F) XBRL adatait.
2. **Sablonba illesztés**: a `scripts/sec-parse.mjs` a különféle XBRL címkéket egységes mezőkre fordítja (lásd 1. rész), és a cég fájlját `data/companies/<TICKER>.json` néven menti.
3. **Elemzés**: az `assets/js/scoring.js` a sablonból mutatókat számol, 0–100 pontra skáláz, és szöveges magyarázatot ír (lásd 2–5. rész). Ugyanez a kód fut a böngészőben és a frissítő scriptben.

---

## 1. A cég adatfájlja (`data/companies/<TICKER>.json`)

### Fejléc

| Mező | Típus | Leírás |
|---|---|---|
| `schemaVersion` | szám | A sablon verziója, jelenleg `1`. |
| `ticker` | szöveg | Tőzsdei kód, pl. `AAPL`. |
| `name` | szöveg | A cég neve. |
| `exchange` | szöveg | `NASDAQ`. |
| `cik` | szöveg / null | SEC azonosító, 10 jegyre kiegészítve. |
| `sector` | szöveg / null | Iparág (SEC SIC leírás). |
| `currency` | szöveg | Pénznem, `USD`. |
| `fiscalYearEndMonth` | szám / null | A pénzügyi év zárásának hónapja (1–12). |
| `demo` | logikai | `true`, ha közelítő minta adat (nem hivatalos letöltés). |
| `source` | objektum / null | `{ name, url, retrieved }` – honnan és mikor jött az adat. |
| `note` | szöveg | Opcionális megjegyzés, ha nincs adat. |
| `annual` | tömb | Éves adatok, évenként egy objektum (lásd lent), legfeljebb 10 év. |

### Éves adatok (`annual[]`)

Minden összeg **USD-ben, egész dollárban** (nem millióban). A hiányzó adat `null`.

| Mező | Magyar név | XBRL címkék (prioritási sorrendben) |
|---|---|---|
| `year` | Pénzügyi év | a periódus végének éve |
| `periodEnd` | Periódus vége | `ÉÉÉÉ-HH-NN` |
| **Eredménykimutatás** | | |
| `revenue` | Bevétel | RevenueFromContractWithCustomerExcludingAssessedTax, Revenues, RevenueFromContractWithCustomerIncludingAssessedTax, SalesRevenueNet, SalesRevenueGoodsNet, RevenuesNetOfInterestExpense |
| `costOfRevenue` | Közvetlen költségek | CostOfRevenue, CostOfGoodsAndServicesSold, CostOfGoodsSold |
| `grossProfit` | Bruttó nyereség | GrossProfit; ha hiányzik: bevétel − közvetlen költségek |
| `researchAndDevelopment` | Kutatás-fejlesztés | ResearchAndDevelopmentExpense |
| `operatingIncome` | Működési eredmény | OperatingIncomeLoss |
| `interestExpense` | Kamatköltség | InterestExpense, InterestExpenseNonoperating, InterestExpenseDebt |
| `netIncome` | Nettó nyereség | NetIncomeLoss, ProfitLoss |
| `epsDiluted` | Hígított EPS ($/részvény) | EarningsPerShareDiluted, EarningsPerShareBasicAndDiluted, EarningsPerShareBasic |
| `sharesDiluted` | Hígított részvényszám (db) | WeightedAverageNumberOfDilutedSharesOutstanding |
| **Cash flow** | | |
| `operatingCashFlow` | Működési cash flow | NetCashProvidedByUsedInOperatingActivities |
| `capex` | Beruházások (pozitív szám) | PaymentsToAcquirePropertyPlantAndEquipment |
| `freeCashFlow` | Szabad cash flow | működési cash flow − beruházások |
| `dividendsPaid` | Kifizetett osztalék | PaymentsOfDividends, PaymentsOfDividendsCommonStock |
| **Mérleg (a pénzügyi év utolsó napján)** | | |
| `totalAssets` | Összes eszköz | Assets |
| `totalLiabilities` | Összes kötelezettség | Liabilities; ha hiányzik: eszközök − saját tőke |
| `currentAssets` | Forgóeszközök | AssetsCurrent |
| `currentLiabilities` | Rövid lejáratú kötelezettségek | LiabilitiesCurrent |
| `cash` | Készpénz | CashAndCashEquivalentsAtCarryingValue, CashCashEquivalentsRestrictedCash… |
| `totalDebt` | Pénzügyi adósság | LongTermDebtNoncurrent + LongTermDebtCurrent + CommercialPaper + ShortTermBorrowings; ha nincs bontás: LongTermDebt |
| `equity` | Saját tőke | StockholdersEquity |
| `retainedEarnings` | Eredménytartalék | RetainedEarningsAccumulatedDeficit |

**Szabályok az adatok kiválasztásához**

- Csak éves jelentés (`10-K`, `10-K/A`, `20-F`, `40-F`) számít; negyedéves adat nem.
- Eredmény- és cash flow tételeknél csak 340–390 napos periódus érvényes (így a jelentésben szereplő negyedéves bontás kiesik).
- Ha ugyanarra a periódusra több bejelentés van, a **legkésőbb beadott** (javított) érték nyer.
- Mérlegtételnél a periódus végével egyező, vagy attól legfeljebb 7 napra eső dátum fogadható el.

### Kereső lista (`data/index.json`)

```json
{ "generated": "ISO dátum", "engineVersion": "1.0.0", "count": 3300,
  "companies": [ { "t": "AAPL", "n": "Apple Inc.", "s": "Iparág", "y": 2024,
                   "sc": { "overall": 74, "operations": 100, "stability": 47, "growth1y": 46,
                           "longTerm": 77, "reliability": 88, "risk": 35 },
                   "d": "low", "cov": 95, "demo": true } ] }
```

Adat nélküli cégnél az `sc`, `y`, `d`, `cov` mezők hiányoznak.

---

## 2. Pontozás

Minden mutatót lineárisan váltunk 0–100 pontra: megadjuk, melyik érték ér **0 pontot** és melyik **100 pontot**; közte arányos, kívül vágva. Egy témakör pontszáma a tételek **súlyozott átlaga**; a hiányzó tétel kimarad, a többi súlya arányosan nő.

### Működés – „Mennyire nyereséges most?”

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Működési árrés | működési eredmény / bevétel | 0% | 30% | 30% |
| Nettó árrés | nettó nyereség / bevétel | −5% | 20% | 20% |
| ROE | nettó nyereség / átlagos saját tőke (negatív tőkénél kihagyva) | 0% | 25% | 20% |
| ROA | nettó nyereség / átlagos összes eszköz | 0% | 15% | 10% |
| Szabad cash flow árrés | szabad cash flow / bevétel | −5% | 20% | 20% |

### Pénzügyi stabilitás – „Sok-e az adósság, kibírja-e a nehéz időket?”

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Likviditási ráta | forgóeszközök / rövid lejáratú kötelezettségek | 0,6 | 2,0 | 15% |
| Adósság / saját tőke | pénzügyi adósság / saját tőke (negatív tőke = 0 pont) | 2,5 | 0,3 | 20% |
| Kamatfedezet | működési eredmény / kamatköltség (nincs kamat = 100 pont) | 1,5× | 15× | 15% |
| Nettó adósság / szabad cash flow | (adósság − készpénz) / szabad cash flow; nettó készpénz = 100, adósság pénztermelés nélkül = 0 | 8 év | 0,5 év | 25% |
| Altman Z'' | 6,56·FT/E + 3,26·ET/E + 6,72·ME/E + 1,05·ST/K | 1,1 | 4,0 | 25% |

(FT = forgótőke, E = összes eszköz, ET = eredménytartalék, ME = működési eredmény, ST = saját tőke, K = összes kötelezettség.)

### Fejlődés (utóbbi 1 év)

| Mutató | 0 pont | 100 pont | Súly |
|---|---|---|---|
| Bevétel változása | −10% | +20% | 40% |
| Nettó nyereség változása* | −25% | +30% | 30% |
| Szabad cash flow változása | −25% | +30% | 30% |

\* Ha az előző évi érték negatív vagy nulla, a százalékos változás nem értelmezhető (kihagyjuk). Ha a cég az utolsó évben veszteséges, ez a tétel 0 pont.

### Hosszú távú fejlődés (legfeljebb az utolsó 6 év)

| Mutató | 0 pont | 100 pont | Súly |
|---|---|---|---|
| Bevétel CAGR (évi átlagos növekedés) | −5% | +15% | 35% |
| Nettó nyereség CAGR* | −10% | +20% | 25% |
| Növekvő bevételű évek aránya | 0% | 100% | 20% |
| Működési árrés változása (első → utolsó év) | −10 pp | +10 pp | 20% |

Legalább 3 év adat kell (2 évnyi változás).

### Megbízhatóság – „Mennyire kiszámítható?”

| Mutató | 0 pont | 100 pont | Súly |
|---|---|---|---|
| Nyereséges évek aránya | 0% | 100% | 30% |
| Pozitív szabad cash flow-s évek aránya | 0% | 100% | 25% |
| Bevétel ingadozása (éves növekedés szórása) | 30% | 3% | 20% |
| Részvényszám éves változása (hígítás) | +5% | −2% | 10% |
| Piotroski F-pontszám (0–9) | 2 | 8 | 15% |

Piotroski tesztek (mindegyik 1 pont): ROA > 0; működési cash flow > 0; ROA javult; működési cash flow > nettó nyereség; adósság/eszköz nem nőtt; likviditási ráta javult; nem bocsátott ki új részvényt; bruttó árrés javult; eszközforgás javult. Ha egy teszt nem számolható, a többiből arányosan becsüljük (legalább 6 kell).

### Kockázat (alacsonyabb = jobb)

```
Kockázat = 100 − súlyozott átlag(stabilitás 45%, megbízhatóság 30%, működés 25%)
           + 10 × kritikus figyelmeztetések száma
           +  4 × egyéb figyelmeztetések száma          (0 és 100 közé vágva)
```

### TeraScore (összesített)

| Témakör | Súly |
|---|---|
| Működés | 20% |
| Pénzügyi stabilitás | 25% |
| Fejlődés (1 év) | 10% |
| Hosszú távú fejlődés | 20% |
| Megbízhatóság | 25% |

---

## 3. Minősítések (szín + szöveg)

| Pontszám | Minősítés | Kockázatnál | Szín |
|---|---|---|---|
| 80–100 | Kiváló | Nagyon alacsony (0–20) | zöld |
| 65–79 | Jó | Alacsony (21–35) | zöld |
| 45–64 | Közepes | Mérsékelt (36–55) | sárga |
| 25–44 | Gyenge | Magas (56–75) | narancs |
| 0–24 | Rossz | Nagyon magas (76–100) | piros |

A szín mellett mindig ott a szöveges minősítés is, így színtévesztők számára is egyértelmű.

---

## 4. Figyelmeztetések és erősségek

| Szint | Feltétel |
|---|---|
| Kritikus | Negatív saját tőke |
| Kritikus | Legalább 2 egymást követő veszteséges év |
| Figyelmeztetés | Veszteséges az utolsó évben |
| Figyelmeztetés | Negatív szabad cash flow |
| Figyelmeztetés | Likviditási ráta < 1 |
| Kritikus / Figyelm. | Kamatfedezet < 1,5× / < 3× |
| Kritikus / Figyelm. | Altman Z'' < 1,1 / 1,1–2,6 |
| Figyelmeztetés | Nettó adósság pénztermelés nélkül, vagy > 5 év szabad cash flow |
| Figyelmeztetés | Bevétel > 10%-os esése egy év alatt |
| Figyelmeztetés | Évi > 5% részvényhígítás |
| Erősség | Nettó készpénz pozíció; működési árrés > 25%; minden vizsgált évben nyereséges (≥ 4 év); bevétel CAGR > 10%; részvény-visszavásárlás (> 1%/év); Altman Z'' > 2,6 |

---

## 5. Csődkockázat és hosszú távú trend

**Csődkockázat** – pontok összege:

| Jel | Pont |
|---|---|
| Altman Z'' < 1,1 / 1,1–2,6 | +3 / +1 |
| Negatív saját tőke pozitív szabad cash flow nélkül | +2 |
| Negatív szabad cash flow | +1 |
| Veszteség az utolsó évben | +1 |
| Kamatfedezet < 1,5× | +2 |
| Nettó adósság pénztermelés nélkül | +1 |

0–1 pont: **Alacsony**, 2–3 pont: **Közepes**, 4+ pont: **Magas**.

**Hosszú távú trend** = 70% × hosszú távú fejlődés + 30% × egyéves fejlődés.
≥ 65: **Emelkedő**, 40–64: **Stagnáló**, < 40: **Csökkenő**. A múltbeli irányt írja le, nem jóslat.

**Adatlefedettség**: a 22 pontozott tételből hány volt kiszámolható – minél kisebb, annál óvatosabban kell kezelni az eredményt.

---

## 6. Ismert korlátok (a következő körökben csiszolhatók)

- Nem vesszük figyelembe a részvény árát (drága-e: P/E, P/S), mert a SEC nem közöl árfolyamot.
- Bankok, biztosítók és REIT-ek mérlegszerkezete eltér; náluk a likviditási és adóssági mutatók kevésbé értelmesek. Később iparág-specifikus sablon kell.
- A küszöbértékek minden iparágra azonosak; egy szoftvercég és egy kiskereskedő árrése természetesen eltér.
- A külföldi (20-F, IFRS) jelentések címkéi eltérhetnek, náluk gyakoribb a hiányos adat.
