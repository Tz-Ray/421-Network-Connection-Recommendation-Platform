# Holdout 4 adjudication

Inputs: `labels_A.json`, `labels_B.json`, `connections.json`, `queries.json` (this folder only).
Output: `qrels.json` (grades 1-3; absent = 0). Scale per the grade scale in `bench/README.md`.

## Merge rule

- A == B: kept.
- |A-B| = 1 with both >= 1: round-half-up of the mean (1/2 -> 2, 2/3 -> 3).
- 0 vs 1: 1 unless the row is plainly off-intent (decided per pair below).
- |A-B| >= 2: adjudicated per the brief's scale (table below).
- Every query keeps at least one grade-2/3 row (checked by the merge script).

## Agreement

- Judged pairs (union of both files): 314
- Exact agreement: 193 (61.5%)
- Off by one: 94 (of which 65 were 0-vs-1)
- Off by two or more: 27 (8.6%) -> adjudicated
- Within one grade: 287 (91.4%)

## |A-B| >= 2 adjudications (27)

| Query | Row | A | B | Final | Reason |
|---|---|---|---|---|---|
| m01 store manager | m058 Area Manager, Nando's | 2 | 0 | 1 | Multi-site restaurant role; intent excludes district-level roles and is retail. Related field only. |
| m03 gm | m048 Hotel Manager, Accor | 0 | 2 | 2 | Runs a hotel unit; closely related to hotel GM. |
| m03 gm | m057 Restaurant Manager, Chipotle | 2 | 0 | 2 | Runs a restaurant unit; closely related to restaurant GM (same treatment as m048). |
| m05 3pl | m160 (no title), Kuehne+Nagel | 3 | 1 | 2 | At a named 3PL, but role unknown; intent prefers account/ops roles. |
| m12 open a restaurant | m058 Area Manager, Nando's | 0 | 2 | 2 | Multi-site restaurant operating experience. |
| m12 open a restaurant | m067 Operations Manager, The Ivy Collection | 0 | 2 | 2 | Restaurant group operations. |
| m12 open a restaurant | m071 VP Operations, Chipotle | 0 | 2 | 2 | Restaurant operations executive. |
| m12 open a restaurant | m161 Chef (no company) | 0 | 2 | 2 | Intent lists chefs; employer unknown, so not 3. |
| m13 warehouse automation | m098 Cold Storage Site Lead, Lineage | 0 | 2 | 1 | Warehouse operator, no automation signal. |
| m14 buyers | m105 Procurement Specialist, General Motors | 2 | 0 | 1 | Buying function but automotive, outside retail/CPG/food-service. |
| m15 resturant manager | m055 Owner / Chef, Osteria Bianchi | 0 | 2 | 2 | Owner-operator runs the restaurant. |
| m15 resturant manager | m063 Founder, Taqueria El Sol | 0 | 2 | 2 | Restaurant founder/operator. |
| m15 resturant manager | m069 Owner, Pho Saigon Kitchen | 0 | 2 | 2 | Restaurant owner/operator. |
| m15 resturant manager | m119 Franchisee / Owner-Operator, McDonald's | 0 | 2 | 2 | Operates six restaurants. |
| m15 resturant manager | m123 Franchise Partner, Costa Coffee | 0 | 2 | 1 | Coffee-shop franchise; other hospitality management = partial. |
| m16 hospitality | m058 Area Manager, Nando's | 0 | 3 | 3 | Restaurants are hospitality. |
| m16 hospitality | m064 District Manager, Aramark | 0 | 3 | 3 | Contract catering explicitly in intent (cf. m053 Compass = 3/3). |
| m16 hospitality | m068 Shop Manager, Pret A Manger | 0 | 3 | 3 | Food-service cafe chain. |
| m16 hospitality | m122 Head of Franchise Recruitment, Franchise Brands plc | 0 | 2 | 1 | Franchising, not a hospitality employer. |
| m16 hospitality | m136 Senior Data Scientist, Deliveroo | 1 | 3 | 2 | Hospitality-tech company, non-hospitality function. |
| m16 hospitality | m156 CFO, Greene King | 0 | 3 | 3 | Pub company; consistent with m044 CFO Marriott and m054 FD Compass (both 3/3). |
| m16 hospitality | m158 (no title), Marriott | 0 | 2 | 2 | Hospitality employer, role unknown. |
| m16 hospitality | m161 Chef (no company) | 0 | 2 | 2 | Chef role, employer unknown. |
| m17 logistics | m007 E-commerce Operations Lead, Zalando | 0 | 2 | 1 | E-commerce ops, adjacent to logistics. |
| m17 logistics | m013 Head of E-Commerce Operations, ASOS | 0 | 2 | 1 | Same as m007. |
| m17 logistics | m033 Demand Planner, Nestle | 0 | 2 | 2 | Supply chain planning is in intent. |
| m17 logistics | m138 Software Engineer, project44 | 0 | 2 | 2 | Logistics-tech company (cf. m144 Samsara = 2/2). |

## 0-vs-1 decisions (65)

Set to **0** (plainly off-intent), 4 pairs:

- m01 store manager: m048 Hotel Manager (Accor), m070 Hotel GM (Radisson). Intent is retail stores; hotels are not stores.
- m03 gm: m158 (no title, Marriott). No role evidence of a GM.
- m04 f&b: m158 (no title, Marriott). No role evidence of F&B.

Set to **1**, 61 pairs, all "related field / partial" per the intent text:

- m03 m012 (Store Director, GM-equivalent); m04 m124, m129, m161 (food-service roles, secondary per intent); m05 m088 (haulage MD).
- m06 m146, m147, m150, m152, m153 (accounting/finance field, not CFO).
- m07 m007, m008, m076, m086 (operations function, lower seniority; same as existing 1/1 ops managers).
- m08 m048, m056, m081 (non-Marriott, non-hotel-GM or GM outside hotels); m09 m016, m098 (logistics/site roles, not DHL warehouse).
- m12 m042, m049, m064, m066 (F&B / food-service ops); m111, m112, m113, m114, m115, m117 (trades and property agents usable for a fit-out); m126, m130 (food-service suppliers).
- m13 m014, m074, m076 (warehouse ops, no automation); m138 (supply-chain software).
- m15 m041, m045, m046, m047, m053, m060, m061, m064, m066, m068, m120, m121, m124, m128, m137 (other hospitality managers are partial per intent).
- m17 m030, m031, m034, m100, m101, m104 (manufacturing, adjacent to supply chain); m126, m130 (food-service distribution).
- m18 m014, m126, m130 (warehousing / food distribution with possible chilled exposure).

## Result

- Grade distribution: 3 = 158, 2 = 52, 1 = 100 (310 labelled pairs; 4 pairs merged to 0).
- Per query (1/2/3): m01 1/1/7, m02 2/0/5, m03 1/3/5, m04 6/2/3, m05 3/5/13, m06 5/1/2, m07 9/6/4,
  m08 9/0/1, m09 8/0/2, m10 0/0/4, m11 0/0/2, m12 16/11/11, m13 5/2/6, m14 1/1/6, m15 20/6/2,
  m16 1/9/47, m17 10/5/34, m18 3/0/4.
