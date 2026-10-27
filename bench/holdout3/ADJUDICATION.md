# Holdout 3 adjudication

Inputs: `labels_A.json`, `labels_B.json` (18 queries k01-k18, 162 rows k001-k162). Output: `qrels.json`.

## Agreement

- All query x row pairs (absent = 0): 2916 pairs, 2883 identical = **98.9%**.
- Pairs labelled > 0 by at least one annotator: 198, 165 identical = **83.3%**.
- Cohen's kappa (unweighted, grades 0-3, all pairs): **0.908**. Quadratic-weighted kappa: **0.980**.
- Confusion (rows = A, cols = B, grades 0..3): `[[2718,14,3,0],[4,27,7,0],[1,3,28,1],[0,0,0,110]]`.

## Merge rules applied

- Equal: kept (165 labelled pairs).
- |A-B| = 1, not 0-vs-1: round-half-up of the mean, so 1/2 -> 2 and 2/3 -> 3 (11 pairs).
- 0-vs-1: decided; 0 only if plainly off-intent (18 pairs; all resolved to 1, none was plainly off-intent).
- |A-B| >= 2: adjudicated from intent and row (4 pairs).

## Adjudicated cases (|A-B| >= 2)

| Query | Row | A | B | Final | Reason |
|---|---|---|---|---|---|
| k10 postdocs | k010 Research Fellow, Belfer Center @ Harvard | 2 | 0 | 2 | Belfer research fellowships are postdoc-level appointments; closely related role. |
| k10 postdocs | k030 Research Assistant Professor @ CMU | 0 | 2 | 2 | Junior research-track faculty, the step right after a postdoc: adjacent seniority. |
| k14 utilities | k033 Program Manager, Office of Electricity @ DOE | 0 | 2 | 2 | Federal grid/electricity-delivery office; closely related to utility work, same footing as k036 (NREL grid integration, merged 2). |
| k14 utilities | k158 Credit Analyst, Public Utilities @ Moody's | 0 | 2 | 2 | Title is utility-sector coverage; works on utilities, not at one or a regulator. |

## 0-vs-1 decisions (all -> 1)

| Query | Row | Why marginal, not off-intent |
|---|---|---|
| k01, k09 | k031 Program Manager, Graham Sustainability Institute @ UMich | Program role at an institute that runs internal grant programs; not a foundation. |
| k01, k09 | k033 Program Manager, Office of Electricity @ DOE | DOE program managers run funding programs; public funder, not a foundation. |
| k04 doe | k015 PI @ MIT | Note: "PI on our DOE grant"; DOE grantee, not DOE staff. |
| k08 energy newspaper | k094 (blank title) @ Detroit Free Press | Unknown role at a newspaper; may be newsroom staff. |
| k10 postdocs | k014 Principal Research Scientist @ MIT | Academic research, far above postdoc level. |
| k10 postdocs | k022 Senior Research Scholar @ Columbia | Academic research staff, senior. |
| k10 postdocs | k055 Senior Fellow @ Brookings | Think-tank fellow; consistent with k057 (Fellow @ RFF, both 1). |
| k11 legislative aides | k049 Analyst @ Congressional Research Service | Legislative-branch staff supporting members. |
| k12 superintendant | k121 Senior Project Manager @ Skanska | Construction site management, related field. |
| k14 utilities | k035 Policy Advisor, EERE @ DOE | Energy policy, not utility-specific. |
| k14 utilities | k080 Executive Director @ Elevate Energy | Nonprofit running utility efficiency programs; related field. |
| k14 utilities | k150 MD, Energy Investment Banking @ J.P. Morgan | Energy finance, covers utilities. |
| k14 utilities | k161 Energy Transition Research Analyst @ Citi | Energy-sector research, related field. |
| k17 grid modernization engineer | k113 Data Analyst @ GridPoint Analytics | Company-only match on a role query (scale: 1). |
| k18 chief of staff | k038 Communications Director @ Michigan House | Senior legislative staff, related field. |
| k18 chief of staff | k051 Legislative Correspondent @ U.S. Senate | Legislative office staff, related field. |

## Rounded pairs (|A-B| = 1)

k01/k078 2/1->2; k03/k014 1/2->2; k08/k097 1/2->2; k09/k074 2/3->3; k10/k012 1/2->2; k10/k016 1/2->2;
k10/k027 1/2->2; k11/k041 2/1->2; k14/k036 1/2->2; k14/k108 1/2->2; k17/k103 2/1->2.

## Result

Grade distribution in `qrels.json`: 3 = 111, 2 = 42, 1 = 45 (198 labelled pairs). Every query has at least
one grade-3 row. Thinnest: k02, k07, k16 (3s only, no 2s/1s); k12 (2 x grade 3, 1 x grade 1).
