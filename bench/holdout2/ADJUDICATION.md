# Holdout 2: label adjudication

Inputs: `labels_A.json`, `labels_B.json` (18 queries, 168 rows in `connections.json`). Output: `qrels.json` (same shape; absent = 0).

## Merge rule

- A = B: kept.
- |A-B| = 1 with both >= 1: round-half-up of the mean (1/2 -> 2, 2/3 -> 3). 6 pairs: h07 h088, h08 h022, h12 h017, h12 h152, h16 h157 -> 2; h12 h035 -> 3.
- 0 vs 1: decided by hand (0 only if plainly off-intent). 25 pairs; none was plainly off-intent, so all became 1.
- |A-B| >= 2: adjudicated from query intent + Position/Company/Note against the brief scale. 6 pairs.

## Agreement

| Measure | Value |
|---|---|
| Labeled pairs (union of A and B, absent = 0) | 219 |
| Exact agreement | 182 / 219 = 83.1% |
| Within one grade | 213 / 219 = 97.3% |
| Quadratic-weighted kappa, labeled pairs | 0.882 |
| Quadratic-weighted kappa, full pool (18 x 168 = 3024 pairs) | 0.975 (inflated by agreed zeros) |
| Disagreements | 37 (6 mechanical, 25 zero-vs-one, 6 two-plus) |

## Result

Grade distribution in `qrels.json`: 108 x 3, 33 x 2, 78 x 1 (219 judged rows). Every query keeps at least one grade-2/3 row.

## Adjudicated cases (31)

| Query | Row | Position @ Company | A | B | Final | Reason |
|---|---|---|---|---|---|---|
| h05 | h150 | Cloud Consultant @ IBM | 2 | 0 | **2** | (>=2 gap) Cloud Consultant is a plain Consultant, which the intent names as adjacent (grade 2) |
| h06 | h019 | Chair, Department of Family Medicine @ Mayo Clinic Health System | 0 | 2 | **1** | (>=2 gap) Department chair at a health system is clinical/academic leadership, not C-suite or VP; marginal |
| h06 | h071 | General Counsel @ Northbridge Health | 0 | 2 | **2** | (>=2 gap) General Counsel of a health system is an executive officer, but not a clinical/operational C-suite or VP title; clearly relevant, not exact |
| h06 | h107 | Department Chair, Anesthesiology @ University of Washington School of Medicine | 0 | 2 | **1** | (>=2 gap) Medical-school department chair is academic leadership, not a hospital C-suite/VP; marginal |
| h12 | h071 | General Counsel @ Northbridge Health | 0 | 2 | **2** | (>=2 gap) General Counsel of Northbridge Health sits on the health system's leadership team; clearly relevant for an intro, not a named leader title |
| h12 | h155 | Chief of Staff to the CMO @ (none) | 3 | 1 | **2** | (>=2 gap) Intent names chiefs of staff; Chief of Staff to the CMO sits next to a leader, but no hospital employer is stated, so not exact |
| h01 | h034 | Vice President, Patient Care Services @ CommonSpirit Health | 1 | 0 | **1** | VP Patient Care Services is nursing leadership, not a nurse manager; intent caps other nursing roles at marginal |
| h02 | h064 | Partner, Healthcare Regulatory @ Hollis & Grant LLP | 1 | 0 | **1** | Law-firm regulatory partner is outside counsel, related to GC (intent: law-firm counsel adjacent); not off-intent |
| h02 | h079 | Legal Operations Manager @ Cascadia Mutual Insurance | 1 | 0 | **1** | Legal Operations Manager works in a legal department but is not counsel; marginal |
| h03 | h062 | Medical Director @ Blue Cross Blue Shield Association | 1 | 0 | **1** | Medical Director at a payer is related medical leadership, not a CMO; marginal |
| h03 | h160 | Executive Assistant @ Northbridge Health | 0 | 1 | **1** | Executive Assistant whose note says she manages the CMO calendar; intent: roles that merely mention the CMO are marginal |
| h04 | h021 | Physician Recruiter @ Kaiser Permanente | 1 | 0 | **1** | Physician Recruiter is talent acquisition, which the intent names as adjacent to HR; not off-intent |
| h05 | h090 | Manager, Strategy @ Monitor Deloitte | 0 | 1 | **1** | Strategy manager at a consulting firm (Monitor Deloitte): consulting role at a different level; marginal |
| h05 | h093 | Business Analyst @ McKinsey & Co. | 0 | 1 | **1** | Business Analyst at McKinsey: junior consulting-firm role; marginal |
| h06 | h017 | Administrator, Department of Surgery @ Mayo Clinic | 0 | 1 | **1** | Departmental administrator at Mayo Clinic: health-system leadership below VP level; marginal |
| h06 | h024 | Director, Quality & Patient Safety @ Kaiser Foundation Health Plan | 0 | 1 | **1** | Director-level at a health plan, below the stated VP/C-suite bar; marginal |
| h06 | h039 | Director, Population Health Analytics @ Optum | 0 | 1 | **1** | Director at Optum (health-services company), below VP; marginal |
| h06 | h078 | Compliance Officer @ Mercy Valley Hospital | 0 | 1 | **1** | Hospital Compliance Officer (not Chief Compliance Officer): hospital staff role near leadership; marginal |
| h06 | h092 | Associate Partner, Healthcare Systems & Services @ McKinsey & Company | 1 | 0 | **1** | McKinsey healthcare associate partner advises executives but is not one at a health organization; marginal |
| h06 | h155 | Chief of Staff to the CMO @ (none) | 0 | 1 | **1** | Chief of Staff to a CMO is staff to an executive, no stated health employer; marginal |
| h07 | h099 | Senior Associate Consultant @ Bain & Company | 1 | 0 | **1** | Consultant-level role at Bain, not Deloitte; intent: consultants elsewhere are partial; kept at marginal as labeled |
| h07 | h104 | Senior Associate, Healthcare Advisory @ KPMG | 1 | 0 | **1** | Advisory senior associate at KPMG, not Deloitte; marginal |
| h07 | h150 | Cloud Consultant @ IBM | 1 | 0 | **1** | Consultant at IBM, not Deloitte; marginal |
| h08 | h019 | Chair, Department of Family Medicine @ Mayo Clinic Health System | 1 | 0 | **1** | Physician (family medicine chair) at Mayo, not Kaiser; physician elsewhere is partial; marginal |
| h08 | h107 | Department Chair, Anesthesiology @ University of Washington School of Medicine | 1 | 0 | **1** | Physician (anesthesiology chair) at UW, not Kaiser; marginal |
| h11 | h165 | Senior Paralegal, Risk Management @ Westlake Regional Medical Center | 0 | 1 | **1** | Senior Paralegal: intent names paralegals as marginal |
| h12 | h019 | Chair, Department of Family Medicine @ Mayo Clinic Health System | 0 | 1 | **1** | Department chair at Mayo Clinic Health System is near hospital leadership but not in it; marginal |
| h12 | h062 | Medical Director @ Blue Cross Blue Shield Association | 1 | 0 | **1** | Medical Director at a payer (BCBS Association), not hospital leadership; marginal |
| h12 | h107 | Department Chair, Anesthesiology @ University of Washington School of Medicine | 0 | 1 | **1** | Medical-school department chair has indirect ties to academic hospital leadership; marginal |
| h14 | h079 | Legal Operations Manager @ Cascadia Mutual Insurance | 1 | 0 | **1** | Legal Operations Manager is not a lawyer; legal-support role like paralegal; marginal |
| h14 | h165 | Senior Paralegal, Risk Management @ Westlake Regional Medical Center | 0 | 1 | **1** | Senior Paralegal: intent names paralegals as marginal |

Notes: h07 h099/h104/h150 and h02 h064 arguably merit 2 under the intent wording ("consultants elsewhere are partial", "law-firm counsel are adjacent"), but both labelers gave <= 1, so they stay at 1 under the 0-vs-1 rule. The 0-vs-1 decisions consistently treat sub-VP health leadership, legal-support roles and non-target-company consultants as marginal.
