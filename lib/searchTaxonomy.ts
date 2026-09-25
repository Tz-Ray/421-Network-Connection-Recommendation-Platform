// lib/searchTaxonomy.ts
//
// Vocabulary for the local search ranker (lib/search.ts): pure data plus a
// couple of tiny helpers. No React, no Firebase, no imports.
//
// Everything here is general occupational and business knowledge, written for
// any user's network (tech and non-tech alike):
//   - topics (job functions, and industries prefixed "i_") and how they relate,
//   - title phrasings mapped to topics and seniority,
//   - abbreviations (ambiguous ones list every common sense),
//   - seniority words and query bands,
//   - query-only phrasings, intent verbs and natural-language filler,
//   - word families (agent noun <-> activity: recruiter / recruiting),
//   - company aliases (parent / brand relations), well-known companies per
//     industry, company-name keywords per industry, and the generic titles whose
//     function comes from the employer's industry ("Partner" at a law firm).
// All phrases are written in plain lowercase English; lib/search.ts normalizes
// them (diacritics, punctuation, plurals) exactly like titles and queries.

export type TopicWeights = Readonly<Record<string, number>>;

/**
 * A lookup table keyed by words from titles, companies, notes or the query:
 * built with a null prototype, so a word such as "constructor" or "toString"
 * reads as absent instead of resolving to an inherited Object.prototype member.
 */
function dict<T>(entries: Record<string, T>): Readonly<Record<string, T>> {
  return Object.freeze(Object.assign(Object.create(null) as Record<string, T>, entries));
}

// =============================================================================
// Topics
// =============================================================================

/** Human-readable topic names (used in reasons and the query description). */
export const TOPIC_LABELS: Readonly<Record<string, string>> = dict({
  // Software and technical
  engineering: 'engineering',
  software: 'software engineering',
  frontend: 'front-end engineering',
  backend: 'back-end engineering',
  mobile: 'mobile engineering',
  infra: 'infrastructure / DevOps / SRE',
  dataeng: 'data engineering',
  ml: 'machine learning / AI',
  security: 'security',
  qa: 'QA / test engineering',
  solutions: 'solutions engineering',
  devrel: 'developer relations',
  engmgmt: 'engineering leadership',
  support: 'customer support',
  // Physical engineering and trades
  hardware: 'hardware / physical engineering',
  mecheng: 'mechanical engineering',
  eleceng: 'electrical engineering',
  civileng: 'civil / structural engineering',
  chemeng: 'chemical / process engineering',
  mfgeng: 'manufacturing / industrial engineering',
  quality: 'quality',
  trades: 'skilled trades / technicians',
  // Product, design, data, research
  pm: 'product management',
  program: 'program / project management',
  design: 'design',
  uxr: 'UX research',
  datasci: 'data science',
  analytics: 'analytics',
  research: 'research',
  // Go-to-market
  sales: 'sales',
  ae: 'account executives',
  sdr: 'sales development',
  accounts: 'account management / customer success',
  bizdev: 'partnerships / business development',
  marketing: 'marketing',
  growth: 'growth',
  comms: 'communications / PR',
  // People and operations
  recruiting: 'recruiting / talent',
  hr: 'people / HR',
  ops: 'operations',
  supplychain: 'supply chain / logistics / procurement',
  admin: 'administrative support',
  founder: 'founders / CEOs / owners',
  board: 'board members',
  mgmtdirector: 'managing directors',
  // Finance, legal, consulting
  finance: 'finance',
  accounting: 'accounting / audit / tax',
  banking: 'banking / investment banking',
  wealth: 'wealth management / financial advice',
  investing: 'investing',
  pe: 'private equity',
  vc: 'venture capital',
  trading: 'trading',
  risk: 'risk management',
  underwriting: 'underwriting',
  actuarial: 'actuarial',
  claims: 'insurance claims',
  brokerage: 'brokers / agents',
  legal: 'legal (attorneys / counsel)',
  paralegal: 'paralegals / legal support',
  compliance: 'compliance / regulatory',
  consulting: 'consulting',
  // Healthcare
  physician: 'physicians / doctors',
  nursing: 'nursing',
  apc: 'advanced practice (NP / PA)',
  pharmacy: 'pharmacy',
  allied: 'allied health (therapists / technologists)',
  mentalhealth: 'mental health / social work',
  dental: 'dentistry',
  vet: 'veterinary',
  clinresearch: 'clinical research',
  healthadmin: 'healthcare administration',
  // Education, public sector, real estate, retail, media
  teaching: 'teaching',
  academia: 'academia (professors / researchers)',
  schooladmin: 'school / university administration',
  policy: 'policy / government affairs',
  legislative: 'legislators / legislative staff',
  grants: 'grants / program officers',
  fundraising: 'fundraising / development',
  realestate: 'real estate (agents / brokers)',
  propmgmt: 'property management',
  retail: 'retail',
  hospitality: 'hospitality / food service',
  journalism: 'journalism',
  editorial: 'editorial / writing',
  production: 'media production',
  // Industries (evidenced by company names and industry words in titles)
  i_tech: 'tech companies',
  i_ai: 'AI companies',
  i_security: 'security companies',
  i_fintech: 'fintech',
  i_payments: 'payments',
  i_crypto: 'crypto',
  i_health: 'healthcare',
  i_hospital: 'hospitals / health systems',
  i_pharma: 'pharma / biotech',
  i_bank: 'banks',
  i_investing: 'investment firms (VC / PE / asset management)',
  i_insurance: 'insurance',
  i_law: 'law firms',
  i_consulting: 'consulting firms',
  i_accounting: 'accounting firms',
  i_education: 'education',
  i_highered: 'higher education (universities / colleges)',
  i_government: 'government',
  i_nonprofit: 'nonprofits',
  i_foundation: 'foundations / funders',
  i_retail: 'retail',
  i_hospitality: 'hospitality',
  i_realestate: 'real estate',
  i_media: 'media / entertainment',
  i_energy: 'energy',
  i_utilities: 'electric / gas utilities and grid operators',
  i_cleanenergy: 'clean / renewable energy',
  i_manufacturing: 'manufacturing / industrial',
  i_telecom: 'telecom',
});

/** Industry topics are the ones prefixed "i_" (not role facets for strict mode). */
export const isIndustryTopic = (t: string): boolean => t.startsWith('i_');

/** Engineering functions ("head of engineering" means their leadership; hiring engineers). */
export const ENGINEERING_FAMILY: ReadonlySet<string> = new Set([
  'engineering', 'software', 'frontend', 'backend', 'mobile', 'infra', 'dataeng', 'ml', 'security', 'qa',
  'hardware', 'mecheng', 'eleceng', 'civileng', 'chemeng', 'mfgeng', 'solutions', 'engmgmt',
]);

/**
 * Symmetric-ish partial credit between neighbouring functions: [a, b, credit
 * a->b, credit b->a (default: same)]. A generalist ask credits specialists
 * more than a specialist ask credits generalists.
 */
export const RELATED_PAIRS: ReadonlyArray<readonly [string, string, number, number?]> = [
  // Software specialties are software engineers too.
  ['frontend', 'software', 0.5, 1], ['backend', 'software', 0.5, 1], ['mobile', 'software', 0.45, 1],
  ['frontend', 'backend', 0.3], ['frontend', 'mobile', 0.35], ['backend', 'infra', 0.35],
  ['software', 'infra', 0.5, 0.35], ['software', 'dataeng', 0.5, 0.35], ['software', 'ml', 0.5, 0.35],
  ['software', 'security', 0.4, 0.2], ['software', 'solutions', 0.35, 0.25], ['software', 'engmgmt', 0.35],
  ['software', 'devrel', 0.35, 0.25], ['software', 'hardware', 0.3, 0.2], ['software', 'qa', 0.4, 0.3],
  ['infra', 'dataeng', 0.35], ['infra', 'security', 0.35], ['infra', 'engmgmt', 0.3],
  ['dataeng', 'datasci', 0.4], ['dataeng', 'ml', 0.35], ['dataeng', 'analytics', 0.35],
  ['ml', 'datasci', 0.5], ['ml', 'research', 0.6],
  ['datasci', 'analytics', 0.5], ['datasci', 'research', 0.5],
  ['qa', 'quality', 0.6], ['solutions', 'support', 0.3], ['support', 'accounts', 0.5],
  // Physical engineering: specialties are hardware engineers; specialties are only partly each other.
  ['mecheng', 'hardware', 0.4, 1], ['eleceng', 'hardware', 0.4, 1], ['civileng', 'hardware', 0.4, 1],
  ['chemeng', 'hardware', 0.4, 1], ['mfgeng', 'hardware', 0.4, 1],
  ['mecheng', 'eleceng', 0.3], ['mecheng', 'mfgeng', 0.4], ['mecheng', 'civileng', 0.3], ['chemeng', 'mfgeng', 0.4],
  ['mfgeng', 'quality', 0.5], ['trades', 'hardware', 0.3], ['trades', 'mfgeng', 0.3],
  // Product, design
  ['pm', 'program', 0.4], ['design', 'uxr', 0.6],
  // Go-to-market
  ['sales', 'ae', 0.6], ['sales', 'sdr', 0.6], ['ae', 'sdr', 0.4], ['ae', 'accounts', 0.5],
  ['sales', 'accounts', 0.6], ['sales', 'bizdev', 0.5], ['sales', 'solutions', 0.3], ['sales', 'marketing', 0.3],
  ['marketing', 'growth', 0.7], ['marketing', 'comms', 0.5],
  // People and operations
  ['recruiting', 'hr', 0.5], ['ops', 'supplychain', 0.5], ['ops', 'admin', 0.2], ['hr', 'admin', 0.2],
  ['founder', 'board', 0.3],
  // Finance, legal, consulting
  ['investing', 'founder', 0.2],
  ['finance', 'accounting', 0.5], ['finance', 'banking', 0.5], ['banking', 'investing', 0.5],
  ['wealth', 'banking', 0.5], ['wealth', 'investing', 0.4], ['trading', 'investing', 0.5], ['finance', 'investing', 0.3],
  ['risk', 'finance', 0.3], ['risk', 'compliance', 0.5], ['underwriting', 'risk', 0.4], ['underwriting', 'actuarial', 0.4],
  ['underwriting', 'claims', 0.3], ['actuarial', 'datasci', 0.3], ['brokerage', 'realestate', 0.4],
  ['brokerage', 'wealth', 0.3], ['brokerage', 'sales', 0.3], ['mgmtdirector', 'banking', 0.3],
  ['legal', 'paralegal', 0.6, 0.5], ['legal', 'compliance', 0.5], ['paralegal', 'admin', 0.3], ['policy', 'legal', 0.2],
  ['legislative', 'policy', 0.5],
  // Healthcare
  ['physician', 'apc', 0.5], ['nursing', 'apc', 0.5], ['physician', 'nursing', 0.25], ['nursing', 'allied', 0.3],
  ['physician', 'allied', 0.25], ['pharmacy', 'physician', 0.2], ['mentalhealth', 'allied', 0.4],
  ['physician', 'mentalhealth', 0.3], ['clinresearch', 'research', 0.4], ['healthadmin', 'ops', 0.3],
  ['dental', 'physician', 0.2], ['vet', 'physician', 0.2],
  // Education, public sector, real estate, retail, media
  ['teaching', 'academia', 0.5], ['academia', 'research', 0.7], ['schooladmin', 'teaching', 0.5],
  ['schooladmin', 'academia', 0.4], ['policy', 'grants', 0.3], ['grants', 'fundraising', 0.5],
  ['fundraising', 'bizdev', 0.3], ['realestate', 'propmgmt', 0.6], ['retail', 'sales', 0.3],
  ['retail', 'hospitality', 0.3], ['retail', 'supplychain', 0.2], ['comms', 'journalism', 0.4],
  ['editorial', 'journalism', 0.6], ['editorial', 'marketing', 0.3], ['production', 'journalism', 0.3],
];

/** Directed credit (query topic -> row topic): parents, umbrellas and industry containment. */
export const DIRECTED: ReadonlyArray<readonly [string, string, number]> = [
  // "engineer" on its own means an engineering IC, software first (the most common reading).
  ['engineering', 'software', 1], ['engineering', 'infra', 0.9], ['engineering', 'dataeng', 0.75],
  ['engineering', 'ml', 0.75], ['engineering', 'security', 0.7], ['engineering', 'hardware', 0.7],
  ['engineering', 'qa', 0.6], ['engineering', 'solutions', 0.55], ['engineering', 'devrel', 0.45],
  ['engineering', 'engmgmt', 0.35], ['engineering', 'quality', 0.4], ['engineering', 'trades', 0.2],
  ['sales', 'ae', 1], ['sales', 'sdr', 1],
  ['investing', 'pe', 1], ['investing', 'vc', 1], ['pe', 'investing', 0.5], ['vc', 'investing', 0.5],
  ['pe', 'vc', 0.3], ['vc', 'pe', 0.3],
  // Industries: umbrellas and containment.
  ['i_fintech', 'i_payments', 1], ['i_fintech', 'i_crypto', 0.8], ['i_fintech', 'i_bank', 0.5],
  ['i_fintech', 'i_insurance', 0.4], ['i_payments', 'i_fintech', 0.5], ['i_crypto', 'i_fintech', 0.4],
  ['i_bank', 'i_fintech', 0.3],
  ['i_health', 'i_hospital', 1], ['i_health', 'i_pharma', 0.7], ['i_hospital', 'i_health', 0.6],
  ['i_pharma', 'i_health', 0.3],
  // An industry ask credits the people whose job is that industry's core work.
  ['i_health', 'physician', 0.7], ['i_health', 'nursing', 0.7], ['i_health', 'apc', 0.7], ['i_health', 'pharmacy', 0.6],
  ['i_health', 'allied', 0.6], ['i_health', 'mentalhealth', 0.5], ['i_health', 'clinresearch', 0.6],
  ['i_health', 'healthadmin', 0.7], ['i_health', 'dental', 0.6],
  ['i_hospital', 'physician', 0.5], ['i_hospital', 'nursing', 0.5], ['i_hospital', 'healthadmin', 0.5],
  ['i_pharma', 'clinresearch', 0.6], ['i_pharma', 'pharmacy', 0.3],
  ['i_bank', 'banking', 0.6], ['i_insurance', 'underwriting', 0.6], ['i_insurance', 'actuarial', 0.6],
  ['i_insurance', 'claims', 0.6], ['i_law', 'legal', 0.6], ['i_law', 'paralegal', 0.6],
  ['i_consulting', 'consulting', 0.6], ['consulting', 'i_consulting', 0.5],
  ['i_accounting', 'accounting', 0.6], ['accounting', 'i_accounting', 0.5],
  ['i_education', 'teaching', 0.6], ['i_education', 'academia', 0.6], ['i_education', 'schooladmin', 0.6],
  ['i_government', 'policy', 0.6], ['i_nonprofit', 'grants', 0.6], ['i_nonprofit', 'fundraising', 0.6],
  ['i_retail', 'retail', 0.6], ['i_hospitality', 'hospitality', 0.6], ['i_realestate', 'realestate', 0.6],
  ['i_realestate', 'propmgmt', 0.6], ['i_media', 'journalism', 0.6], ['i_media', 'editorial', 0.6],
  ['i_media', 'production', 0.6], ['i_manufacturing', 'mfgeng', 0.5], ['i_manufacturing', 'hardware', 0.4],
  ['i_energy', 'hardware', 0.3], ['i_investing', 'investing', 0.6],
  // Energy is the broad domain: it contains utilities / grid operators and clean energy.
  ['i_energy', 'i_utilities', 1], ['i_energy', 'i_cleanenergy', 1], ['i_utilities', 'i_energy', 0.4],
  ['i_cleanenergy', 'i_energy', 0.4], ['i_utilities', 'i_cleanenergy', 0.3], ['i_cleanenergy', 'i_utilities', 0.3],
  ['i_utilities', 'hardware', 0.3], ['i_cleanenergy', 'hardware', 0.3],
  // Education contains higher education; universities are where academics work.
  ['i_education', 'i_highered', 1], ['i_highered', 'i_education', 0.5],
  ['i_highered', 'academia', 0.6], ['i_highered', 'schooladmin', 0.5],
  // Foundations are nonprofits whose core work is grant making.
  ['i_nonprofit', 'i_foundation', 1], ['i_foundation', 'i_nonprofit', 0.5], ['i_foundation', 'grants', 0.6],
  ['i_government', 'legislative', 0.6],
];

// =============================================================================
// Title phrasings -> topics (and seniority level)
// =============================================================================
// [phrase, topics, level?]. Matched greedily, longest first, on whole words.
// Levels: intern 0, junior 1, mid 2, senior 3, staff / lead 4, manager 4.5,
// head / director 5, VP / MD / partner 6, C-level / founder 7.
// A pattern with no topics only sets the level ("board member", "president").
// Every phrasing doubles as a query trigger (lib/search.ts drops its industry
// topics there when it also names a role, so "underwriter" asks for underwriters,
// not for everyone at an insurer).
export type TitlePatternSpec = readonly [phrase: string, topics: TopicWeights, level?: number];

export const TITLE_PATTERNS: ReadonlyArray<TitlePatternSpec> = [
  // ---- Software engineering
  ['software engineer', { software: 1 }], ['software developer', { software: 1 }],
  ['software development engineer', { software: 1 }], ['software architect', { software: 1 }],
  ['developer', { software: 0.9 }], ['programmer', { software: 0.9 }], ['coder', { software: 0.8 }],
  ['backend', { backend: 1, software: 1 }], ['back end', { backend: 1, software: 1 }],
  ['frontend', { frontend: 1, software: 1 }], ['front end', { frontend: 1, software: 1 }],
  ['ui engineer', { frontend: 1, software: 1 }],
  ['full stack', { frontend: 0.9, backend: 0.9, software: 1 }], ['fullstack', { frontend: 0.9, backend: 0.9, software: 1 }],
  ['web developer', { frontend: 0.8, software: 1 }],
  ['ios', { mobile: 1, software: 0.9 }], ['android', { mobile: 1, software: 0.9 }],
  ['mobile engineer', { mobile: 1, software: 1 }], ['mobile developer', { mobile: 1, software: 1 }],
  ['founding engineer', { software: 0.9 }], ['member of technical staff', { software: 0.9 }],
  ['tech lead', { software: 0.9 }, 4], ['technical lead', { software: 0.9 }, 4],
  ['open source', { software: 0.6 }], ['architect', { software: 0.6 }],
  ['sdet', { qa: 1, software: 0.7 }], ['qa engineer', { qa: 1, software: 0.6 }], ['test engineer', { qa: 0.9, software: 0.5 }],
  ['quality assurance', { qa: 1, quality: 0.6 }], ['tester', { qa: 0.8 }],
  // ---- Infrastructure / DevOps / SRE / IT
  ['site reliability', { infra: 1 }], ['reliability engineer', { infra: 1 }], ['devops', { infra: 1 }],
  ['platform engineer', { infra: 1 }],
  // Often a team name in other roles ("Engineering Manager, Payments Infrastructure").
  ['infrastructure', { infra: 0.8 }], ['infra', { infra: 0.8 }],
  ['cloud engineer', { infra: 1 }], ['cloud infrastructure', { infra: 1 }],
  ['systems engineer', { infra: 0.7 }], ['network engineer', { infra: 0.7 }], ['sysadmin', { infra: 0.7 }],
  ['systems administrator', { infra: 0.7 }], ['system administrator', { infra: 0.7 }],
  ['database administrator', { infra: 0.6, dataeng: 0.5 }], ['network administrator', { infra: 0.7 }],
  ['it support', { infra: 0.5, support: 0.6 }], ['help desk', { support: 0.8, infra: 0.3 }],
  // ---- Data engineering
  ['data engineer', { dataeng: 1 }], ['analytics engineer', { dataeng: 1, analytics: 0.5 }],
  ['data platform', { dataeng: 1 }], ['data infrastructure', { dataeng: 0.9 }], ['etl', { dataeng: 0.8 }],
  // ---- Machine learning / AI ("AI" as a bare modifier is weaker evidence than an ML job title)
  ['machine learning', { ml: 1 }], ['ml engineer', { ml: 1 }], ['ml researcher', { ml: 1 }],
  ['ai engineer', { ml: 1 }], ['ai researcher', { ml: 1 }], ['deep learning', { ml: 1 }],
  ['computer vision', { ml: 1 }], ['natural language processing', { ml: 1 }],
  ['artificial intelligence', { ml: 1 }], ['llm', { ml: 0.9 }],
  ['applied scientist', { ml: 0.9, datasci: 0.7 }], ['research engineer', { ml: 0.7, research: 0.7 }],
  ['ml', { ml: 0.7 }], ['ai', { ml: 0.7 }],
  // ---- Security
  ['security', { security: 1 }], ['security engineer', { security: 1 }], ['cybersecurity', { security: 1 }],
  ['infosec', { security: 1 }], ['appsec', { security: 1 }],
  ['chief information security officer', { security: 1 }, 7],
  ['penetration tester', { security: 1 }], ['pentester', { security: 1 }],
  ['security guard', { trades: 0.4 }], ['security officer', { security: 0.5, trades: 0.3 }],
  // ---- Physical engineering and trades
  ['mechanical engineer', { mecheng: 1, hardware: 1 }], ['mechanical engineering', { mecheng: 1, hardware: 0.9 }],
  ['mechanical', { mecheng: 0.8, hardware: 0.7 }],
  ['electrical engineer', { eleceng: 1, hardware: 1 }], ['electrical engineering', { eleceng: 1, hardware: 0.9 }],
  ['electronics engineer', { eleceng: 1, hardware: 1 }], ['controls engineer', { eleceng: 0.8, hardware: 0.9 }],
  ['civil engineer', { civileng: 1, hardware: 1 }], ['civil engineering', { civileng: 1, hardware: 0.9 }],
  ['structural engineer', { civileng: 1, hardware: 1 }], ['geotechnical engineer', { civileng: 1, hardware: 1 }],
  ['environmental engineer', { civileng: 0.7, chemeng: 0.5, hardware: 1 }],
  ['transportation engineer', { civileng: 1, hardware: 1 }],
  ['chemical engineer', { chemeng: 1, hardware: 1 }], ['process engineer', { chemeng: 0.7, mfgeng: 0.7, hardware: 1 }],
  ['manufacturing engineer', { mfgeng: 1, hardware: 1 }], ['industrial engineer', { mfgeng: 1, hardware: 1 }],
  ['production engineer', { mfgeng: 0.7, infra: 0.5, hardware: 0.6 }],
  ['quality engineer', { quality: 1, mfgeng: 0.5, hardware: 0.8 }],
  ['quality manager', { quality: 1 }], ['quality control', { quality: 1 }], ['quality', { quality: 0.8 }],
  ['aerospace engineer', { mecheng: 0.6, hardware: 1 }], ['hardware engineer', { hardware: 1, eleceng: 0.6 }],
  ['biomedical engineer', { hardware: 1 }], ['materials engineer', { chemeng: 0.6, hardware: 1 }],
  ['design engineer', { mecheng: 0.8, hardware: 1 }], ['field engineer', { hardware: 0.7 }],
  ['project engineer', { civileng: 0.6, hardware: 0.8 }], ['reliability', { hardware: 0.4 }],
  ['professional engineer', { civileng: 0.6, hardware: 1 }],
  ['firmware', { hardware: 0.8, software: 0.6 }], ['embedded', { hardware: 0.8, software: 0.6 }],
  ['electrician', { trades: 1, eleceng: 0.3 }], ['plumber', { trades: 1 }], ['welder', { trades: 1 }],
  ['machinist', { trades: 1, mfgeng: 0.3 }], ['carpenter', { trades: 1 }], ['mechanic', { trades: 1 }],
  ['hvac', { trades: 0.9 }], ['technician', { trades: 0.6 }], ['maintenance technician', { trades: 1 }],
  ['maintenance', { trades: 0.5 }], ['foreman', { trades: 0.8 }, 4], ['construction', { trades: 0.6, civileng: 0.4 }],
  ['plant manager', { mfgeng: 0.6, ops: 0.8 }, 5], ['manufacturing', { mfgeng: 0.7, i_manufacturing: 1 }],
  // ---- Solutions / sales engineering, developer relations, support
  ['solutions engineer', { solutions: 1 }], ['sales engineer', { solutions: 1 }],
  ['solutions architect', { solutions: 1 }], ['solutions consultant', { solutions: 0.9 }],
  ['forward deployed engineer', { solutions: 0.8, software: 0.6 }],
  ['developer advocate', { devrel: 1 }], ['developer relations', { devrel: 1 }], ['devrel', { devrel: 1 }],
  ['developer evangelist', { devrel: 1 }],
  ['customer service', { support: 1 }], ['customer support', { support: 1 }], ['support specialist', { support: 0.8 }],
  ['support engineer', { support: 0.7, solutions: 0.5 }], ['call center', { support: 0.8 }],
  // ---- Engineering leadership
  ['engineering manager', { engmgmt: 1 }], ['eng manager', { engmgmt: 1 }],
  ['engineering lead', { engmgmt: 0.9 }, 4], ['engineering director', { engmgmt: 1 }, 5],
  ['vp eng', { engmgmt: 1 }, 6], ['vpe', { engmgmt: 1 }, 6],
  ['chief technology officer', { engmgmt: 1 }, 7], ['hiring manager', { engmgmt: 0.6 }],
  ['chief information officer', { engmgmt: 0.7, infra: 0.6 }, 7], ['information technology', { infra: 0.6, support: 0.4 }],
  // ---- Product
  ['product manager', { pm: 1 }], ['product management', { pm: 1 }],
  ['associate product manager', { pm: 1 }, 1], ['product owner', { pm: 0.9 }],
  ['group product manager', { pm: 1 }, 4], ['chief product officer', { pm: 1 }, 7],
  ['product marketing', { marketing: 1, pm: 0.35 }],
  ['program manager', { program: 1 }], ['project manager', { program: 1 }], ['project management', { program: 0.9 }],
  ['technical program manager', { program: 1 }], ['scrum master', { program: 0.8 }],
  // ---- Design and research
  ['designer', { design: 1 }], ['design', { design: 1 }], ['ux', { design: 1 }], ['ui', { design: 0.9 }],
  ['creative director', { design: 0.9 }, 5], ['art director', { design: 0.9 }, 5], ['illustrator', { design: 0.8 }],
  ['graphic', { design: 0.9 }], ['interior designer', { design: 0.9 }],
  ['user experience', { design: 1 }], ['ux researcher', { uxr: 1 }], ['ux research', { uxr: 1 }], ['user researcher', { uxr: 1 }],
  ['user research', { uxr: 1 }], ['design researcher', { uxr: 1 }],
  // ---- Data science and analytics
  ['data scientist', { datasci: 1 }], ['data science', { datasci: 1 }], ['decision scientist', { datasci: 1 }],
  ['statistician', { datasci: 0.9 }], ['quantitative analyst', { datasci: 0.8, trading: 0.5, i_fintech: 0.5 }],
  ['quantitative researcher', { datasci: 0.7, trading: 0.7 }], ['quant', { trading: 0.7, datasci: 0.6 }],
  ['modeler', { datasci: 0.6 }], ['data analyst', { analytics: 1 }], ['business intelligence', { analytics: 1 }],
  ['analytics', { analytics: 0.8 }], ['business analyst', { analytics: 0.7 }], ['analyst', { analytics: 0.4 }],
  ['research scientist', { research: 1 }], ['researcher', { research: 1 }],
  ['research assistant', { research: 0.7 }, 1], ['scientist', { research: 0.6 }],
  ['economist', { research: 0.7, policy: 0.3 }],
  ['principal investigator', { research: 1, academia: 0.6 }], ['research associate', { research: 0.8 }],
  ['staff scientist', { research: 0.9 }],
  // ---- Sales, accounts, partnerships
  ['sales', { sales: 1 }], ['account executive', { ae: 1 }], ['sales development', { sdr: 1 }],
  ['business development representative', { sdr: 1 }], ['sales development representative', { sdr: 1 }],
  ['chief revenue officer', { sales: 1 }, 7], ['sales representative', { sales: 1 }], ['sales rep', { sales: 1 }],
  ['sales associate', { sales: 0.6, retail: 0.8 }], ['territory manager', { sales: 0.9 }],
  ['account manager', { accounts: 1 }], ['account management', { accounts: 1 }],
  ['account director', { accounts: 0.9 }, 5], ['customer success', { accounts: 1 }],
  ['relationship manager', { accounts: 0.4, banking: 0.6, wealth: 0.5 }],
  ['partnership', { bizdev: 1 }], ['business development', { bizdev: 1 }], ['partner manager', { bizdev: 0.9 }],
  ['corporate development', { bizdev: 0.8, investing: 0.4 }], ['strategy', { consulting: 0.4, bizdev: 0.4 }],
  // ---- Marketing, growth, communications
  ['marketing', { marketing: 1 }], ['marketer', { marketing: 1 }], ['campaign manager', { marketing: 0.9 }],
  ['brand manager', { marketing: 0.9 }], ['brand', { marketing: 0.8 }], ['seo', { marketing: 0.8 }],
  ['content marketing', { marketing: 1 }], ['social media', { marketing: 0.8 }],
  ['digital marketing', { marketing: 1 }], ['demand generation', { marketing: 0.9, growth: 0.6 }],
  ['content strategist', { marketing: 0.8, editorial: 0.5 }], ['content', { marketing: 0.6, editorial: 0.5 }],
  ['copywriter', { editorial: 0.8, marketing: 0.7 }],
  ['chief marketing officer', { marketing: 1 }, 7], ['growth', { growth: 1, marketing: 0.6 }],
  ['chief commercial officer', { sales: 0.9, bizdev: 0.6 }, 7],
  ['communication', { comms: 1, marketing: 0.5 }], ['public relation', { comms: 1 }],
  ['media relation', { comms: 1 }], ['publicist', { comms: 1 }], ['spokesperson', { comms: 0.9 }],
  ['public affair', { policy: 0.8, comms: 0.6 }], ['investor relation', { finance: 0.6, comms: 0.6 }],
  ['chief communications officer', { comms: 1 }, 7],
  // ---- Recruiting and people
  ['recruiter', { recruiting: 1 }], ['recruiting', { recruiting: 1 }], ['recruitment', { recruiting: 1 }],
  ['talent acquisition', { recruiting: 1 }], ['talent partner', { recruiting: 1 }], ['talent', { recruiting: 0.9 }],
  ['sourcer', { recruiting: 1 }], ['headhunter', { recruiting: 1 }], ['staffing', { recruiting: 0.7 }],
  ['hr', { hr: 1 }], ['hr business partner', { hr: 1 }], ['human resource', { hr: 1 }],
  ['human resources business partner', { hr: 1 }], ['people operation', { hr: 1 }], ['people ops', { hr: 1 }],
  ['people partner', { hr: 1 }], ['chief people officer', { hr: 1 }, 7],
  ['chief human resources officer', { hr: 1 }, 7], ['compensation', { hr: 0.8 }], ['benefit', { hr: 0.6 }],
  ['total rewards', { hr: 0.8 }], ['employee relation', { hr: 0.9 }], ['hris', { hr: 0.8 }],
  ['learning and development', { hr: 0.7, teaching: 0.3 }], ['organizational development', { hr: 0.7 }],
  ['payroll', { accounting: 0.5, hr: 0.4 }],
  // ---- Operations, supply chain, admin
  ['chief of staff', { ops: 0.8 }, 5], ['operation', { ops: 0.8 }], ['operations manager', { ops: 1 }],
  ['bizops', { ops: 0.9 }], ['chief operating officer', { ops: 1 }, 7],
  ['supply chain', { supplychain: 1, ops: 0.6 }], ['logistics', { supplychain: 1 }],
  ['procurement', { supplychain: 0.9 }], ['purchasing', { supplychain: 0.8 }], ['buyer', { supplychain: 0.6, retail: 0.5 }],
  ['warehouse', { supplychain: 0.8 }], ['inventory', { supplychain: 0.7 }], ['distribution', { supplychain: 0.6 }],
  ['facilities', { ops: 0.6 }], ['general manager', { ops: 0.5 }, 5],
  ['executive assistant', { admin: 1 }, 2], ['administrative assistant', { admin: 1 }, 2],
  ['office manager', { admin: 0.8 }, 3], ['office administrator', { admin: 0.8 }], ['receptionist', { admin: 0.8 }],
  ['secretary', { admin: 0.7 }], ['personal assistant', { admin: 0.9 }],
  // ---- Founders, executives, boards
  ['founder', { founder: 1 }, 7], ['co founder', { founder: 1 }, 7], ['cofounder', { founder: 1 }, 7],
  ['chief executive officer', { founder: 1 }, 7], ['entrepreneur', { founder: 0.8 }],
  ['owner', { founder: 0.7 }, 7], ['business owner', { founder: 0.8 }, 7], ['product owner', { pm: 0.9 }],
  ['president', {}, 6], ['vice president', {}, 6], ['assistant vice president', {}, 4],
  ['associate vice president', {}, 4.5], ['executive director', {}, 6], ['managing director', { mgmtdirector: 1 }, 6],
  ['managing partner', {}, 7], ['senior partner', {}, 6.5],
  ['board member', { board: 1 }, 6.5], ['board director', { board: 1 }, 6.5], ['board of director', { board: 1 }, 6.5],
  ['member of the board', { board: 1 }, 6.5], ['board of trustee', { board: 1 }, 6.5], ['trustee', { board: 0.9 }, 6],
  ['chairman', { board: 1 }, 7], ['chairwoman', { board: 1 }, 7], ['chairperson', { board: 1 }, 7],
  ['advisory board', { board: 0.7 }, 5], ['board advisor', { board: 0.7 }, 5],
  // ---- Finance, accounting, banking, investing
  ['finance', { finance: 1 }], ['financial analyst', { finance: 1 }], ['fp a', { finance: 1 }],
  ['financial planning and analysis', { finance: 1 }], ['finance manager', { finance: 1 }],
  ['controller', { finance: 0.7, accounting: 0.7 }], ['comptroller', { finance: 0.7, accounting: 0.7 }],
  ['treasurer', { finance: 0.9 }], ['treasury', { finance: 0.8 }],
  ['chief financial officer', { finance: 1 }, 7], ['chief accounting officer', { accounting: 1, finance: 0.6 }, 7],
  ['accountant', { accounting: 1 }], ['accounting', { accounting: 1 }], ['auditor', { accounting: 0.9 }],
  ['audit', { accounting: 0.8 }], ['internal audit', { accounting: 0.9 }], ['tax', { accounting: 0.7 }],
  ['bookkeeper', { accounting: 0.8 }], ['accounts payable', { accounting: 0.7 }],
  ['accounts receivable', { accounting: 0.7 }], ['assurance', { accounting: 0.7 }],
  ['financial advisor', { wealth: 1 }], ['financial adviser', { wealth: 1 }], ['financial planner', { wealth: 1 }],
  ['wealth advisor', { wealth: 1 }], ['wealth manager', { wealth: 1 }], ['wealth management', { wealth: 1 }],
  ['private wealth', { wealth: 1 }], ['private banker', { wealth: 0.9, banking: 0.5 }],
  ['investment banker', { banking: 1 }], ['investment banking', { banking: 1 }], ['banker', { banking: 1 }],
  ['banking', { banking: 0.8, i_bank: 0.8, i_fintech: 0.6 }], ['corporate banking', { banking: 1 }],
  ['loan officer', { banking: 0.7, i_bank: 0.6 }], ['mortgage', { banking: 0.6, i_fintech: 0.4 }],
  ['teller', { banking: 0.5 }], ['lending', { banking: 0.5, i_fintech: 0.9 }], ['credit analyst', { banking: 0.6, risk: 0.6 }],
  ['portfolio manager', { investing: 1 }], ['fund manager', { investing: 1 }], ['investment manager', { investing: 1 }],
  ['investment analyst', { investing: 1 }], ['investment', { investing: 0.8 }], ['asset manager', { investing: 0.7, propmgmt: 0.4 }],
  ['asset management', { investing: 0.8 }], ['equity research', { investing: 0.7, research: 0.3 }],
  ['investor', { investing: 1 }], ['angel investor', { investing: 1, vc: 0.6 }],
  ['venture capital', { vc: 1, investing: 1 }], ['venture capitalist', { vc: 1, investing: 1 }],
  ['venture partner', { vc: 1, investing: 1 }], ['venture associate', { vc: 1, investing: 1 }, 1],
  ['general partner', { investing: 1, vc: 0.7, pe: 0.7 }, 6], ['private equity', { pe: 1, investing: 1 }],
  ['scout', { investing: 0.7, vc: 0.6 }],
  ['trader', { trading: 1 }], ['trading', { trading: 0.9 }],
  ['risk manager', { risk: 1 }], ['risk management', { risk: 1 }], ['risk', { risk: 0.8 }],
  ['credit risk', { risk: 1, i_fintech: 0.8 }], ['fraud', { risk: 0.7, i_fintech: 0.7 }],
  // ---- Insurance
  ['underwriter', { underwriting: 1 }], ['underwriting', { underwriting: 1, i_fintech: 0.5 }],
  ['actuary', { actuarial: 1 }], ['actuarial', { actuarial: 1, i_fintech: 0.4 }],
  ['claims', { claims: 1 }], ['claims adjuster', { claims: 1 }], ['adjuster', { claims: 0.9 }],
  ['insurance agent', { brokerage: 1, i_insurance: 1 }], ['insurance broker', { brokerage: 1, i_insurance: 1 }],
  ['insurance', { i_insurance: 1, i_fintech: 0.6 }], ['reinsurance', { i_insurance: 1 }],
  ['broker', { brokerage: 1 }], ['brokerage', { brokerage: 0.8 }], ['stockbroker', { brokerage: 1, wealth: 0.6 }],
  // ---- Legal and compliance
  ['lawyer', { legal: 1 }], ['attorney', { legal: 1 }], ['counsel', { legal: 1 }],
  ['general counsel', { legal: 1 }, 6.5], ['associate general counsel', { legal: 1 }, 5],
  ['deputy general counsel', { legal: 1 }, 5.5], ['of counsel', { legal: 1 }, 5],
  ['litigator', { legal: 1 }], ['litigation', { legal: 0.9 }], ['solicitor', { legal: 1 }], ['barrister', { legal: 1 }],
  ['judge', { legal: 0.8 }, 6], ['law clerk', { legal: 0.7 }, 1], ['judicial clerk', { legal: 0.7 }, 1],
  ['legal', { legal: 1 }], ['law', { legal: 0.6 }], ['patent agent', { legal: 0.7 }], ['juris doctor', { legal: 0.7 }],
  ['contracts manager', { legal: 0.6 }], ['legal operations', { legal: 0.7, ops: 0.4 }],
  ['paralegal', { paralegal: 1, legal: 0.5 }], ['legal assistant', { paralegal: 0.8, legal: 0.4 }],
  ['legal secretary', { paralegal: 0.6, admin: 0.5 }],
  ['compliance', { compliance: 1 }], ['compliance officer', { compliance: 1 }],
  ['chief compliance officer', { compliance: 1 }, 7], ['aml', { compliance: 0.8 }], ['kyc', { compliance: 0.8 }],
  ['regulatory', { compliance: 0.6 }], ['regulatory affair', { compliance: 0.7, clinresearch: 0.4 }],
  ['privacy', { compliance: 0.6, legal: 0.5 }],
  // ---- Consulting
  ['consultant', { consulting: 1 }], ['consulting', { consulting: 1 }], ['management consultant', { consulting: 1 }],
  ['strategy consultant', { consulting: 1 }], ['engagement manager', { consulting: 0.8 }], ['advisory', { consulting: 0.7 }],
  // ---- Healthcare: physicians
  ['physician', { physician: 1 }], ['doctor', { physician: 0.9 }], ['surgeon', { physician: 1 }],
  ['hospitalist', { physician: 1 }], ['internist', { physician: 1 }], ['pediatrician', { physician: 1 }],
  ['cardiologist', { physician: 1 }], ['oncologist', { physician: 1 }], ['radiologist', { physician: 1 }],
  ['anesthesiologist', { physician: 1 }], ['neurologist', { physician: 1 }], ['dermatologist', { physician: 1 }],
  ['psychiatrist', { physician: 1, mentalhealth: 0.6 }], ['obstetrician', { physician: 1 }],
  ['gynecologist', { physician: 1 }], ['ob gyn', { physician: 1 }], ['pathologist', { physician: 1 }],
  ['urologist', { physician: 1 }], ['gastroenterologist', { physician: 1 }], ['endocrinologist', { physician: 1 }],
  ['nephrologist', { physician: 1 }], ['pulmonologist', { physician: 1 }], ['ophthalmologist', { physician: 1 }],
  ['intensivist', { physician: 1 }], ['neonatologist', { physician: 1 }], ['orthopedic surgeon', { physician: 1 }],
  ['general practitioner', { physician: 1 }], ['family physician', { physician: 1 }],
  ['attending physician', { physician: 1 }, 3], ['resident physician', { physician: 1 }, 1],
  ['medical resident', { physician: 1 }, 1], ['chief resident', { physician: 1 }, 2], ['fellow physician', { physician: 1 }, 1],
  ['medical director', { physician: 1 }, 5], ['chief medical officer', { physician: 1 }, 7],
  ['medical officer', { physician: 0.8 }], ['clinician', { physician: 0.7, nursing: 0.6, apc: 0.6 }],
  ['medicine', { physician: 0.6 }], ['family medicine', { physician: 0.8 }], ['internal medicine', { physician: 0.8 }],
  ['emergency medicine', { physician: 0.8 }], ['primary care', { physician: 0.6 }], ['critical care', { physician: 0.5, nursing: 0.4 }],
  // Specialties: evidence of clinical work, usually a modifier ("Oncology Nurse").
  ['cardiology', { physician: 0.6 }], ['oncology', { physician: 0.6 }], ['radiology', { physician: 0.6 }],
  ['pediatric', { physician: 0.5 }], ['surgery', { physician: 0.6 }], ['neurology', { physician: 0.6 }],
  ['dermatology', { physician: 0.6 }], ['psychiatry', { physician: 0.6, mentalhealth: 0.5 }],
  ['anesthesiology', { physician: 0.6 }], ['orthopedic', { physician: 0.5 }], ['obstetric', { physician: 0.5 }],
  ['gynecology', { physician: 0.5 }], ['urology', { physician: 0.6 }], ['pathology', { physician: 0.6 }],
  ['gastroenterology', { physician: 0.6 }], ['endocrinology', { physician: 0.6 }], ['nephrology', { physician: 0.6 }],
  ['pulmonology', { physician: 0.6 }], ['ophthalmology', { physician: 0.6 }], ['hematology', { physician: 0.6 }],
  ['rheumatology', { physician: 0.6 }], ['geriatric', { physician: 0.5 }], ['neonatology', { physician: 0.6 }],
  // ---- Healthcare: nursing, advanced practice, pharmacy, allied, mental health
  ['nurse', { nursing: 1 }], ['registered nurse', { nursing: 1 }], ['nursing', { nursing: 0.9 }],
  ['licensed practical nurse', { nursing: 0.9 }], ['licensed vocational nurse', { nursing: 0.9 }],
  ['certified nursing assistant', { nursing: 0.6 }], ['nurse manager', { nursing: 1 }, 4.5],
  ['charge nurse', { nursing: 1 }, 3], ['chief nursing officer', { nursing: 1 }, 7], ['nurse educator', { nursing: 0.9, teaching: 0.4 }],
  ['nurse practitioner', { apc: 1, nursing: 0.6 }], ['physician assistant', { apc: 1, physician: 0.4 }],
  ['physician associate', { apc: 1, physician: 0.4 }], ['pa c', { apc: 1, physician: 0.4 }],
  ['certified registered nurse anesthetist', { apc: 1, nursing: 0.6 }], ['nurse anesthetist', { apc: 1, nursing: 0.6 }],
  ['midwife', { nursing: 0.8, apc: 0.6 }], ['advanced practice', { apc: 0.9 }],
  ['pharmacist', { pharmacy: 1 }], ['pharmacy', { pharmacy: 0.9 }], ['pharmacy technician', { pharmacy: 0.7 }],
  ['clinical pharmacist', { pharmacy: 1 }],
  ['physical therapist', { allied: 1 }], ['occupational therapist', { allied: 1 }], ['respiratory therapist', { allied: 1 }],
  ['speech language pathologist', { allied: 1 }], ['speech therapist', { allied: 1 }], ['physiotherapist', { allied: 1 }],
  ['therapist', { allied: 0.7, mentalhealth: 0.6 }], ['dietitian', { allied: 0.9 }], ['nutritionist', { allied: 0.8 }],
  ['radiologic technologist', { allied: 1 }], ['radiology technician', { allied: 1 }], ['sonographer', { allied: 1 }],
  ['phlebotomist', { allied: 0.8 }], ['medical technologist', { allied: 0.9 }], ['lab technician', { allied: 0.6 }],
  ['paramedic', { allied: 0.9 }], ['emergency medical technician', { allied: 0.9 }], ['medical assistant', { allied: 0.7 }],
  ['surgical technologist', { allied: 0.9 }], ['optometrist', { allied: 0.8, physician: 0.3 }],
  ['psychologist', { mentalhealth: 1 }], ['psychotherapist', { mentalhealth: 1 }], ['counselor', { mentalhealth: 0.7 }],
  ['social worker', { mentalhealth: 0.9 }], ['mental health', { mentalhealth: 0.9 }], ['behavioral health', { mentalhealth: 0.9 }],
  ['dentist', { dental: 1 }], ['orthodontist', { dental: 1 }], ['dental hygienist', { dental: 0.8 }], ['dental', { dental: 0.7 }],
  ['veterinarian', { vet: 1 }], ['veterinary', { vet: 0.8 }],
  // ---- Healthcare: clinical research and administration
  ['clinical research', { clinresearch: 1 }], ['clinical research coordinator', { clinresearch: 1 }],
  ['clinical research associate', { clinresearch: 1 }], ['clinical trial', { clinresearch: 1 }],
  ['clinical operation', { clinresearch: 0.8 }], ['research coordinator', { clinresearch: 0.6, research: 0.5 }],
  ['medical science liaison', { clinresearch: 0.6 }],
  ['practice administrator', { healthadmin: 1 }, 4.5], ['practice manager', { healthadmin: 1 }, 4.5],
  ['hospital administrator', { healthadmin: 1 }, 5], ['healthcare administrator', { healthadmin: 1 }, 4.5],
  ['health administrator', { healthadmin: 1 }, 4.5], ['clinic manager', { healthadmin: 1 }, 4.5],
  ['revenue cycle', { healthadmin: 1 }], ['medical billing', { healthadmin: 0.9 }], ['medical coder', { healthadmin: 0.9 }],
  ['medical coding', { healthadmin: 0.9 }], ['health information', { healthadmin: 0.8 }],
  ['patient access', { healthadmin: 0.7 }], ['patient service', { healthadmin: 0.7 }],
  ['case manager', { nursing: 0.5, healthadmin: 0.5 }], ['care coordinator', { healthadmin: 0.6 }],
  ['clinical informatics', { healthadmin: 0.6, i_health: 1 }],
  // Industry words that show up in titles ("Healthcare Data Scientist")
  ['healthcare', { i_health: 1 }], ['health', { i_health: 1 }], ['clinical', { i_health: 1 }], ['medical', { i_health: 1 }],
  ['hospital', { i_hospital: 1 }], ['pharmaceutical', { i_pharma: 1 }], ['biotech', { i_pharma: 1 }],
  // ---- Education and academia
  ['teacher', { teaching: 1 }], ['teaching', { teaching: 0.9 }], ['educator', { teaching: 0.9 }],
  ['instructor', { teaching: 0.8 }], ['tutor', { teaching: 0.7 }], ['substitute teacher', { teaching: 1 }],
  ['curriculum', { teaching: 0.7 }], ['instructional designer', { teaching: 0.6, design: 0.4 }],
  ['teaching assistant', { teaching: 0.6, academia: 0.5 }, 0],
  ['lecturer', { academia: 1, teaching: 0.6 }], ['senior lecturer', { academia: 1, teaching: 0.6 }, 3],
  ['professor', { academia: 1, research: 0.6 }, 4], ['assistant professor', { academia: 1, research: 0.6 }, 2],
  ['associate professor', { academia: 1, research: 0.6 }, 3], ['adjunct professor', { academia: 0.9 }, 2],
  ['adjunct', { academia: 0.7 }], ['postdoc', { academia: 1, research: 0.7 }, 1],
  ['postdoctoral', { academia: 1, research: 0.7 }, 1], ['phd candidate', { academia: 0.9, research: 0.6 }, 0],
  ['phd student', { academia: 0.9, research: 0.6 }, 0], ['doctoral candidate', { academia: 0.9, research: 0.6 }, 0],
  ['doctoral student', { academia: 0.9, research: 0.6 }, 0], ['phd', { academia: 0.6, research: 0.6 }, 0],
  ['graduate student', { academia: 0.7 }, 0], ['research fellow', { academia: 0.8, research: 0.8 }, 1],
  ['school principal', { schooladmin: 1 }, 5], ['assistant principal', { schooladmin: 1 }, 4],
  ['vice principal', { schooladmin: 1 }, 4], ['headmaster', { schooladmin: 1 }, 6], ['head of school', { schooladmin: 1 }, 6],
  ['dean', { schooladmin: 0.8, academia: 0.6 }, 6], ['provost', { schooladmin: 0.8, academia: 0.5 }, 6.5],
  ['chancellor', { schooladmin: 0.6 }, 7], ['admission', { schooladmin: 0.7 }], ['registrar', { schooladmin: 0.6 }],
  ['academic advisor', { schooladmin: 0.6, teaching: 0.4 }], ['librarian', { teaching: 0.5, academia: 0.4 }],
  ['education', { i_education: 1, teaching: 0.5 }],
  // ---- Government, policy, nonprofit
  ['policy', { policy: 0.9 }], ['public policy', { policy: 1 }], ['policy advisor', { policy: 1 }],
  ['policy analyst', { policy: 1 }], ['government affair', { policy: 1 }], ['government relation', { policy: 1 }],
  ['legislative', { legislative: 1, policy: 0.6 }], ['lobbyist', { policy: 0.9 }], ['advocacy', { policy: 0.7 }],
  ['legislator', { legislative: 1 }, 6], ['lawmaker', { legislative: 1 }, 6], ['congressional', { legislative: 0.9, policy: 0.5 }],
  ['senator', { legislative: 1, policy: 0.5 }, 7], ['state senator', { legislative: 1, policy: 0.5 }, 6],
  ['council member', { legislative: 0.9, policy: 0.5 }, 6], ['councilmember', { legislative: 0.9, policy: 0.5 }, 6],
  ['city councilor', { legislative: 0.9, policy: 0.5 }, 6], ['congressman', { legislative: 1 }, 7],
  ['congresswoman', { legislative: 1 }, 7], ['member of congress', { legislative: 1 }, 7],
  ['member of parliament', { legislative: 1 }, 7], ['state representative', { legislative: 1 }, 6],
  ['assemblymember', { legislative: 1 }, 6], ['assemblyman', { legislative: 1 }, 6], ['assemblywoman', { legislative: 1 }, 6],
  ['alderman', { legislative: 0.9 }, 6], ['alderperson', { legislative: 0.9 }, 6],
  ['mayor', { policy: 0.7 }, 7], ['diplomat', { policy: 0.8 }], ['foreign service officer', { policy: 0.8 }],
  ['civil servant', { policy: 0.5 }], ['government', { i_government: 1, policy: 0.4 }],
  ['program officer', { grants: 1 }], ['grants manager', { grants: 1 }], ['grantmaking', { grants: 1 }],
  ['grant making', { grants: 1 }], ['grant manager', { grants: 1 }],
  ['grant writer', { grants: 0.9, fundraising: 0.6 }], ['grant', { grants: 0.8 }],
  ['development officer', { fundraising: 1 }], ['development director', { fundraising: 0.8 }, 5],
  ['major gift', { fundraising: 1 }], ['fundraising', { fundraising: 1 }], ['fundraiser', { fundraising: 1 }],
  ['philanthropy', { fundraising: 0.8, grants: 0.6 }], ['donor relation', { fundraising: 0.9 }],
  ['advancement', { fundraising: 0.8 }], ['nonprofit', { i_nonprofit: 1 }], ['community organizer', { policy: 0.5 }],
  // ---- Real estate
  ['real estate agent', { realestate: 1 }], ['real estate broker', { realestate: 1, brokerage: 0.8 }],
  ['realtor', { realestate: 1 }], ['real estate', { realestate: 0.8, i_realestate: 1 }],
  ['leasing', { realestate: 0.8, propmgmt: 0.6 }], ['leasing agent', { realestate: 0.9, propmgmt: 0.6 }],
  ['leasing manager', { realestate: 0.8, propmgmt: 0.7 }], ['property manager', { propmgmt: 1 }],
  ['property management', { propmgmt: 1 }], ['appraiser', { realestate: 0.6 }],
  // ---- Retail and hospitality
  ['store manager', { retail: 1 }, 4.5], ['assistant store manager', { retail: 1 }, 3.5],
  ['retail', { retail: 0.8, i_retail: 1 }], ['merchandiser', { retail: 0.8 }], ['merchandising', { retail: 0.8 }],
  ['cashier', { retail: 0.6 }], ['district manager', { retail: 0.6, sales: 0.4 }, 5],
  ['hotel manager', { hospitality: 1 }, 4.5], ['front desk', { hospitality: 0.7 }], ['concierge', { hospitality: 0.7 }],
  ['chef', { hospitality: 0.9 }], ['sous chef', { hospitality: 0.9 }, 3], ['executive chef', { hospitality: 1 }, 5],
  ['restaurant manager', { hospitality: 1 }, 4.5], ['bartender', { hospitality: 0.7 }],
  ['hospitality', { hospitality: 0.8, i_hospitality: 1 }], ['catering', { hospitality: 0.7 }],
  ['event planner', { hospitality: 0.6, marketing: 0.5 }], ['event manager', { hospitality: 0.6, marketing: 0.4 }],
  // ---- Media and creative
  ['journalist', { journalism: 1 }], ['reporter', { journalism: 1 }], ['correspondent', { journalism: 1 }],
  ['columnist', { journalism: 0.9 }], ['anchor', { journalism: 0.8 }], ['news', { journalism: 0.7 }],
  ['editor', { editorial: 1, journalism: 0.6 }], ['editor in chief', { editorial: 1, journalism: 0.6 }, 7],
  ['managing editor', { editorial: 1, journalism: 0.6 }, 5], ['copy editor', { editorial: 1 }],
  ['video editor', { production: 0.9 }], ['writer', { editorial: 0.8 }], ['staff writer', { editorial: 0.9, journalism: 0.7 }],
  ['author', { editorial: 0.6 }], ['publisher', { editorial: 0.6 }, 6], ['publishing', { editorial: 0.5, i_media: 0.8 }],
  ['producer', { production: 1 }], ['executive producer', { production: 1 }, 5],
  ['videographer', { production: 0.8 }], ['cinematographer', { production: 0.8 }], ['photographer', { production: 0.7 }],
  ['film', { production: 0.6 }], ['podcast', { production: 0.6 }], ['broadcast', { journalism: 0.6, production: 0.6 }],
  ['media', { i_media: 1 }],
  // ---- Industry words in titles ("Engineering Manager, Payments")
  ['payment', { i_payments: 1 }], ['billing', { i_payments: 0.9 }], ['checkout', { i_payments: 0.8 }],
  ['ledger', { i_fintech: 0.8, i_payments: 0.6 }], ['fintech', { i_fintech: 1 }],
  ['crypto', { i_crypto: 1 }], ['blockchain', { i_crypto: 1 }], ['web3', { i_crypto: 1 }],
  ['energy', { i_energy: 1 }], ['telecom', { i_telecom: 1 }],
  ['utility', { i_utilities: 1 }], ['grid', { i_utilities: 0.8 }], ['lineworker', { trades: 1 }], ['lineman', { trades: 1 }],
  ['renewable', { i_cleanenergy: 1 }], ['clean energy', { i_cleanenergy: 1 }], ['solar', { i_cleanenergy: 1 }],
  ['higher education', { i_highered: 1 }],
];

/**
 * Leadership words combined with a function noun anywhere in the title
 * ("Head of Talent", "Director of Engineering", "Growth Lead", "Director of
 * Pharmacy") imply that function even when no fixed phrase matched.
 */
export const LEADERSHIP_WORDS: ReadonlySet<string> = new Set([
  'head', 'vp', 'svp', 'evp', 'avp', 'director', 'chief', 'lead', 'manager', 'president', 'supervisor', 'officer',
]);
export const FUNCTION_NOUNS: Readonly<Record<string, string>> = dict({
  engineering: 'engmgmt', eng: 'engmgmt', technology: 'engmgmt',
  product: 'pm', design: 'design', creative: 'design', talent: 'recruiting', recruiting: 'recruiting',
  people: 'hr', sales: 'sales', account: 'accounts', marketing: 'marketing', growth: 'growth',
  partnership: 'bizdev', data: 'datasci', analytics: 'analytics', security: 'security',
  infrastructure: 'infra', operation: 'ops', finance: 'finance', research: 'research',
  nursing: 'nursing', pharmacy: 'pharmacy', medicine: 'physician', legal: 'legal', law: 'legal',
  compliance: 'compliance', communication: 'comms', procurement: 'supplychain', logistics: 'supplychain',
  facilities: 'ops', quality: 'quality', policy: 'policy', accounting: 'accounting', tax: 'accounting',
  audit: 'accounting', risk: 'risk', underwriting: 'underwriting', claims: 'claims', investment: 'investing',
  education: 'teaching', curriculum: 'teaching', admission: 'schooladmin', editorial: 'editorial',
  news: 'journalism', manufacturing: 'mfgeng', hr: 'hr', philanthropy: 'fundraising', advancement: 'fundraising',
  retail: 'retail', store: 'retail', hospitality: 'hospitality', leasing: 'realestate', property: 'propmgmt',
  clinical: 'healthadmin', patient: 'healthadmin', therapy: 'allied', rehabilitation: 'allied',
});
export const LEADERSHIP_NOUN_STRENGTH = 0.9;
/** "<noun> Manager" is a people manager (level 4) only for these functions ("Design Manager"). */
export const PEOPLE_MANAGER_NOUNS: ReadonlySet<string> = new Set([
  'design', 'creative', 'engineering', 'eng', 'recruiting', 'talent', 'research', 'security', 'nurse', 'nursing',
]);
export const PEOPLE_MANAGER_LEVEL = 4;

/** Title words that set a seniority level (max wins). Words inside a matched phrase don't count. */
export const LEVEL_WORDS: Readonly<Record<string, number>> = dict({
  intern: 0, internship: 0, student: 0, candidate: 0, trainee: 0, apprentice: 0,
  junior: 1, jr: 1, associate: 1, entry: 1, resident: 1, fellow: 1.5,
  ii: 2, iii: 2.5, iv: 3,
  senior: 3, sr: 3, attending: 3,
  staff: 4, principal: 4, lead: 4,
  head: 5, director: 5,
  vp: 6, svp: 6.5, evp: 6.5, avp: 4, president: 6, partner: 6, dean: 6, superintendent: 6, chair: 6,
  chief: 7,
});
/** Topics whose holders are managers even without a level word. */
export const TOPIC_DEFAULT_LEVEL: Readonly<Record<string, number>> = dict({ engmgmt: 4.5 });
/** Default seniority level for a title with no level marker. */
export const DEFAULT_LEVEL = 2;

// =============================================================================
// Abbreviations
// =============================================================================
// Expanded on both sides for literal / phrase matching, and turned into title
// evidence by analyzing each expansion like a title. Ambiguous abbreviations
// list every common sense (first = most common). On a row, a sense tied to an
// industry wins when the employer is in that industry ("MD" at a hospital is a
// physician, at a bank a managing director); a query matches any sense (OR).
export type AbbreviationSense = { expansion: string; weight?: number; industries?: readonly string[] };

const HEALTH_INDUSTRIES = ['i_health', 'i_hospital', 'i_pharma'] as const;

export const ABBREVIATIONS: Readonly<Record<string, string | readonly AbbreviationSense[]>> = dict({
  // Software and technical
  swe: 'software engineer', sde: 'software development engineer', sre: 'site reliability engineer',
  mle: 'machine learning engineer', apm: 'associate product manager', tpm: 'technical program manager',
  em: 'engineering manager', eng: 'engineering', ml: 'machine learning', ai: 'artificial intelligence',
  nlp: 'natural language processing', ux: 'user experience', qa: 'quality assurance', sdet: 'software development engineer in test',
  devrel: 'developer relations', fullstack: 'full stack', frontend: 'front end', backend: 'back end', k8s: 'kubernetes',
  it: 'information technology', dba: 'database administrator',
  // Go-to-market and people
  ae: 'account executive', sdr: 'sales development representative', bdr: 'business development representative',
  csm: 'customer success manager', bizdev: 'business development', bd: 'business development',
  pmm: 'product marketing manager', hr: 'human resources', hrbp: 'hr business partner', pr: 'public relations',
  ir: 'investor relations', ea: 'executive assistant', gm: 'general manager',
  ta: [{ expansion: 'talent acquisition' }, { expansion: 'teaching assistant', weight: 0.8, industries: ['i_education'] }],
  // Levels
  vp: 'vice president', svp: 'senior vice president', evp: 'executive vice president', avp: 'assistant vice president',
  sr: 'senior', jr: 'junior', cofounder: 'co founder',
  // C-suite (row-side too: "CHRO" is the chief of HR)
  ceo: 'chief executive officer', cto: 'chief technology officer', cfo: 'chief financial officer',
  coo: 'chief operating officer', ciso: 'chief information security officer', chro: 'chief human resources officer',
  cno: 'chief nursing officer', cao: 'chief accounting officer', gc: 'general counsel',
  cmo: [{ expansion: 'chief marketing officer' }, { expansion: 'chief medical officer', weight: 0.9, industries: HEALTH_INDUSTRIES }],
  cpo: [{ expansion: 'chief product officer' }, { expansion: 'chief people officer', weight: 0.9 }],
  cro: [{ expansion: 'chief revenue officer' }, { expansion: 'chief risk officer', weight: 0.8, industries: ['i_bank', 'i_insurance', 'i_fintech', 'i_investing'] }],
  cco: [{ expansion: 'chief compliance officer' }, { expansion: 'chief commercial officer', weight: 0.9 }, { expansion: 'chief communications officer', weight: 0.8 }],
  cio: [{ expansion: 'chief information officer' }, { expansion: 'chief investment officer', weight: 0.9, industries: ['i_investing', 'i_bank', 'i_insurance'] }],
  cdo: [{ expansion: 'chief data officer' }, { expansion: 'chief digital officer', weight: 0.9 }],
  // Finance, legal
  md: [{ expansion: 'managing director' }, { expansion: 'medical doctor physician', industries: HEALTH_INDUSTRIES }],
  pm: [{ expansion: 'product manager' }, { expansion: 'project manager', weight: 0.75 }],
  pe: [{ expansion: 'private equity' }, { expansion: 'professional engineer', weight: 0.6 }],
  vc: 'venture capital', ib: 'investment banking', cpa: 'certified public accountant',
  cfa: 'chartered financial analyst', cfp: 'certified financial planner', fpa: 'financial planning and analysis',
  esq: 'attorney', jd: 'juris doctor',
  // Healthcare
  rn: 'registered nurse', lpn: 'licensed practical nurse', lvn: 'licensed vocational nurse',
  cna: 'certified nursing assistant', np: 'nurse practitioner', aprn: 'nurse practitioner',
  fnp: 'family nurse practitioner', crna: 'certified registered nurse anesthetist',
  pa: [{ expansion: 'physician assistant', industries: HEALTH_INDUSTRIES }],
  pharmd: 'pharmacist', dds: 'dentist', dmd: 'dentist', dvm: 'veterinarian',
  dpt: 'physical therapist', slp: 'speech language pathologist', lcsw: 'licensed clinical social worker',
  emt: 'emergency medical technician', cra: 'clinical research associate', crc: 'clinical research coordinator',
  // Education, research, public sector and nonprofit
  phd: 'phd', postdoc: 'postdoctoral', pi: 'principal investigator', ra: 'research assistant',
  ed: 'executive director', cos: 'chief of staff', ld: 'legislative director', dg: 'director general',
  aa: 'administrative assistant', pio: 'public information officer',
});

// =============================================================================
// Query vocabulary
// =============================================================================
export type Band = { lo: number; hi: number; label: string };

export const BAND_SENIOR: Band = { lo: 3, hi: 4.5, label: 'senior or above' };
export const BAND_STAFF: Band = { lo: 4, hi: 4.5, label: 'staff / principal' };
export const BAND_LEAD: Band = { lo: 4, hi: 5, label: 'lead' };
export const BAND_LEADERSHIP: Band = { lo: 5, hi: 7, label: 'leadership (head / director / VP / C-level / board)' };
export const BAND_CLEVEL: Band = { lo: 7, hi: 7, label: 'C-level' };
export const BAND_JUNIOR: Band = { lo: 0, hi: 1.5, label: 'junior' };
export const BAND_INTERN: Band = { lo: 0, hi: 0.5, label: 'intern' };
export const BAND_MID: Band = { lo: 2, hi: 2.5, label: 'mid-level' };

export function bandForLevel(level: number): Band | undefined {
  if (level >= 7) return BAND_CLEVEL;
  if (level >= 5) return BAND_LEADERSHIP;
  if (level >= 4) return BAND_STAFF;
  if (level >= 3) return BAND_SENIOR;
  if (level <= 1) return BAND_JUNIOR;
  return undefined;
}

/**
 * `skill`: a technology or skill ("kubernetes", "python"): credited to related
 * roles, but not itself a role, so the query is not a role query.
 */
export type QueryTriggerSpec = { phrase: string; topics?: TopicWeights; band?: Band; hire?: boolean; skill?: boolean };

/** Query-only phrasings (override a title phrasing with the same words). */
export const QUERY_TRIGGERS: ReadonlyArray<QueryTriggerSpec> = [
  { phrase: 'engineer', topics: { engineering: 1 } },
  { phrase: 'engineering', topics: { engineering: 1, engmgmt: 0.9 } },
  { phrase: 'eng', topics: { engineering: 1 } },
  { phrase: 'dev', topics: { software: 1 } },
  // A specialty asks for the specialist; generic software engineers are related.
  { phrase: 'backend', topics: { backend: 1 } }, { phrase: 'back end', topics: { backend: 1 } },
  { phrase: 'frontend', topics: { frontend: 1 } }, { phrase: 'front end', topics: { frontend: 1 } },
  { phrase: 'ui engineer', topics: { frontend: 1 } },
  { phrase: 'full stack', topics: { frontend: 1, backend: 1 } }, { phrase: 'fullstack', topics: { frontend: 1, backend: 1 } },
  { phrase: 'ios', topics: { mobile: 1 } }, { phrase: 'android', topics: { mobile: 1 } },
  { phrase: 'mobile', topics: { mobile: 1 } }, { phrase: 'mobile engineer', topics: { mobile: 1 } },
  { phrase: 'mobile developer', topics: { mobile: 1 } },
  { phrase: 'web', topics: { frontend: 0.8, software: 0.6 } },
  { phrase: 'gtm', topics: { sales: 1, marketing: 0.8, bizdev: 0.6 } },
  { phrase: 'go to market', topics: { sales: 1, marketing: 0.8, bizdev: 0.6 } },
  { phrase: 'programming', topics: { software: 1 } }, { phrase: 'coding', topics: { software: 1 } },
  { phrase: 'cloud', topics: { infra: 0.8 } },
  { phrase: 'data', topics: { datasci: 0.8, dataeng: 0.8, analytics: 0.8 } },
  { phrase: 'ai', topics: { ml: 1 } }, { phrase: 'ml', topics: { ml: 1 } },
  { phrase: 'product', topics: { pm: 0.9 } },
  { phrase: 'seller', topics: { sales: 1 } },
  { phrase: 'people', topics: {} }, // filler in natural language ("people working on ...")
  { phrase: 'hr', topics: { hr: 1, recruiting: 0.5 } },
  { phrase: 'investing', topics: { investing: 1 } }, { phrase: 'angel', topics: { investing: 1 } },
  { phrase: 'venture', topics: { vc: 1 } },
  // Startup fundraising (investors) or nonprofit fundraising (development officers).
  { phrase: 'fundraising', topics: { investing: 1, fundraising: 1 } },
  { phrase: 'startup founder', topics: { founder: 1 } },
  { phrase: 'insurtech', topics: { i_fintech: 1 } }, { phrase: 'financial technology', topics: { i_fintech: 1 } },
  { phrase: 'healthtech', topics: { i_health: 1 } }, { phrase: 'medtech', topics: { i_health: 1 } },
  // Healthcare
  { phrase: 'doctor', topics: { physician: 1 } }, { phrase: 'clinician', topics: { physician: 1, nursing: 1, apc: 1, allied: 0.6 } },
  { phrase: 'clinical', topics: { i_health: 1, physician: 0.7, nursing: 0.7, apc: 0.7 } },
  { phrase: 'medical', topics: { i_health: 1, physician: 0.6 } },
  { phrase: 'healthcare', topics: { i_health: 1 } }, { phrase: 'health care', topics: { i_health: 1 } },
  { phrase: 'health', topics: { i_health: 1 } },
  { phrase: 'hospital', topics: { i_hospital: 1 } }, { phrase: 'health system', topics: { i_hospital: 1 } },
  { phrase: 'pharma', topics: { i_pharma: 1 } }, { phrase: 'pharmaceutical', topics: { i_pharma: 1 } },
  { phrase: 'biotech', topics: { i_pharma: 1 } }, { phrase: 'biopharma', topics: { i_pharma: 1 } },
  { phrase: 'life science', topics: { i_pharma: 1 } },
  // Finance and other industries
  { phrase: 'bank', topics: { i_bank: 1 } }, { phrase: 'banking', topics: { banking: 1, i_bank: 1 } },
  { phrase: 'financial service', topics: { i_bank: 1, i_insurance: 0.6, i_fintech: 0.6, i_investing: 0.6 } },
  { phrase: 'insurance', topics: { i_insurance: 1 } }, { phrase: 'insurer', topics: { i_insurance: 1 } },
  { phrase: 'fintech', topics: { i_fintech: 1 } },
  { phrase: 'law firm', topics: { i_law: 1 } }, { phrase: 'law', topics: { legal: 1, i_law: 1 } },
  { phrase: 'consulting firm', topics: { i_consulting: 1, consulting: 1 } },
  { phrase: 'accounting firm', topics: { i_accounting: 1 } }, { phrase: 'big 4', topics: { i_accounting: 1, i_consulting: 0.8 } },
  { phrase: 'big four', topics: { i_accounting: 1, i_consulting: 0.8 } },
  { phrase: 'education', topics: { i_education: 1 } }, { phrase: 'school', topics: { i_education: 1 } },
  { phrase: 'university', topics: { i_highered: 1, academia: 0.6 } }, { phrase: 'college', topics: { i_highered: 1 } },
  { phrase: 'higher education', topics: { i_highered: 1 } }, { phrase: 'higher ed', topics: { i_highered: 1 } },
  { phrase: 'academia', topics: { academia: 1, i_highered: 0.8 } }, { phrase: 'academic', topics: { academia: 1, i_highered: 0.8 } },
  { phrase: 'government', topics: { i_government: 1 } }, { phrase: 'public sector', topics: { i_government: 1 } },
  { phrase: 'federal', topics: { i_government: 1 } },
  { phrase: 'nonprofit', topics: { i_nonprofit: 1 } }, { phrase: 'non profit', topics: { i_nonprofit: 1 } },
  { phrase: 'not for profit', topics: { i_nonprofit: 1 } }, { phrase: 'ngo', topics: { i_nonprofit: 1 } },
  { phrase: 'charity', topics: { i_nonprofit: 1 } },
  { phrase: 'foundation', topics: { i_foundation: 1 } }, { phrase: 'philanthropy', topics: { i_foundation: 1, fundraising: 0.6 } },
  // Occupation cues: who funds, who legislates, who covers a beat.
  { phrase: 'funder', topics: { grants: 1, i_foundation: 0.8 } }, { phrase: 'grant maker', topics: { grants: 1, i_foundation: 0.8 } },
  { phrase: 'grantmaker', topics: { grants: 1, i_foundation: 0.8 } },
  { phrase: 'lawmaker', topics: { legislative: 1 } }, { phrase: 'legislator', topics: { legislative: 1 } },
  { phrase: 'elected official', topics: { legislative: 1, policy: 0.5 } }, { phrase: 'politician', topics: { legislative: 1 } },
  { phrase: 'congress', topics: { legislative: 1 } }, { phrase: 'capitol hill', topics: { legislative: 1 } },
  { phrase: 'newspaper', topics: { journalism: 1, editorial: 0.7, i_media: 0.5 } },
  { phrase: 'magazine', topics: { journalism: 1, editorial: 0.8, i_media: 0.5 } },
  { phrase: 'outlet', topics: { journalism: 1, editorial: 0.7, i_media: 0.5 } },
  { phrase: 'news outlet', topics: { journalism: 1, editorial: 0.7, i_media: 0.5 } },
  { phrase: 'media outlet', topics: { journalism: 1, editorial: 0.7, i_media: 0.5 } },
  { phrase: 'publication', topics: { journalism: 1, editorial: 0.8 } }, { phrase: 'newsroom', topics: { journalism: 1, editorial: 0.7 } },
  { phrase: 'cover', topics: { journalism: 1, editorial: 0.6 } }, { phrase: 'covering', topics: { journalism: 1, editorial: 0.6 } },
  { phrase: 'write about', topics: { journalism: 1, editorial: 0.8 } }, { phrase: 'writes about', topics: { journalism: 1, editorial: 0.8 } },
  { phrase: 'writing about', topics: { journalism: 1, editorial: 0.8 } }, { phrase: 'report on', topics: { journalism: 1, editorial: 0.6 } },
  { phrase: 'reports on', topics: { journalism: 1, editorial: 0.6 } }, { phrase: 'reporting on', topics: { journalism: 1, editorial: 0.6 } },
  { phrase: 'retail', topics: { i_retail: 1, retail: 0.8 } },
  { phrase: 'hospitality', topics: { i_hospitality: 1, hospitality: 0.8 } }, { phrase: 'hotel', topics: { i_hospitality: 1 } },
  { phrase: 'restaurant', topics: { i_hospitality: 1 } },
  { phrase: 'real estate', topics: { i_realestate: 1, realestate: 1 } },
  { phrase: 'media', topics: { i_media: 1 } }, { phrase: 'entertainment', topics: { i_media: 1 } },
  { phrase: 'energy', topics: { i_energy: 1 } }, { phrase: 'oil and gas', topics: { i_energy: 1 } },
  { phrase: 'utility', topics: { i_utilities: 1 } }, { phrase: 'electric utility', topics: { i_utilities: 1 } },
  { phrase: 'power company', topics: { i_utilities: 1 } }, { phrase: 'grid', topics: { i_utilities: 1 } },
  { phrase: 'renewable', topics: { i_cleanenergy: 1 } }, { phrase: 'renewable energy', topics: { i_cleanenergy: 1 } },
  { phrase: 'clean energy', topics: { i_cleanenergy: 1 } }, { phrase: 'solar', topics: { i_cleanenergy: 1 } },
  { phrase: 'wind', topics: { i_cleanenergy: 1 } }, { phrase: 'cleantech', topics: { i_cleanenergy: 1 } },
  { phrase: 'climate tech', topics: { i_cleanenergy: 1 } },
  { phrase: 'manufacturing', topics: { i_manufacturing: 1, mfgeng: 0.6 } },
  { phrase: 'automotive', topics: { i_manufacturing: 1 } }, { phrase: 'aerospace', topics: { i_manufacturing: 1, hardware: 0.6 } },
  { phrase: 'telecom', topics: { i_telecom: 1 } }, { phrase: 'telecommunication', topics: { i_telecom: 1 } },
  { phrase: 'tech', topics: { i_tech: 1 } }, { phrase: 'tech company', topics: { i_tech: 1 } },
  { phrase: 'saas', topics: { i_tech: 1 } },
  // Technologies: associated with a function, credited as a related role (not an exact one).
  { phrase: 'kubernetes', topics: { infra: 0.4 }, skill: true }, { phrase: 'k8s', topics: { infra: 0.4 }, skill: true },
  { phrase: 'docker', topics: { infra: 0.4 }, skill: true }, { phrase: 'terraform', topics: { infra: 0.4 }, skill: true },
  { phrase: 'react', topics: { frontend: 0.6 }, skill: true }, { phrase: 'javascript', topics: { frontend: 0.5, software: 0.5 }, skill: true },
  { phrase: 'typescript', topics: { frontend: 0.5, software: 0.5 }, skill: true }, { phrase: 'python', topics: { software: 0.4, datasci: 0.3 }, skill: true },
  { phrase: 'golang', topics: { software: 0.5 }, skill: true }, { phrase: 'pytorch', topics: { ml: 0.6 }, skill: true },
  { phrase: 'tensorflow', topics: { ml: 0.6 }, skill: true },
  // Seniority
  { phrase: 'senior', band: BAND_SENIOR }, { phrase: 'sr', band: BAND_SENIOR }, { phrase: 'experienced', band: BAND_SENIOR },
  { phrase: 'staff', band: BAND_STAFF }, { phrase: 'principal', band: BAND_STAFF }, { phrase: 'lead', band: BAND_LEAD },
  { phrase: 'head', band: BAND_LEADERSHIP }, { phrase: 'director', band: BAND_LEADERSHIP },
  { phrase: 'vp', band: BAND_LEADERSHIP }, { phrase: 'vice president', band: BAND_LEADERSHIP },
  { phrase: 'svp', band: BAND_LEADERSHIP }, { phrase: 'evp', band: BAND_LEADERSHIP },
  { phrase: 'executive', band: BAND_LEADERSHIP }, { phrase: 'exec', band: BAND_LEADERSHIP },
  { phrase: 'leader', band: BAND_LEADERSHIP }, { phrase: 'leadership', band: BAND_LEADERSHIP },
  { phrase: 'senior leadership', band: BAND_LEADERSHIP }, { phrase: 'management', band: BAND_LEADERSHIP },
  { phrase: 'administrator', band: BAND_LEADERSHIP }, { phrase: 'decision maker', band: BAND_LEADERSHIP },
  { phrase: 'chief', band: BAND_CLEVEL }, { phrase: 'c level', band: BAND_CLEVEL }, { phrase: 'c suite', band: BAND_CLEVEL },
  { phrase: 'junior', band: BAND_JUNIOR }, { phrase: 'jr', band: BAND_JUNIOR }, { phrase: 'entry level', band: BAND_JUNIOR },
  { phrase: 'intern', band: BAND_INTERN }, { phrase: 'internship', band: BAND_INTERN },
  { phrase: 'mid level', band: BAND_MID },
  // Intent verbs: the people who can help you hire, not the hires themselves.
  { phrase: 'hire', hire: true }, { phrase: 'hiring', hire: true }, { phrase: 'recruit', hire: true },
];

/** Natural-language filler dropped from queries (never matched on its own). */
export const QUERY_STOPWORDS_RAW: ReadonlyArray<string> = [
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'with', 'from', 'by', 'as', 'into',
  'who', 'whom', 'that', 'which', 'what', 'someone', 'somebody', 'anyone', 'anybody', 'person',
  'folks', 'me', 'my', 'i', 'we', 'us', 'our', 'you', 'your', 'can', 'could', 'would', 'should', 'will', 'help',
  'find', 'looking', 'look', 'need', 'needs', 'want', 'wants', 'know', 'knows', 'work', 'works', 'working',
  'worked', 'is', 'are', 'was', 'be', 'been', 'good', 'great', 'best', 'strong', 'expert', 'like', 'about',
  'some', 'any', 'one', 'do', 'does', 'doing', 'get', 'connect', 'intro', 'introduce', 'talk', 'ask',
  'advice', 'contact', 'contacts', 'connections', 'connection', 'network', 'guy', 'guys', 'there', 'here',
  'this', 'these', 'those', 'it', 'its', 'app', 'apps', 'review', 'reviews', 'company', 'companies', 'firm',
  'firms', 'either', 'also', 'currently', 'now', 'right', 'ex', 'former', 'formerly', 'industry', 'industries',
  'space', 'sector', 'field', 'area', 'role', 'roles', 'job', 'jobs', 'position', 'positions', 'organization',
  'organizations', 'org', 'orgs', 'team', 'teams', 'type', 'kind', 'background', 'experience', 'someplace',
  'please', 'show', 'list', 'all', 'every', 'other', 'who\'s', 'whos', 'mine', 'friend', 'friends', 'colleague',
  'colleagues', 'individual', 'individuals', 'professional', 'professionals', 'worker', 'workers', 'staffer',
  // Greetings and politeness: never a role, a company or an acronym ("hi" is not "Head of Innovation").
  'hi', 'hey', 'hello', 'thanks', 'thank', 'thx', 'pls', 'plz', 'ok', 'okay', 'yes', 'so',
];

/**
 * Frequent short English words (3-5 letters). Typed in lowercase, such a word
 * is read as itself, never as bare initials ("runs" is not "Retail Unit
 * Navigator", "act" is not "Account Coordinator Trainee"); typed in capitals
 * ("RUN") it may still be an acronym. Established acronyms (ABBREVIATIONS) are
 * unaffected. Keep org acronyms that aren't English words out (doe, nih, epa).
 */
export const COMMON_ENGLISH_WORDS: ReadonlyArray<string> = [
  // Function words, pronouns, determiners, adverbs
  'all', 'and', 'any', 'are', 'but', 'can', 'did', 'for', 'had', 'has', 'her', 'him', 'his', 'how', 'its',
  'may', 'nor', 'not', 'now', 'off', 'old', 'one', 'our', 'out', 'own', 'per', 'she', 'the', 'too', 'two',
  'via', 'was', 'way', 'who', 'why', 'yet', 'you', 'also', 'away', 'back', 'been', 'both', 'each', 'even',
  'ever', 'from', 'have', 'here', 'into', 'just', 'less', 'many', 'more', 'most', 'much', 'must', 'next',
  'only', 'once', 'over', 'same', 'some', 'soon', 'such', 'than', 'that', 'them', 'then', 'they', 'this',
  'thus', 'upon', 'very', 'were', 'what', 'when', 'whom', 'with', 'your', 'about', 'above', 'after', 'again',
  'along', 'among', 'being', 'below', 'could', 'every', 'first', 'other', 'their', 'there', 'these', 'those',
  'three', 'under', 'until', 'where', 'which', 'while', 'whose', 'would', 'four', 'five', 'nine', 'ten', 'six',
  // Common verbs
  'act', 'add', 'aim', 'ask', 'buy', 'cut', 'die', 'dig', 'eat', 'end', 'fit', 'fix', 'fly', 'get', 'got',
  'go', 'hit', 'let', 'lie', 'log', 'pay', 'put', 'ran', 'run', 'saw', 'say', 'see', 'set', 'sit', 'try',
  'use', 'win', 'won', 'bring', 'build', 'built', 'call', 'came', 'care', 'come', 'deal', 'does', 'done',
  'draw', 'drive', 'fall', 'feel', 'fill', 'find', 'gave', 'give', 'goes', 'gone', 'grow', 'hear', 'held',
  'help', 'hold', 'hope', 'join', 'keep', 'kept', 'know', 'knew', 'lead', 'left', 'lend', 'like', 'live',
  'look', 'lose', 'lost', 'love', 'made', 'make', 'mean', 'meet', 'met', 'move', 'need', 'open', 'pick',
  'plan', 'play', 'pull', 'push', 'read', 'rely', 'rest', 'ride', 'rise', 'said', 'save', 'seek', 'seem',
  'sell', 'send', 'sent', 'show', 'shut', 'sold', 'spend', 'stay', 'stop', 'take', 'talk', 'tell', 'tend',
  'test', 'told', 'took', 'turn', 'used', 'vote', 'wait', 'walk', 'want', 'went', 'wish', 'work', 'write',
  'wrote', 'allow', 'apply', 'begin', 'carry', 'catch', 'check', 'choose', 'cover', 'fight', 'guide', 'learn',
  'leave', 'match', 'offer', 'order', 'plant', 'print', 'raise', 'reach', 'serve', 'share', 'solve',
  'speak', 'stand', 'start', 'study', 'teach', 'think', 'thank', 'train', 'trust', 'visit', 'watch',
  // Common nouns and adjectives
  'age', 'air', 'art', 'bad', 'bag', 'bar', 'bed', 'big', 'bit', 'box', 'boy', 'bus', 'car', 'cat', 'day',
  'dog', 'due', 'ear', 'egg', 'eye', 'far', 'fee', 'few', 'fun', 'gap', 'gas', 'hot', 'ice', 'ill', 'job',
  'key', 'kid', 'law', 'leg', 'lot', 'low', 'man', 'map', 'men', 'mix', 'net', 'new', 'odd', 'oil', 'pen',
  'pet', 'pop', 'raw', 'red', 'row', 'sea', 'sky', 'son', 'sun', 'tax', 'tea', 'tie', 'tip', 'top', 'toy',
  'war', 'web', 'wet', 'yes', 'area', 'army', 'baby', 'bank', 'base', 'bear', 'best', 'bill', 'bird', 'blue',
  'body', 'book', 'born', 'busy', 'camp', 'card', 'case', 'cash', 'city', 'club', 'cold', 'cool', 'copy',
  'core', 'cost', 'crew', 'dark', 'data', 'date', 'dead', 'dear', 'deep', 'desk', 'door', 'down', 'easy',
  'edge', 'else', 'fair', 'farm', 'fast', 'fear', 'file', 'film', 'fine', 'fire', 'firm', 'fish',
  'flat', 'food', 'foot', 'form', 'free', 'full', 'fund', 'game', 'gift', 'girl', 'goal', 'gold', 'good',
  'half', 'hall', 'hand', 'hard', 'head', 'high', 'hill', 'home', 'hour', 'huge', 'idea', 'item', 'kind',
  'king', 'lack', 'lady', 'land', 'last', 'late', 'life', 'line', 'list', 'long', 'main', 'mind', 'miss',
  'mode', 'name', 'near', 'news', 'nice', 'note', 'page', 'pair', 'park', 'part', 'past', 'path',
  'peak', 'plus', 'poor', 'real', 'rich', 'road', 'rock', 'role', 'room', 'rule', 'safe', 'sale', 'seat',
  'self', 'ship', 'shop', 'side', 'sign', 'site', 'size', 'slow', 'soft', 'song', 'sort', 'star', 'step',
  'sure', 'task', 'team', 'term', 'text', 'time', 'tool', 'tour', 'town', 'tree', 'trip', 'true', 'type',
  'unit', 'vast', 'view', 'wall', 'warm', 'week', 'well', 'west', 'east', 'wide', 'wife', 'wind', 'wood',
  'word', 'year', 'zero', 'zone', 'block', 'board', 'brand', 'bread', 'break', 'brief', 'broad', 'chair',
  'cheap', 'chief', 'child', 'claim', 'class', 'clean', 'clear', 'close', 'coach', 'count', 'court', 'crowd',
  'daily', 'dream', 'early', 'earth', 'empty', 'enemy', 'entry', 'equal', 'event', 'exact', 'extra', 'faith',
  'field', 'final', 'floor', 'focus', 'force', 'frame', 'fresh', 'front', 'fruit', 'funny', 'great', 'green',
  'group', 'happy', 'heart', 'heavy', 'horse', 'hotel', 'house', 'human', 'image', 'issue', 'large', 'later',
  'level', 'light', 'local', 'lucky', 'lunch', 'major', 'maybe', 'metal', 'minor', 'model', 'money', 'month',
  'moral', 'mouth', 'music', 'night', 'noise', 'north', 'novel', 'ocean', 'paper', 'party', 'peace', 'phone',
  'piece', 'place', 'plane', 'point', 'power', 'press', 'price', 'pride', 'prime', 'prize', 'proof', 'quick',
  'quiet', 'radio', 'range', 'rapid', 'ready', 'right', 'river', 'round', 'route', 'scale', 'scene', 'sense',
  'shape', 'sharp', 'sheet', 'short', 'skill', 'sleep', 'small', 'smart', 'smile', 'solid', 'sound', 'south',
  'space', 'speed', 'sport', 'staff', 'stage', 'state', 'steel', 'stock', 'stone', 'store', 'story', 'style',
  'sugar', 'table', 'taste', 'thing', 'title', 'today', 'total', 'touch', 'tough', 'trade', 'truth', 'value',
  'voice', 'water', 'wheel', 'white', 'whole', 'woman', 'world', 'worth', 'young', 'youth',
];

// =============================================================================
// Word families: agent nouns and activities share a stem
// =============================================================================
// A typed word matches its family members in titles at reduced weight ("the
// typed form scores higher"), and a family member that is a known phrasing
// stands in for a typed word the vocabulary lacks. First member = family key.
export const WORD_FAMILIES: ReadonlyArray<readonly string[]> = [
  ['underwriter', 'underwriting', 'underwrite'], ['recruiter', 'recruiting', 'recruitment'],
  ['consultant', 'consulting', 'consultancy'], ['investor', 'investing', 'investment'],
  ['designer', 'design'], ['lawyer', 'law', 'legal'], ['nurse', 'nursing'], ['teacher', 'teaching'],
  ['analyst', 'analytics', 'analysis'], ['accountant', 'accounting'], ['marketer', 'marketing'],
  ['researcher', 'research'], ['producer', 'production'], ['editor', 'editorial', 'editing'],
  ['writer', 'writing'], ['trader', 'trading'], ['banker', 'banking'], ['advisor', 'adviser', 'advisory'],
  ['economist', 'economics'], ['pharmacist', 'pharmacy'], ['therapist', 'therapy'], ['auditor', 'audit', 'auditing'],
  ['planner', 'planning'], ['strategist', 'strategy'], ['scientist', 'science'], ['educator', 'education'],
  ['administrator', 'administration'], ['coordinator', 'coordination'], ['investigator', 'investigation'],
  ['statistician', 'statistics'], ['journalist', 'journalism'], ['photographer', 'photography'],
  ['architect', 'architecture'], ['tutor', 'tutoring'], ['coach', 'coaching'], ['seller', 'sales', 'selling'],
  ['buyer', 'buying'], ['broker', 'brokerage'], ['lender', 'lending'], ['fundraiser', 'fundraising'],
  ['organizer', 'organizing'], ['publisher', 'publishing'], ['programmer', 'programming'],
  ['lobbyist', 'lobbying'], ['litigator', 'litigation'], ['actuary', 'actuarial'], ['physician', 'medicine'],
  ['surgeon', 'surgery'], ['dentist', 'dentistry', 'dental'], ['manufacturer', 'manufacturing'],
  ['operator', 'operation'], ['developer', 'development'], ['engineer', 'engineering'], ['manager', 'management'],
  ['realtor', 'realty'], ['insurer', 'insurance'], ['recruit', 'recruiter'], ['cook', 'cooking'],
  ['paralegal'], ['diplomat', 'diplomacy'], ['psychologist', 'psychology'], ['biologist', 'biology'],
  ['chemist', 'chemistry'], ['physicist', 'physics'], ['mathematician', 'mathematics'],
  ['legislator', 'legislative', 'legislation', 'legislature'], ['grantmaker', 'grantmaking'],
];

// =============================================================================
// Companies
// =============================================================================
/** Trailing legal-form words dropped from company names ("Google LLC" = "Google"). */
export const LEGAL_SUFFIXES: ReadonlySet<string> = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'plc', 'gmbh', 'sa',
  'ag', 'llp', 'lp', 'pllc', 'pc', 'nv', 'bv', 'srl', 'spa', 'sas', 'pty', 'pte', 'kk', 'ab', 'oy', 'se',
]);

/**
 * Parent / brand / subsidiary groups: any member satisfies a query for any
 * other member (labeled as an alias match). General public knowledge.
 */
export const COMPANY_ALIAS_GROUPS: ReadonlyArray<readonly string[]> = [
  ['google', 'alphabet', 'deepmind', 'google deepmind', 'youtube', 'waymo', 'verily', 'fitbit', 'google cloud'],
  ['meta', 'facebook', 'instagram', 'whatsapp', 'oculus', 'meta platforms'],
  ['amazon', 'aws', 'amazon web services', 'whole foods', 'whole foods market', 'zappos', 'twitch', 'audible'],
  ['microsoft', 'linkedin', 'github'],
  ['block', 'square', 'cash app', 'afterpay'],
  ['paypal', 'venmo', 'braintree'],
  ['jpmorgan', 'jpmorgan chase', 'chase', 'j p morgan'],
  ['bank of america', 'bofa', 'merrill', 'merrill lynch'],
  ['citi', 'citigroup', 'citibank'],
  ['morgan stanley', 'e trade', 'etrade'],
  ['kaiser permanente', 'kaiser', 'the permanente medical group', 'permanente medical group', 'kaiser foundation health plan'],
  ['deloitte', 'monitor deloitte', 'deloitte consulting', 'deloitte touche tohmatsu'],
  ['ey', 'ernst young', 'ey parthenon'],
  ['pwc', 'pricewaterhousecoopers', 'price waterhouse coopers', 'strategy and', 'strategyand'],
  ['mckinsey', 'mckinsey company'],
  ['bcg', 'boston consulting group'],
  ['unitedhealth group', 'unitedhealthcare', 'optum', 'uhg'],
  ['cvs health', 'cvs', 'aetna', 'cvs pharmacy', 'caremark'],
  ['salesforce', 'slack', 'tableau', 'mulesoft'],
  ['oracle', 'oracle health', 'cerner'],
  ['ibm', 'red hat'],
  ['johnson johnson', 'j j', 'janssen'],
  ['walmart', 'sams club'],
  ['general electric', 'ge', 'ge healthcare', 'ge aerospace', 'ge vernova'],
  ['disney', 'walt disney', 'the walt disney company', 'espn', 'pixar', 'marvel', 'hulu'],
  ['comcast', 'nbcuniversal', 'nbc universal', 'nbc', 'universal pictures'],
  ['at t', 'att'],
  ['berkshire hathaway', 'geico'],
  ['hca', 'hca healthcare'],
  ['uber', 'uber eats', 'postmates'],
  ['booking holdings', 'booking com', 'priceline', 'kayak'],
  ['expedia', 'expedia group', 'vrbo'],
  ['marriott', 'marriott international', 'ritz carlton'],
  ['hilton', 'hilton worldwide'],
  ['blackrock', 'ishares'],
  ['fidelity', 'fidelity investments'],
  ['goldman sachs', 'goldman'],
];

/** Well-known companies per industry (a generic, public-knowledge list). */
export const KNOWN_INDUSTRY: Readonly<Record<string, readonly string[]>> = dict({
  i_payments: [
    'stripe', 'square', 'block', 'paypal', 'venmo', 'braintree', 'adyen', 'checkout com', 'worldpay',
    'fiserv', 'global payments', 'visa', 'mastercard', 'american express', 'amex', 'marqeta', 'plaid',
    'klarna', 'afterpay', 'affirm', 'wise', 'remitly', 'payoneer', 'bill com', 'toast', 'shopify payments',
  ],
  i_fintech: [
    'ramp', 'brex', 'robinhood', 'coinbase', 'chime', 'sofi', 'mercury', 'capital one', 'nubank', 'revolut',
    'monzo', 'n26', 'wealthfront', 'betterment', 'carta', 'credit karma', 'lendingclub', 'upstart', 'kraken',
    'jpmorgan chase', 'jpmorgan', 'goldman sachs', 'morgan stanley', 'wells fargo', 'bank of america', 'citi',
    'intuit',
  ],
  i_crypto: ['coinbase', 'kraken', 'binance', 'circle', 'chainalysis', 'ripple', 'consensys', 'gemini trust'],
  i_bank: [
    'jpmorgan chase', 'jpmorgan', 'chase', 'bank of america', 'citi', 'citigroup', 'citibank', 'wells fargo',
    'goldman sachs', 'morgan stanley', 'us bank', 'u s bank', 'pnc', 'truist', 'capital one', 'td bank',
    'bmo', 'hsbc', 'barclays', 'deutsche bank', 'ubs', 'credit suisse', 'bnp paribas', 'santander', 'citizens bank',
    'fifth third bank', 'keybank', 'regions bank', 'huntington bank', 'charles schwab', 'lazard', 'evercore',
    'jefferies', 'rbc', 'rbc capital markets', 'scotiabank', 'societe generale', 'mizuho', 'mufg', 'nomura', 'ally',
  ],
  i_investing: [
    'blackrock', 'vanguard', 'fidelity', 'fidelity investments', 'state street', 'pimco', 't rowe price',
    'blackstone', 'kkr', 'carlyle', 'apollo global management', 'tpg', 'bain capital', 'warburg pincus',
    'sequoia capital', 'andreessen horowitz', 'a16z', 'accel', 'benchmark', 'greylock', 'kleiner perkins',
    'lightspeed venture partners', 'index ventures', 'general catalyst', 'insight partners', 'tiger global',
    'bridgewater', 'citadel', 'two sigma', 'de shaw', 'renaissance technologies', 'point72', 'millennium',
    'y combinator', 'softbank', 'thoma bravo', 'vista equity partners',
  ],
  i_insurance: [
    'state farm', 'allstate', 'progressive', 'geico', 'liberty mutual', 'nationwide', 'travelers', 'chubb',
    'aig', 'metlife', 'prudential', 'new york life', 'northwestern mutual', 'massmutual', 'aflac', 'the hartford',
    'hartford', 'farmers insurance', 'usaa', 'lemonade', 'root insurance', 'oscar health', 'axa', 'allianz',
    'zurich', 'aon', 'marsh', 'marsh mclennan', 'willis towers watson', 'gallagher', 'lincoln financial', 'principal financial',
    'humana', 'cigna', 'anthem', 'elevance health', 'aetna', 'unitedhealthcare', 'blue cross blue shield', 'lloyds',
  ],
  i_hospital: [
    'kaiser permanente', 'mayo clinic', 'cleveland clinic', 'johns hopkins medicine', 'johns hopkins hospital',
    'massachusetts general hospital', 'mass general brigham', 'hca healthcare', 'hca', 'ascension', 'commonspirit health',
    'providence', 'trinity health', 'advocate health', 'atrium health', 'intermountain health', 'sutter health',
    'mount sinai', 'nyu langone', 'nyu langone health', 'new york presbyterian', 'cedars sinai', 'stanford health care',
    'ucsf health', 'ucla health', 'penn medicine', 'northwell health', 'baylor scott white', 'memorial sloan kettering',
    'md anderson', 'tenet healthcare', 'community health systems', 'kaiser', 'banner health', 'geisinger',
    'sanford health', 'ochsner health', 'christianacare', 'unc health', 'duke health', 'michigan medicine',
  ],
  i_health: [
    'epic systems', 'cerner', 'oracle health', 'teladoc', 'one medical', 'unitedhealth group', 'optum', 'cvs health',
    'walgreens', 'mckesson', 'cardinal health', 'labcorp', 'quest diagnostics', 'athenahealth', 'veeva',
    'hims hers', 'ro', 'zocdoc', 'flatiron health', 'tempus', 'doximity', 'davita', 'fresenius',
  ],
  i_pharma: [
    'pfizer', 'johnson johnson', 'merck', 'abbvie', 'bristol myers squibb', 'eli lilly', 'lilly', 'novartis',
    'roche', 'genentech', 'astrazeneca', 'gsk', 'glaxosmithkline', 'sanofi', 'novo nordisk', 'bayer', 'amgen',
    'gilead', 'gilead sciences', 'regeneron', 'vertex', 'vertex pharmaceuticals', 'biogen', 'moderna', 'takeda',
    'boehringer ingelheim', 'teva', 'illumina', 'thermo fisher scientific', 'medtronic', 'abbott', 'stryker',
    'boston scientific', 'baxter', 'becton dickinson', 'bd', 'iqvia', 'janssen',
  ],
  i_law: [
    'kirkland ellis', 'latham watkins', 'skadden', 'skadden arps', 'baker mckenzie', 'dla piper', 'dentons',
    'sidley austin', 'white case', 'jones day', 'morgan lewis', 'gibson dunn', 'sullivan cromwell', 'davis polk',
    'cravath', 'wachtell lipton', 'simpson thacher', 'paul weiss', 'ropes gray', 'covington burling', 'wilmerhale',
    'cooley', 'wilson sonsini', 'fenwick west', 'goodwin procter', 'orrick', 'hogan lovells', 'clifford chance',
    'allen overy', 'linklaters', 'freshfields', 'norton rose fulbright', 'mayer brown', 'quinn emanuel',
    'king spalding', 'weil gotshal', 'debevoise', 'milbank', 'perkins coie', 'morrison foerster', 'k l gates',
  ],
  i_consulting: [
    'mckinsey', 'boston consulting group', 'bcg', 'bain', 'bain company', 'deloitte', 'monitor deloitte', 'accenture',
    'pwc', 'strategy and', 'ey', 'ey parthenon', 'kpmg', 'oliver wyman', 'kearney', 'a t kearney', 'roland berger',
    'lek consulting', 'l e k consulting', 'booz allen hamilton', 'capgemini', 'alvarez marsal', 'fti consulting',
    'huron', 'guidehouse', 'zs associates', 'slalom', 'protiviti', 'north highland', 'simon kucher', 'navigant',
    'cognizant', 'infosys', 'wipro', 'tata consultancy services', 'ibm consulting',
  ],
  i_accounting: [
    'deloitte', 'pwc', 'pricewaterhousecoopers', 'ey', 'ernst young', 'kpmg', 'grant thornton', 'bdo', 'rsm',
    'crowe', 'baker tilly', 'cbiz', 'moss adams', 'plante moran', 'cohnreznick', 'marcum', 'eisneramper', 'forvis',
  ],
  i_education: [
    'harvard', 'stanford', 'mit', 'yale', 'princeton', 'columbia', 'berkeley', 'uc berkeley', 'caltech',
    'teach for america', 'khan academy', 'coursera', 'edx', 'pearson', 'mcgraw hill', 'kaplan', 'chegg', 'duolingo',
  ],
  // Universities by common short name (names with "University" / "College" are caught by keywords).
  i_highered: [
    'harvard', 'stanford', 'mit', 'yale', 'princeton', 'columbia', 'berkeley', 'uc berkeley', 'caltech', 'ucla', 'ucsf',
    'ucsd', 'uc davis', 'uc irvine', 'usc', 'nyu', 'cmu', 'carnegie mellon', 'georgia tech', 'umich', 'upenn', 'uchicago',
    'northwestern', 'cornell', 'dartmouth', 'johns hopkins', 'vanderbilt', 'emory', 'georgetown', 'umass', 'uconn',
    'uva', 'unc', 'uiuc', 'utexas', 'ut austin', 'purdue', 'ohio state', 'penn state', 'rutgers', 'cuny', 'suny',
    'oxford', 'imperial college', 'lse', 'eth zurich', 'epfl', 'mcgill', 'kaust', 'wharton', 'kellogg', 'insead',
  ],
  i_government: [
    'united nations', 'world bank', 'imf', 'international monetary fund', 'nasa', 'nih', 'cdc', 'fda', 'fbi', 'cia',
    'irs', 'us army', 'us navy', 'us air force', 'usaid', 'white house', 'state department', 'federal reserve',
    'epa', 'usda', 'nsf', 'national science foundation', 'noaa', 'gao', 'cbo', 'omb', 'hhs', 'dod', 'ferc', 'nrel',
    'federal energy regulatory commission', 'census bureau', 'ftc', 'fcc', 'sec', 'eia', 'oecd', 'european commission',
    'tennessee valley authority', 'tva', 'bonneville power administration',
  ],
  i_foundation: [
    'gates foundation', 'bill melinda gates foundation', 'ford foundation', 'rockefeller foundation', 'macarthur foundation',
    'hewlett foundation', 'william and flora hewlett foundation', 'packard foundation', 'robert wood johnson foundation',
    'kresge foundation', 'w k kellogg foundation', 'bloomberg philanthropies', 'open society foundations', 'wellcome trust',
    'pew charitable trusts', 'carnegie corporation of new york', 'walton family foundation', 'arnold ventures',
    'chan zuckerberg initiative', 'schmidt futures', 'open philanthropy', 'knight foundation', 'lumina foundation',
    'annie e casey foundation', 'doris duke foundation', 'simons foundation', 'sloan foundation', 'moore foundation',
    'national science foundation', 'mott foundation', 'skoll foundation', 'omidyar network', 'bezos earth fund',
  ],
  i_nonprofit: [
    'red cross', 'american red cross', 'united way', 'salvation army', 'habitat for humanity', 'unicef',
    'world wildlife fund', 'wwf', 'doctors without borders', 'save the children', 'oxfam', 'feeding america',
    'ymca', 'boys girls clubs of america', 'gates foundation', 'bill melinda gates foundation', 'ford foundation',
    'rockefeller foundation', 'wikimedia foundation', 'mozilla foundation', 'aclu', 'big brothers big sisters',
  ],
  i_retail: [
    'walmart', 'target', 'costco', 'costco wholesale', 'kroger', 'home depot', 'the home depot', 'lowes', 'best buy',
    'macys', 'nordstrom', 'kohls', 'tj maxx', 'tjx', 'ross stores', 'gap', 'old navy', 'nike', 'adidas', 'ikea',
    'walgreens', 'cvs pharmacy', 'albertsons', 'safeway', 'publix', 'aldi', 'trader joes', 'rei', 'sephora', 'ulta beauty',
    'lululemon', 'h m', 'zara', 'dollar general', 'dollar tree', 'wayfair', 'etsy', 'ebay',
  ],
  i_hospitality: [
    'marriott', 'marriott international', 'hilton', 'hyatt', 'ihg', 'intercontinental hotels group', 'accor',
    'four seasons', 'wyndham', 'choice hotels', 'airbnb', 'mgm resorts', 'caesars entertainment', 'starbucks',
    'mcdonalds', 'chipotle', 'darden', 'sodexo', 'aramark', 'compass group', 'yum brands', 'royal caribbean',
    'carnival', 'disney parks', 'ritz carlton',
  ],
  i_realestate: [
    'cbre', 'jll', 'jones lang lasalle', 'cushman wakefield', 'colliers', 'newmark', 'compass', 'keller williams',
    'coldwell banker', 'century 21', 'sothebys international realty', 're max', 'remax', 'redfin', 'zillow',
    'opendoor', 'prologis', 'simon property group', 'brookfield properties', 'equity residential', 'avalonbay',
    'greystar', 'related companies', 'tishman speyer', 'hines', 'berkshire hathaway homeservices',
  ],
  i_media: [
    'new york times', 'the new york times', 'washington post', 'the washington post', 'wall street journal',
    'dow jones', 'bloomberg', 'reuters', 'associated press', 'cnn', 'nbc', 'nbcuniversal', 'abc news', 'cbs', 'fox',
    'fox news', 'npr', 'bbc', 'the guardian', 'vox media', 'conde nast', 'hearst', 'netflix', 'disney', 'warner bros',
    'warner bros discovery', 'paramount', 'sony pictures', 'universal music group', 'spotify', 'iheartmedia', 'buzzfeed',
    'axios', 'politico', 'the atlantic', 'penguin random house', 'simon schuster', 'harpercollins',
  ],
  i_energy: [
    'exxonmobil', 'exxon', 'chevron', 'shell', 'bp', 'conocophillips', 'totalenergies', 'schlumberger', 'slb',
    'halliburton', 'baker hughes', 'occidental petroleum', 'marathon petroleum', 'valero', 'phillips 66', 'equinor',
    'eni', 'repsol', 'saudi aramco', 'aramco', 'kinder morgan', 'enbridge', 'williams companies', 'cheniere',
  ],
  // Electric / gas utilities, grid operators (ISOs / RTOs) and utility regulators.
  i_utilities: [
    'duke energy', 'nextera energy', 'florida power light', 'fpl', 'southern company', 'georgia power', 'dominion energy',
    'pg e', 'pge', 'pacific gas and electric', 'con edison', 'consolidated edison', 'exelon', 'comed', 'national grid',
    'xcel energy', 'dte energy', 'consumers energy', 'cms energy', 'entergy', 'firstenergy', 'aep',
    'american electric power', 'eversource', 'pseg', 'public service enterprise group', 'sempra', 'sdg e',
    'san diego gas electric', 'edison international', 'southern california edison', 'sce', 'ameren', 'centerpoint energy',
    'pacificorp', 'portland general electric', 'puget sound energy', 'evergy', 'alliant energy', 'wec energy group',
    'avangrid', 'nisource', 'ppl', 'ppl electric utilities', 'pepco', 'bge', 'baltimore gas and electric', 'oncor',
    'tennessee valley authority', 'tva', 'bonneville power administration', 'smud', 'ladwp',
    'los angeles department of water and power', 'iberdrola', 'enel', 'edf', 'e on', 'eon', 'rwe', 'engie',
    'vattenfall', 'scottishpower', 'sse', 'octopus energy', 'uniper', 'hydro quebec', 'ontario power generation',
    'miso', 'midcontinent independent system operator', 'pjm', 'pjm interconnection', 'caiso', 'california iso',
    'ercot', 'nyiso', 'iso new england', 'iso ne', 'southwest power pool', 'spp', 'nerc', 'ferc',
    'federal energy regulatory commission',
  ],
  i_cleanenergy: [
    'orsted', 'first solar', 'sunrun', 'enphase', 'enphase energy', 'sunpower', 'vestas', 'siemens gamesa',
    'nextera energy', 'nextera energy resources', 'brookfield renewable', 'invenergy', 'pattern energy', 'tesla energy',
    'fluence', 'plug power', 'bloom energy', 'form energy', 'commonwealth fusion systems', 'redwood materials',
  ],
  i_manufacturing: [
    'boeing', 'airbus', 'lockheed martin', 'raytheon', 'rtx', 'northrop grumman', 'general dynamics', 'general electric',
    'ge aerospace', 'honeywell', '3m', 'caterpillar', 'deere', 'john deere', 'siemens', 'bosch', 'ford', 'ford motor',
    'general motors', 'gm', 'toyota', 'honda', 'tesla', 'stellantis', 'volkswagen', 'bmw', 'emerson', 'parker hannifin',
    'eaton', 'dow', 'dupont', 'basf', 'procter gamble', 'p g', 'spacex', 'blue origin', 'whirlpool', 'cummins',
  ],
  i_telecom: [
    'at t', 'att', 'verizon', 't mobile', 'comcast', 'charter communications', 'spectrum', 'vodafone', 'orange',
    'deutsche telekom', 'telefonica', 'bt', 'sprint', 'lumen technologies', 'cox communications', 'rogers', 'bell',
    'telus', 'ericsson', 'nokia',
  ],
  i_tech: [
    'google', 'alphabet', 'apple', 'microsoft', 'amazon', 'meta', 'facebook', 'netflix', 'nvidia', 'salesforce',
    'oracle', 'ibm', 'intel', 'adobe', 'cisco', 'uber', 'lyft', 'airbnb', 'doordash', 'snowflake', 'datadog',
    'atlassian', 'shopify', 'spotify', 'workday', 'servicenow', 'hubspot', 'zoom', 'slack', 'dropbox', 'twilio',
    'notion', 'figma', 'canva', 'openai', 'anthropic', 'linkedin', 'github', 'zendesk', 'okta', 'palantir',
  ],
  i_ai: ['openai', 'anthropic', 'deepmind', 'google deepmind', 'cohere', 'hugging face', 'scale ai', 'mistral ai', 'nvidia'],
  i_security: ['okta', 'crowdstrike', 'palo alto networks', 'zscaler', 'fortinet', 'sentinelone', 'wiz', 'snyk'],
});

/**
 * Company-name words that reveal an industry ("... Hospital", "... Therapeutics",
 * "... Credit Union", "... LLP"). `words` must equal a whole token, `phrases` a
 * token run, `prefixes` start a token, `last` must be the final token.
 * `unlessKnown`: skipped when the company is a known company of another industry
 * (LLP is also the legal form of the big accounting firms).
 */
export type CompanyKeywordSpec = {
  industry: string;
  words?: readonly string[];
  phrases?: readonly string[];
  prefixes?: readonly string[];
  last?: readonly string[];
  unlessKnown?: boolean;
};

export const COMPANY_KEYWORDS: ReadonlyArray<CompanyKeywordSpec> = [
  { industry: 'i_payments', words: ['pay', 'payments', 'payment', 'billing'], prefixes: ['pay'] },
  { industry: 'i_fintech', words: ['fintech', 'finance', 'financial', 'lending', 'credit', 'wealth', 'money', 'loans'] },
  { industry: 'i_crypto', words: ['crypto', 'blockchain', 'web3', 'bitcoin', 'ethereum'] },
  { industry: 'i_bank', words: ['bank', 'bancorp', 'bancshares', 'banking', 'savings'], phrases: ['credit union', 'federal credit union', 'trust company'] },
  {
    industry: 'i_hospital',
    words: ['hospital', 'hospitals', 'clinic', 'clinics', 'infirmary'],
    phrases: ['medical center', 'health system', 'health systems', 'healthcare system', 'medical group', 'health network', 'physicians group', 'children s hospital', 'health care system'],
  },
  {
    industry: 'i_health',
    words: ['health', 'healthcare', 'medical', 'care', 'clinical', 'medicine', 'wellness', 'dental', 'pharmacy', 'hospice', 'rehab', 'rehabilitation'],
    prefixes: ['health'],
  },
  {
    industry: 'i_pharma',
    words: ['therapeutics', 'pharma', 'pharmaceutical', 'pharmaceuticals', 'biotech', 'biosciences', 'bioscience', 'biologics', 'biopharma', 'genomics', 'oncology', 'biotherapeutics', 'diagnostics', 'medicines'],
    prefixes: ['bio'],
  },
  { industry: 'i_insurance', words: ['insurance', 'mutual', 'assurance', 'reinsurance', 'underwriters', 'casualty', 'indemnity', 'insurers'], prefixes: ['insur'] },
  { industry: 'i_law', words: ['law', 'legal', 'attorneys', 'lawyers', 'esq', 'llp'], phrases: ['law firm', 'law group', 'law offices', 'law office'], unlessKnown: true },
  { industry: 'i_consulting', words: ['consulting', 'consultants', 'consultancy', 'advisory', 'advisors'] },
  { industry: 'i_accounting', words: ['accounting', 'accountants', 'cpas', 'cpa', 'audit', 'tax'] },
  {
    industry: 'i_education',
    words: ['university', 'college', 'school', 'schools', 'academy', 'education', 'educational', 'isd', 'polytechnic', 'seminary', 'conservatory'],
    phrases: ['school district', 'public schools', 'institute of technology', 'community college'],
  },
  {
    industry: 'i_highered',
    words: ['university', 'universities', 'univ', 'universidad', 'universite', 'universitat', 'college', 'polytechnic', 'seminary', 'conservatory', 'uc', 'suny', 'cuny'],
    phrases: ['institute of technology', 'community college', 'graduate school', 'school of', 'u of', 'state university', 'faculty of', 'college of'],
  },
  {
    industry: 'i_government',
    words: ['government', 'federal', 'ministry', 'county', 'municipal', 'municipality', 'senate', 'congress', 'parliament', 'governor', 'commonwealth', 'legislature', 'congressional', 'embassy', 'consulate'],
    phrases: ['department of', 'city of', 'state of', 'office of', 'house of representatives', 'u s department', 'us department', 'bureau of', 'county of', 'agency for', 'state assembly', 'city council', 'county council', 'national laboratory', 'national lab', 'public utilities commission', 'public utility commission', 'public service commission'],
    last: ['administration', 'authority', 'commission', 'agency'],
  },
  {
    industry: 'i_nonprofit',
    words: ['foundation', 'association', 'society', 'charity', 'charities', 'alliance', 'coalition', 'nonprofit', 'nonprofits', 'ngo', 'charitable', 'philanthropies'],
    phrases: ['non profit', 'not for profit', 'united way', 'center for', 'centre for', 'institute for', 'council on', 'council for', 'policy institute', 'think tank', 'community fund', 'relief fund', 'action fund', 'defense fund', 'fund for', 'trust for'],
  },
  { industry: 'i_foundation', words: ['foundation', 'foundations', 'philanthropies', 'philanthropy', 'endowment'], phrases: ['charitable trust', 'charitable trusts', 'fund for'] },
  { industry: 'i_retail', words: ['retail', 'stores', 'store', 'supermarket', 'supermarkets', 'grocery', 'grocers', 'boutique', 'outlet', 'outlets', 'mart'] },
  { industry: 'i_hospitality', words: ['hotel', 'hotels', 'resort', 'resorts', 'hospitality', 'restaurant', 'restaurants', 'inn', 'suites', 'casino', 'catering', 'cafe', 'bistro', 'brewery'] },
  { industry: 'i_realestate', words: ['realty', 'realtors', 'properties', 'property', 'homes', 'apartments', 'reit'], phrases: ['real estate', 'realty group', 'land company'] },
  {
    industry: 'i_media',
    words: ['media', 'news', 'publishing', 'publishers', 'entertainment', 'broadcasting', 'radio', 'television', 'tv', 'magazine', 'films', 'pictures', 'records', 'productions', 'studios', 'press', 'newspaper', 'newspapers', 'gazette', 'tribune', 'herald', 'chronicle', 'courier', 'dispatch', 'inquirer', 'newsroom', 'journalism', 'daily', 'weekly'],
    phrases: ['wire service', 'news service', 'news agency', 'public radio', 'public media'],
    last: ['times', 'post', 'journal', 'observer', 'examiner', 'sentinel', 'bulletin', 'ledger', 'globe', 'reporter'],
  },
  { industry: 'i_energy', words: ['energy', 'oil', 'gas', 'petroleum', 'nuclear', 'lng', 'pipeline', 'pipelines', 'midstream', 'refining', 'drilling'] },
  {
    industry: 'i_utilities',
    words: ['utilities', 'utility', 'electric', 'edison', 'power'],
    phrases: ['gas electric', 'gas and electric', 'power light', 'power and light', 'light and power', 'water and power', 'public utilities commission', 'public utility commission', 'public service commission', 'utilities commission', 'utility commission', 'utilities board', 'public utility district', 'electric cooperative', 'power authority', 'system operator', 'independent system operator', 'power pool', 'grid operator'],
  },
  { industry: 'i_cleanenergy', words: ['solar', 'wind', 'renewables', 'renewable', 'cleantech', 'geothermal', 'hydrogen', 'climate'], phrases: ['clean energy', 'clean power'] },
  { industry: 'i_manufacturing', words: ['manufacturing', 'industries', 'industrial', 'motors', 'automotive', 'aerospace', 'steel', 'chemicals', 'chemical', 'materials', 'machinery', 'robotics', 'defense', 'aviation', 'semiconductor', 'semiconductors'] },
  { industry: 'i_telecom', words: ['telecom', 'telecommunications', 'wireless', 'broadband', 'cellular'] },
  { industry: 'i_tech', words: ['software', 'technologies', 'tech', 'labs', 'cloud', 'data', 'digital', 'systems', 'io', 'ai', 'saas', 'app', 'apps', 'computing', 'analytics', 'robotics'] },
  { industry: 'i_ai', words: ['ai', 'ml'] },
  { industry: 'i_security', words: ['security', 'cyber', 'cybersecurity'], prefixes: ['cyber'] },
  { industry: 'i_investing', words: ['ventures', 'venture', 'vc', 'equity', 'investments', 'investment', 'asset', 'hedge'], last: ['capital', 'partners', 'fund'] },
];

/**
 * Industries whose companies imply a role at reduced strength (as in "the
 * people at an AI lab do ML"), damped when the title names an unrelated function.
 */
export const INDUSTRY_ROLE_DUAL: Readonly<Record<string, string>> = dict({
  i_ai: 'ml', i_security: 'security', i_investing: 'investing',
});

/** Industries where a bare "Engineer" means a physical (not software) engineer. */
export const PHYSICAL_ENGINEERING_INDUSTRIES: ReadonlySet<string> = new Set([
  'i_manufacturing', 'i_energy', 'i_utilities', 'i_cleanenergy', 'i_telecom',
]);

/**
 * Generic titles take their function from the employer's industry when the
 * title alone doesn't name one: "Partner" at a law firm is legal, "Analyst" at
 * a bank is banking / finance, "Consultant" at a hospital is clinical.
 * `words` are title words or phrases; `topics` the inferred functions.
 */
export type GenericTitleSpec = {
  industries: readonly string[];
  words: readonly string[];
  topics: TopicWeights;
  label: string;
  /** The employer overrides the word's own reading (a hospital "Consultant" is clinical, not management consulting). */
  replacesTitleReading?: boolean;
};

export const GENERIC_TITLES: ReadonlyArray<GenericTitleSpec> = [
  {
    industries: ['i_law'], label: 'a law firm', topics: { legal: 1 },
    words: ['partner', 'associate', 'senior associate', 'counsel', 'of counsel', 'shareholder', 'member', 'managing partner', 'principal', 'staff attorney'],
  },
  {
    industries: ['i_bank'], label: 'a bank', topics: { banking: 1, finance: 0.8 },
    words: ['analyst', 'associate', 'vice president', 'vp', 'managing director', 'director', 'principal', 'officer', 'executive director', 'avp', 'assistant vice president'],
  },
  {
    industries: ['i_investing'], label: 'an investment firm', topics: { investing: 1 },
    words: ['analyst', 'associate', 'senior associate', 'principal', 'partner', 'vice president', 'vp', 'managing director', 'director', 'managing partner'],
  },
  {
    industries: ['i_consulting'], label: 'a consulting firm', topics: { consulting: 1 },
    words: ['analyst', 'associate', 'senior associate', 'business analyst', 'manager', 'senior manager', 'principal', 'partner', 'director', 'managing director', 'associate partner'],
  },
  {
    industries: ['i_accounting'], label: 'an accounting firm', topics: { accounting: 1 },
    words: ['associate', 'senior associate', 'staff', 'senior', 'manager', 'senior manager', 'partner', 'director'],
  },
  {
    industries: ['i_hospital', 'i_health'], label: 'a healthcare provider', topics: { physician: 1 }, replacesTitleReading: true,
    words: ['consultant', 'fellow', 'resident', 'attending', 'registrar', 'house officer', 'staff physician'],
  },
  {
    industries: ['i_education'], label: 'a school or university', topics: { schooladmin: 1 },
    words: ['principal', 'superintendent', 'provost', 'president', 'dean'],
  },
  {
    industries: ['i_education'], label: 'a school or university', topics: { academia: 1 },
    words: ['fellow', 'research fellow', 'faculty', 'faculty member', 'visiting scholar', 'scholar'],
  },
  {
    industries: ['i_nonprofit', 'i_education', 'i_hospital'], label: 'a nonprofit / school / hospital', topics: { fundraising: 1 },
    words: ['development', 'director of development', 'development manager', 'development associate', 'gift officer'],
  },
  {
    industries: ['i_government'], label: 'a government agency', topics: { policy: 1 },
    words: ['analyst', 'advisor', 'adviser', 'senior advisor', 'specialist', 'officer', 'staffer', 'aide'],
  },
  {
    industries: ['i_realestate'], label: 'a real estate firm', topics: { realestate: 1 },
    words: ['agent', 'broker', 'associate', 'salesperson', 'principal', 'partner', 'associate broker'],
  },
  {
    industries: ['i_insurance'], label: 'an insurer', topics: { brokerage: 0.8, underwriting: 0.5 },
    words: ['agent', 'broker', 'producer', 'account executive'],
  },
  {
    industries: ['i_retail'], label: 'a retailer', topics: { retail: 1 },
    words: ['associate', 'sales associate', 'manager', 'assistant manager', 'keyholder', 'specialist', 'team member', 'supervisor', 'general manager'],
  },
  {
    industries: ['i_hospitality'], label: 'a hospitality business', topics: { hospitality: 1 },
    words: ['general manager', 'manager', 'server', 'host', 'associate', 'team member', 'supervisor'],
  },
  {
    industries: ['i_media'], label: 'a media company', topics: { production: 0.6, editorial: 0.6 },
    words: ['host', 'contributor', 'director'],
  },
];
