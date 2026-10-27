// Builds the per-query candidate pools the two labelers grade. Ranker-independent on purpose: a row is in a
// query's pool when it matches the query's broad, hand-written rule below. Nothing here scores or orders rows
// by relevance; candidates are listed in row-id order.
//
// Rule for each query:
//   1. TERMS: a term matches when the case-insensitive regex \b(?:term) finds it in the row's Position, Company
//      or Note (a word-start match, so "dispatch" also matches "dispatcher"). A term written "=ag" must match a
//      whole word (\b(?:ag)\b), used only for short abbreviations that would otherwise match the start of
//      unrelated words ("ag" in "agent").
//   2. SECTORS: every row whose generator sector (sectors.json, the employer's industry) starts with one of the
//      listed prefixes.
//   3. NOTES: for note queries, every row that has a Note.
//   4. AUDIT: AUDIT_PER_QUERY extra rows drawn at random (seeded per query) from the rows the rule left out.
//      Labelers do not know which rows these are. Any audit row graded > 0 is evidence that the rule missed
//      relevant people; merge_labels.mjs reports it.
// Run: node bench/holdout5/labeling/build_pools.mjs   (re-runnable; output is byte-identical)
// Writes pools/<queryId>.md (what the labelers read: the query, its intent, and one JSON candidate per line) and pool_manifest.json (rule vs audit ids; for the
// merge script and the adjudicator only, never for labelers).
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const H5 = path.join(HERE, '..');
const AUDIT_PER_QUERY = 15;

const rows = JSON.parse(fs.readFileSync(path.join(H5, 'connections.json'), 'utf8'));
const queries = JSON.parse(fs.readFileSync(path.join(H5, 'queries.json'), 'utf8'));
const sectors = JSON.parse(fs.readFileSync(path.join(HERE, 'sectors.json'), 'utf8'));

// Deliberately broad: synonyms, abbreviations, related roles, the industries involved, and common distractors.
export const RULES = {
  v01: { terms: ['air traffic', 'atc', 'controller', 'tower', 'airspace', 'faa', 'federal aviation', 'traffic'], sectors: ['aviation/faa', 'aviation/atc-contract', 'military/'] },
  v02: { terms: ['agronom', 'crop', 'soil', 'seed', 'plant breed', 'extension', '=ag', 'agri', 'precision', 'grower', 'farm'], sectors: ['agriculture/'] },
  v03: { terms: ['chief', 'pilot', 'aviator', 'captain', 'capt', 'first officer', 'flight operations', 'flight instructor', 'check airman'], sectors: [] },
  v04: { terms: ['a&p', 'airframe', 'powerplant', 'mechanic', 'maintenance', 'avionics', 'aircraft inspector', 'quality inspector', 'engine technician', 'sheet metal', 'crew chief', 'mro', 'aircraft', 'aviation maintenance', 'airworthiness'], sectors: ['aviation/mro'] },
  v05: { terms: ['dp', 'director of photography', 'photograph', 'cinemat', 'camera', 'aerial', 'videograph', 'gaffer', 'grip', 'steadicam', '1st ac', 'film'], sectors: ['media/film-tv', 'media/aerial-film', 'media/freelance'] },
  v06: { terms: ['ems', 'emergency', 'paramedic', 'emt', 'medic', 'ambulance', 'flight nurse', 'nurse', 'first responder', 'rescue', 'firefighter', 'ff/pm'], sectors: ['public-safety/ems', 'public-safety/fire', 'public-safety/911', 'aviation/air-medical'] },
  v07: { terms: ['uas', 'suas', 'drone', 'unmanned', 'rpa', 'remote pilot', 'part 107', '107', 'bvlos', 'mq-9', 'autonom', 'dfr', 'aerial', 'photogramm', 'lidar'], sectors: ['drones/'] },
  v08: { terms: ['cfi', 'cfii', '=mei', 'instructor', 'flight school', 'training', 'teach', 'examiner', 'flight academy'], sectors: ['aviation/flight-training', 'aviation/university'] },
  v09: { terms: ['vfx', 'visual effect', 'effects', 'compositor', '=fx', '=cg', 'animat', 'lighting artist', 'matte', 'roto', 'layout artist', 'pipeline td', 'technical artist', 'post-production', 'colorist', 'editor'], sectors: ['media/vfx', 'media/games', 'media/film-tv'] },
  v10: { terms: ['aerospace', 'aeronaut', 'aerodynam', 'aero', 'propulsion', 'stress', 'structur', 'flight test', 'avionics', 'gnc'], sectors: ['aerospace/', 'drones/evtol'] },
  v11: { terms: ['fire', 'chief', 'marshal', 'battalion', 'captain', 'lieutenant', 'firefight', 'ff/pm'], sectors: ['public-safety/fire', 'public-safety/wildland', 'public-safety/aerial-firefighting'] },
  v12: { terms: ['alaska', 'horizon', 'pilot', 'captain', 'capt', 'first officer', 'aviator', 'check airman'], sectors: ['aviation/airline'] },
  v13: { terms: ['netflix', 'producer', 'production', 'showrunner'], sectors: ['media/film-tv'] },
  v14: { terms: ['spacex', 'space', 'starlink', 'rocket', 'launch', 'propulsion', 'satellite'], sectors: ['aerospace/space'] },
  v15: { terms: ['deere', 'john', 'tractor', 'dealer', 'papé', 'pape', 'rdo', 'see & spray'], sectors: ['agriculture/equipment', 'agriculture/deere-dealers'] },
  v16: { terms: ['faa', 'federal aviation', 'aviation administration', 'department of transportation', 'air traffic', 'aviation safety'], sectors: ['aviation/faa', 'aviation/ntsb', 'aviation/tsa', 'aviation/atc-contract'] },
  v17: { terms: ['107', 'waiver', '=coa', 'regulat', 'complian', 'faa', 'federal aviation', 'uas', 'drone', 'bvlos', 'unmanned', 'attorney', 'law', 'counsel', 'legal', 'policy', 'certification', 'advocacy', 'airspace', 'flight standards'], sectors: ['drones/', 'aviation/faa'] },
  v18: { terms: ['aerial', 'cinemat', 'photograph', 'camera', 'drone', 'film', 'video', 'dp', 'director of photography', 'gimbal', 'helicopter', 'media production', 'steadicam'], sectors: ['media/aerial-film', 'media/film-tv', 'media/freelance'] },
  v19: { terms: ['fire', 'firefight', 'public safety', 'rescue', 'drone', 'uas', 'dfr', 'first responder'], sectors: ['public-safety/fire', 'public-safety/wildland', 'public-safety/association', 'drones/companies', 'drones/owner'] },
  v20: { terms: ['spray', 'applicat', 'pesticid', 'crop', 'ag pilot', 'agricultural pilot', 'agronom', 'duster', 'extension', 'regulat', 'complian', 'entomolog', 'pest', 'herbicide', 'chemical', 'licens'], sectors: ['agriculture/aerial-application', 'agriculture/agencies', 'agriculture/extension', 'agriculture/inputs'] },
  v21: { terms: ['recruit', 'talent', 'hiring', 'staffing', 'pilot', 'human resources', '=hr', 'people', 'acquisition'], sectors: ['background/staffing', 'background/aviation-staffing'] },
  v22: { terms: ['dispatch', 'telecommunicat', 'call receiver', 'communications center', 'communications specialist', '911', 'cad administrator', 'crew schedul', 'operations control', 'load planner', 'flight coordinator', 'charter coordinator', 'controller', 'sno911', 'norcom'], sectors: ['public-safety/911'] },
  v23: { terms: ['captain', 'capt', 'pilot', 'first officer', 'aviator', 'commander', 'master', 'check airman'], sectors: ['aviation/airline', 'aviation/cargo', 'aviation/business'] },
  v24: { terms: ['producer', 'production', 'showrunner', 'film', 'studio', 'pictures', 'entertainment', 'content'], sectors: ['media/'] },
  v25: { terms: ['veterin', 'dvm', 'vet', 'animal', 'equine', 'livestock', 'cattle', 'dairy', 'herd', 'farrier'], sectors: ['veterinary/'] },
  v26: { terms: ['geolog', 'geophys', 'geotech', 'geospatial', 'mining', 'mine', 'exploration', 'survey', 'petroleum', 'reservoir', 'drilling', 'earth', 'usgs'], sectors: ['resources/'] },
  v27: { terms: ['cinemat', 'cinemot', 'photograph', 'dp', 'director of photography', 'camera', 'aerial', 'videograph', 'gaffer', 'grip', 'steadicam', '1st ac', 'film'], sectors: ['media/film-tv', 'media/aerial-film', 'media/freelance', 'media/broadcast'] },
  v28: { terms: ['paramedic', 'medic', 'emt', 'ems', 'emergency medical', 'ambulance', 'flight nurse', 'firefighter', 'ff/pm', 'rescue', 'corpsman', 'nurse'], sectors: ['public-safety/ems', 'public-safety/fire', 'aviation/air-medical'] },
  v29: { terms: ['aerospace', 'aerospase', 'aeronaut', 'aerodynam', 'aero', 'propulsion', 'avionics', 'flight test', 'stress', 'structur', 'gnc'], sectors: ['aerospace/', 'drones/evtol'] },
  v30: { terms: ['precision', 'agri', '=ag', 'agtech', 'farm', 'crop', 'agronom', 'spray', 'see & spray', 'yield', 'seed', 'gis'], sectors: ['agriculture/'] },
  v31: { terms: ['space', 'nasa', 'rocket', 'launch', 'satellite', 'starlink', 'orbit', 'jpl', 'jet propulsion', 'planet', 'firefly', 'blue origin', 'united launch', 'relativity', 'mission'], sectors: ['aerospace/space'] },
  v32: { terms: ['police', 'sheriff', 'fire', 'ems', 'paramedic', 'emt', '911', 'dispatch', 'emergency', 'rescue', 'public safety', 'law enforcement', 'trooper', 'patrol', 'detective', 'security', 'disaster', 'fema', 'special agent', 'border patrol'], sectors: ['public-safety/', 'military/coast-guard'] },
  v33: { terms: ['beta', 'tester', 'test', '=qa', 'quality assurance', 'early access'], sectors: [], notes: true },
  v34: { terms: ['wildfire', 'wildland', 'fire', 'smoke', 'forest', 'hotshot', 'smokejump', 'helitack', 'tanker', 'prescribed', 'fuels', 'incident', 'burn', 'ember', 'natural resources'], sectors: ['public-safety/wildland', 'public-safety/aerial-firefighting', 'public-safety/fire'], notes: true },
  v35: { terms: ['flight test', 'test engineer', 'test pilot', 'instrumentation', 'field test', 'test'], sectors: [] },
};

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function seededRandom(seedText) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const field = (r, k) => (typeof r[k] === 'string' ? r[k] : '');

const manifest = {};
const sizes = [];
fs.mkdirSync(path.join(HERE, 'pools'), { recursive: true });
for (const q of queries) {
  const rule = RULES[q.id];
  if (!rule) throw new Error(`no pool rule for ${q.id}`);
  const res = rule.terms.map((t) =>
    t.startsWith('=') ? new RegExp(`\\b(?:${escapeRe(t.slice(1))})\\b`, 'i') : new RegExp(`\\b(?:${escapeRe(t)})`, 'i'));
  const inRule = rows.filter((r) => {
    const text = `${field(r, 'Position')} || ${field(r, 'Company')} || ${field(r, 'Note')}`;
    if (res.some((re) => re.test(text))) return true;
    const sec = sectors[r._id] ?? '';
    if (rule.sectors.some((p) => sec.startsWith(p))) return true;
    if (rule.notes && field(r, 'Note')) return true;
    return false;
  }).map((r) => r._id);
  const ruleSet = new Set(inRule);
  const rest = rows.map((r) => r._id).filter((id) => !ruleSet.has(id));
  const rand = seededRandom(`holdout5-audit-${q.id}`);
  const audit = [];
  const pool = rest.slice();
  for (let i = 0; i < AUDIT_PER_QUERY && pool.length; i++) audit.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  audit.sort();
  manifest[q.id] = { text: q.text, rule: inRule, audit };
  const shown = new Set([...inRule, ...audit]);
  const cands = rows.filter((r) => shown.has(r._id));
  const lines = [
    `# ${q.id}: "${q.text}"${q.strict ? ' (strict title-only)' : ''}`,
    '',
    `Intent: ${q.intent}`,
    '',
    `Candidates: ${cands.length}. One JSON object per line: id, title, company, and the owner's private note when there is one.`,
    'An empty string means the field is blank in the export.',
    '',
    '```jsonl',
    ...cands.map((r) => {
      const c = { id: r._id, title: field(r, 'Position'), company: field(r, 'Company') };
      const note = field(r, 'Note');
      if (note) c.note = note;
      return JSON.stringify(c);
    }),
    '```',
    '',
  ];
  fs.writeFileSync(path.join(HERE, 'pools', `${q.id}.md`), lines.join('\n'));
  sizes.push([q.id, inRule.length, audit.length, cands.length]);
}
const ruleDoc = Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, v]));
fs.writeFileSync(path.join(HERE, 'pool_manifest.json'), JSON.stringify({
  note: 'Rule ids and audit ids per query. For merge_labels.mjs and the adjudicator; labelers must not read this file.',
  auditPerQuery: AUDIT_PER_QUERY, rules: ruleDoc, pools: manifest,
}, null, 1) + '\n');
const total = sizes.reduce((a, s) => a + s[3], 0);
console.log('query  rule  audit  shown');
for (const [id, a, b, c] of sizes) console.log(`${id}    ${String(a).padStart(4)}  ${String(b).padStart(5)}  ${String(c).padStart(5)}`);
console.log(`total candidates shown: ${total} (rows in network: ${rows.length}); min ${Math.min(...sizes.map((s) => s[3]))}, max ${Math.max(...sizes.map((s) => s[3]))}`);
