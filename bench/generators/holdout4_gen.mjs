// Holdout 4 generator (retail, CPG, hospitality, logistics). Run: node bench/generators/holdout4_gen.mjs [outDir]
// It patches the context.json already in the output folder (the original context was hand-written), so copy
// bench/holdout4/context.json into outDir first when writing elsewhere. queries.json was hand-written, not generated.
import fs from 'node:fs';
import path from 'node:path';
import { toNetworkContext, getField, POSITION_KEYS, COMPANY_KEYS, NOTE_KEYS } from '../../lib/connectionFields.ts';
const OUT = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..', 'holdout4')) + '/';
// [first, last, company, position]
const R = [
// retail / e-com
['Oliver','Bennett','Tesco','Store Manager'],
['Aisha','Rahman','Tesco PLC','Area Manager - North West'],
['Tom','Hughes',"Sainsbury's",'Head of Buying – Fresh Produce'],
['Chloe','Martin','Marks & Spencer','Category Manager, Food'],
['Daniel','Okafor','Walmart','Store Manager'],
['Grace','Liu','Target','Sr. Merchandising Manager'],
['Marco','Rossi','Zara (Inditex)','Visual Merchandiser'],
['Emma','Schulz','Zalando','E-commerce Operations Lead'],
['Lucas','Silva','Amazon','Area Manager, Fulfillment Center'],
['James',"O'Connor",'The Home Depot','District Manager'],
['Sofia','Garcia','Home Depot','Asst. Store Mgr'],
['Ben','Carter','Boots UK','Buyer'],
['Isabelle','Dubois','Carrefour','Store Director'],
['Ravi','Patel','ASOS','Head of E-Commerce Operations'],
['Megan','Walsh','Costco Wholesale','Warehouse Manager'],
['Kenji','Tanaka','Uniqlo','Store Manager | Regent Street'],
['Fatima','Al-Sayed','IKEA','Logistics Manager'],
['Nora','Lindqvist','H&M','Buying Manager, Womenswear'],
['Patrick','Doyle','Lidl','Regional Operations Director'],
['Laura','Novak','Tesco','Merchandiser'],
['Sam','Whitfield','John Lewis & Partners','Partner'],
['Ella','Brooks','Etsy','Seller Operations Specialist'],
['Jake','Morris','Target','Buyer, Home Decor'],
['Owen','Price','Tesco','Distribution Centre Manager'],
['Carmen','Vidal','Office Depot','Store Manager'],
['Declan','Hayes','Lowe\'s','Merchandising Manager'],
// CPG
['Michael','Brown','P&G','Brand Manager'],
['Julia','Weber','Procter & Gamble','Supply Chain Manager'],
['Nadia','Haddad','P&G','Sales Director UK&I'],
['Rohan','Desai','Procter and Gamble','Senior Buyer - Indirect Procurement'],
['Arjun','Mehta','Unilever','Category Manager'],
['Claire','Fontaine','Unilever','Head of Supply Chain – Foods & Refreshment'],
['Stephen','Ward','Unilever','Factory Manager'],
['Daniel','Ross','Unilever','Plant Manager'],
['David','Chen','PepsiCo','National Account Manager'],
['Sarah','Jensen','Nestlé','Demand Planner'],
['Tomasz','Kowalski','Mondelez International','Plant Manager'],
['Rachel','Adeyemi','Diageo','Customer Marketing Manager'],
['Paul','Murphy','Coca-Cola Europacific Partners','Key Account Director'],
['Anna','Petrova','Kraft Heinz','Procurement Manager'],
['Victor','Mendes','Reckitt','Operations Director'],
['Lily','Chang',"L'Oréal",'Trade Marketing Manager'],
['George','Evans','Heineken','Brewery Manager'],
['Maya','Goldberg','General Mills','Brand Manager'],
['Chris','Taylor','Mars Wrigley','Supply Planning Lead'],
['Oliver','Grant',"Kellogg's",'Manufacturing Engineer'],
['Priya','Menon','Plant Power Foods','Marketing Manager'],
// hospitality
['Isabella','Moretti','Marriott International','General Manager'],
['Jonathan','Reyes','Marriott','Director of Food & Beverage'],
['Gabriel','Costa','Marriott','Director of Sales & Marketing'],
['Oscar','Lindgren','Marriott International','CFO – EMEA'],
['Amelia','Clarke','Hilton','Director of Operations'],
['Mohammed','Iqbal','Hilton Hotels & Resorts','GM'],
['Lauren','Mitchell','Hilton','Housekeeping Manager'],
['Sophie','Laurent','Accor','Hotel Manager'],
['Carlos','Mendoza','Hyatt','Dir. of F&B'],
['Hiroshi','Sato','Four Seasons Hotels and Resorts','Executive Chef'],
['Emily','Foster','Compass Group','Operations Manager'],
['Liam','Byrne','Compass Group UK & Ireland','Operations Director'],
['Zara','Ahmed','Compass Group','Regional Manager'],
['Mark','Jenkins','Compass Group','Finance Director'],
['Luca','Bianchi','Osteria Bianchi','Owner / Chef'],
['Rebecca','Stone','Sweetgreen','Restaurant General Manager'],
['Andre','Johnson','Chipotle Mexican Grill','Restaurant Manager'],
['Mei','Wong',"Nando's",'Area Manager'],
['Kevin',"O'Brien",'Wagamama','Head Chef'],
['Olivia','Harris','Soho House','Chief Operating Officer'],
['Ahmed','Hassan','Sodexo','Food Service Director'],
['Charlotte','Webb','Whitbread (Premier Inn)','Operations Manager'],
['Diego','Alvarez','Taqueria El Sol','Founder'],
['Natalie','Price','Aramark','District Manager'],
['Samuel','Osei','IHG Hotels & Resorts','Revenue Manager'],
['Jessica','Moore','Tablecraft Hospitality Advisors','Restaurant Opening Consultant'],
['Tim','Fischer','Hotel Adlon Kempinski','F&B Manager'],
['Aoife','Kelly','The Ivy Collection','Operations Manager'],
['Raj','Kapoor','Taj Hotels','Front Office Manager'],
['Hannah','Becker','Pret A Manger','Shop Manager'],
['William','Tran','Pho Saigon Kitchen','Owner'],
['Elena','Popescu','Radisson Hotel Group','Hotel GM'],
['Marcus','Reid','Chipotle Mexican Grill','Vice President of Operations'],
['Sienna','Clarke','Hilton','Events Coordinator'],
['Kwame','Mensah','Premier Inn','Guest Experience Coordinator'],
// logistics
['Stefan','Müller','DHL Supply Chain','Operations Director'],
['Karen','Walsh','DHL','Warehouse Manager'],
['Pedro','Santos','DHL Express','Hub Manager'],
['Aidan','Burke','DHL Supply Chain','Warehouse Operations Manager'],
['Anil','Kumar','XPO Logistics','VP Operations'],
['Jennifer','Lee','C.H. Robinson','Freight Broker'],
['Mark','Thompson','Maersk','Head of Logistics'],
['Yuki','Nakamura','Kuehne + Nagel','Sea Freight Manager'],
['Robert','Clarke','GXO Logistics','General Manager, Distribution Center'],
['Eva','Horvath','DB Schenker','3PL Account Manager'],
['Andrew','Scott','Ryder','Transportation Manager'],
['Leila','Nasser','Flexport','Customs Brokerage Lead'],
['Ian','McGregor','Wincanton','Site Manager'],
['Monica','Ruiz','Uber Freight','Carrier Operations Manager'],
['Hassan','Ali','Amazon Logistics','Last Mile Delivery Manager'],
['Joanna','Nowak','Geodis','Supply Chain Analyst'],
['Brian','Fletcher','Fletcher Haulage Ltd','MD'],
['Sunita','Rao','Symbotic','Solutions Engineer – Warehouse Automation'],
['Thomas','Berg','AutoStore','Sales Director, UK'],
['Grace',"O'Neill",'Ocado Technology','Robotics Engineer'],
['Alex','Novak','Locus Robotics','Customer Success Manager'],
['Rachel','Goodwin','FedEx','Operations Manager'],
['Martin','Svensson','UPS Supply Chain Solutions','Solutions Architect'],
['Carla','Jimenez','Penske Logistics','Fleet Manager'],
['Priyanka','Shah','Ocado','Operations Director, Customer Fulfilment Centre'],
['Nikhil','Joshi','Blue Yonder','WMS Implementation Consultant'],
['Dylan','Hughes','Lineage Logistics','Cold Storage Site Lead'],
['Beatriz','Oliveira','XPO','Logistics Coordinator'],
// manufacturing
['Frank','Weber','Bosch','Plant Manager'],
['Susan',"O'Hara",'Toyota Motor Manufacturing','Lean Manufacturing Specialist'],
['Wei','Zhang','Foxconn','Production Supervisor'],
['Rita','Fernandes','Nestlé','Quality Assurance Manager'],
['Jim','Kowalczyk','Kowalczyk Packaging','Owner'],
['Ahmed','Yusuf','Siemens','Automation Engineer'],
['Laura','Bell','Smurfit Kappa','Continuous Improvement Manager'],
['Kevin','Nguyen','General Motors','Procurement Specialist'],
// agencies
['Chloe','Adams','Ogilvy','Account Director'],
['Max','Hoffmann','WPP','Creative Director'],
['Jade','Thompson','Wieden+Kennedy','Art Director'],
['Sanjay','Gupta','Publicis Sapient','Strategy Director'],
['Emma','Rhodes','Rhodes & Co Design Studio','Founder / Creative Director'],
['Tariq','Malik','Dentsu','Media Planner'],
['Lucy','Parker','BBH London','Copywriter'],
['Ryan','Cole','VaynerMedia','Social Media Manager'],
// small biz / trades
['Mike','Sullivan','Sullivan Electric','Master Electrician'],
['Tony','Russo','Russo Construction LLC','General Contractor'],
['Karen','Mills','Keller Williams','Realtor'],
['Dev','Sharma','Sharma Plumbing & Heating','Owner'],
['Paula','Green','RE/MAX','Real Estate Agent (Buyer\'s Agent)'],
['Steve','Barker','Barker Builders','Contractor'],
['Maria','Lopez','Lopez Commercial Kitchens','Owner - Commercial Kitchen Design & Install'],
['Joe','Fitzgerald','Self-employed','Electrician'],
['Nick','Adams','CBRE','Commercial Real Estate Broker - Retail & Restaurants'],
// franchising
['Brian','Kelly',"McDonald's",'Franchisee / Owner-Operator'],
['Shanice','Brown','Subway','Franchise Development Manager'],
['Omar','Farouk',"Domino's Pizza Group",'Franchise Business Consultant'],
['Helen','Yeo','Anytime Fitness','Multi-Unit Franchise Owner'],
['Greg','Hall','Franchise Brands plc','Head of Franchise Recruitment'],
['Victor','Chan','Costa Coffee','Franchise Partner'],
// F&B
['Isla','Mackenzie','BrewDog','Head of Hospitality'],
['Ethan','Wright','Oatly','Head of Foodservice'],
['Camille','Roux','Moët Hennessy','Brand Ambassador'],
['Jorge','Ramirez','Sysco','Territory Sales Manager'],
['Aaliyah','James','US Foods','Chef Consultant'],
['Finn',"O'Sullivan",'Guinness Storehouse','Bar Manager'],
['Leah','Cohen','Bakery Collective','Head Baker & Co-founder'],
['Pierre','Dupont','Bidfood','Category Buyer'],
// tech
['Nathan','Park','Google','Software Engineer'],
['Sara','Ahmed','Microsoft','Product Manager'],
['Jason','Wu','Toast','Account Executive, Restaurants'],
['Kate','Morrison','Oracle Hospitality','Product Manager - OPERA Cloud'],
['Ali','Reza','Stripe','Solutions Engineer'],
['Megan','Taylor','Salesforce','Customer Success Manager'],
['Vikram','Singh','Amazon Web Services','Solutions Architect'],
['Emily','Zhao','Deliveroo','Senior Data Scientist'],
['Tom','Baker','Uber Eats','Operations Manager - Restaurant Partnerships'],
['Lina','Petersen','project44','Software Engineer'],
['Bruno','Almeida','SAP','ERP Consultant'],
['Hye-jin','Park','OpenTable','Head of Restaurant Partnerships'],
['Chris','Doyle','SevenRooms','Implementation Manager'],
['Priya','Nair','Meta','Engineering Manager'],
['Jordan','Lee','Stealth Startup','CTO & Co-founder'],
['Mateo','Fernandez','Shopify','Senior Developer'],
['Anna','Schmidt','Samsara','Account Manager - Fleet'],
['Ines','Moreau','Deliveroo','VP Ops'],
// finance
['Richard','Hale','KPMG','Chartered Accountant'],
['Sophie','Tan','Deloitte','Audit Manager'],
['Rebecca','Owusu','HSBC','Relationship Manager - Commercial Banking'],
['Tom','Fielding','Barclays','Segment Manager, Business Banking'],
['Ahmed','Karim','EY','Transaction Services Director'],
['Julia','Novak','Blackstone','Vice President - Real Estate (Hospitality)'],
['Marcus','Webb','Webb & Co Accountants','Partner'],
['Hannah','Price','PwC','Tax Senior'],
['Anjali','Rao','NHS','Physician, MD'],
['Grace','Mwangi','','Freelance Bookkeeper'],
['Harriet','Cole','Greene King','CFO'],
// blanks / messy
['Sean','Doherty','',''],
['Yasmin','Farah','Marriott',''],
['Lukas','Brandt','','Operations'],
['Chen','Wei','Kuehne+Nagel',''],
['Rosa','Martinez','','Chef'],
['Tobias','Klein','',''],
['Amara','Eze','',''],
];
// seeded rng
let s = 421; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pad = n => String(n).padStart(2,'0');
const slug = t => t.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
// enrichment by "First Last"
const E = {
 'Emily Foster': {m:42,s:9,r:11,last:'2026-09-12',first:'2024-02-20',end:6,note:'My deputy at Compass; runs the Manchester contract catering sites day to day.'},
 'Liam Byrne': {m:18,s:4,r:5,last:'2026-08-30',first:'2023-12-01',end:3,inv:'incoming',note:'Hired me into Compass. Ask about the B&I contracts and site mobilisation playbook.'},
 'Mark Jenkins': {m:6,s:2,r:1,last:'2026-06-04',first:'2024-05-02'},
 'Oliver Bennett': {m:27,s:6,r:7,last:'2025-11-19',first:'2016-03-02',end:5,rec:true},
 'Aisha Rahman': {m:14,s:3,r:4,last:'2026-01-08',first:'2018-07-11',end:4,note:'Took over my Tesco area; strong on store P&L and labour scheduling.'},
 'Owen Price': {m:9,s:2,r:3,last:'2025-04-22',first:'2019-02-14',end:2,note:'Ran the Tesco Doncaster DC; knows cold chain and chilled distribution inside out.'},
 'Laura Novak': {m:2,s:1,r:1,last:'2023-06-10',first:'2021-05-01'},
 'Arjun Mehta': {m:11,s:3,r:2,last:'2025-09-03',first:'2014-10-10',end:2},
 'Claire Fontaine': {m:21,s:5,r:6,last:'2026-03-15',first:'2014-01-20',end:7,rec:true,note:'My old boss at Unilever. Best mentor I had on S&OP and supplier negotiations.'},
 'Daniel Ross': {m:4,s:1,r:1,last:'2024-02-28',first:'2016-09-09'},
 'Stephen Ward': {m:1,s:1,r:0,last:'2019-11-02',first:'2019-11-02'},
 'Karen Walsh': {m:5,s:1,r:2,last:'2026-07-01',first:'2026-05-12',inv:'outgoing',invAt:'2026-05-10',note:'Met at the IntraLogistics show. Offered a tour of her DHL site in Warrington.'},
 'Stefan Müller': {m:3,s:1,r:1,last:'2026-04-18',first:'2026-02-02',inv:'outgoing',invAt:'2026-02-01'},
 'Isabella Moretti': {m:7,s:2,r:2,last:'2026-08-10',first:'2025-06-15',inv:'outgoing',invAt:'2025-06-14',note:'Introduced by Liam. Open to a chat about moving into hotel operations.'},
 'Jonathan Reyes': {m:2,s:1,r:1,last:'2025-10-05',first:'2025-10-01',inv:'incoming',invAt:'2025-09-30'},
 'Mohammed Iqbal': {m:1,s:0,r:1,last:'2025-12-12',first:'2025-12-12',inv:'incoming',invAt:'2025-12-11'},
 'Jessica Moore': {m:12,s:4,r:4,last:'2026-09-02',first:'2026-06-20',note:'Has opened 4 restaurants in Manchester and Leeds; offered to help with pre-opening checklists.'},
 'Luca Bianchi': {m:8,s:3,r:3,last:'2026-05-21',first:'2022-08-08',note:'Friend from Leeds. Talk to him before signing any restaurant lease.'},
 'Maria Lopez': {m:3,s:1,r:1,last:'2026-07-19',first:'2026-07-01',inv:'outgoing',invAt:'2026-06-30'},
 'Sunita Rao': {m:4,s:2,r:2,last:'2026-06-11',first:'2026-03-03',inv:'incoming',invAt:'2026-03-02',note:'Walked me through AS/RS vs AMR trade-offs for a grocery DC.'},
 'Priyanka Shah': {m:6,s:2,r:2,last:'2025-08-14',first:'2020-11-11',end:1},
 'Yuki Nakamura': {m:2,s:1,r:1,last:'2024-03-30',first:'2024-03-01',note:'Reefer and cold chain capacity on Asia-Europe lanes; useful for chilled imports.'},
 'Dylan Hughes': {m:1,s:1,r:0,last:'2025-02-05',first:'2025-02-05'},
 'Anil Kumar': {m:3,s:1,r:1,last:'2026-02-27',first:'2026-01-16',inv:'outgoing',invAt:'2026-01-15'},
 'Robert Clarke': {m:2,s:1,r:1,last:'2026-01-20',first:'2026-01-16',note:'Hiring manager contact for the GXO Operations Director role I applied to.'},
 'Olivia Harris': {m:5,s:2,r:2,last:'2025-07-07',first:'2023-04-04',end:1},
 'Julia Weber': {m:9,s:2,r:3,last:'2024-12-01',first:'2015-06-06',end:3},
 'Michael Brown': {m:1,s:0,r:1,last:'2021-02-02',first:'2021-02-02'},
 'Richard Hale': {m:10,s:3,r:3,last:'2026-04-01',first:'2017-04-01',note:'Our family accountant; does my self-assessment every January.'},
 'Mike Sullivan': {m:4,s:2,r:1,last:'2025-09-09',first:'2023-09-01',note:'Rewired our kitchen; reliable electrician for commercial fit-outs too.'},
 'Tony Russo': {m:2,s:1,r:1,last:'2024-05-05',first:'2024-05-01'},
 'Brian Kelly': {m:6,s:2,r:2,last:'2026-03-03',first:'2025-10-10',inv:'incoming',invAt:'2025-10-09',note:'Runs 6 McDonald\'s franchises; candid about franchise economics and cold chain audits.'},
 'Mei Wong': {m:3,s:1,r:1,last:'2023-10-10',first:'2019-10-10',end:1},
 'Ahmed Hassan': {m:2,s:1,r:1,last:'2025-05-15',first:'2025-05-01'},
 'Nathan Park': {m:1,s:1,r:0,last:'2020-01-01',first:'2020-01-01'},
 'Isla Mackenzie': {m:3,s:1,r:1,last:'2026-08-22',first:'2026-08-01',inv:'incoming',invAt:'2026-07-31'},
 'Tom Hughes': {m:5,s:1,r:2,last:'2022-12-12',first:'2012-12-12',end:2},
 'Carmen Vidal': {inv:'incoming',invAt:'2024-09-09'},
 'Harriet Cole': {inv:'outgoing',invAt:'2026-04-04'},
 'Ines Moreau': {m:2,s:1,r:1,last:'2025-03-03',first:'2025-03-01'},
};
const DROP = new Set(['Marco Rossi','Ella Brooks','Lily Chang','Maya Goldberg','Chris Taylor','Rachel Adeyemi','Raj Kapoor','Samuel Osei','Wei Zhang','Laura Bell','Jade Thompson','Tariq Malik','Lucy Parker','Steve Barker','Helen Yeo','Camille Roux','Ali Reza','Megan Taylor','Bruno Almeida','Joanna Nowak','Declan Hayes','Kwame Mensah']);
for (const n of ['Richard Hale','Robert Clarke','Mike Sullivan']) delete E[n].note;
const R2 = R.filter(([f,l]) => !DROP.has(`${f} ${l}`));
if (R.length - R2.length !== DROP.size) throw new Error('drop mismatch');
const used = new Set();
const rows = R2.map(([f,l,c,p], i) => {
  const full = `${f} ${l}`;
  let base = slug(full); let u = base; if (used.has(u)) u = `${base}-${Math.floor(rnd()*9000+1000)}`;
  else if (rnd() < 0.5) u = `${base}-${Math.floor(rnd()*90000000+10000000).toString(16)}`;
  used.add(u);
  const y = 2012 + Math.floor(rnd()*14.7), mo = Math.floor(rnd()*12), d = 1 + Math.floor(rnd()*28);
  const e = E[full];
  let iso = `${y}-${pad(mo+1)}-${pad(d)}`;
  if (e?.first && e.first < iso) iso = e.first; // connected before first message
  if (e?.invAt) { const dd = new Date(e.invAt); dd.setUTCDate(dd.getUTCDate()+1); iso = dd.toISOString().slice(0,10); }
  if (iso > '2026-09-20') iso = '2026-09-20';
  const [Y,M,D] = iso.split('-');
  const row = { _id: `m${String(i+1).padStart(3,'0')}`, 'First Name': f, 'Last Name': l, 'Full Name': full,
    Company: c, Position: p, URL: `https://www.linkedin.com/in/${u}`, 'Connected On': `${D} ${MON[+M-1]} ${Y}` };
  if (e) {
    if (e.m != null) { row['Messages'] = e.m; row['Messages Sent'] = e.s; row['Messages Received'] = e.r; row['Last Messaged'] = e.last; row['First Messaged'] = e.first; }
    if (e.inv) { row['Invitation'] = e.inv; row['Invited At'] = e.invAt; }
    if (e.note) row['Note'] = e.note;
    if (e.end) row['Endorsements'] = e.end;
    if (e.rec) row['Recommended You'] = true;
    row['Connected On (ISO)'] = iso;
  }
  return row;
});
const missing = Object.keys(E).filter(n => !rows.some(r => r['Full Name'] === n));
if (missing.length) throw new Error('enrichment names not found: ' + missing);
fs.writeFileSync(OUT+'connections.json', JSON.stringify(rows, null, 2)+'\n');
// context: fix list fields and timestamp
const ctx = JSON.parse(fs.readFileSync(OUT+'context.json','utf8'));
ctx.dreamCompanies = ['Marriott International','DHL Supply Chain','Hilton'];
ctx.desiredTitles = ['Operations Director','Chief Operating Officer','VP Operations'];
ctx.source = { fileName: 'Basic_LinkedInDataExport_09-20-2026.zip', importedAt: '2026-09-20T09:00:00.000Z' };
const v = toNetworkContext(ctx);
if (!v) throw new Error('context invalid');
fs.writeFileSync(OUT+'context.json', JSON.stringify(v, null, 2)+'\n');
const enriched = rows.filter(r => 'Connected On (ISO)' in r).length;
const notes = rows.filter(r => getField(r, NOTE_KEYS)).length;
const blanks = rows.filter(r => !getField(r, POSITION_KEYS) || !getField(r, COMPANY_KEYS)).length;
console.log({ rows: rows.length, enriched, notes, blanks, ctxValid: !!v, dream: v.dreamCompanies });
