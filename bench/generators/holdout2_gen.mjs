// Holdout 2 generator (health systems, pharma, law, consulting, insurance). Run: node bench/generators/holdout2_gen.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..', 'holdout2'));
// [first, last, company, position, enrichment?]
// enrichment shorthand: m=Messages, s=Sent, r=Received, lm=Last Messaged, fm=First Messaged,
// inv=Invitation, ia=Invited At, n=Note, e=Endorsements, rec=Recommended You
const R = [
  // --- Northbridge Health (current employer, fictional regional system) ---
  ['Dana','Whitfield','Northbridge Health','President & Chief Executive Officer',{m:14,s:3,r:4,lm:'2026-08-02',fm:'2023-05-11',e:1}],
  ['Samuel','Okafor','Northbridge Health','Chief Medical Officer',{m:22,s:6,r:7,lm:'2026-09-10',fm:'2023-04-20',e:2,n:'Sponsor for the Epic implementation; ask him before any physician workflow change.'}],
  ['Lorraine','Beckett','Northbridge Health','Chief Nursing Officer',{m:9,s:2,r:3,lm:'2026-07-15',fm:'2023-06-01'}],
  ['Marisol','Vega','Northbridge Health','Nurse Manager - ICU',{m:31,s:8,r:9,lm:'2026-09-18',fm:'2023-07-02',e:3,rec:true}],
  ['Tyrone','Gaines','Northbridge Health','Director, Revenue Cycle',{m:12,s:4,r:4,lm:'2026-06-30',fm:'2023-08-14'}],
  ['Kelsey','Marsh','Northbridge Health','HR Business Partner',{m:5,s:1,r:2,lm:'2026-03-09',fm:'2024-01-15'}],
  ['Priya','Raman','Northbridge Health','Clinical Informatics Analyst',{m:18,s:5,r:5,lm:'2026-09-01',fm:'2023-09-12',n:'Ran go-live command center for our Epic implementation; knows the build team.'}],
  // --- Northbridge-affiliated / other hospitals & clinics ---
  ['Heather','Lindqvist','Northbridge Health - St. Agnes Campus','Nurse Manager, Med-Surg'],
  ['Omar','Haddad','St. Agnes Medical Center','Attending Physician, Emergency Medicine'],
  ['Grace','Nakamura','Mercy Valley Hospital','Chief Operating Officer'],
  ['Victor','Alvarez','Mercy Valley Hospital','RN, BSN'],
  ['Janelle','Brooks','Mercy Valley Hospital','Clinical Nurse Manager, Labor & Delivery'],
  ['Pauline','Carver','Mercy Valley Hospital','Executive Assistant to the CEO'],
  ['Rahul','Mehta','Mercy Valley Hospital','Director of Pharmacy'],
  ['Ingrid','Solberg','Mayo Clinic','Consultant, Division of Cardiology'],
  ['Thomas','Kerrigan','Mayo Clinic','Clinical Research Coordinator'],
  ['Adaeze','Nwosu','Mayo Clinic','Administrator, Department of Surgery'],
  ['Benjamin','Hale','Mayo Clinic','Physician Assistant'],
  ['Carmen','Ortiz','Mayo Clinic Health System','Chair, Department of Family Medicine'],
  ['Lena','Fischer','Kaiser Permanente','Attending Physician',{m:3,s:1,r:1,lm:'2025-11-20',fm:'2025-10-02'}],
  ['Marcus','Dunn','Kaiser Permanente','Physician Recruiter',{m:16,s:4,r:5,lm:'2026-09-12',fm:'2024-02-01',e:2}],
  ['Yvonne','Tran','Kaiser Permanente','Nurse Practitioner'],
  ['Elliot','Park','The Permanente Medical Group','Physician - Internal Medicine'],
  ['Rebecca','Stein','Kaiser Foundation Health Plan','Director, Quality & Patient Safety'],
  ['Andre','Coleman','Kaiser Foundation Health Plan','Senior Financial Analyst'],
  ['Natalie','Brennan','Cedar Ridge Family Clinic','Practice Administrator'],
  ['Hugo','Delacroix','Cedar Ridge Family Clinic','Family Physician'],
  ['Shauna','Price','Harborview Community Health Center','Executive Director',{m:6,s:2,r:2,lm:'2026-02-14',fm:'2024-05-09'}],
  ['Felix','Moreno','Harborview Community Health Center','Chronic Care Coordinator'],
  ['Gwen','Halloran','Pinecrest Senior Living','Director of Nursing'],
  ['Desmond','Kiplagat','Pinecrest Senior Living','Maintenance Supervisor'],
  ['Tamara','Voss','Summit Orthopedic Associates','Practice Manager'],
  ['Luis','Figueroa','Summit Orthopedic Associates','Orthopedic Surgeon'],
  ['Brianna','Cole','Lakeshore Behavioral Health','Case Manager, RN'],
  ['Wendell','Frost','Lakeshore Behavioral Health','Chief of Staff'],
  ['Harriet','Osei','CommonSpirit Health','Vice President, Patient Care Services'],
  ['Kenji','Watanabe','HCA Healthcare','Hospital Administrator',{inv:'incoming',ia:'2025-04-03'}],
  ['Sofia','Russo','CVS Health','Pharmacist'],
  ['Derek','Lowell','Walgreens','Pharmacy Technician'],
  ['Mei','Chen','UnitedHealth Group','Chief Marketing Officer'],
  ['Arjun','Kapoor','Optum','Director, Population Health Analytics'],
  // --- Pharma / biotech ---
  ['Claire','Donnelly','Pfizer','Brand Manager, Oncology'],
  ['Stefan','Novak','Pfizer','Pharmaceutical Sales Representative',{m:4,s:1,r:2,lm:'2025-09-01',fm:'2025-06-10',inv:'incoming',ia:'2025-06-01'}],
  ['Aisha','Rahman','Pfizer Inc.','Regulatory Affairs Manager'],
  ['Jonah','Weiss','Merck','Medical Science Liaison'],
  ['Olivia','Grant','Merck & Co., Inc.','Associate Director, Market Access'],
  ['Nikhil','Rao','Genentech','Clinical Trial Manager'],
  ['Beatriz','Santos','Solara Therapeutics','Founder & CEO',{m:7,s:2,r:2,lm:'2026-05-22',fm:'2024-10-04',e:1}],
  ['Kyle','Brandt','Solara Therapeutics','VP, Clinical Operations'],
  ['Ruth','Adeyemi','Solara Therapeutics','Quality Assurance Specialist'],
  ['Martin','Esposito','Amgen','Account Executive, Specialty Pharma'],
  ['Hannah','Lutz','Novo Nordisk','Market Access Manager'],
  ['Jiho','Lim','Moderna','Supply Chain Analyst'],
  ['Cecilia','Marquez','Bluefin Biologics','Principal Scientist'],
  // --- Banking / insurance ---
  ['Patrick','Sullivan','JPMorgan Chase & Co.','VP, Commercial Banking',{m:10,s:3,r:3,lm:'2026-04-18',fm:'2022-03-01'}],
  ['Esther','Liu','JPMorgan Chase & Co.','Associate, M&A'],
  ['Connor','McBride','J.P. Morgan','Healthcare Investment Banking Analyst'],
  ['Farah','Siddiqui','J.P. Morgan Asset Management','Executive Director, Portfolio Manager'],
  ['Gregory','Pope','Chase','Branch Manager'],
  ['Isabel','Duarte','Wells Fargo','Mortgage Underwriter'],
  ['Trevor','Nash','Wells Fargo','Vice President, Finance'],
  ['Monica','Feld','Bank of America','Relationship Manager, Healthcare Banking'],
  ['Walter','Kim','Goldman Sachs','Vice President'],
  ['Quinn','Harper','Cascadia Mutual Insurance','Underwriter II'],
  ['Deborah','Klein','Cascadia Mutual Insurance','Underwriting Manager'],
  ['Raj','Patel','Cascadia Mutual Insurance','Actuarial Analyst'],
  ['Lydia','Moss','Cascadia Mutual Insurance','Claims Adjuster'],
  ['Simon','Barrett','Travelers','Senior Underwriter, Healthcare Liability'],
  ['Joy','Okonkwo','The Hartford','Commercial Lines Underwriter'],
  ['Ethan','Cross','Blue Shield of California','SVP Finance'],
  ['Maya','Petrov','Blue Cross Blue Shield Association','Medical Director'],
  ['Colin','Fairbanks','UL (Underwriters Laboratories)','Quality Engineer'],
  ['Renee','Holt','First Harbor Credit Union','Finance Manager'],
  // --- Law ---
  ['Victoria','Hollis','Hollis & Grant LLP','Partner, Healthcare Regulatory',{m:8,s:2,r:3,lm:'2026-01-28',fm:'2023-11-02',n:'Helped us with the Stark Law review last year; very responsive.'}],
  ['Daniel','Ferreira','Hollis & Grant LLP','Senior Associate | Litigation'],
  ['Kimberly','Nguyen','Hollis & Grant LLP','Paralegal'],
  ['Arthur','Grant','Hollis & Grant LLP','Of Counsel'],
  ['Sienna','Blake','Baker McKenzie','Associate'],
  ['Robert','Castellano','Ropes & Gray LLP','Attorney'],
  ['Naomi','Fitzgerald','Ropes & Gray','Senior Paralegal'],
  ['Jerome','Wallace','Northbridge Health','General Counsel',{m:6,s:2,r:2,lm:'2026-08-19',fm:'2023-06-20'}],
  ['Helen','Park','Solara Therapeutics','Deputy General Counsel'],
  ['Bruno','Albers','Cascadia Mutual Insurance','Associate General Counsel'],
  ['Yasmin','Haddad','Legal Aid Society','Staff Attorney'],
  ['Caleb','Rowe','Lawyers for Children','Program Officer'],
  ['Teresa','Munoz','Munoz Law PLLC','Lawyer & Founder'],
  ['Gideon','Shaw','Kirkland & Ellis','Legal Assistant'],
  ['Paige','Donovan','Mercy Valley Hospital','Compliance Officer'],
  ['Leonard','Voigt','Cascadia Mutual Insurance','Legal Operations Manager'],
  ['Stella','Moreau','Hollis & Grant LLP','Counsel',{inv:'outgoing',ia:'2026-03-02'}],
  // --- Consulting: Huron (former employer), Deloitte, McKinsey, boutiques ---
  ['Megan','Albright','Huron Consulting Group','Managing Director',{m:25,s:6,r:7,lm:'2026-07-01',fm:'2019-02-04',e:4,rec:true}],
  ['Jason','Liang','Huron Consulting Group','Sr. Consultant',{m:12,s:4,r:4,lm:'2025-12-10',fm:'2019-06-01',e:2}],
  ['Chloe','Bennett','Huron','Engagement Manager, Healthcare',{m:9,s:3,r:2,lm:'2025-05-15',fm:'2020-01-08'}],
  ['Andrew','Pike','Huron Consulting Group','Consultant',{n:'Built the OR scheduling model on our Epic implementation work at Mercy Valley.'}],
  ['Laura','Bishop','Deloitte Consulting LLP','Sr. Consultant, Health Care Strategy'],
  ['Mohammed','Aziz','Deloitte','Senior Consultant'],
  ['Erin','Walsh','Deloitte Consulting','Consultant, Human Capital'],
  ['Scott','Fenwick','Deloitte','Senior Manager'],
  ['Tanya','Ivanova','Deloitte & Touche LLP','Audit Senior'],
  ['Philip','Crane','Monitor Deloitte','Manager, Strategy'],
  ['Allison','Reyes','McKinsey & Company','Engagement Manager'],
  ['David','Osei','McKinsey & Company','Associate Partner, Healthcare Systems & Services',{m:5,s:1,r:2,lm:'2025-03-02',fm:'2021-09-14'}],
  ['Katherine','Lowe','McKinsey & Co.','Business Analyst'],
  ['Ian','Moreland','McKinsey Health Institute','Research Fellow'],
  ['Nadia','Cho','Harbor Lane Advisors','Founder (ex-McKinsey)'],
  ['Brandon','Yu','Accenture','Consultant'],
  ['Zoe','Fontaine','Strategy&','Principal, Strategy&'],
  ['Eric','Lindgren','Boston Consulting Group','Principal'],
  ['Maria','Castro','Bain & Company','Senior Associate Consultant'],
  ['Owen','Price','Chartis Group','Senior Consultant'],
  ['Rachel','Adler','Kestrel Health Advisors','Managing Partner',{m:3,s:1,r:1,lm:'2024-11-11',fm:'2024-10-01'}],
  ['Jamal','Wright','Kestrel Health Advisors','Senior Consultant, Epic Implementation'],
  ['Fiona','Gallagher','Oliver Wyman','Senior Accountant'],
  ['Victor','Hsu','KPMG','Senior Associate, Healthcare Advisory'],
  // --- Universities / academia ---
  ['Eleanor','Whitcomb','University of Washington','Assistant Professor of Epidemiology'],
  ['Mateo','Rivas','University of Washington','PhD Candidate, Health Services'],
  ['Sarah','Goldberg','University of Washington School of Medicine','Department Chair, Anesthesiology'],
  ['Kofi','Mensah','University of Washington','Grants Manager'],
  ['Lillian','Ward','Johns Hopkins Bloomberg School of Public Health','Associate Professor, Health Policy'],
  ['Henry','Chase','Stanford University','Research Assistant'],
  ['Amara','Obi','Cascade State University','Director of Admissions'],
  // --- Nonprofits / government ---
  ['Beth','Sorensen','Robert Wood Johnson Foundation','Program Officer'],
  ['Dmitri','Volkov','Gates Foundation','Senior Program Officer, Global Health'],
  ['Carla','Jimenez','Washington State Department of Health','Policy Advisor'],
  ['Neil','Harrington','Centers for Medicare & Medicaid Services','Health Insurance Specialist'],
  ['Joanna','Pratt','City of Seattle','Emergency Management Planner'],
  ['Luke','Donahue','American Heart Association','Campaign Manager'],
  ['Tessa','Morgan','United Way of King County','Grants Manager'],
  ['Frank','Oduya','Office of the Governor','Chief of Staff'],
  ['Ruby','Alcott','Northwest Hospital Association','Board Member',{n:'Knows every hospital CEO in the state; offered intros to hospital leadership.'}],
  // --- Marketing / communications ---
  ['Chelsea','Dorsey','Ogilvy Health','Account Director'],
  ['Marco','Bellini','Ogilvy','Senior Copywriter'],
  ['Jade','Winters','Edelman','PR Manager'],
  ['Nora','Kline','Brightline Communications','Director of Communications'],
  ['Pete','Sandoval','Brightline Communications','Media Planner'],
  ['Alyssa','Hart','Procter & Gamble','Brand Manager'],
  ['Gabriel','Soto','PepsiCo','Chief Marketing Officer, North America Beverages'],
  // --- Real estate / retail / CPG ---
  ['Diane','Keller','CBRE','Senior Vice President, Healthcare Real Estate'],
  ['Travis','Boone','Greystar','Leasing Agent'],
  ['Wanda','Fisher','Target','Store Manager'],
  ['Hector','Lozano','Costco Wholesale','Supply Chain Analyst'],
  ['Irene','Pak','Nordstrom','HR Generalist'],
  ['Sean','Maloney','Unilever','Director of Human Resources'],
  ['Bianca','Rossi','General Mills','Talent Acquisition Specialist'],
  ['Russell','Hughes','Kroger','General Manager'],
  ['Ada','Lambert','Starbucks','People Operations Manager'],
  ['Curtis','Webb','Home Depot','CHRO'],
  // --- Tech minority (~15%) ---
  ['Tim','Olsen','Epic Systems','Implementation Consultant',{m:11,s:3,r:4,lm:'2026-02-02',fm:'2024-03-18',n:'Our Epic TS during go-live; best person for Epic implementation questions.'}],
  ['Grace','Hoffman','Epic','Software Developer'],
  ['Ravi','Shankar','Microsoft','Senior Software Engineer'],
  ['Emily','Zhang','Google','Product Manager, Health'],
  ['Jordan','Blake','Salesforce','Solutions Engineer, Health Cloud'],
  ['Kevin','Moore','Amazon Web Services','Solutions Architect'],
  ['Alicia','Ferrer','CrowdStrike','Threat Intelligence Analyst'],
  ['Nathan','Reid','Zocdoc','Data Scientist'],
  ['Sanjay','Iyer','Cerner (Oracle Health)','Domain Architect'],
  ['Lucy','Tan','Stripe','Implementation Manager'],
  ['Max','Hollander','Oscar Health','Engineering Manager'],
  ['Wei','Zhou','Flatiron Health','Machine Learning Engineer'],
  ['Brooke','Sterling','Nuvola Labs','Founder'],
  ['Diego','Paredes','Datadog','Site Reliability Engineer'],
  ['Hana','Kobayashi','Teladoc Health','UX Designer'],
  ['Luca','Romano','Palantir Technologies','Deployment Strategist'],
  ['Evan','Schultz','Meta','Product Designer'],
  ['Sara','Lindholm','Microsoft','Program Manager, Healthcare Cloud'],
  ['Jacob','Frey','Twilio','Account Executive'],
  ['Mila','Novak','Veeva Systems','Customer Success Manager'],
  ['Ahmed','Farouk','Snowflake','Data Engineer'],
  ['Oscar','Lindeman','IBM','Cloud Consultant'],
  // --- Other / retired / notes-heavy / blanks ---
  ['Margaret','Doyle','','Retired',{n:'Former nurse manager at St. Agnes for 20 years; great mentor on ICU staffing.'}],
  ['George','Albrecht','Self-employed','Board Member, Healthcare Nonprofits'],
  ['Patricia','Lane','','',{m:2,s:1,r:1,lm:'2024-08-08',fm:'2024-08-01',n:'Met at HFMA conference; revenue cycle and denials expert, now between roles.'}],
  ['Vincent','Moreau','Mercy Valley Hospital',''],
  ['Lindsey','Carter','','Chief of Staff to the CMO'],
  ['Bernard','Ng','Stealth Startup',''],
  ['Rosa','Delgado','','Healthcare Operations Consultant',{n:'Ex-Deloitte senior consultant, now independent; did our lean workflow redesign.'}],
  ['Keith','Sandberg','Freelance',''],
  ['Julia','Monroe','Pfizer',''],
  ['Terrence','Oyelaran','','',{inv:'incoming',ia:'2026-09-05'}],
  ['Sophie','Laurent','Northbridge Health','Executive Assistant',{m:40,s:10,r:10,lm:'2026-09-20',fm:'2023-05-01',n:'Manages the CEO and CMO calendars; route intro requests to hospital leadership through her.'}],
  ['Albert','Kwan','Westlake Regional Medical Center','Chief Executive Officer'],
  ['Denise','Farrow','Westlake Regional Medical Center','VP & Chief Financial Officer'],
  ['Hollis','Graves','Westlake Regional Medical Center','Director of Facilities Maintenance'],
  ['Crystal','Young','Westlake Regional Medical Center','Nurse Manager'],
  ['Trent','Collins','Westlake Regional Medical Center','Senior Paralegal, Risk Management'],
  ['Imani','Barnes','Nexa Home Health','Director of Operations',{n:'Asked me about Deloitte vs Huron for her ops team; possible client.'}],
];
const DROP=new Set(['Luis Figueroa','Andre Coleman','Ruth Adeyemi','Hannah Lutz','Cecilia Marquez','Walter Kim','Lydia Moss','Renee Holt','Marco Bellini','Henry Chase','Amara Obi','Tessa Morgan','Hector Lozano','Keith Sandberg','Neil Harrington','Frank Oduya','Pete Sandoval','Monica Feld','Lillian Ward','Olivia Grant']);
const ADD_E={
 'Yvonne Tran':{m:20,s:5,r:6,lm:'2026-09-15',fm:'2024-04-01',e:2},
 'Russell Hughes':{m:15,s:4,r:4,lm:'2026-08-28',fm:'2021-05-05'},
 'Joy Okonkwo':{inv:'incoming',ia:'2026-06-11'},
 'Laura Bishop':{m:4,s:1,r:1,lm:'2025-10-10',fm:'2025-09-01'},
 'Allison Reyes':{m:6,s:2,r:1,lm:'2025-07-07',fm:'2022-02-02'},
 'Esther Liu':{m:2,s:1,r:1,lm:'2024-12-01',fm:'2024-11-20'},
 'Claire Donnelly':{e:1},
 'Eleanor Whitcomb':{m:3,s:1,r:1,lm:'2026-01-09',fm:'2025-12-01',rec:true},
 'Beth Sorensen':{inv:'outgoing',ia:'2026-04-22'},
 'Chelsea Dorsey':{m:5,s:1,r:2,lm:'2025-08-19',fm:'2025-03-03'},
 'Kimberly Nguyen':{n:'Handled our vendor contract redlines; ask her for the BAA templates.'},
 'Diane Keller':{m:1,r:1,lm:'2023-10-02',fm:'2023-10-02'},
};
R.push(['Priyanka','Desai','Epic Systems','Technical Services Lead']);
R.push(['Chris','Holland','Workday','HRIS Product Manager']);
for (let i=R.length-1;i>=0;i--){ const k=R[i][0]+' '+R[i][1]; if (DROP.has(k)) R.splice(i,1); else if (ADD_E[k]) { if (R[i][4]) throw new Error('dup '+k); R[i][4]=ADD_E[k]; } }
function dateText(i){
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const y=2012+(i*7)%14, m=(i*5)%12, d=1+(i*11)%28;
  return `${String(d).padStart(2,'0')} ${months[m]} ${y}`;
}
const seen=new Set();
const rows = R.map(([f,l,c,p,e],i)=>{
  const id='h'+String(i+1).padStart(3,'0');
  let slug=(f+'-'+l).toLowerCase().replace(/[^a-z-]/g,'');
  if (seen.has(slug)) slug+='-'+(i+1); seen.add(slug);
  const row={_id:id,'First Name':f,'Last Name':l,'Full Name':`${f} ${l}`,Company:c,Position:p,
    URL:`https://www.linkedin.com/in/${slug}-${(1000+i*37).toString(16)}`,'Connected On':dateText(i)};
  if (e){
    if (e.m!=null) row['Messages']=e.m;
    if (e.s!=null) row['Messages Sent']=e.s;
    if (e.r!=null) row['Messages Received']=e.r;
    if (e.lm) row['Last Messaged']=e.lm;
    if (e.fm) row['First Messaged']=e.fm;
    if (e.inv) row['Invitation']=e.inv;
    if (e.ia) row['Invited At']=e.ia;
    if (e.n) row['Note']=e.n;
    if (e.e!=null) row['Endorsements']=e.e;
    if (e.rec!=null) row['Recommended You']=e.rec;
  }
  return row;
});
fs.writeFileSync(OUT+'/connections.json', JSON.stringify(rows,null,1)+'\n');
const ctx={
  name:'Jordan Ellery',
  headline:'Director, Clinical Operations at Northbridge Health | Former healthcare consultant',
  industry:'Hospitals and Health Care',
  positions:[
    {company:'Northbridge Health',title:'Director, Clinical Operations',current:true},
    {company:'Huron Consulting Group',title:'Manager, Healthcare Performance Improvement',current:false},
    {company:'Huron Consulting Group',title:'Senior Consultant',current:false},
    {company:'Cascadia Mutual Insurance',title:'Business Analyst',current:false},
  ],
  schools:['University of Washington','Gonzaga University'],
  skills:['Healthcare Operations','Lean Six Sigma','Revenue Cycle Management','Epic Systems','Process Improvement','Change Management','Strategic Planning','Project Management','Healthcare Consulting','Data Analysis','Stakeholder Management','Patient Flow'],
  followedCompanies:['Mayo Clinic','Kaiser Permanente','McKinsey & Company','CommonSpirit Health','Robert Wood Johnson Foundation'],
  appliedCompanies:['Kaiser Permanente','Optum'],
  appliedTitles:['VP, Operations','Chief Operating Officer'],
  dreamCompanies:['Mayo Clinic','Kaiser Permanente'],
  desiredTitles:['VP of Operations','Chief Operating Officer'],
  source:{fileName:'Basic_LinkedInDataExport_09-20-2026.zip',importedAt:'2026-09-20T15:04:00.000Z'},
};
fs.writeFileSync(OUT+'/context.json', JSON.stringify(ctx,null,2)+'\n');
const Q=[
  ['h01','nurse manager','role-exact','Nurse managers (unit/clinical nurse managers). Other nursing roles or non-nurse managers are at most marginal.',true],
  ['h02','general counsel','role-exact','General Counsel and deputy/associate GCs; other in-house or law-firm counsel are adjacent. "General Manager" is not relevant.'],
  ['h03','cmo','abbreviation','Chief Medical Officer or Chief Marketing Officer (both expansions are valid for this owner); roles that merely mention the CMO are marginal.'],
  ['h04','hr','abbreviation','Human resources / people roles (HR business partner, HR generalist, Director of Human Resources, CHRO, people operations); talent acquisition is adjacent.'],
  ['h05','senior consultant','seniority','Senior Consultants (any firm, "Sr." spelling included); plain Consultants and consulting-firm senior associates are adjacent; senior non-consulting roles are not.'],
  ['h06','healthcare executives','seniority','C-suite and VP-level leaders at hospitals, health systems, clinics and health plans; health-sector executives elsewhere are adjacent; "Executive Assistant" or "Account Executive" are not executives.'],
  ['h07','consultant at deloitte','role+company','Consultants at any Deloitte entity (Deloitte, Deloitte Consulting LLP, Monitor Deloitte); other Deloitte staff or consultants elsewhere are partial.'],
  ['h08','physician kaiser','role+company','Physicians at Kaiser Permanente or its affiliates (Permanente Medical Group, Kaiser Foundation Health Plan); physicians elsewhere or non-physician clinicians at Kaiser are partial.'],
  ['h09','mckinsey','company-only','Anyone at McKinsey (any spelling or unit), plus people explicitly described as ex-McKinsey.'],
  ['h10','people at jpmorgan','company-only','Anyone at JPMorgan Chase in any variant (JPMorgan Chase & Co., J.P. Morgan, J.P. Morgan Asset Management, Chase).'],
  ['h11','someone who can help me with a legal question','natural-language','Lawyers who could answer a legal question: attorneys, counsel, law-firm associates/partners, general counsel; paralegals, legal ops and compliance are marginal.'],
  ['h12','who could introduce me to hospital leadership','natural-language','People who are hospital/health-system leaders or sit next to them (CEO, CMO, CNO, COO, CFO, VPs, chiefs of staff, board members with hospital ties).'],
  ['h13','underwriters','stem-plural','Insurance and mortgage underwriters (any level); underwriting managers are relevant; actuaries are marginal; Underwriters Laboratories staff are not underwriters.'],
  ['h14','lawyers','stem-plural','Practicing lawyers: attorneys, counsel, law-firm associates and partners, general counsel. Paralegals are marginal; a nonprofit named "Lawyers for Children" program officer is not a lawyer.'],
  ['h15','paralegl','typo','Paralegals (typo for "paralegal"), including senior paralegals; legal assistants are closely related.'],
  ['h16','deloite','typo','Anyone at Deloitte (typo), any entity; ex-Deloitte people are partial.'],
  ['h17','pharma','domain','People working in the pharmaceutical/biotech industry (Pfizer, Merck, Genentech, Amgen, Moderna, Novo Nordisk, biotech startups); retail pharmacists and hospital pharmacy are marginal.'],
  ['h18','epic implementation','note','People who know Epic EHR implementations, mostly identifiable from the user\'s own notes, plus Epic implementation consultants; other "implementation" roles are marginal.'],
];
const queries=Q.map(([id,text,category,intent,strict])=>{const q={id,text,category,split:'test'}; if(strict) q.strict=true; q.intent=intent; return q;});
fs.writeFileSync(OUT+'/queries.json', JSON.stringify(queries,null,2)+'\n');
console.log(rows.length, rows.filter(r=>'Messages' in r||'Invitation' in r||'Note' in r).length, rows.filter(r=>r.Note).length, rows.filter(r=>!r.Position||!r.Company).length);
