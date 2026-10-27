# TeraStockX adatsablon és elemzési módszertan (v2.0.0)

> Ez a fájl automatikusan készül a kódból (`npm run docs`), ezért mindig pontosan az elemzőmotor aktuális működését írja le.

```
SEC EDGAR (10-K, 10-Q, 20-F)  ─┐
Nasdaq (lista, árfolyam)       ├─▶  sablon JSON  ─▶  elemzőmotor  ─▶  weboldal (5 nyelv)
Yahoo / Stooq (árfolyam-előzm.)┘    data/companies/   assets/js/scoring.js
```

## 1. A vállalat adatfájlja – `data/companies/<TICKER>.json` (schemaVersion 2)

| Mező | Leírás |
|---|---|
| `ticker`, `name`, `exchange`, `cik` | Azonosítók (CIK: SEC-azonosító, 10 jegy). |
| `sicCode`, `sicDescription` | SEC iparági kód és leírás. |
| `sector` | Szektorkulcs (technology, healthcare, financials, realEstate, …) – a SIC-kódból képezve. |
| `industry` | Iparág (Nasdaq-besorolás, ennek hiányában SIC-leírás). |
| `profile` | Elemzési profil: `general`, `financial` (SIC 6000–6799), `realEstate` (SIC 65xx, 6798). |
| `fiscalYearEndMonth` | Az üzleti év zárásának hónapja. |
| `market` | `price`, `priceDate`, `marketCap`, `sharesOutstanding` (fedőlapi részvényszám), forrás. |
| `prices` | Havi, osztalékkal/felosztással korrigált záróárak (legfeljebb 10 év): `[["ÉÉÉÉ-HH", ár], …]`. |
| `annual[]` | Üzleti évenkénti adatok (legfeljebb 10 év) – lásd lent. |
| `ttm` | Utolsó 12 hónap (TTM) eredmény- és cash flow-adatai. |
| `latestBalance` | Mérleg a legutóbbi negyedév végén. |
| `source`, `demo` | Adatforrás és letöltés ideje; `demo: true` = közelítő mintaadat. |

Minden összeg **USD-ben, egész dollárban**. A hiányzó adat `null`.

### Eredménykimutatás és cash flow (időszaki adatok)

| Mező | Megnevezés | XBRL-címkék prioritási sorrendben |
|---|---|---|
| `revenue` | Árbevétel | Revenues, RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, SalesRevenueNet, SalesRevenueGoodsNet, SalesRevenueServicesNet, RevenuesNetOfInterestExpense, InterestAndDividendIncomeOperating |
| `costOfRevenue` | Közvetlen költségek | CostOfRevenue, CostOfGoodsAndServicesSold, CostOfGoodsSold, CostOfServices |
| `grossProfit` | Bruttó eredmény | GrossProfit |
| `researchAndDevelopment` | Kutatás-fejlesztés | ResearchAndDevelopmentExpense, ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost |
| `operatingIncome` | Üzemi eredmény (EBIT) | OperatingIncomeLoss |
| `interestExpense` | Kamatráfordítás | InterestExpense, InterestExpenseNonoperating, InterestExpenseDebt, InterestAndDebtExpense |
| `pretaxIncome` | Adózás előtti eredmény | IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest, IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments, IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic |
| `incomeTaxExpense` | Társasági adó | IncomeTaxExpenseBenefit |
| `netIncome` | Nettó eredmény | NetIncomeLoss, ProfitLoss, NetIncomeLossAvailableToCommonStockholdersBasic |
| `depreciationAndAmortization` | Értékcsökkenés és amortizáció | DepreciationDepletionAndAmortization, DepreciationAmortizationAndAccretionNet, DepreciationAndAmortization, Depreciation |
| `shareBasedCompensation` | Részvényalapú juttatás | ShareBasedCompensation, AllocatedShareBasedCompensationExpense |
| `operatingCashFlow` | Működési cash flow | NetCashProvidedByUsedInOperatingActivities, NetCashProvidedByUsedInOperatingActivitiesContinuingOperations |
| `capex` | Beruházások (CapEx) | PaymentsToAcquirePropertyPlantAndEquipment, PaymentsToAcquireProductiveAssets, PaymentsForCapitalImprovements |
| `dividendsPaid` | Kifizetett osztalék | PaymentsOfDividends, PaymentsOfDividendsCommonStock |
| `buybacks` | Részvény-visszavásárlás | PaymentsForRepurchaseOfCommonStock, PaymentsForRepurchaseOfEquity |
| `epsDiluted` | EPS, hígított ($) | EarningsPerShareDiluted, EarningsPerShareBasicAndDiluted, EarningsPerShareBasic |
| `sharesDiluted` | Hígított részvényszám (súlyozott) | WeightedAverageNumberOfDilutedSharesOutstanding, … |
| `grossProfit` | (ha hiányzik) | árbevétel − közvetlen költségek |
| `freeCashFlow` | Szabad cash flow | működési cash flow − beruházások |

### Mérleg (fordulónapi adatok)

| Mező | Megnevezés | XBRL-címkék |
|---|---|---|
| `totalAssets` | Mérlegfőösszeg | Assets |
| `totalLiabilities` | Összes kötelezettség | Liabilities |
| `currentAssets` | Forgóeszközök | AssetsCurrent |
| `currentLiabilities` | Rövid lejáratú kötelezettségek | LiabilitiesCurrent |
| `cash` | Pénzeszközök | CashAndCashEquivalentsAtCarryingValue, CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents, CashAndDueFromBanks, Cash |
| `inventory` | Készletek | InventoryNet, InventoryFinishedGoodsNetOfReserves |
| `accountsReceivable` | Vevőkövetelések | AccountsReceivableNetCurrent, ReceivablesNetCurrent |
| `goodwill` | Goodwill | Goodwill |
| `intangibleAssets` | Immateriális javak | IntangibleAssetsNetExcludingGoodwill, FiniteLivedIntangibleAssetsNet |
| `equity` | Saját tőke | StockholdersEquity, StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest |
| `retainedEarnings` | Eredménytartalék | RetainedEarningsAccumulatedDeficit |
| `totalDebt` | Pénzügyi adósság | LongTermDebtNoncurrent + LongTermDebtCurrent + CommercialPaper + ShortTermBorrowings; bontás hiányában LongTermDebt |
| `sharesOutstanding` | Forgalomban lévő részvények | CommonStockSharesOutstanding |

### Adatkiválasztási szabályok

1. Éves adat csak éves jelentésből (10-K, 10-K/A, 20-F, 40-F) és csak 340–390 napos időszakra számít – a jelentésekben szereplő negyedéves bontás így kiesik.
2. Ha egy időszakra több érték van, a magasabb prioritású címke, azon belül a **legkésőbb benyújtott** (helyesbített) érték nyer.
3. A címkéket évek között összefésüljük (a cégek idővel címkét váltanak, pl. SalesRevenueNet → RevenueFromContractWithCustomer…).
4. Mérlegadatnál legfeljebb 7 nap eltérés megengedett a fordulónaptól (52/53 hetes üzleti év).
5. **TTM** = utolsó üzleti év + tárgyévi halmozott (YTD) negyedéves adat − előző év azonos YTD-időszaka. Ha nincs frissebb negyedéves jelentés, az éves adat érvényes.
6. Többosztályú részvényeknél a fedőlapi részvényszámok összeadódnak.

## 2. Pontozás

Minden mutatót lineárisan váltunk 0–100 pontra a „0 pont” és „100 pont” érték között, azon kívül vágva. Egy szempont pontszáma a mutatók súlyozott átlaga; hiányzó mutató kimarad, a többi súlya arányosan nő. Az értékeltség a TTM-adatokon alapul (ha elérhető), a többi szempont az auditált éves adatokon. A hosszú távú mutatók legfeljebb az utolsó 6 üzleti évet (5 év változást) veszik figyelembe.

### Jövedelmezőség

Milyen hatékonyan alakítja a vállalat az árbevételt és a tőkét nyereséggé?

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Bruttó árrés | Bruttó eredmény / árbevétel. | 10% | 60% | 15% |
| Üzemi árrés | Üzemi eredmény (EBIT) / árbevétel. | 0% | 30% | 25% |
| Nettó árrés | Nettó eredmény / árbevétel. | -5% | 20% | 15% |
| Befektetett tőke megtérülése (ROIC) | NOPAT (EBIT × (1 − effektív adókulcs)) / átlagos befektetett tőke (saját tőke + adósság − pénzeszközök). | 0% | 20% | 20% |
| Sajáttőke-arányos megtérülés (ROE) | Nettó eredmény / átlagos saját tőke. Negatív saját tőkénél nem pontozott. | 0% | 25% | 15% |
| Eszközarányos megtérülés (ROA) | Nettó eredmény / átlagos mérlegfőösszeg. | 0% | 15% | 10% |

**Pénzügyi profil (bankok, biztosítók):** 

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Nettó árrés | Nettó eredmény / árbevétel. | 0% | 30% | 25% |
| Sajáttőke-arányos megtérülés (ROE) | Nettó eredmény / átlagos saját tőke. Negatív saját tőkénél nem pontozott. | 2% | 16% | 45% |
| Eszközarányos megtérülés (ROA) | Nettó eredmény / átlagos mérlegfőösszeg. | 0,2% | 1,5% | 30% |

### Cash flow minősége

Mennyire áll valós pénzáram a kimutatott nyereség mögött?

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| FCF-árrés | Szabad cash flow (működési cash flow − beruházások) / árbevétel. | -5% | 20% | 35% |
| FCF-konverzió | Szabad cash flow / nettó eredmény. Veszteség mellett pozitív FCF 60 pontot ér. | 30% | 110,0% | 25% |
| Eredményhatárolási ráta | (Nettó eredmény − működési cash flow) / átlagos mérlegfőösszeg. Magas érték: a nyereség mögött nincs pénzáram. | 10% | -5% | 20% |
| Részvényalapú juttatás / árbevétel | Nem pénzbeli, a részvényeseket hígító juttatás. | 15% | 1% | 20% |

**Pénzügyi profil (bankok, biztosítók):** nem pontozott.

### Mérlegerő

Mekkora az eladósodottság az eredménytermelő képességhez és a saját tőkéhez képest?

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Adósság / saját tőke | Pénzügyi adósság / saját tőke. Negatív saját tőke 0 pont. | 2,5× | 0,3× | 20% |
| Nettó adósság / EBITDA | Hány évnyi EBITDA szükséges a nettó adósság visszafizetéséhez. Nettó készpénz 100 pont; negatív EBITDA melletti nettó adósság 0 pont. | 4× | 0× | 25% |
| Kamatfedezet | EBIT / kamatráfordítás. Kamatráfordítás nélkül 100 pont. | 1,5× | 15× | 20% |
| Altman Z''-pontszám | 6,56·(forgótőke/eszközök) + 3,26·(eredménytartalék/eszközök) + 6,72·(EBIT/eszközök) + 1,05·(saját tőke/kötelezettségek). < 1,1 veszélyzóna, > 2,6 biztonságos. | 1,1 | 4 | 20% |
| Sajáttőke-arány | Saját tőke / mérlegfőösszeg. | 10% | 60% | 15% |

**Pénzügyi profil (bankok, biztosítók):** 

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Sajáttőke-arány | Saját tőke / mérlegfőösszeg. | 4% | 14,0% | 60% |
| Adósság / saját tőke | Pénzügyi adósság / saját tőke. Negatív saját tőke 0 pont. | 4× | 0,5× | 40% |

**Ingatlanprofil (REIT-ek):** 

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Adósság / saját tőke | Pénzügyi adósság / saját tőke. Negatív saját tőke 0 pont. | 4× | 0,8× | 25% |
| Nettó adósság / EBITDA | Hány évnyi EBITDA szükséges a nettó adósság visszafizetéséhez. Nettó készpénz 100 pont; negatív EBITDA melletti nettó adósság 0 pont. | 10× | 4× | 35% |
| Kamatfedezet | EBIT / kamatráfordítás. Kamatráfordítás nélkül 100 pont. | 1,2× | 6× | 25% |
| Sajáttőke-arány | Saját tőke / mérlegfőösszeg. | 15% | 55,0% | 15% |

### Likviditás

Fedezik-e a rövid lejáratú eszközök a rövid lejáratú kötelezettségeket?

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Likviditási ráta | Forgóeszközök / rövid lejáratú kötelezettségek. | 0,6× | 2× | 40% |
| Gyorsráta | (Forgóeszközök − készletek) / rövid lejáratú kötelezettségek. | 0,4× | 1,5× | 35% |
| Pénzeszköz-ráta | Pénzeszközök / rövid lejáratú kötelezettségek. | 0,05× | 0,8× | 25% |

**Pénzügyi profil (bankok, biztosítók):** nem pontozott.

**Ingatlanprofil (REIT-ek):** nem pontozott.

### Növekedés (utolsó üzleti év)

Éves dinamika az árbevételben, az eredményben és a cash flow-ban.

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Árbevétel-növekedés (éves) | Változás az előző üzleti évhez képest. | -10% | +20% | 35% |
| Üzemi eredmény növekedése (éves) | Változás az előző üzleti évhez képest; negatív bázisról nem értelmezhető. | -25% | +30% | 20% |
| EPS-növekedés (éves) | Hígított egy részvényre jutó eredmény az előző évhez képest. Veszteséges utolsó év esetén 0 pont. | -25% | +30% | 25% |
| FCF-növekedés (éves) | Szabad cash flow az előző évhez képest. | -25% | +30% | 20% |

**Pénzügyi profil (bankok, biztosítók):** 

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Árbevétel-növekedés (éves) | Változás az előző üzleti évhez képest. | -10% | +15% | 45% |
| EPS-növekedés (éves) | Hígított egy részvényre jutó eredmény az előző évhez képest. Veszteséges utolsó év esetén 0 pont. | -25% | +25% | 55% |

### Hosszú távú növekedés

Átlagos éves növekedés legfeljebb öt év alatt.

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Árbevétel CAGR | Átlagos éves növekedési ütem legfeljebb öt év alatt. | -5% | +15% | 30% |
| EPS CAGR | A hígított EPS átlagos éves növekedése legfeljebb öt év alatt. | -10% | +20% | 25% |
| FCF CAGR | A szabad cash flow átlagos éves növekedése legfeljebb öt év alatt. | -10% | +20% | 15% |
| Egy részvényre jutó saját tőke CAGR | Az egy részvényre jutó saját tőke átlagos éves növekedése. | -5% | +15% | 15% |
| Árbevétel-növekedéses évek aránya | Az időszak azon éveinek aránya, amikor az árbevétel nőtt. | 0% | 100% | 15% |

**Pénzügyi profil (bankok, biztosítók):** 

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Árbevétel CAGR | Átlagos éves növekedési ütem legfeljebb öt év alatt. | -5% | +12% | 30% |
| EPS CAGR | A hígított EPS átlagos éves növekedése legfeljebb öt év alatt. | -10% | +15% | 30% |
| Egy részvényre jutó saját tőke CAGR | Az egy részvényre jutó saját tőke átlagos éves növekedése. | -5% | +12% | 25% |
| Árbevétel-növekedéses évek aránya | Az időszak azon éveinek aránya, amikor az árbevétel nőtt. | 0% | 100% | 15% |

### Kiszámíthatóság

Mennyire stabilak és ellenállóak az eredmények?

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Nyereséges évek aránya | Az időszak azon éveinek aránya, amikor a nettó eredmény pozitív volt. | 0% | 100% | 25% |
| Pozitív FCF-es évek aránya | Az időszak azon éveinek aránya, amikor a szabad cash flow pozitív volt. | 0% | 100% | 20% |
| Árbevétel-növekedés volatilitása | Az éves árbevétel-növekedés szórása. | 30% | 3% | 20% |
| Árrés-volatilitás | Az üzemi árrés szórása (pénzügyi vállalatoknál a nettó árrésé). | +10 pp | +1 pp | 15% |
| Piotroski F-pontszám | Kilenc bináris teszt a jövedelmezőségre, eladósodottságra, likviditásra és működési hatékonyságra (0–9). | 2 | 8 | 20% |

**Pénzügyi profil (bankok, biztosítók):** 

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Nyereséges évek aránya | Az időszak azon éveinek aránya, amikor a nettó eredmény pozitív volt. | 0% | 100% | 45% |
| Árbevétel-növekedés volatilitása | Az éves árbevétel-növekedés szórása. | 30% | 3% | 30% |
| Árrés-volatilitás | Az üzemi árrés szórása (pénzügyi vállalatoknál a nettó árrésé). | +15 pp | +2 pp | 25% |

### Tőkeallokáció

Hogyan juttatja vissza és fekteti be újra a tőkét a vállalat?

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Részvényszám éves változása | Pozitív = hígítás, negatív = részvény-visszavásárlás. | +5% | -3% | 35% |
| Osztalékkifizetés (FCF arányában) | Kifizetett osztalék / szabad cash flow. Osztalék hiányában nem pontozott. | 120% | 60% | 20% |
| Részvényesi hozam | (Osztalék + részvény-visszavásárlás, TTM) / piaci kapitalizáció. | 0% | 6% | 20% |
| ROIC változása | A ROIC változása az időszak első és utolsó éve között (százalékpont). | -10 pp | +10 pp | 25% |

**Pénzügyi profil (bankok, biztosítók):** 

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Részvényszám éves változása | Pozitív = hígítás, negatív = részvény-visszavásárlás. | +5% | -3% | 50% |
| Részvényesi hozam | (Osztalék + részvény-visszavásárlás, TTM) / piaci kapitalizáció. | 0% | 7,0% | 50% |

### Értékeltség

Mennyire drága a részvény a fundamentumokhoz képest?

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Árfolyam / nyereség (P/E) | Piaci kapitalizáció / nettó eredmény (TTM). Veszteség 0 pont. | 45× | 10× | 25% |
| EV / EBIT | Vállalatérték / üzemi eredmény (TTM). | 40× | 8× | 20% |
| FCF-hozam | Szabad cash flow (TTM) / piaci kapitalizáció. | 0% | 8% | 25% |
| Árfolyam / árbevétel (P/S) | Piaci kapitalizáció / árbevétel (TTM). | 15× | 1× | 10% |
| PEG-ráta | P/E osztva az EPS CAGR-rel (%-ban). Negatív növekedés vagy veszteség 0 pont. | 3 | 0,8 | 20% |

**Pénzügyi profil (bankok, biztosítók):** 

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Árfolyam / nyereség (P/E) | Piaci kapitalizáció / nettó eredmény (TTM). Veszteség 0 pont. | 25× | 8× | 50% |
| Árfolyam / könyv szerinti érték (P/B) | Piaci kapitalizáció / saját tőke. | 3× | 0,8× | 30% |
| PEG-ráta | P/E osztva az EPS CAGR-rel (%-ban). Negatív növekedés vagy veszteség 0 pont. | 3 | 0,8 | 20% |

**Ingatlanprofil (REIT-ek):** 

| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Árfolyam / FCF | Piaci kapitalizáció / szabad cash flow (TTM). | 35× | 10× | 40% |
| Árfolyam / könyv szerinti érték (P/B) | Piaci kapitalizáció / saját tőke. | 3× | 0,8× | 30% |
| EV / EBITDA | Vállalatérték / EBITDA (TTM). | 30× | 10× | 30% |

### Piaci kockázat



| Mutató | Képlet | 0 pont | 100 pont | Súly |
|---|---|---|---|---|
| Volatilitás (évesített) | A havi log-hozamok szórása 36 hónapra × √12. | 70% | 15% | 60% |
| Legnagyobb visszaesés (5 év) | Az árfolyam legnagyobb csúcstól mélypontig tartó esése. | -80% | -20% | 40% |


### Különleges esetek

- Negatív saját tőkénél a ROE nem pontozott, az adósság/saját tőke 0 pont.
- Kamatráfordítás nélkül a kamatfedezet 100 pont; nettó készpénz esetén a nettó adósság/EBITDA 100 pont.
- Veszteséges utolsó év esetén az EPS-növekedés és az EPS CAGR 0 pont (negatív bázisról a növekedés nem értelmezhető).
- Osztalék nélkül a kifizetési arány nem pontozott; az FCF-et meghaladó osztalék 0 pont.
- Veszteség esetén a P/E és a PEG 0 pont.

## 3. Összesítés

**TeraScore** – a kilenc fundamentális szempont súlyozott átlaga:

| Szempont | Súly |
|---|---|
| Jövedelmezőség | 15% |
| Cash flow minősége | 12% |
| Mérlegerő | 13% |
| Likviditás | 5% |
| Növekedés (utolsó üzleti év) | 8% |
| Hosszú távú növekedés | 14% |
| Kiszámíthatóság | 13% |
| Tőkeallokáció | 7% |
| Értékeltség | 13% |

**Kockázat** (alacsonyabb = jobb):

```
biztonság   = súlyozott átlag(Mérlegerő 30%, Likviditás 10%, Kiszámíthatóság 25%, Jövedelmezőség 15%, Cash flow minősége 20%)
              árfolyam-előzmény esetén: 75% × biztonság + 25% × piaci kockázati pontszám
Kockázat    = 100 − biztonság + 10 × kritikus jelzések + 4 × figyelmeztetések   (0–100 közé vágva)
```

**Minősítési sávok:** 80–100 Kiváló · 65–79 Erős · 45–64 Mérsékelt · 25–44 Gyenge · 0–24 Kritikus (kockázatnál fordítva: 0–20 nagyon alacsony … 76–100 nagyon magas). A szín mellett mindig szöveges minősítés is megjelenik.

## 4. Csődkockázat, trend, befektetési profil

Pontok: Altman Z'' veszélyzóna +3 / szürke zóna +1; negatív saját tőke pozitív FCF nélkül +2; negatív FCF +1; nettó veszteség +1; 1,5× alatti kamatfedezet +2; nettó adósság pozitív EBITDA nélkül +1; 5% alatti sajáttőke-arány (pénzügyi profil) +2. 2–3 pont = emelkedett, 4+ = magas.

**Hosszú távú trend:** 70% hosszú távú növekedés + 30% utolsó éves növekedés, az üzemi árrés trendjével legfeljebb ±5 ponttal korrigálva. ≥ 65 javuló, 40–64 stagnáló, < 40 romló. A múltat írja le, nem előrejelzés.

**Befektetési profil:** Minőségi: jövedelmezőség ≥ 70, kiszámíthatóság ≥ 70, mérlegerő ≥ 60, nincs kritikus jelzés. Növekedési: hosszú távú növekedés ≥ 70. Érték: értékeltség ≥ 65. Osztalék: ≥ 2% FCF-fel fedezett osztalékhozam. Spekulatív: kritikus jelzés vagy veszteség az évek többségében.

**Szektor-összehasonlítás:** Minden pontszám a szektor összes elemzett vállalatához viszonyított rangsorban (percentilis) is megjelenik.

## 5. Jelzések (32)

| Azonosító | Jelzés | Leírás |
|---|---|---|
| `negativeEquity` | Negatív saját tőke | A kötelezettségek meghaladják az eszközöket. Agresszív részvény-visszavásárlás is okozhatja, de gyakran pénzügyi feszültségre utal. |
| `persistentLosses` | Tartós veszteség | Legalább két egymást követő üzleti évben nettó veszteség. |
| `lossLastYear` | Veszteség az utolsó évben | A legutóbbi üzleti év nettó veszteséggel zárult. |
| `negativeFcf` | Negatív szabad cash flow | A működés és a beruházások több pénzt emésztenek fel, mint amennyit termelnek; külső finanszírozás szükséges. |
| `lowCurrentRatio` | 1,0 alatti likviditási ráta | A rövid lejáratú kötelezettségek meghaladják a forgóeszközöket (likviditási ráta: ‹value›). Erős működési cash flow mellett kezelhető. |
| `interestCoverageCritical` | Elégtelen kamatfedezet | A kamatfedezet csupán ‹value› – az adósságszolgálat veszélyben van. |
| `interestCoverageWeak` | Gyenge kamatfedezet | A kamatfedezet csupán ‹value› (EBIT / kamatráfordítás). |
| `altmanDistress` | Altman Z'' veszélyzónában | A Z''-pontszám (‹value›) az 1,1-es csődküszöb alatt van. |
| `altmanGrey` | Altman Z'' szürke zónában | A Z''-pontszám ‹value›: nem veszélyes, de nem is a biztonságos (> 2,6) tartomány. |
| `debtWithoutEbitda` | Nettó adósság pozitív EBITDA nélkül | A vállalatnak nettó adóssága van, de nem termel pozitív EBITDA-t annak kiszolgálására. |
| `highLeverage` | Magas eladósodottság | Nettó adósság / EBITDA: ‹value›. |
| `revenueDecline` | Jelentős árbevétel-csökkenés | Az árbevétel éves változása ‹value›. |
| `heavyDilution` | Erős részvényhígítás | A részvényszám éves átlagos változása: ‹value›. |
| `highSbc` | Magas részvényalapú juttatás | Részvényalapú juttatás / árbevétel: ‹value›. |
| `lowEarningsQuality` | Gyenge eredményminőség | Eredményhatárolási ráta ‹value›: a nyereség jelentősen meghaladja a működési cash flow-t. |
| `dividendUncovered` | Az osztalékot nem fedezi az FCF | A kifizetett osztalék meghaladja a szabad cash flow-t (kifizetési arány: ‹value›). |
| `goodwillHeavy` | Magas goodwill és immateriális javak | Goodwill és immateriális javak a mérlegfőösszeg arányában: ‹value›; értékvesztési kockázatnak kitett. |
| `staleData` | Elavult pénzügyi adatok | A legutóbbi éves jelentés fordulónapja: ‹value›. |
| `deepDrawdown` | Mély árfolyamesés | Legnagyobb árfolyamesés az ötéves csúcshoz képest: ‹value›. |
| `bankruptcyFiling` | Csőd- vagy felszámolási eljárás | 8-K bejelentés 1.03-as pontja, benyújtva: ‹value›. |
| `restatement` | Pénzügyi kimutatások helyesbítése | 8-K bejelentés 4.02-es pontja (a korábban közzétett kimutatások nem megbízhatók), benyújtva: ‹value›. |
| `debtAcceleration` | Adósság lejáratának előrehozása | 8-K bejelentés 2.04-es pontja (pénzügyi kötelezettség esedékessé válása), benyújtva: ‹value›. |
| `delistingNotice` | Tőzsdei kivezetési figyelmeztetés | 8-K bejelentés 3.01-es pontja (tőzsdei szabály megsértése), benyújtva: ‹value›. |
| `auditorChange` | Könyvvizsgáló-váltás | 8-K bejelentés 4.01-es pontja, benyújtva: ‹value›. |
| `netCash` | Nettó készpénz-pozíció | A pénzeszközök a pénzügyi adósságot ‹value› összeggel haladják meg. |
| `highMargin` | Magas üzemi árrés | Az üzemi árrés ‹value›. |
| `highRoic` | Magas befektetett tőke megtérülés | A ROIC ‹value›, jóval a szokásos tőkeköltség felett. |
| `alwaysProfitable` | Minden vizsgált évben nyereséges | Mind a(z) ‹years› üzleti évben pozitív nettó eredmény. |
| `strongGrowth` | Erős hosszú távú növekedés | Árbevétel CAGR: ‹value›. |
| `buybacks` | Nettó részvény-visszavásárlás | A részvényszám éves átlagos változása: ‹value›. |
| `altmanSafe` | Altman Z'' biztonságos zónában | Z''-pontszám: ‹value›. |
| `strongCashConversion` | Erős cash-konverzió | FCF-konverzió (szabad cash flow / nettó eredmény): ‹value›. |

## 6. Korlátok

A pontszámok kizárólag a közzétett pénzügyi adatokon és a piaci árfolyamokon alapulnak. Nem veszik figyelembe a menedzsment minőségét, a versenyhelyzetet, a híreket és a vállalati előrejelzéseket. Nem befektetési tanács.
