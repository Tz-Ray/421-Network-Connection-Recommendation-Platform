# Adjudication of benchmark labels

Inputs: `labels_A.json`, `labels_B.json` (independent blind labels, grades 3/2/1, absent = 0), `connections.json`, `queries.json`. Output: `qrels.json` plus `dev/` and `test/` split copies. Grades 0 are omitted from qrels (absent = 0).

## Merge rule

- |A-B| = 0: that grade.
- |A-B| = 1, not 0-vs-1: round-half-up of the mean (1/2 -> 2, 2/3 -> 3).
- 0 vs 1: 0 if the row is plainly off-intent, else 1 (155 cases; 3 set to 0, listed below; the rest set to 1).
- |A-B| >= 2: adjudicated from the query intent and the row's Position/Company/Note under the brief's grade scale (72 cases, all listed below). Where both labelers agreed on an analogous row in the same query, the adjudicated grade was kept consistent with it.

## Agreement

Computed on the union of labeled pairs (a pair counts when either labeler graded it; the other's absence counts as 0). Pairs neither labeler graded are excluded, so kappa here is conservative (no credit for the large mass of agreed 0s).

- Labeled pairs (union): 886
- Exact agreement: 570/886 = 64.3%
- Within one grade: 814/886 = 91.9%
- Cohen's weighted kappa (0-3 scale): linear 0.600, quadratic 0.682
- |A-B| >= 2 cases: 72

Confusion matrix (rows A, columns B, grades 0-3):

| A \\ B | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| 0 | 0 | 71 | 6 | 4 |
| 1 | 84 | 130 | 23 | 5 |
| 2 | 19 | 12 | 60 | 3 |
| 3 | 29 | 9 | 51 | 380 |

Pattern: most large disagreements come from B omitting clearly relevant engineer rows whose titles lack the literal words (SRE, Backend Engineer, Founding Engineer, Systems Programmer) on q01/q05/q27, and from A being stricter on company-membership intents (q22 payments, q32 fintech, q33 healthcare).

## Adjudicated cases (|A-B| >= 2)

| Query | Row | Position @ Company | A | B | Final | Reason |
|---|---|---|---|---|---|---|
| q01 "software engineer" | r001 | Senior SRE @ Netflix | 3 | 0 | 2 | SRE: closely related infrastructure engineering role, not a software engineer title |
| q01 "software engineer" | r051 | DevOps Engineer @ Kestrel Cloud [note: helped me debug our kubernetes cluster, very generous] | 3 | 1 | 2 | DevOps engineer: closely related role |
| q01 "software engineer" | r055 | Senior Data Engineer @ Snowflake | 2 | 0 | 2 | Data engineer: closely related engineering role |
| q01 "software engineer" | r067 | Founding Engineer @ Quillon AI [note: won the AI hackathon at Demo Days, wants to chat about agents] | 3 | 0 | 3 | Founding engineer is an IC software engineer |
| q01 "software engineer" | r089 | Open Source Maintainer (npm, Node.js) @ Self-employed | 3 | 0 | 2 | Open-source npm/Node.js maintainer writes software but holds no engineer title |
| q01 "software engineer" | r163 | HTML Email Developer @ Tidewater Creative | 3 | 0 | 2 | HTML email developer: developer, but a narrow front-end niche |
| q01 "software engineer" | r173 | Principal Architect @ Salesforce | 2 | 0 | 2 | Principal architect: senior technical role adjacent to SWE (both labelers gave 2 on q10) |
| q01 "software engineer" | r179 | Platform Engineer @ Kestrel Cloud | 3 | 1 | 2 | Platform engineer: closely related role |
| q01 "software engineer" | r198 | Domain Architect @ Accenture | 2 | 0 | 1 | Domain architect at a consultancy: enterprise/business architecture, related field only |
| q01 "software engineer" | r201 | Site Reliability Engineer @ Datadog [note: gave a great talk on kubernetes autoscaling] | 3 | 0 | 2 | SRE: closely related role |
| q01 "software engineer" | r203 | Cloud Infrastructure Engineer @ HashiCorp | 3 | 1 | 2 | Cloud infrastructure engineer: closely related role |
| q01 "software engineer" | r222 | Mainframe Systems Programmer @ IBM | 3 | 0 | 3 | Systems programmer is a software developer |
| q01 "software engineer" | r229 | Backend Engineer @ Ledgerly [note: hackathon teammate in 2024, built our ledger API overnight] | 3 | 0 | 3 | Backend engineer is a software engineer |
| q05 "swe" | r001 | Senior SRE @ Netflix | 3 | 0 | 2 | SRE: closely related infrastructure engineering role, not a software engineer title |
| q05 "swe" | r051 | DevOps Engineer @ Kestrel Cloud [note: helped me debug our kubernetes cluster, very generous] | 3 | 1 | 2 | DevOps engineer: closely related role |
| q05 "swe" | r055 | Senior Data Engineer @ Snowflake | 2 | 0 | 2 | Data engineer: closely related engineering role |
| q05 "swe" | r067 | Founding Engineer @ Quillon AI [note: won the AI hackathon at Demo Days, wants to chat about agents] | 3 | 0 | 3 | Founding engineer is an IC software engineer |
| q05 "swe" | r089 | Open Source Maintainer (npm, Node.js) @ Self-employed | 3 | 0 | 2 | Open-source npm/Node.js maintainer writes software but holds no engineer title |
| q05 "swe" | r163 | HTML Email Developer @ Tidewater Creative | 3 | 0 | 2 | HTML email developer: developer, but a narrow front-end niche |
| q05 "swe" | r173 | Principal Architect @ Salesforce | 2 | 0 | 2 | Principal architect: senior technical role adjacent to SWE (both labelers gave 2 on q10) |
| q05 "swe" | r179 | Platform Engineer @ Kestrel Cloud | 3 | 1 | 2 | Platform engineer: closely related role |
| q05 "swe" | r198 | Domain Architect @ Accenture | 2 | 0 | 1 | Domain architect at a consultancy: enterprise/business architecture, related field only |
| q05 "swe" | r201 | Site Reliability Engineer @ Datadog [note: gave a great talk on kubernetes autoscaling] | 3 | 0 | 2 | SRE: closely related role |
| q05 "swe" | r203 | Cloud Infrastructure Engineer @ HashiCorp | 3 | 1 | 2 | Cloud infrastructure engineer: closely related role |
| q05 "swe" | r222 | Mainframe Systems Programmer @ IBM | 3 | 0 | 3 | Systems programmer is a software developer |
| q05 "swe" | r229 | Backend Engineer @ Ledgerly [note: hackathon teammate in 2024, built our ledger API overnight] | 3 | 0 | 3 | Backend engineer is a software engineer |
| q10 "senior engineer" | r055 | Senior Data Engineer @ Snowflake | 0 | 3 | 2 | Senior data engineer: seniority met, closely related engineering role |
| q10 "senior engineer" | r067 | Founding Engineer @ Quillon AI [note: won the AI hackathon at Demo Days, wants to chat about agents] | 2 | 0 | 2 | Engineer, seniority not stated: function right, seniority constraint only partly met |
| q10 "senior engineer" | r153 | Senior Data Scientist @ Zillow | 0 | 2 | 1 | Senior data scientist: seniority met but not an engineer; related field |
| q10 "senior engineer" | r198 | Domain Architect @ Accenture | 2 | 0 | 1 | Domain architect: related field, not a senior IC engineer |
| q11 "engineering leadership" | r046 | Engineering Manager, Payments Infrastructure @ Stripe | 3 | 0 | 3 | Engineering manager is explicitly in the intent |
| q12 "head of product" | r094 | Senior Product Manager - Technical @ Amazon | 2 | 0 | 1 | Senior PM: right function, two levels below head of product (Group PM merged to 2) |
| q12 "head of product" | r207 | Senior Product Manager @ Salesforce [note: my mentor from Salesforce days, great on pricing strategy] | 2 | 0 | 1 | Senior PM: right function, not a product leader |
| q12 "head of product" | r216 | Senior Product Manager @ Uber | 2 | 0 | 1 | Senior PM: right function, not a product leader |
| q12 "head of product" | r232 | Senior Product Manager @ Robinhood | 2 | 0 | 1 | Senior PM: right function, not a product leader |
| q18 "people at google" | r043 | Incoming SWE Intern @ Google / CS @ Georgia Tech @ Georgia Institute of Technology | 1 | 3 | 2 | Incoming Google intern; currently at Georgia Tech, so company constraint only partly met |
| q20 "someone who can help me hire engineers" | r046 | Engineering Manager, Payments Infrastructure @ Stripe | 3 | 0 | 3 | Engineering hiring manager; other EMs merged to 3 |
| q21 "who could introduce me to investors" | r016 | Talent Partner @ Fernwood Ventures [note: offered to help us hire our first engineers] | 3 | 1 | 3 | VC talent/platform partner, explicitly in intent; same role as r008 (merged 3) |
| q22 "people working on payments" | r010 | VP Engineering @ Gusto | 0 | 2 | 1 | Gusto (payroll): only marginally payments |
| q22 "people working on payments" | r026 | Chief of Staff @ Ramp [note: said they are hiring PMs in Q4] | 0 | 2 | 2 | Ramp (corporate cards/spend): payments-adjacent fintech (Ramp engineer agreed 2) |
| q22 "people working on payments" | r054 | (no title) @ Stripe | 0 | 3 | 3 | Works at Stripe, named in the intent |
| q22 "people working on payments" | r061 | Head of Partnerships @ Stripe | 0 | 3 | 3 | Head of Partnerships at Stripe, named in the intent |
| q22 "people working on payments" | r085 | (no title) @ Cobalt Pay | 1 | 3 | 3 | Works at Cobalt Pay, a payments company named in the intent |
| q22 "people working on payments" | r090 | Engineering Manager @ Chime | 2 | 0 | 2 | Chime (neobank): payments-adjacent fintech, like Coinbase/Ramp/Brex (merged 2) |
| q22 "people working on payments" | r131 | Enterprise AE @ Stripe | 1 | 3 | 3 | Works at Stripe, named in the intent (Stripe solutions engineer agreed 3) |
| q22 "people working on payments" | r237 | Technical Recruiter @ Cobalt Pay | 1 | 3 | 3 | Works at Cobalt Pay, a payments company named in the intent |
| q27 "enginer" | r001 | Senior SRE @ Netflix | 3 | 0 | 3 | SRE is an engineer; DevOps/platform engineers merged to 3 on this query |
| q27 "enginer" | r043 | Incoming SWE Intern @ Google / CS @ Georgia Tech @ Georgia Institute of Technology | 3 | 0 | 3 | Incoming SWE intern: a software engineer |
| q27 "enginer" | r048 | Application Security Engineer @ Okta | 0 | 2 | 2 | Application security engineer: engineer of another kind |
| q27 "enginer" | r055 | Senior Data Engineer @ Snowflake | 2 | 0 | 2 | Data engineer: non-SWE engineer (other data engineers agreed 2) |
| q27 "enginer" | r067 | Founding Engineer @ Quillon AI [note: won the AI hackathon at Demo Days, wants to chat about agents] | 3 | 0 | 3 | Founding engineer is a software engineer |
| q27 "enginer" | r081 | Freelance Web Developer @ Freelance | 3 | 0 | 3 | Freelance web developer is a software developer |
| q27 "enginer" | r086 | Solutions Engineer @ Stripe | 2 | 0 | 2 | Solutions engineer (Snowflake solutions engineer agreed 2) |
| q27 "enginer" | r089 | Open Source Maintainer (npm, Node.js) @ Self-employed | 3 | 0 | 2 | OSS maintainer: develops software without an engineer title |
| q27 "enginer" | r163 | HTML Email Developer @ Tidewater Creative | 3 | 0 | 2 | HTML email developer: narrow developer niche |
| q27 "enginer" | r173 | Principal Architect @ Salesforce | 2 | 0 | 2 | Principal architect: senior technical role adjacent to engineering |
| q27 "enginer" | r198 | Domain Architect @ Accenture | 2 | 0 | 1 | Domain architect at a consultancy: related field only |
| q27 "enginer" | r201 | Site Reliability Engineer @ Datadog [note: gave a great talk on kubernetes autoscaling] | 3 | 0 | 3 | SRE is an engineer; DevOps/platform engineers merged to 3 on this query |
| q27 "enginer" | r222 | Mainframe Systems Programmer @ IBM | 3 | 0 | 3 | Systems programmer is a software developer |
| q27 "enginer" | r229 | Backend Engineer @ Ledgerly [note: hackathon teammate in 2024, built our ledger API overnight] | 3 | 0 | 3 | Backend engineer is a software engineer |
| q29 "gogle" | r043 | Incoming SWE Intern @ Google / CS @ Georgia Tech @ Georgia Institute of Technology | 1 | 3 | 2 | Incoming Google intern; currently at Georgia Tech, so company constraint only partly met |
| q30 "machine learning" | r003 | Research Scientist @ Meta | 3 | 1 | 2 | Research scientist at Meta: in intent, but ML focus not stated |
| q30 "machine learning" | r133 | Co-founder / CEO @ Nimbus Health AI | 2 | 0 | 2 | CEO of an AI company; Quillon AI CEO agreed 2 |
| q32 "fintech" | r010 | VP Engineering @ Gusto | 0 | 2 | 2 | Gusto (payroll/HR platform): fintech-adjacent |
| q32 "fintech" | r026 | Chief of Staff @ Ramp [note: said they are hiring PMs in Q4] | 0 | 3 | 3 | Works at Ramp, a fintech |
| q32 "fintech" | r090 | Engineering Manager @ Chime | 3 | 0 | 3 | Works at Chime, a fintech; everyone at fintech companies agreed 3 |
| q32 "fintech" | r144 | People Operations Manager @ Gusto | 0 | 2 | 2 | Gusto (payroll/HR platform): fintech-adjacent |
| q32 "fintech" | r237 | Technical Recruiter @ Cobalt Pay | 3 | 0 | 3 | Works at Cobalt Pay, a fintech |
| q33 "healthcare" | r029 | Product Manager @ Epic Systems | 3 | 0 | 3 | Epic Systems is healthcare software |
| q33 "healthcare" | r214 | Software Developer @ Epic Systems | 3 | 0 | 3 | Epic Systems is healthcare software |
| q33 "healthcare" | r240 | (no title) @ Brightwave Health | 3 | 1 | 3 | Works at Brightwave Health; all other Brightwave rows agreed 3 |
| q36 "kubernetes" | r001 | Senior SRE @ Netflix | 2 | 0 | 2 | SRE without a Kubernetes note: secondary per intent (like r203, agreed 2) |

## 0-vs-1 cases set to 0

| Query | Row | Position @ Company | A | B | Reason |
|---|---|---|---|---|---|
| q22 "people working on payments" | r197 | Data Engineer @ Meta [note: met at the fintech hackathon, strong on data pipelines] | 1 | 0 | Data engineer at Meta; 'fintech hackathon' note does not make them a payments person |
| q31 "data engineering" | r205 | Business Analyst @ Deloitte | 0 | 1 | Business analyst at a consultancy: not data engineering |
| q32 "fintech" | r147 | Financial Advisor @ Edward Jones | 1 | 0 | Traditional financial advisor (Edward Jones), not fintech |

## Final grade distribution

- Grade 3: 461, grade 2: 130, grade 1: 292 (total 883 relevant pairs)

## Per-query relevant counts

| Query | Text | Split | Strict | 3 | 2 | 1 | Total |
|---|---|---|---|---|---|---|---|
| q01 | software engineer | dev |  | 35 | 18 | 30 | 83 |
| q02 | product manager | dev |  | 18 | 6 | 4 | 28 |
| q03 | data scientist | dev | yes | 7 | 2 | 12 | 21 |
| q04 | recruiter | test |  | 11 | 0 | 2 | 13 |
| q05 | swe | dev |  | 35 | 18 | 30 | 83 |
| q06 | pm | dev |  | 18 | 6 | 4 | 28 |
| q07 | vp eng | test |  | 8 | 2 | 7 | 17 |
| q08 | ae | dev |  | 6 | 2 | 2 | 10 |
| q09 | ml engineer | test | yes | 5 | 4 | 4 | 13 |
| q10 | senior engineer | dev |  | 15 | 3 | 3 | 21 |
| q11 | engineering leadership | test |  | 17 | 0 | 0 | 17 |
| q12 | head of product | dev |  | 6 | 3 | 4 | 13 |
| q13 | product manager at stripe | dev |  | 2 | 0 | 29 | 31 |
| q14 | engineer google | test |  | 5 | 1 | 74 | 80 |
| q15 | designer airbnb | dev |  | 2 | 0 | 13 | 15 |
| q16 | recruiter at amazon | dev |  | 2 | 0 | 15 | 17 |
| q17 | stripe | dev |  | 9 | 0 | 0 | 9 |
| q18 | people at google | test |  | 10 | 1 | 0 | 11 |
| q19 | salesforce | dev |  | 5 | 0 | 0 | 5 |
| q20 | someone who can help me hire engineers | dev |  | 28 | 2 | 1 | 31 |
| q21 | who could introduce me to investors | test |  | 11 | 0 | 1 | 12 |
| q22 | people working on payments | dev |  | 23 | 10 | 5 | 38 |
| q23 | someone to review our app's security | dev |  | 3 | 1 | 0 | 4 |
| q24 | designers | dev |  | 12 | 2 | 0 | 14 |
| q25 | investing | test |  | 9 | 0 | 3 | 12 |
| q26 | recruiting | dev |  | 11 | 0 | 2 | 13 |
| q27 | enginer | dev |  | 40 | 23 | 24 | 87 |
| q28 | prodcut manager | test |  | 18 | 6 | 4 | 28 |
| q29 | gogle | dev |  | 10 | 1 | 0 | 11 |
| q30 | machine learning | dev |  | 12 | 5 | 11 | 28 |
| q31 | data engineering | test |  | 5 | 8 | 4 | 17 |
| q32 | fintech | dev |  | 38 | 2 | 2 | 42 |
| q33 | healthcare | test |  | 16 | 0 | 1 | 17 |
| q34 | hackathon | dev |  | 4 | 0 | 0 | 4 |
| q35 | mentor | test |  | 2 | 0 | 0 | 2 |
| q36 | kubernetes | dev |  | 3 | 4 | 1 | 8 |

## Problem queries

None: every query has at least one grade-3 or grade-2 row.
