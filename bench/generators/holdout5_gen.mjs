// Holdout 5 generator: a blind, synthetic LinkedIn network (~2,100 connections) for the ranking benchmark.
// Run: node bench/generators/holdout5_gen.mjs [outDir]      (default: bench/holdout5)
// Writes connections.json, context.json, queries.json and labeling/sectors.json. Seeded (SEED below) and
// free of clocks and Math.random, so a re-run is byte-identical.
//
// Domain mix (chosen to differ from the earlier sets: dev/test = tech and startups, holdout2 = health,
// pharma, law, consulting, holdout3 = academia, energy policy, government, journalism, holdout4 = retail, CPG,
// hospitality, logistics): aviation, aerospace and space, drones and eVTOL, military aviation, public safety
// (fire, police, EMS, 911, emergency management), agriculture and agtech, film/TV/broadcast/music/games,
// mining and oil and gas, maritime, sports, veterinary, plus a general background of common roles.
// People are fictional (random first+last combinations); companies are real or invented.
// Queries are written from this description of the network, never from any ranker's output.
import fs from 'node:fs';
import path from 'node:path';
import { toNetworkContext } from '../../lib/connectionFields.ts';

const SEED = 5021;
const OUT = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..', 'holdout5'));
const TODAY = '2026-10-01'; // fixed "export date" of this synthetic network

// ---------------------------------------------------------------- seeded RNG (mulberry32)
let state = SEED >>> 0;
function rnd() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
function shuffle(xs) {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// "Name*3 | Other" -> weighted list
function weighted(spec) {
  const out = [];
  for (const part of spec.split('|').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(.*?)\*(\d+)$/);
    const name = m ? m[1].trim() : part;
    const w = m ? Number(m[2]) : 1;
    for (let i = 0; i < w; i++) out.push(name);
  }
  return out;
}
const expandTitles = (ts) => ts.flatMap((t) => weighted(t));

// ---------------------------------------------------------------- fictional names
const FIRST = `Aaliyah Abdi Adaeze Adrian Aiko Alana Alejandro Alexei Amara Amir Anaya Andrea Anika Anton Ari Arjun Asha Astrid
Aurelio Ayesha Bao Beatriz Bethany Bilal Bjorn Blessing Brendan Bryce Caleb Camila Carmen Cassidy Cedric Chidi Chloe Colin
Dalia Damien Dana Darius Dashiell Deepa Delphine Desmond Devin Dmitri Eamon Ebony Eduardo Elif Elijah Elena Elodie Emeka
Esme Esteban Ezra Fatima Felipe Fiona Freya Gabriela Garrett Gemma Gideon Greta Gustavo Hadley Hamza Hana Harlan Hector
Helena Hiroshi Hugo Ibrahim Ifeoma Ilse Imani Ingrid Isaac Ivy Jalen Jamal Janelle Javier Jin Joaquin Jonah Josefina Juniper
Kai Kalani Kamal Karina Keanu Keiko Kendall Khalil Kiara Kofi Lachlan Laila Lars Leilani Leon Lucia Luka Lydia Magnus Malia
Marcus Mariam Mateo Maya Mei Micah Milan Mira Moana Nadia Nasser Naveen Nia Nikolai Noor Odette Oksana Omar Orla Pablo Paloma
Priya Quentin Rafael Rania Reza Rhea Rohan Rosalind Rowan Rui Sabine Saanvi Samir Santiago Saoirse Selin Seth Shira Silas
Simone Soren Stellan Sunita Tamsin Tariq Teodora Thandiwe Theo Tobias Uma Valentina Vikram Wren Xavier Yara Yusuf Zane Zola`
  .split(/\s+/).filter(Boolean);
const LAST = `Abara Achterberg Adeyemi Albrecht Alcott Amundsen Anand Arceneaux Ashworth Babatunde Balogun Barrientos Beaumont
Bergstrom Bhattacharya Blackwood Boateng Brennan Calloway Castellanos Chaudhry Cheng Ciobanu Corrigan Dalgaard Darrow Delacroix
Demir Desai Dimitrov Donnelly Duarte Eckhart Ekwueme Ellison Endo Esparza Falk Farrow Fenwick Figueroa Fitzgerald Fonseca
Gallagher Garrido Gebre Goswami Granger Gutierrez Halvorsen Haruna Hastings Hendricks Hollis Holmberg Huang Iqbal Ishikawa Ivanova
Jaramillo Jovanovic Kahananui Kapoor Karlsson Kealoha Keane Khoury Kimura Kowalczyk Kuznetsov Lachance Lindahl Lombardi Lowell
Lucero Mabry Macharia Madsen Mahoney Malhotra Marchetti Matsuda McAllister Medeiros Mendoza Mwangi Nakagawa Navarro Ndlovu
Nilsson Novak Nwachukwu Obi Okonkwo Olafsson Oyelaran Pacheco Palmer Paredes Pemberton Petrakis Pham Quintero Rahimi Ramanathan
Rasmussen Redbird Reinholt Rocha Rosales Saavedra Sahin Salonga Sandoval Santangelo Schuyler Sekibo Serrano Shapiro Silversmith
Solberg Soto Stavros Strand Sutherland Takahashi Talbot Tanaka Thackeray Thibodeaux Toivonen Trujillo Tsosie Underhill Valdez
Vang Varga Velasquez Vukovic Wainwright Walcott Watanabe Whitlock Wiśniewski Yamamoto Yazzie Yildiz Zamora Zeller Zhou Zielinski`
  .split(/\s+/).filter(Boolean);

const usedNames = new Set();
function freshName() {
  for (let i = 0; i < 1000; i++) {
    const f = pick(FIRST);
    const l = pick(LAST);
    if (!usedNames.has(`${f} ${l}`)) {
      usedNames.add(`${f} ${l}`);
      return [f, l];
    }
  }
  throw new Error('name pool exhausted');
}

// ---------------------------------------------------------------- generated groups
// sector: a coarse label of the employer's industry (written to labeling/sectors.json for the pool rule).
// co: weighted companies; ti: titles (each "Title*N" weight), cycled through in a seeded shuffle.
const G = [];
const SCALE = 0.7; // group sizes below are relative; this sets the network to ~2,000 rows
const group = (sector, n, co, ti) => G.push({ sector, n: Math.max(1, Math.round(n * SCALE)), co: weighted(co), ti: expandTitles(ti) });

// --- aviation
group('aviation/airline', 150,
  'Delta Air Lines*6 | Delta | Alaska Airlines*5 | United Airlines*4 | American Airlines*3 | Southwest Airlines*3 | JetBlue*2 | SkyWest Airlines*2 | Hawaiian Airlines | Frontier Airlines | Horizon Air',
  ['Captain*3', 'First Officer*3', 'Captain, Boeing 737', 'First Officer - Airbus A320', 'Captain | B757/767', 'First Officer, E175',
    'Airline Pilot', 'Line Check Airman', 'Instructor Pilot, 737 Fleet', 'Flight Attendant*3', 'Lead Flight Attendant', 'Inflight Supervisor',
    'Aircraft Dispatcher', 'Flight Dispatcher', 'Manager, Flight Dispatch', 'Crew Scheduler', 'Crew Scheduling Supervisor', 'Station Manager',
    'Customer Service Agent', 'Gate Agent', 'Ramp Agent', 'Ramp Supervisor', 'Aircraft Maintenance Technician', 'Safety Manager, SMS',
    'Flight Safety Analyst', 'Fleet Technical Pilot', 'Revenue Management Analyst', 'Network Planning Manager', 'Pilot Recruiter',
    'Talent Acquisition Partner, Pilot Hiring', 'Software Engineer', 'Senior Data Scientist', 'Corporate Communications Manager',
    'Manager, Flight Operations Training', 'Loyalty Marketing Manager', 'Cargo Sales Manager', 'Director of Safety']);
group('aviation/cargo', 35,
  'FedEx Express*3 | FedEx | UPS Airlines*2 | Atlas Air*2 | Amazon Air*2 | Kalitta Air | ABX Air',
  ['Captain, MD-11', 'Captain*2', 'First Officer, B767F', 'First Officer*2', 'Flight Engineer', 'Aircraft Maintenance Technician',
    'Load Planner', 'Cargo Agent', 'Ramp Supervisor', 'Flight Operations Manager', 'Global Operations Control Duty Manager',
    'Aircraft Dispatcher', 'Hub Operations Manager']);
group('aviation/airport', 45,
  'Port of Seattle*3 | Seattle-Tacoma International Airport*2 | Denver International Airport*2 | Hartsfield-Jackson Atlanta International Airport | Los Angeles World Airports | Paine Field (Snohomish County Airport) | Spokane International Airport',
  ['Airport Operations Manager', 'Airport Duty Manager', 'Airfield Operations Supervisor', 'Airport Operations Specialist*2',
    'Airport Planner', 'Senior Airport Planner', 'ARFF Firefighter', 'ARFF Captain', 'Airport Police Officer', 'Wildlife Biologist',
    'Airport Security Coordinator', 'Noise Program Manager', 'Terminal Operations Manager', 'Airport Engineer',
    'Air Service Development Manager', 'Environmental Program Manager', 'Emergency Manager']);
group('aviation/mro', 50,
  'AAR Corp*2 | StandardAero*2 | Delta TechOps*2 | HAECO Americas | AvTech Aviation Services | Cascade Aircraft Maintenance',
  ['A&P Mechanic*2', 'Aircraft Mechanic*2', 'A&P Technician', 'Airframe & Powerplant Mechanic', 'Aircraft Maintenance Technician (A&P)',
    'Avionics Technician*2', 'Lead Avionics Technician', 'Aircraft Inspector', 'Quality Inspector (IA)', 'Maintenance Controller',
    'MRO Program Manager', 'Powerplant Engineer', 'Structures Repair Engineer', 'Planner, Heavy Maintenance', 'Tooling Coordinator',
    'Parts Manager', 'Line Maintenance Supervisor', 'Sheet Metal Technician', 'Engine Technician', 'Quality Assurance Manager']);
group('aviation/faa', 45,
  'Federal Aviation Administration*5 | FAA*3 | Federal Aviation Administration (FAA)',
  ['Air Traffic Controller*3', 'Air Traffic Control Specialist*2', 'Certified Professional Controller', 'Air Traffic Manager',
    'Front Line Manager, ATC', 'Operations Supervisor, Seattle Center', 'Aviation Safety Inspector*2', 'Aviation Safety Inspector (Operations)',
    'Aviation Safety Inspector, Airworthiness', 'UAS Integration Specialist', 'Program Manager, UAS Integration Office',
    'Aviation Safety Analyst', 'Airspace Specialist', 'Air Traffic Assistant', 'Attorney-Advisor', 'Management and Program Analyst',
    'Airport Certification Inspector', 'Flight Standards Supervisor', 'Senior Policy Advisor, UAS']);
group('aviation/atc-contract', 6, 'Serco*2 | Midwest ATC*2 | Robinson Aviation (RVA)',
  ['Air Traffic Controller*3', 'Air Traffic Manager', 'Tower Controller']);
group('aviation/ntsb', 6, 'NTSB | National Transportation Safety Board',
  ['Air Safety Investigator*2', 'Senior Air Safety Investigator', 'Investigator-in-Charge', 'Aviation Accident Investigator']);
group('aviation/tsa', 8, 'TSA | Transportation Security Administration',
  ['Transportation Security Officer*3', 'Lead Transportation Security Officer', 'Federal Security Director', 'Supervisory TSO']);
group('aviation/flight-training', 40,
  'ATP Flight School*3 | CAE*2 | Galvin Flying*2 | Rainier Flight Academy*2 | L3Harris Airline Academy',
  ['Certified Flight Instructor*2', 'CFI', 'CFI/CFII', 'CFII, MEI', 'Flight Instructor*2', 'Chief Flight Instructor', 'Assistant Chief Flight Instructor',
    'Simulator Instructor', 'Ground Instructor', 'Training Center Manager', 'Pilot Training Coordinator', 'Director of Training',
    'Admissions Advisor', 'Dispatcher', 'Student Pilot']);
group('aviation/university', 25,
  'Embry-Riddle Aeronautical University*3 | Embry-Riddle Aeronautical University - Worldwide | Purdue University School of Aviation and Transportation Technology | University of North Dakota Aerospace',
  ['Professor of Aeronautical Science', 'Assistant Professor, Unmanned Systems', 'Associate Professor of Aviation Safety', 'Flight Instructor',
    'Department Chair, Flight', 'Research Engineer', 'Graduate Research Assistant', 'Career Services Director', 'Lecturer, Air Traffic Management',
    'Program Coordinator, UAS Program', 'Student']);
group('aviation/business', 40,
  'NetJets*3 | Wheels Up*2 | Flexjet*2 | Signature Aviation*2 | Clay Lacy Aviation | Atlantic Aviation | Jet Linx',
  ['Captain, Citation X', 'Captain*2', 'First Officer*2', 'Charter Sales Executive', 'Charter Coordinator', 'Flight Coordinator',
    'FBO General Manager', 'Line Service Technician*2', 'Customer Service Representative', 'Director of Maintenance', 'Owner Services Manager',
    'Director of Operations', 'Aircraft Sales Director', 'Aviation Sales Manager']);
group('aviation/air-medical', 30,
  'Air Methods*3 | Life Flight Network*2 | PHI Air Medical*2 | Airlift Northwest',
  ['Flight Paramedic*3', 'Flight Nurse*3', 'EMS Helicopter Pilot*2', 'Pilot, Bell 407', 'Base Lead Pilot', 'Clinical Base Manager',
    'Aviation Maintenance Technician', 'Flight Communications Specialist', 'Program Director', 'Safety Officer']);

// --- aerospace, defense, space
group('aerospace/primes', 170,
  'Boeing*6 | The Boeing Company*3 | Boeing Commercial Airplanes*2 | Airbus*2 | Lockheed Martin*4 | Northrop Grumman*3 | RTX | Raytheon*2 | Pratt & Whitney*2 | Collins Aerospace*2 | General Dynamics | GE Aerospace*2 | Honeywell Aerospace*2 | Textron Aviation | Bell Textron | Gulfstream Aerospace | L3Harris Technologies*2 | BAE Systems | Spirit AeroSystems',
  ['Aerospace Engineer*3', 'Senior Aerospace Engineer*2', 'Aerospace Engineer II', 'Lead Aerospace Engineer', 'Principal Aerospace Engineer',
    'Structural Analysis Engineer', 'Stress Engineer', 'Senior Stress Engineer', 'Systems Engineer*2', 'Systems Engineer III',
    'Flight Test Engineer', 'Senior Flight Test Engineer', 'Flight Test Instrumentation Engineer', 'Experimental Test Pilot', 'Test Pilot',
    'Avionics Engineer', 'Propulsion Engineer', 'Aerodynamics Engineer', 'Manufacturing Engineer*2', 'Quality Engineer', 'Liaison Engineer',
    'Program Manager*2', 'Senior Program Manager', 'Business Development Manager', 'Capture Manager', 'Contracts Manager',
    'Subcontract Administrator', 'Supply Chain Specialist', 'Software Engineer*2', 'Embedded Software Engineer', 'GNC Engineer',
    'Aircraft Mechanic', 'Airplane Assembler', 'CNC Machinist', 'Facility Security Officer', 'Engineering Manager', 'Chief Engineer',
    'Program Director', 'Field Service Representative', 'Technical Fellow', 'Reliability Engineer', 'Certification Engineer (DER)',
    'Human Resources Generalist', 'Financial Analyst', 'Communications Specialist']);
group('aerospace/space', 80,
  'SpaceX*5 | Space Exploration Technologies | Blue Origin*3 | NASA*3 | NASA Jet Propulsion Laboratory*2 | Rocket Lab*2 | United Launch Alliance | Relativity Space | Planet | Firefly Aerospace',
  ['Propulsion Engineer*2', 'Senior Propulsion Engineer', 'Launch Engineer', 'Mission Operations Engineer', 'Avionics Engineer',
    'Flight Software Engineer*2', 'GNC Engineer', 'Structures Engineer', 'Test Engineer', 'Build Reliability Engineer', 'Manufacturing Engineer',
    'Launch Director', 'Mission Manager', 'Range Safety Officer', 'Production Technician', 'Spacecraft Operations Engineer',
    'Engineering Manager, Propulsion', 'Supply Chain Manager', 'Recruiter', 'Systems Engineer', 'Thermal Engineer', 'Research Scientist']);
group('aerospace/defense-tech', 25,
  'Anduril Industries*2 | Shield AI*2 | AeroVironment*2 | General Atomics Aeronautical Systems*2 | Kratos Defense',
  ['Autonomy Engineer', 'Flight Test Engineer', 'Field Engineer', 'UAS Operator', 'Program Manager', 'Business Development Director',
    'Software Engineer', 'Hardware Engineer', 'Mission Engineer', 'UAS Test Pilot', 'Field Service Representative']);

// --- drones and eVTOL
group('drones/companies', 105,
  'Skydio*4 | Zipline*3 | Wing*2 | DJI*2 | DJI Enterprise | BRINC*2 | Percepto | DroneDeploy*2 | Flock Safety | Parrot | Matternet | Northwind Aerial Imaging | Cascade Drone Services',
  ['UAS Pilot*2', 'Drone Pilot*2', 'Remote Pilot in Command', 'sUAS Operator', 'Commercial Drone Pilot', 'Flight Operations Manager',
    'Head of Flight Operations', 'Flight Test Engineer', 'Flight Test Pilot', 'Regulatory Affairs Manager', 'Head of Regulatory Affairs',
    'FAA Certification Lead', 'Certification Engineer', 'Customer Success Manager, Public Safety', 'Account Executive, Public Safety',
    'Account Executive - Agriculture', 'Solutions Engineer', 'Robotics Engineer', 'Autonomy Engineer', 'Computer Vision Engineer',
    'Hardware Engineer', 'Product Manager', 'Senior Product Manager', 'Training Manager', 'Field Operations Lead', 'BVLOS Program Manager',
    'Part 107 Instructor', 'Mission Planner', 'Fleet Maintenance Technician', 'Battery Systems Engineer', 'Software Engineer*2',
    'Recruiter', 'Marketing Manager', 'GIS Analyst', 'Photogrammetrist']);
group('drones/evtol', 35,
  'Joby Aviation*3 | Archer Aviation*2 | BETA Technologies*2 | Wisk Aero | Supernal',
  ['Test Pilot', 'Experimental Test Pilot', 'Flight Test Engineer*2', 'Certification Engineer', 'Airworthiness Engineer', 'Battery Engineer',
    'Electric Propulsion Engineer', 'Program Manager, Vertiport Infrastructure', 'Pilot Training Lead', 'Regulatory Affairs Manager',
    'Manufacturing Engineer', 'Software Engineer', 'Human Factors Engineer', 'Aerodynamics Engineer', 'Technician', 'Supply Chain Manager']);

// --- military
group('military/air-force', 40,
  'U.S. Air Force*4 | United States Air Force*2 | USAF | Washington Air National Guard',
  ['MQ-9 Pilot*2', 'RPA Pilot', 'Sensor Operator, MQ-9', 'Captain', 'Major', 'Lieutenant Colonel', 'Squadron Commander', 'Flight Commander',
    'Aircraft Maintenance Officer', 'Crew Chief', 'Dedicated Crew Chief, C-17', 'C-17 Pilot', 'KC-135 Instructor Pilot', 'Intelligence Officer',
    'Logistics Readiness Officer', 'Recruiter', 'Public Affairs Officer', 'Air Traffic Controller', 'Security Forces', 'Airfield Manager']);
group('military/army', 25, 'U.S. Army*3 | US Army | Army National Guard*2',
  ['UH-60 Instructor Pilot', 'Helicopter Pilot', 'Unmanned Aircraft Systems Operator (15W)', 'Aviation Officer', 'Captain', 'Major',
    'Combat Medic', 'Recruiter', 'Logistics Officer', 'Platoon Leader', 'Crew Chief (15T)', 'Company Commander']);
group('military/navy-marines', 15, 'U.S. Navy*2 | United States Marine Corps | U.S. Marine Corps',
  ['Naval Aviator', 'Helicopter Pilot', 'Hospital Corpsman', 'Aviation Boatswain\'s Mate', 'Lieutenant', 'Lieutenant Commander',
    'Intelligence Officer', 'Recruiter', 'Air Traffic Controller']);
group('military/coast-guard', 10, 'U.S. Coast Guard | United States Coast Guard',
  ['Aviation Survival Technician (Rescue Swimmer)', 'MH-65 Pilot', 'Lieutenant', 'Boatswain\'s Mate', 'Search and Rescue Controller',
    'Marine Science Technician']);

// --- public safety
group('public-safety/fire', 90,
  'Seattle Fire Department*2 | Los Angeles County Fire Department*2 | Denver Fire Department | Phoenix Fire Department*2 | Austin Fire Department | Eastside Fire & Rescue | Puget Sound Fire | Bellevue Fire Department | Spokane Valley Fire Department',
  ['Firefighter*3', 'Firefighter/Paramedic*3', 'Firefighter/EMT*2', 'Fire Captain*2', 'Captain', 'Lieutenant', 'Battalion Chief', 'Fire Chief',
    'Deputy Fire Chief', 'Assistant Chief, Operations', 'Division Chief', 'Engineer', 'Fire Apparatus Engineer', 'Fire Marshal',
    'Deputy Fire Marshal', 'Fire Inspector', 'UAS Program Coordinator', 'Drone Team Lead', 'Public Information Officer', 'EMS Coordinator',
    'Training Captain', 'Fire Prevention Specialist', 'Hazmat Technician', 'Technical Rescue Specialist']);
group('public-safety/wildland', 30,
  'CAL FIRE*3 | Cal Fire | USDA Forest Service*2 | US Forest Service | Bureau of Land Management | Washington State Department of Natural Resources*2',
  ['Wildland Firefighter*2', 'Hotshot Crew Member', 'Helitack Crew Member', 'Smokejumper', 'Fire Engine Captain', 'Air Attack Supervisor',
    'Helicopter Manager', 'Fire Management Officer', 'Forestry Technician', 'Prescribed Fire Specialist', 'Wildfire Mitigation Specialist',
    'Fuels Specialist', 'Battalion Chief', 'Unit Chief']);
group('public-safety/aerial-firefighting', 12, 'Coulson Aviation*2 | 10 Tanker Air Carrier | Erickson Inc.',
  ['Air Tanker Pilot', 'Captain, C-130 Air Tanker', 'Helicopter Pilot, Firefighting', 'Aircraft Maintenance Engineer', 'Fire Operations Manager']);
group('public-safety/police', 90,
  'Seattle Police Department*2 | Los Angeles Police Department | LAPD | Austin Police Department | Chula Vista Police Department*2 | Phoenix Police Department | NYPD | King County Sheriff\'s Office*2 | Maricopa County Sheriff\'s Office | Snohomish County Sheriff\'s Office | Washington State Patrol',
  ['Police Officer*4', 'Patrol Officer*2', 'Sergeant*2', 'Lieutenant', 'Captain', 'Detective*2', 'Commander', 'Deputy Chief', 'Chief of Police',
    'Deputy Sheriff*2', 'Drone Unit Supervisor', 'UAS Program Manager', 'Drone as First Responder (DFR) Coordinator', 'Crime Analyst',
    'Real Time Crime Center Manager', 'Public Information Officer', 'Records Specialist', 'School Resource Officer', 'K9 Officer',
    'SWAT Team Leader', 'Police Dispatcher']);
group('public-safety/ems', 45,
  'American Medical Response*2 | AMR | Falck*2 | King County Medic One | Austin-Travis County EMS*2 | Cascade Ambulance',
  ['Paramedic*4', 'EMT*2', 'EMT-B', 'Emergency Medical Technician', 'Critical Care Paramedic', 'Paramedic Supervisor', 'Field Training Officer',
    'Operations Manager', 'Clinical Educator', 'EMS Chief', 'Community Paramedic', 'EMS Dispatcher', 'Medical Director']);
group('public-safety/911', 28,
  'Valley Communications Center*2 | NORCOM 911 | SNO911 | City of Austin 911 Call Center | Phoenix Fire Regional Dispatch Center',
  ['911 Dispatcher*3', 'Emergency Communications Dispatcher*2', 'Public Safety Telecommunicator', 'Call Receiver', 'Dispatch Supervisor',
    'Communications Center Manager', 'CAD Administrator', 'Training Coordinator', 'Fire Dispatcher', 'Quality Assurance Specialist, 911']);
group('public-safety/emergency-mgmt', 40,
  'FEMA*2 | Federal Emergency Management Agency | Washington Emergency Management Division*2 | King County Office of Emergency Management | American Red Cross*2 | Team Rubicon | Pierce County Department of Emergency Management',
  ['Emergency Management Coordinator*2', 'Emergency Manager', 'Emergency Management Specialist', 'Disaster Program Manager',
    'Search and Rescue Coordinator', 'Hazard Mitigation Specialist', 'Planning Section Chief', 'Logistics Specialist', 'Volunteer Coordinator',
    'Recovery Program Manager', 'Public Information Officer', 'GIS Analyst', 'Regional Disaster Officer', 'Preparedness Program Manager']);
group('public-safety/federal-le', 14, 'FBI*2 | Federal Bureau of Investigation | U.S. Marshals Service | DEA',
  ['Special Agent*3', 'Supervisory Special Agent', 'Intelligence Analyst', 'Forensic Examiner', 'Program Analyst', 'Public Affairs Specialist']);

// --- agriculture
group('agriculture/equipment', 45,
  'John Deere*4 | Deere & Company*3 | CNH Industrial | Case IH | AGCO | Raven Industries | Kubota Tractor Corporation',
  ['Product Manager, Sprayers', 'Product Line Manager', 'Design Engineer*2', 'Agricultural Engineer', 'Embedded Software Engineer',
    'Software Engineer*2', 'Precision Ag Product Specialist', 'Territory Manager', 'Dealer Development Manager', 'Field Test Engineer',
    'Manufacturing Engineer', 'Service Technician', 'Product Marketing Manager', 'Autonomy Engineer', 'Data Scientist', 'Supply Chain Analyst',
    'Welder', 'Machine Operator']);
group('agriculture/inputs', 70,
  'Corteva Agriscience*3 | Bayer Crop Science*3 | Syngenta*2 | Nutrien Ag Solutions*3 | Wilbur-Ellis*2 | Simplot*2 | Helena Agri-Enterprises | BASF Agricultural Solutions',
  ['Agronomist*3', 'Senior Agronomist', 'Field Agronomist', 'Agronomy Manager', 'Crop Consultant', 'Certified Crop Adviser (CCA)',
    'Precision Ag Specialist', 'Precision Agriculture Manager', 'Seed Sales Representative', 'Territory Sales Manager',
    'Account Manager, Crop Protection', 'Plant Breeder', 'Research Scientist, Plant Breeding', 'Soil Scientist', 'Entomologist',
    'Regulatory Affairs Manager, Crop Protection', 'Data Scientist', 'Applicator', 'Custom Application Manager', 'Location Manager',
    'Marketing Manager']);
group('agriculture/grain', 22, 'Cargill*2 | ADM | CHS Inc.*2 | Land O\'Lakes | The Scoular Company',
  ['Grain Merchandiser*2', 'Commodity Trader', 'Origination Manager', 'Elevator Manager', 'Location Manager', 'Risk Analyst', 'Plant Manager',
    'Food Safety Manager', 'Supply Chain Analyst', 'Agronomy Sales Representative']);
group('agriculture/deere-dealers', 14, 'Papé Machinery*2 | RDO Equipment Co.*2 | Washington Tractor',
  ['Service Manager', 'Parts Manager', 'Precision Ag Specialist', 'Sales Representative', 'Service Technician*2', 'Integrated Solutions Manager']);
group('agriculture/crop-farms', 25,
  'Hartwell Family Farms | Columbia Basin Potato Growers | Blue Mountain Wheat Ranch | Palouse Grain Partners | Yakima Valley Hops Co. | Skagit Flats Farming',
  ['Owner', 'Owner/Operator', 'Farmer', 'Grower', 'Producer', 'Farm Manager*2', 'Operations Manager', 'Field Supervisor', 'Irrigation Specialist',
    'Equipment Operator', 'Head Grower']);
group('agriculture/orchards-vineyards', 15,
  'Sunny Ridge Orchards | Okanogan Orchards | Riverbend Vineyards | Columbia Crest Winery | Chateau Ste. Michelle',
  ['Orchard Manager', 'Vineyard Manager', 'Viticulturist', 'Winemaker', 'Assistant Winemaker', 'Pest Control Advisor', 'General Manager', 'Grower']);
group('agriculture/livestock', 12, 'Two Rivers Dairy | Cedar Creek Cattle Co. | Darigold',
  ['Dairy Herd Manager', 'Ranch Manager', 'Owner', 'Nutritionist', 'Field Representative', 'Cattle Buyer']);
group('agriculture/aerial-application', 15,
  'Valley Air Crop Care*2 | Columbia Ag Aviation*2 | Hylio | Rantizo | Prairie Sky Ag Drones',
  ['Agricultural Pilot*2', 'Ag Pilot', 'Aerial Applicator*2', 'Spray Drone Operator', 'Drone Applicator', 'Operations Manager', 'Loader/Mixer',
    'Agronomist']);
group('agriculture/agencies', 24,
  'USDA*2 | USDA NRCS*2 | USDA APHIS | USDA Farm Service Agency | Washington State Department of Agriculture*2',
  ['Soil Conservationist', 'District Conservationist', 'Agricultural Economist', 'Plant Health Inspector', 'Pesticide Compliance Inspector',
    'Pesticide Program Manager', 'Agricultural Statistician', 'Farm Loan Officer', 'Food Safety Inspector', 'Program Specialist']);
group('agriculture/extension', 16,
  'Washington State University Extension*2 | Oregon State University Extension Service | Iowa State University Extension and Outreach | University of California Agriculture and Natural Resources',
  ['Extension Agent', 'County Extension Educator', 'Extension Specialist, Precision Agriculture', 'Research Agronomist', 'Extension Entomologist',
    'Pesticide Safety Education Coordinator']);

// --- media and entertainment
group('media/film-tv', 120,
  'Netflix*4 | Warner Bros. Discovery*2 | NBCUniversal*2 | The Walt Disney Company*2 | Disney | Paramount | Sony Pictures Entertainment | Lionsgate | A24 | Amazon MGM Studios*2 | Skydance | Legendary Entertainment | Bluebird Pictures | Low Orbit Films | Granite Peak Productions | Northlight Studios',
  ['Producer*3', 'Executive Producer', 'Line Producer', 'Associate Producer', 'Co-Producer', 'Director', 'Film Director', 'Director of Photography',
    'Cinematographer', 'DP', 'Camera Operator*2', '1st AC', 'Steadicam Operator', 'Gaffer', 'Key Grip', 'Editor', 'Film Editor', 'Assistant Editor',
    'VFX Supervisor', 'Colorist', 'Location Manager', 'Location Scout', 'Production Coordinator', 'Production Assistant*2',
    'Unit Production Manager', 'Writer', 'Casting Director', 'Stunt Coordinator', 'Development Executive', 'Post-Production Supervisor',
    'Script Supervisor', 'Production Designer', 'Sound Mixer', 'Marketing Manager', 'Content Strategy Manager', 'Software Engineer']);
group('media/vfx', 28,
  'Industrial Light & Magic*2 | ILM | Wētā FX | Framestore | DNEG | Pixar Animation Studios | Digital Domain',
  ['VFX Artist', 'Visual Effects Artist', 'VFX Supervisor', 'Compositor', 'Senior Compositor', 'FX TD', 'Lighting Artist', 'Animator',
    'CG Supervisor', 'Pipeline TD', 'Matte Painter', 'VFX Producer', 'Layout Artist', 'Roto Artist']);
group('media/aerial-film', 10, 'HoverFrame Media | Skyline Aerial Cinema | Wolfe Air Aviation | Helinet Aviation',
  ['Aerial Cinematographer', 'Drone Camera Operator', 'Aerial Director of Photography', 'Helicopter Camera Pilot', 'Aerial Coordinator',
    'Gimbal Technician', 'Producer']);
group('media/broadcast', 45,
  'KING 5 News*2 | KOMO News*2 | KIRO 7 | CNN | NBC News | ABC News | CBS News | FOX 13 Seattle | NPR | KUOW',
  ['News Director', 'Assignment Editor', 'Reporter*3', 'Anchor', 'Morning Anchor', 'Meteorologist', 'Chief Meteorologist', 'Photojournalist',
    'News Photographer', 'Executive Producer', 'Producer*2', 'Digital Producer', 'Investigative Reporter', 'Correspondent', 'Video Editor',
    'Technical Director', 'Broadcast Engineer', 'Sports Reporter']);
group('media/music', 22, 'Universal Music Group | Sony Music Entertainment | Live Nation*2 | AEG Presents | Sub Pop Records | KEXP',
  ['A&R Manager', 'Tour Manager', 'Sound Engineer', 'Audio Engineer', 'Music Producer', 'Booking Agent', 'Artist Manager', 'Production Manager',
    'Stage Manager', 'Talent Buyer', 'Promoter', 'Venue Manager']);
group('media/games', 45,
  'Electronic Arts*2 | Riot Games*2 | Bungie*2 | Valve | Nintendo of America | Xbox Game Studios | PopCap Games | 343 Industries',
  ['Game Designer', 'Level Designer', 'Producer*2', 'Senior Producer', 'Technical Artist', 'Gameplay Engineer', 'Graphics Engineer', 'QA Tester*2',
    'QA Analyst', 'Community Manager', 'Narrative Designer', 'Art Director', 'Environment Artist', 'VFX Artist', 'Animator', 'Game Director',
    'Live Ops Manager', 'Data Analyst', 'Esports Producer']);
group('media/talent-agency', 14, 'Creative Artists Agency*2 | CAA | WME | United Talent Agency',
  ['Agent', 'Talent Agent', 'Literary Agent', 'Motion Picture Agent', 'Agent Trainee', 'Coordinator', 'Executive Assistant']);
group('media/advertising', 22, 'Wieden+Kennedy*2 | Droga5 | Cole & Weber | Publicis',
  ['Creative Director', 'Copywriter', 'Art Director', 'Account Director', 'Producer', 'Head of Production', 'Strategist', 'Account Manager',
    'Social Media Manager', 'Designer']);

// --- mining, oil and gas, heavy equipment
group('resources/mining', 40,
  'Rio Tinto*2 | Freeport-McMoRan*2 | Newmont*2 | BHP | Kennecott Utah Copper | Hecla Mining Company | Teck Resources | Barrick Gold',
  ['Mining Engineer*2', 'Senior Mining Engineer', 'Mine Superintendent', 'Geologist*2', 'Exploration Geologist', 'Senior Geologist',
    'Mine Surveyor', 'Surveyor', 'Geotechnical Engineer', 'Drill and Blast Engineer', 'Blaster', 'Haul Truck Operator', 'Heavy Equipment Operator',
    'Mine Manager', 'HSE Manager', 'Safety Specialist', 'Environmental Specialist', 'Geospatial Analyst', 'Remote Sensing Specialist',
    'Drone Survey Lead', 'Maintenance Planner', 'Metallurgist', 'Process Engineer']);
group('resources/oil-gas', 45,
  'Chevron*2 | ExxonMobil*2 | Shell*2 | BP | ConocoPhillips | Halliburton*2 | SLB | Baker Hughes | Kinder Morgan | Williams Companies',
  ['Petroleum Engineer*2', 'Drilling Engineer', 'Reservoir Engineer', 'Completions Engineer', 'Production Engineer', 'Geologist', 'Geophysicist',
    'Pipeline Integrity Engineer', 'Pipeline Inspector', 'Asset Integrity Manager', 'Inspection Lead', 'HSE Manager', 'EHS Advisor',
    'Field Service Technician', 'Field Engineer', 'Operator', 'Control Room Operator', 'Landman', 'Regulatory Compliance Specialist',
    'Emergency Response Coordinator', 'Drone Inspection Specialist', 'Robotics Engineer', 'Data Scientist']);
group('resources/heavy-equipment', 28,
  'Caterpillar*3 | Komatsu | Komatsu America | Trimble*2 | Hexagon | Topcon Positioning Systems | Sandvik',
  ['Product Manager, Autonomous Haulage', 'Field Service Engineer', 'Application Engineer', 'Design Engineer', 'Sales Engineer',
    'Dealer Sales Manager', 'Mining Solutions Specialist', 'Software Engineer', 'Technical Trainer', 'Project Manager',
    'Geospatial Solutions Specialist', 'Account Manager']);

// --- maritime
group('maritime/ports', 20,
  'Port of Seattle | Port of Tacoma | The Northwest Seaport Alliance*2 | Port of Long Beach | Port of Los Angeles',
  ['Harbor Master', 'Terminal Manager', 'Maritime Operations Manager', 'Port Security Manager', 'Environmental Program Manager', 'Commercial Manager',
    'Planner', 'Facilities Manager', 'Real Estate Manager', 'Harbor Patrol Officer', 'Port Engineer']);
group('maritime/shipping', 35,
  'Matson*2 | Crowley*2 | Foss Maritime*2 | Washington State Ferries*2 | Harley Marine | Royal Caribbean Group | Carnival Cruise Line',
  ['Captain*2', 'Master', 'Chief Mate', 'Second Mate', 'Chief Engineer', 'Marine Engineer', 'Port Engineer', 'Deckhand', 'Able Seaman',
    'Vessel Operations Manager', 'Marine Superintendent', 'Marine Surveyor', 'Fleet Manager', 'Safety Manager', 'Crew Manager', 'Marine Dispatcher']);

// --- sports
group('sports/teams', 40,
  'Seattle Seahawks*2 | Seattle Sounders FC*2 | Seattle Mariners*2 | Seattle Kraken | Seattle Storm | Los Angeles Lakers | Portland Timbers | University of Washington Athletics | Washington State University Athletics',
  ['Head Coach', 'Assistant Coach*2', 'Strength and Conditioning Coach', 'Athletic Trainer', 'Head Athletic Trainer', 'Scout', 'Pro Scout',
    'Video Coordinator', 'Director of Player Personnel', 'Ticket Sales Manager', 'Partnership Sales Manager', 'Director of Partnerships',
    'Data Analyst, Baseball Operations', 'Sports Scientist', 'Team Physician', 'Equipment Manager', 'Director of Communications',
    'Event Operations Manager', 'Content Producer', 'Creative Video Producer', 'General Manager']);
group('sports/motorsport', 12, 'Hendrick Motorsports | Joe Gibbs Racing | Team Penske | Andretti Global | NASCAR',
  ['Crew Chief*2', 'Race Engineer', 'Car Chief', 'Pit Crew Member', 'Data Engineer', 'Aerodynamicist', 'Composite Technician', 'Spotter',
    'Vehicle Dynamics Engineer']);
group('sports/agencies', 8, 'Wasserman | Octagon | Excel Sports Management | Klutch Sports Group',
  ['Sports Agent', 'Agent', 'Director, Athlete Marketing', 'NIL Manager', 'Agent Assistant']);
group('sports/media', 10, 'ESPN*2 | Fox Sports | ROOT SPORTS',
  ['Producer', 'Play-by-Play Announcer', 'Analyst', 'Production Assistant', 'Camera Operator', 'Director', 'Sideline Reporter', 'Graphics Operator']);

// --- veterinary
group('veterinary/small-animal', 16, 'Banfield Pet Hospital*2 | VCA Animal Hospitals*2 | BluePearl Pet Hospital',
  ['Veterinarian*2', 'Associate Veterinarian', 'DVM', 'Emergency Veterinarian', 'Medical Director', 'Veterinary Technician',
    'Licensed Veterinary Technician', 'Veterinary Assistant', 'Practice Manager', 'Hospital Manager', 'Client Service Representative',
    'Veterinary Surgeon']);
group('veterinary/large-animal', 12,
  'Cedar Valley Large Animal Clinic | Palouse Equine Veterinary Services | Washington State University College of Veterinary Medicine',
  ['Large Animal Veterinarian', 'Equine Veterinarian', 'Mixed Animal Veterinarian', 'Veterinarian', 'Veterinary Technician', 'Practice Manager',
    'Clinical Assistant Professor', 'Resident, Large Animal Surgery']);
group('veterinary/industry', 12, 'Zoetis*2 | Elanco | Merck Animal Health | IDEXX | Boehringer Ingelheim Animal Health',
  ['Technical Services Veterinarian', 'Professional Services Veterinarian', 'Territory Manager', 'Key Account Manager', 'Research Scientist',
    'Regulatory Affairs Specialist', 'Sales Representative', 'Marketing Manager']);

// --- general background (the ordinary roles every network has)
group('background/tech', 120,
  'Microsoft*4 | Amazon*4 | Google*2 | Meta | Salesforce | Oracle | Adobe | Expedia Group | Zillow | Tableau | T-Mobile*2 | F5 | Smartsheet | Esri | Garmin | ForeFlight',
  ['Software Engineer*3', 'Senior Software Engineer*2', 'Software Development Engineer II', 'Product Manager*2', 'Senior Product Manager',
    'Technical Program Manager', 'Data Scientist', 'Data Engineer', 'UX Designer', 'Product Designer', 'Engineering Manager', 'Account Executive',
    'Enterprise Account Executive', 'Sales Development Representative', 'Customer Success Manager', 'Solutions Architect',
    'Cloud Solutions Architect', 'Technical Recruiter', 'Recruiter', 'HR Business Partner', 'Marketing Manager', 'Product Marketing Manager',
    'Financial Analyst', 'Program Manager', 'Security Engineer', 'DevOps Engineer', 'Site Reliability Engineer', 'Machine Learning Engineer',
    'Research Scientist', 'Director of Engineering']);
group('background/banking', 30,
  'JPMorgan Chase*2 | Chase | Wells Fargo*2 | Bank of America | BECU | Fidelity Investments | Edward Jones',
  ['Financial Advisor*2', 'Loan Officer', 'Mortgage Loan Officer', 'Branch Manager', 'Relationship Manager', 'Personal Banker', 'Analyst',
    'Investment Banking Associate', 'Vice President, Commercial Banking', 'Wealth Management Associate']);
group('background/insurance', 30, 'State Farm*2 | Allstate | Farmers Insurance*2 | Travelers | USAA | Liberty Mutual',
  ['Insurance Agent*2', 'Agent', 'Claims Adjuster*2', 'Senior Claims Adjuster', 'Underwriter', 'Commercial Underwriter', 'Producer',
    'Insurance Producer', 'Actuarial Analyst', 'Agency Owner']);
group('background/aviation-insurance', 8, 'Global Aerospace*2 | AIG Aerospace | Starr Aviation',
  ['Aviation Underwriter*2', 'Senior Aviation Underwriter', 'Aviation Claims Manager', 'Account Executive, Aviation']);
group('background/aircraft-leasing', 6, 'AerCap | Air Lease Corporation',
  ['Aircraft Leasing Analyst', 'Technical Asset Manager', 'Vice President, Marketing', 'Contracts Manager']);
group('background/consulting', 40,
  'Deloitte*2 | Accenture*2 | KPMG | PwC | EY | McKinsey & Company | Booz Allen Hamilton*2 | Leidos | SAIC',
  ['Consultant*2', 'Senior Consultant*2', 'Manager', 'Senior Manager', 'Audit Associate', 'Tax Manager', 'Strategy Analyst', 'Technology Consultant',
    'Principal', 'Aerospace & Defense Consultant', 'Program Analyst', 'Cybersecurity Consultant']);
group('background/k12', 30,
  'Seattle Public Schools*2 | Bellevue School District | Lake Washington School District | Tacoma Public Schools | Highline Public Schools',
  ['Teacher*2', 'High School Teacher', 'Math Teacher', 'STEM Teacher', 'Physical Education Teacher', 'Principal', 'Assistant Principal',
    'School Counselor', 'Special Education Teacher', 'Instructional Coach', 'Librarian', 'Coach', 'CTE Teacher']);
group('background/higher-ed', 25,
  'University of Washington*2 | Washington State University | Western Washington University | Bellevue College | Oregon State University',
  ['Professor', 'Assistant Professor', 'Associate Professor', 'Research Scientist', 'Lecturer', 'Admissions Counselor', 'Career Services Director',
    'Program Manager', 'Graduate Research Assistant', 'Postdoctoral Researcher', 'Lab Manager']);
group('background/healthcare', 45,
  'Swedish Medical Center*2 | Providence*2 | UW Medicine*2 | Harborview Medical Center | Kaiser Permanente | MultiCare | Virginia Mason Franciscan Health | Seattle Children\'s',
  ['Registered Nurse*3', 'RN, ICU', 'Nurse Practitioner', 'Physician', 'Emergency Medicine Physician', 'Physical Therapist', 'Pharmacist',
    'Respiratory Therapist', 'Medical Assistant', 'Nurse Manager', 'Trauma Surgeon', 'Radiologic Technologist', 'Patient Care Coordinator',
    'EMS Liaison Nurse', 'Director of Emergency Services']);
group('background/real-estate', 22, 'Windermere Real Estate*2 | Compass*2 | Redfin | John L. Scott | CBRE',
  ['Real Estate Agent*2', 'Realtor', 'Broker', 'Managing Broker', 'Commercial Real Estate Broker', 'Property Manager', 'Transaction Coordinator']);
group('background/construction', 40,
  'Skanska | Turner Construction | Mortenson | Sellen Construction | AECOM*2 | Jacobs*2 | HDR | KPFF Consulting Engineers | WSP',
  ['Project Manager*2', 'Superintendent', 'Assistant Superintendent', 'Civil Engineer', 'Civil Engineer, PE', 'Structural Engineer', 'Land Surveyor',
    'Survey Party Chief', 'Estimator', 'Construction Manager', 'BIM Manager', 'VDC Manager', 'Safety Manager', 'Project Engineer',
    'Drone Program Lead', 'Reality Capture Specialist', 'Transportation Engineer', 'Airport Planner']);
group('background/government', 35,
  'City of Seattle*2 | King County*2 | State of Washington | Washington State Department of Transportation*2 | City of Bellevue | Snohomish County | Sound Transit',
  ['Planner', 'Senior Planner', 'Transportation Planner', 'Program Manager', 'Policy Analyst', 'GIS Analyst', 'GIS Specialist', 'Traffic Engineer',
    'Budget Analyst', 'Grants Manager', 'Communications Manager', 'Environmental Planner', 'IT Project Manager', 'Building Inspector',
    'Code Compliance Inspector']);
group('background/retail', 25, 'Starbucks*2 | REI*2 | Costco Wholesale | Nordstrom | Les Schwab Tire Centers',
  ['Store Manager', 'Assistant Store Manager', 'Barista', 'Shift Supervisor', 'Buyer', 'District Manager', 'Merchandiser', 'Sales Associate']);
group('background/staffing', 14, 'Robert Half | Aerotek*2 | Randstad | Kforce',
  ['Recruiter*2', 'Technical Recruiter', 'Senior Recruiter', 'Account Manager', 'Talent Acquisition Specialist', 'Staffing Manager']);
group('background/nonprofit', 14, 'Habitat for Humanity | United Way of King County | Boys & Girls Clubs of King County | Northwest Harvest',
  ['Executive Director', 'Program Director', 'Development Director', 'Volunteer Coordinator', 'Communications Manager', 'Grants Manager']);
group('aviation/nonprofit', 14, 'Angel Flight West | Civil Air Patrol*2 | The Museum of Flight*2 | AOPA | Experimental Aircraft Association',
  ['Volunteer Pilot', 'Mission Pilot', 'Education Programs Manager', 'Curator', 'Executive Director', 'Program Director', 'Volunteer Coordinator',
    'Aviation Safety Program Manager']);
group('background/electronics-ems', 8, 'Jabil*2 | Sanmina | Flex | Benchmark Electronics',
  ['Program Manager', 'Manufacturing Engineer', 'Quality Engineer', 'Supply Chain Manager', 'Operations Manager']);
group('background/trucking', 10, 'Swift Transportation | Schneider | J.B. Hunt Transport | Old Dominion Freight Line',
  ['Dispatcher*2', 'Fleet Manager', 'Truck Driver', 'Driver Manager', 'Logistics Coordinator', 'Load Planner']);
group('background/legal', 10, 'Perkins Coie*2 | K&L Gates | Davis Wright Tremaine | Holland & Knight',
  ['Associate Attorney', 'Partner', 'Paralegal', 'Counsel', 'Legal Assistant', 'Senior Associate']);

// ---------------------------------------------------------------- hand-written rows
// [first, last, company, position, sector, extra?]; extra: m/s/r/lm/fm (messages), inv/ia, n (note), e, rec
const FIXED = [
  // the owner's company (fictional)
  ['Corinne', 'Halvorsen', 'Skyfield Aerial', 'CEO & Co-Founder', 'drones/owner', { m: 64, s: 18, r: 20, lm: '2026-09-29', fm: '2022-03-01', e: 9, rec: true }],
  ['Teodor', 'Vukovic', 'Skyfield Aerial', 'Co-Founder & CTO', 'drones/owner', { m: 41, s: 12, r: 12, lm: '2026-09-25', fm: '2022-03-02', e: 6 }],
  ['Malia', 'Kealoha', 'Skyfield Aerial', 'Chief Pilot', 'drones/owner', { m: 52, s: 15, r: 14, lm: '2026-09-30', fm: '2022-06-10', e: 7 }],
  ['Bryce', 'Lindahl', 'Skyfield Aerial', 'Senior UAS Pilot', 'drones/owner', { m: 22, s: 6, r: 7, lm: '2026-09-12', fm: '2023-01-15' }],
  ['Yara', 'Okonkwo', 'Skyfield Aerial', 'Senior UAS Pilot', 'drones/owner', { m: 18, s: 5, r: 5, lm: '2026-08-28', fm: '2023-04-02' }],
  ['Ezra', 'Mabry', 'Skyfield Aerial', 'UAS Pilot', 'drones/owner'],
  ['Leilani', 'Salonga', 'Skyfield Aerial', 'UAS Pilot', 'drones/owner'],
  ['Damien', 'Ashworth', 'Skyfield Aerial', 'Flight Operations Coordinator', 'drones/owner', { m: 30, s: 9, r: 8, lm: '2026-09-27', fm: '2023-02-20' }],
  ['Shira', 'Pemberton', 'Skyfield Aerial', 'Safety & Compliance Manager', 'drones/owner', { m: 15, s: 4, r: 4, lm: '2026-09-18', fm: '2023-05-05' }],
  ['Rohan', 'Ramanathan', 'Skyfield Aerial', 'Regulatory Specialist', 'drones/owner', { m: 27, s: 8, r: 7, lm: '2026-09-22', fm: '2023-06-01', n: 'Owns our Part 107 waiver and COA paperwork; tracks every DroneZone application.' }],
  ['Fiona', 'Corrigan', 'Skyfield Aerial', 'Head of Sales', 'drones/owner'],
  ['Kofi', 'Boateng', 'Skyfield Aerial', 'Account Executive, Public Safety', 'drones/owner'],
  ['Wren', 'Thackeray', 'Skyfield Aerial', 'Account Executive, Agriculture', 'drones/owner'],
  ['Hugo', 'Marchetti', 'Skyfield Aerial', 'Customer Success Lead', 'drones/owner'],
  ['Ilse', 'Reinholt', 'Skyfield Aerial', 'Training Lead', 'drones/owner'],
  ['Naveen', 'Goswami', 'Skyfield Aerial', 'Payload Engineer (Thermal)', 'drones/owner'],
  ['Seth', 'Underhill', 'Skyfield Aerial', 'Software Engineer', 'drones/owner'],
  ['Odette', 'Beaumont', 'Skyfield Aerial', 'Data Analyst', 'drones/owner'],
  ['Joaquin', 'Esparza', 'Skyfield Aerial', 'Media Production Lead', 'drones/owner'],
  ['Rui', 'Medeiros', 'Skyfield Aerial', 'Maintenance Technician', 'drones/owner'],
  ['Gemma', 'Talbot', 'Skyfield Aerial', 'Office Manager', 'drones/owner'],
  // chief pilots and pilots in specific places
  ['Harlan', 'Strand', 'Alaska Airlines', 'Captain, B737', 'aviation/airline', { m: 9, s: 3, r: 3, lm: '2026-05-14', fm: '2019-08-01', n: 'Flew right seat with me at Delta for two years before he moved to Alaska.' }],
  ['Josefina', 'Trujillo', 'Alaska Airlines', 'First Officer', 'aviation/airline'],
  ['Kendall', 'Hastings', 'Alaska Air Group', 'Captain | Line Check Pilot', 'aviation/airline'],
  ['Gideon', 'Farrow', 'Alaska Airlines', 'Chief Pilot, Seattle Base', 'aviation/airline', { m: 5, s: 2, r: 2, lm: '2026-02-10', fm: '2024-11-03' }],
  ['Amir', 'Rahimi', 'Horizon Air', 'Assistant Chief Pilot', 'aviation/airline'],
  ['Saoirse', 'Keane', 'Alaska Airlines', 'Flight Attendant', 'aviation/airline'],
  ['Lachlan', 'Sutherland', 'Alaska Department of Fish and Game', 'Pilot / Fisheries Biologist', 'background/government'],
  ['Moana', 'Kahananui', 'Alaska Seaplanes', 'Bush Pilot', 'aviation/business'],
  ['Colin', 'Darrow', 'Clay Lacy Aviation', 'Chief Pilot | Part 135', 'aviation/business'],
  ['Esme', 'Fenwick', 'Life Flight Network', 'Chief Pilot', 'aviation/air-medical'],
  ['Garrett', 'Pacheco', 'Zipline', 'Chief Pilot, UAS Operations', 'drones/companies', { m: 7, s: 2, r: 3, lm: '2026-07-19', fm: '2025-01-22', inv: 'outgoing', ia: '2025-01-20' }],
  ['Rania', 'Khoury', 'Coulson Aviation', 'Chief Pilot, Air Tanker Operations', 'public-safety/aerial-firefighting', { n: 'Night-flying air tankers on the Bootleg and Cedar Creek fires; open to pairing tankers with our wildfire mapping drones.' }],
  ['Quentin', 'Amundsen', 'Rainier Flight Academy', 'Chief Flight Instructor', 'aviation/flight-training', { m: 6, s: 2, r: 2, lm: '2026-06-02', fm: '2024-04-11', n: 'Offered to beta test our flight-log app with his flight school students.' }],
  ['Paloma', 'Saavedra', 'Self-employed', 'CFI | Commercial Drone Pilot', 'drones/freelance'],
  ['Harper', 'Eckhart', 'Puget Sound Pilots', 'Harbor Pilot', 'maritime/shipping'],
  ['Elif', 'Yildiz', 'U.S. Customs and Border Protection', 'Air Interdiction Agent (Pilot)', 'public-safety/federal-le'],
  ['Dmitri', 'Kuznetsov', 'U.S. Customs and Border Protection', 'Border Patrol Agent', 'public-safety/federal-le'],
  ['Stellan', 'Olafsson', 'NASA Armstrong Flight Research Center', 'Research Test Pilot', 'aerospace/space'],
  ['Imani', 'Walcott', 'NASA', 'Aerospace Engineer, UAS Traffic Management', 'aerospace/space', { m: 4, s: 1, r: 2, lm: '2025-11-05', fm: '2025-04-20' }],
  // recruiters who hire pilots
  ['Cassidy', 'Hollis', 'AvCrew Staffing', 'Aviation Recruiter', 'background/aviation-staffing'],
  ['Khalil', 'Navarro', 'JetStream Aviation Staffing', 'Pilot Recruitment Manager', 'background/aviation-staffing', { inv: 'incoming', ia: '2026-03-14' }],
  ['Theo', 'Brennan', 'Wheels Up', 'Talent Acquisition Manager, Pilot Recruiting', 'aviation/business'],
  ['Mira', 'Desai', 'Zipline', 'Technical Recruiter, Flight Operations', 'drones/companies'],
  // Part 107 waivers, regulators, drone law
  ['Sabine', 'Albrecht', 'Clearline Aviation Consulting', 'Principal', 'drones/consulting', { m: 12, s: 4, r: 4, lm: '2026-08-14', fm: '2024-09-01', n: 'Former FAA UAS Integration Office; now helps operators with waivers and COAs. Got our BVLOS waiver approved in six weeks.' }],
  ['Marcus', 'Wainwright', 'Hollister & Wade LLP', 'Partner, Aviation & Drone Law', 'background/legal', { m: 8, s: 3, r: 2, lm: '2026-04-30', fm: '2024-02-12', n: 'Reviewed our operations-over-people waiver (107.39) and the insurance language in our public safety contracts.' }],
  ['Uma', 'Bhattacharya', 'Altitude Regulatory Advisors', 'Drone Regulatory Consultant', 'drones/consulting'],
  ['Felipe', 'Duarte', 'Federal Aviation Administration', 'UAS Waiver Specialist, Flight Standards', 'aviation/faa'],
  ['Ifeoma', 'Ekwueme', 'U.S. Department of Transportation - FAA', 'Senior Advisor, BVLOS Rulemaking', 'aviation/faa'],
  ['Tobias', 'Holmberg', 'Leidos', 'Former FAA Air Traffic Controller | Airspace Consultant', 'background/consulting'],
  ['Oksana', 'Ivanova', 'Snohomish County Sheriff\'s Office', 'Drone Unit Supervisor', 'public-safety/police', { m: 14, s: 4, r: 5, lm: '2026-09-09', fm: '2025-02-02', n: 'Signed up their sheriff\'s office drone unit as a beta site for our DFR software; wrote their COA application herself.' }],
  ['Nikolai', 'Petrakis', 'Chula Vista Police Department', 'Captain, Drone as First Responder Program', 'public-safety/police', { m: 3, s: 1, r: 1, lm: '2025-12-01', fm: '2025-10-15', n: 'Introduced us to other DFR programs; candid about FAA waiver timelines.' }],
  // fire service and drones
  ['Blessing', 'Babatunde', 'Bellevue Fire Department', 'Fire Captain', 'public-safety/fire', { m: 11, s: 3, r: 4, lm: '2026-09-03', fm: '2025-05-10', n: 'Beta tester for our thermal payload; sends detailed bug reports after every call-out.' }],
  ['Cedric', 'Thibodeaux', 'Seattle Fire Department', 'Deputy Chief of Operations', 'public-safety/fire', { inv: 'outgoing', ia: '2026-06-01' }],
  ['Astrid', 'Toivonen', 'Eastside Fire & Rescue', 'UAS Program Coordinator', 'public-safety/fire', { m: 6, s: 2, r: 2, lm: '2026-07-07', fm: '2025-09-12', n: 'Wants drones on every engine company by 2027; budget decision sits with the fire chief.' }],
  ['Tamsin', 'Lowell', 'Washington State Department of Natural Resources', 'UAS Program Manager, Wildland Fire', 'public-safety/wildland', { m: 9, s: 3, r: 3, lm: '2026-08-20', fm: '2024-07-15', n: 'Flew thermal mapping with us on the Cedar Creek wildfire; runs their night operations drones.' }],
  ['Jalen', 'Redbird', 'CAL FIRE', 'Battalion Chief, Aviation Management', 'public-safety/wildland'],
  ['Rowan', 'Fitzgerald', 'Embercast', 'Founder', 'drones/startup', { m: 4, s: 2, r: 1, lm: '2026-05-05', fm: '2026-04-18', inv: 'incoming', ia: '2026-04-17', n: 'Met at the wildfire tech summit; building a wildfire detection camera network.' }],
  ['Adaeze', 'Okonkwo', 'NOAA National Weather Service', 'Incident Meteorologist', 'public-safety/federal', { n: 'Forecasts for wildfire incident teams; good contact for fire-season TFRs and smoke.' }],
  ['Elena', 'Sandoval', 'Global Aerospace', 'Aviation Underwriter, Unmanned Aircraft', 'background/aviation-insurance', { m: 5, s: 2, r: 2, lm: '2026-03-03', fm: '2024-12-01', n: 'Underwrites our drone fleet; asks about wildfire missions every renewal.' }],
  // agriculture and spraying
  ['Lars', 'Halvorsen', 'Yakima Valley Hops Co.', 'Grower', 'agriculture/crop-farms', { m: 13, s: 4, r: 5, lm: '2026-09-15', fm: '2024-03-03', n: 'Beta-tested the spray-drone mission planner on 400 acres of hops.' }],
  ['Priya', 'Chaudhry', 'Washington State Department of Agriculture', 'Pesticide Licensing Program Manager', 'agriculture/agencies', { n: 'Walked me through applicator licensing for spray drones in Washington and Oregon.' }],
  ['Bjorn', 'Rasmussen', 'Valley Air Crop Care', 'Owner & Chief Pilot', 'agriculture/aerial-application', { m: 7, s: 2, r: 3, lm: '2026-06-21', fm: '2023-05-18', n: 'Third-generation crop duster; knows every aerial application rule and the 137 certificate process.' }],
  ['Rhea', 'Malhotra', 'Hylio', 'Regulatory & Compliance Lead', 'agriculture/aerial-application'],
  ['Silas', 'Bergstrom', 'Prairie Sky Ag Drones', 'Founder & CEO', 'agriculture/aerial-application'],
  ['Thandiwe', 'Ndlovu', 'Washington State University Extension', 'Extension Specialist, Pesticide Safety', 'agriculture/extension'],
  ['Javier', 'Castellanos', 'Corteva Agriscience', 'Field Agronomist', 'agriculture/inputs', { n: 'Ran the side-by-side plots comparing drone and ground spraying.' }],
  ['Hana', 'Kimura', 'Papé Machinery', 'Precision Ag Specialist (John Deere dealer)', 'agriculture/deere-dealers'],
  ['Aurelio', 'Lombardi', 'John Deere', 'Product Manager, See & Spray', 'agriculture/equipment'],
  // film, TV, aerial cinematography
  ['Valentina', 'Rosales', 'Self-employed', 'Director of Photography', 'media/freelance', { m: 10, s: 3, r: 3, lm: '2026-08-08', fm: '2024-06-06', n: 'Wants to beta our cinematography gimbal mount on her next shoot.' }],
  ['Keanu', 'Kealoha', 'HoverFrame Media', 'Aerial Cinematographer', 'media/aerial-film', { m: 8, s: 2, r: 3, lm: '2026-07-30', fm: '2024-01-09', n: 'Shot the aerial sequences for a Netflix series on our drones.' }],
  ['Simone', 'Lucero', 'Netflix', 'Producer', 'media/film-tv'],
  ['Xavier', 'Delacroix', 'Netflix', 'Executive Producer, Unscripted', 'media/film-tv'],
  ['Karina', 'Velasquez', 'Netflix', 'Production Manager', 'media/film-tv'],
  ['Lucia', 'Pemberton', 'Netflix', 'Co-Producer, Documentary Series', 'media/film-tv'],
  ['Brendan', 'Mahoney', 'Freelance', 'Line Producer | Commercials & Features', 'media/freelance'],
  ['Selin', 'Sahin', 'Freelance', 'Drone Pilot | Aerial Photographer', 'media/freelance'],
  ['Orla', 'Gallagher', 'KING 5 News', 'Helicopter Pilot (Newscopter)', 'media/broadcast'],
  ['Micah', 'Zeller', 'Self-employed', 'Videographer & Editor', 'media/freelance'],
  ['Dashiell', 'Wiśniewski', 'Netflix', 'Senior Software Engineer', 'media/film-tv'],
  // EMS, dispatch and other cross-domain words
  ['Asha', 'Mwangi', 'Jabil', 'Program Manager, Electronics Manufacturing Services (EMS)', 'background/electronics-ems'],
  ['Hector', 'Barrientos', 'Sanmina', 'Director, EMS Operations', 'background/electronics-ems'],
  ['Noor', 'Iqbal', 'Harborview Medical Center', 'EMS Medical Director', 'background/healthcare'],
  ['Chidi', 'Nwachukwu', 'Airlift Northwest', 'Flight Paramedic', 'aviation/air-medical', { n: 'Asked whether drones could deliver AEDs ahead of the helicopter.' }],
  ['Sunita', 'Anand', 'King County Medic One', 'Paramedic', 'public-safety/ems'],
  ['Eamon', 'Donnelly', 'Microsoft', 'Data Protection Officer (DPO)', 'background/tech'],
  ['Lydia', 'Hendricks', 'DP World', 'Terminal Manager', 'maritime/ports'],
  ['Ari', 'Shapiro', 'Zillow', 'Director of Product', 'background/tech'],
  ['Kiara', 'Lachance', 'Boeing', 'Financial Controller', 'aerospace/primes'],
  ['Omar', 'Haruna', 'Alaska Airlines', 'Senior Financial Controller', 'aviation/airline'],
  ['Devin', 'Calloway', 'Les Schwab Tire Centers', 'Auto Mechanic', 'background/retail'],
  ['Mateo', 'Paredes', 'Papé Machinery', 'Diesel Mechanic', 'agriculture/deere-dealers'],
  ['Laila', 'Abara', 'Crowley', 'Marine Dispatcher', 'maritime/shipping'],
  ['Santiago', 'Quintero', 'Seattle Mariners', 'Team Captain Liaison, Community Relations', 'sports/teams'],
  ['Freya', 'Nilsson', 'Riot Games', 'QA Tester (Beta Programs)', 'media/games'],
  ['Juniper', 'Whitlock', 'BETA Technologies', 'Flight Test Engineer', 'drones/evtol'],
  ['Magnus', 'Karlsson', 'BETA Technologies', 'Chief Test Pilot', 'drones/evtol'],
  ['Alana', 'Tsosie', 'Navajo Nation Department of Agriculture', 'Range Conservationist', 'agriculture/agencies'],
  ['Zola', 'Mwangi', 'U.S. Geological Survey', 'Research Geologist', 'resources/government'],
  ['Kai', 'Nakagawa', 'Rio Tinto', 'Drone Survey Lead', 'resources/mining', { n: 'Beta user of our LiDAR survey workflow at the Kennecott pit.' }],
  ['Bilal', 'Chaudhry', 'Wing', 'Head of Flight Operations', 'drones/companies', { m: 6, s: 2, r: 2, lm: '2026-04-04', fm: '2025-03-03' }],
  ['Greta', 'Lindahl', 'Joby Aviation', 'Experimental Test Pilot', 'drones/evtol'],
  ['Vikram', 'Malhotra', 'SpaceX', 'Starlink Field Engineer', 'aerospace/space'],
  ['Teodora', 'Dimitrov', 'SpaceX', 'Talent Acquisition Partner', 'aerospace/space'],
  ['Ebony', 'Granger', 'Starlink', 'Satellite Operations Engineer', 'aerospace/space'],
  ['Nasser', 'Rahimi', 'Banfield Pet Hospital', 'Veterinarian', 'veterinary/small-animal', { n: 'Neighbor; vet for our dog.' }],
  ['Rosalind', 'Corrigan', 'Seattle Sounders FC', 'Assistant Coach', 'sports/teams', { n: 'Coached my kid\'s youth team.' }],
  ['Pablo', 'Figueroa', 'Washington State Department of Transportation', 'Aviation Planner, WSDOT Aviation Division', 'background/government'],
  ['Hadley', 'Schuyler', 'Raisbeck Aviation High School', 'Aviation Instructor (CTE)', 'background/k12', { n: 'Runs the drone club; asked for a guest talk on Part 107 careers.' }],
  ['Gustavo', 'Serrano', 'Team Rubicon', 'Search and Rescue Drone Team Lead', 'public-safety/emergency-mgmt', { n: 'Old squadron mate from Creech AFB; now leads volunteer SAR drone teams.' }],
  ['Elijah', 'Tanaka', 'U.S. Air Force', 'MQ-9 Instructor Pilot', 'military/air-force', { m: 19, s: 6, r: 6, lm: '2026-06-30', fm: '2016-05-01', e: 4, n: 'Old squadron mate from Creech AFB.' }],
  ['Anika', 'Solberg', 'Embry-Riddle Aeronautical University', 'Assistant Professor, Unmanned Systems', 'aviation/university', { n: 'Roommate at Embry-Riddle; runs their UAS research lab.' }],
  ['Kalani', 'Vang', 'AUVSI', 'Director of Advocacy', 'drones/association', { n: 'Met at XPONENTIAL 2025; tracks every FAA drone rulemaking.' }],
  ['Reza', 'Sekibo', 'DroneDeploy', 'Solutions Engineer', 'drones/companies', { n: 'Was in the first beta cohort for our mapping pipeline; strong on photogrammetry.' }],
  ['Tariq', 'Soto', 'KPFF Consulting Engineers', 'Survey Party Chief', 'background/construction'],
  ['Deepa', 'Ramanathan', 'Skydio', 'Account Executive, Public Safety', 'drones/companies'],
  ['Milan', 'Jovanovic', 'Skydio', 'Customer Success Manager, Fire & Rescue', 'drones/companies', { n: 'Knows which fire departments are piloting drone programs this year.' }],
  ['Nia', 'Obi', 'International Association of Fire Chiefs', 'Program Manager, Technology', 'public-safety/association', { n: 'Can introduce us to fire chiefs evaluating drone programs.' }],
];

// messy rows: blank fields, generic employers, odd titles
const MESSY = [
  ['Abdi', 'Haruna', '', '', 'unknown'],
  ['Anton', 'Zielinski', '', '', 'unknown'],
  ['Bethany', 'Corrigan', '', '', 'unknown'],
  ['Caleb', 'Yazzie', '', 'Pilot', 'unknown'],
  ['Dalia', 'Fonseca', '', 'Firefighter', 'unknown'],
  ['Eduardo', 'Varga', '', 'Agronomist', 'unknown'],
  ['Gabriela', 'Holmberg', 'Delta Air Lines', '', 'aviation/airline'],
  ['Hamza', 'Endo', 'Boeing', '', 'aerospace/primes'],
  ['Ivy', 'Rocha', 'Netflix', '', 'media/film-tv'],
  ['Jin', 'Stavros', 'CAL FIRE', '', 'public-safety/wildland'],
  ['Keiko', 'Mendoza', 'Federal Aviation Administration', '', 'aviation/faa'],
  ['Luka', 'Arceneaux', 'John Deere', '', 'agriculture/equipment'],
  ['Mei', 'Santangelo', 'Self-employed', 'Consultant', 'unknown'],
  ['Nadia', 'Kowalczyk', 'Self-employed', 'Photographer', 'media/freelance'],
  ['Orla', 'Matsuda', 'Freelance', 'Videographer', 'media/freelance'],
  ['Rafael', 'Ellison', 'Retired', 'Retired Airline Captain', 'aviation/retired'],
  ['Samir', 'Ishikawa', 'Retired', 'Retired Fire Chief', 'public-safety/retired'],
  ['Tobias', 'Achterberg', 'Open to Work', 'Seeking opportunities in aviation operations', 'unknown'],
  ['Valentina', 'Kapoor', 'Embry-Riddle Aeronautical University', 'Student', 'aviation/university'],
  ['Wren', 'Ciobanu', 'Purdue University', 'Student, Aeronautical Engineering Technology', 'background/higher-ed'],
  ['Yusuf', 'Gebre', 'Stealth Startup', 'Founder', 'unknown'],
  ['Zane', 'Velasquez', 'Stealth', 'Building something new', 'unknown'],
  ['Aiko', 'Watanabe', 'Self-employed', 'Owner', 'unknown'],
  ['Bao', 'Pham', 'Pham Family Farm', 'Owner', 'agriculture/crop-farms'],
  ['Camila', 'Duarte', 'Freelance', 'Drone Services', 'drones/freelance'],
  ['Darius', 'Ekwueme', '--', 'Pilot', 'unknown'],
  ['Elodie', 'Strand', 'n/a', 'n/a', 'unknown'],
  ['Felipe', 'Granger', 'Delta Air Lines', '✈️ Captain | A350 | Former USAF', 'aviation/airline'],
  ['Greta', 'Haruna', 'Riot Games', 'Producer 🎮', 'media/games'],
  ['Hiroshi', 'Lombardi', 'SR. AGRONOMIST', 'Nutrien Ag Solutions', 'agriculture/inputs'], // swapped columns, as in real messy exports
  ['Ingrid', 'Thibodeaux', 'Lockheed Martin', 'sr aerospace eng.', 'aerospace/primes'],
  ['Jonah', 'Zamora', 'Seattle Fire Department', 'FF/PM', 'public-safety/fire'],
  ['Laila', 'Kimura', 'U.S. Air Force', 'Capt, USAF | C-17 Aircraft Commander', 'military/air-force'],
  ['Marcus', 'Toivonen', 'Freelance', 'Gaffer / Grip', 'media/freelance'],
  ['Nikolai', 'Salonga', 'Volunteer', 'Search & Rescue Volunteer', 'public-safety/volunteer'],
  ['Pablo', 'Dalgaard', 'Self-employed', 'Farrier', 'agriculture/livestock'],
  ['Saanvi', 'Iqbal', 'Self-employed', 'Real Estate Photographer & Part 107 Pilot', 'drones/freelance'],
  ['Tariq', 'Fenwick', 'Retired', 'Retired, U.S. Navy', 'military/navy-marines'],
];

// ---------------------------------------------------------------- build
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');
const slug = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/ś/g, 's').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dayMs = 86_400_000;
const isoToMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const msToIso = (ms) => new Date(ms).toISOString().slice(0, 10);
const START = isoToMs('2012-01-01');
const END = isoToMs(TODAY) - dayMs;
const randomIso = (from = START, to = END) => msToIso(from + Math.floor(rnd() * ((to - from) / dayMs + 1)) * dayMs);

const LEADERSHIP = /\b(Chief|CEO|President|Founder|Director of|Head of|VP|Vice President|Superintendent|General Manager|Commissioner|Executive Director|Fire Marshal|Harbor Master|Medical Director)\b/;
const people = []; // { f, l, company, position, sector, extra }

for (const [f, l, company, position, sector, extra] of FIXED) {
  if (usedNames.has(`${f} ${l}`)) throw new Error(`duplicate fixed name ${f} ${l}`);
  usedNames.add(`${f} ${l}`);
  people.push({ f, l, company, position, sector, extra: extra ?? null });
}
for (const [f, l, company, position, sector] of MESSY) {
  if (usedNames.has(`${f} ${l}`)) throw new Error(`duplicate messy name ${f} ${l}`);
  usedNames.add(`${f} ${l}`);
  // the one swapped-columns row stores the title in Company and the company in Position, on purpose
  people.push({ f, l, company, position, sector, extra: null });
}
const usedPairs = new Set(people.map((p) => `${p.company}|${p.position}`));
for (const g of G) {
  const titles = shuffle(g.ti);
  for (let i = 0; i < g.n; i++) {
    const position = titles[i % titles.length];
    let company = pick(g.co);
    if (LEADERSHIP.test(position)) {
      for (let k = 0; k < 20 && usedPairs.has(`${company}|${position}`); k++) company = pick(g.co);
    }
    usedPairs.add(`${company}|${position}`);
    const [f, l] = freshName();
    people.push({ f, l, company, position, sector: g.sector, extra: null });
  }
}

// relationship enrichment for some generated rows (fixed rows carry their own)
for (const p of people) {
  if (p.extra) continue;
  const u = rnd();
  if (u < 0.1) {
    const m = pick([1, 1, 2, 2, 3, 4, 5, 7, 9, 12, 18, 25]);
    const s = Math.min(m, int(0, 4));
    const r = Math.min(m - s, int(0, 4));
    p.extra = { m, s, r, auto: true };
    if (rnd() < 0.25) p.extra.e = int(1, 8);
  } else if (u < 0.14) {
    p.extra = { inv: rnd() < 0.5 ? 'incoming' : 'outgoing', auto: true };
  }
}

const rowsUnsorted = people.map((p) => {
  const full = `${p.f} ${p.l}`;
  const x = p.extra;
  let connected = randomIso();
  if (x?.fm && x.fm < connected) connected = x.fm;
  if (x?.ia) connected = msToIso(isoToMs(x.ia) + dayMs);
  if (connected > TODAY) connected = TODAY;
  if (x?.auto && x.m != null) {
    x.fm = randomIso(isoToMs(connected), END);
    x.lm = randomIso(isoToMs(x.fm), END);
  }
  if (x?.auto && x.inv) {
    x.ia = msToIso(isoToMs(connected) - dayMs * int(1, 5));
  }
  return { p, full, connected };
});
rowsUnsorted.sort((a, b) => (a.connected < b.connected ? 1 : a.connected > b.connected ? -1 : a.full < b.full ? -1 : a.full > b.full ? 1 : 0));

const usedSlugs = new Set();
const sectors = {};
const rows = rowsUnsorted.map(({ p, full, connected }, i) => {
  const id = `v${String(i + 1).padStart(4, '0')}`;
  let u = slug(full);
  if (usedSlugs.has(u) || rnd() < 0.6) u = `${u}-${Math.floor(rnd() * 0xfffffff).toString(16)}`;
  usedSlugs.add(u);
  const [Y, M, D] = connected.split('-');
  const row = {
    _id: id, 'First Name': p.f, 'Last Name': p.l, 'Full Name': full, Company: p.company, Position: p.position,
    URL: `https://www.linkedin.com/in/${u}${rnd() < 0.4 ? '/' : ''}`, 'Connected On': `${D} ${MON[+M - 1]} ${Y}`,
  };
  const x = p.extra;
  if (x) {
    if (x.m != null) {
      row['Messages'] = x.m; row['Messages Sent'] = x.s; row['Messages Received'] = x.r;
      row['Last Messaged'] = x.lm; row['First Messaged'] = x.fm;
    }
    if (x.inv) { row['Invitation'] = x.inv; row['Invited At'] = x.ia; }
    if (x.n) row['Note'] = x.n;
    if (x.e) row['Endorsements'] = x.e;
    if (x.rec) row['Recommended You'] = true;
    row['Connected On (ISO)'] = connected;
  }
  sectors[id] = p.sector;
  return row;
});

// ---------------------------------------------------------------- owner context
const ctx = {
  name: 'Avery Lindqvist-Okafor',
  headline: 'Director of Flight Operations at Skyfield Aerial | Drones for public safety, agriculture & film | ex-Delta, ex-USAF',
  industry: 'Aviation and Aerospace Component Manufacturing',
  positions: [
    { company: 'Skyfield Aerial', title: 'Director of Flight Operations', current: true },
    { company: 'Delta Air Lines', title: 'First Officer, A320', current: false },
    { company: 'U.S. Air Force', title: 'MQ-9 Pilot, Captain', current: false },
  ],
  schools: ['Embry-Riddle Aeronautical University', 'Purdue University'],
  skills: ['UAS Operations', 'Part 107', 'FAA Regulations', 'Flight Safety', 'Crew Resource Management', 'BVLOS Operations',
    'Safety Management Systems', 'Aerial Cinematography', 'Precision Agriculture', 'Public Safety Technology', 'Program Management', 'Pilot Training'],
  followedCompanies: ['Zipline', 'Skydio', 'Joby Aviation', 'Wing', 'Federal Aviation Administration', 'AUVSI'],
  appliedCompanies: ['Skydio', 'Zipline'],
  appliedTitles: ['VP of Flight Operations'],
  dreamCompanies: ['Zipline', 'Joby Aviation', 'Wing'],
  desiredTitles: ['VP of Flight Operations', 'Head of Flight Operations', 'Chief Operating Officer'],
  source: { fileName: 'Basic_LinkedInDataExport_10-01-2026.zip', importedAt: '2026-10-01T16:00:00.000Z' },
};
const vctx = toNetworkContext(ctx);
if (!vctx) throw new Error('context invalid');

// ---------------------------------------------------------------- queries (written from the network description)
const Q = [
  ['air traffic controller', 'role-exact', 'Air traffic controllers (FAA, contract towers, military ATC), any level; ATC supervisors and managers are adjacent. Financial controllers, airline dispatchers and air traffic assistants are not controllers.'],
  ['agronomist', 'role-exact', 'Agronomists (field, senior, research, agronomy managers); crop consultants and certified crop advisers are closely related; soil scientists and precision-ag specialists are marginal.'],
  ['chief pilot', 'role-exact', 'Chief pilots and assistant chief pilots (airline bases, charter, air medical, drone and eVTOL operators). Other pilots are marginal; other "chief" titles (fire chief, chief engineer, chief flight instructor) are not chief pilots.'],
  ['a&p mechanic', 'abbreviation', 'FAA airframe and powerplant (A&P) mechanics and aircraft maintenance technicians; avionics technicians and aircraft inspectors are closely related. Auto and diesel mechanics are not A&P mechanics.'],
  ['dp', 'abbreviation', 'DP = director of photography (cinematographers, aerial DPs). Not data protection officers, not DP World, not a Director of Product.'],
  ['ems', 'abbreviation', 'EMS = emergency medical services: paramedics, EMTs, flight paramedics and nurses, EMS chiefs, coordinators and medical directors. Electronics manufacturing services (EMS) roles are not relevant.'],
  ['uas', 'abbreviation', 'People who work with unmanned aircraft systems: drone pilots and operators, UAS program managers and coordinators, drone-company staff in flight, regulatory and UAS engineering roles; other staff at drone companies are marginal.'],
  ['cfi', 'abbreviation', 'Certified flight instructors (CFI, CFII, MEI, chief and assistant chief flight instructors); simulator and ground instructors are closely related.'],
  ['vfx', 'abbreviation', 'Visual effects people: VFX artists and supervisors, compositors, FX TDs, VFX producers, CG supervisors; other animation and post-production roles are marginal.'],
  ['senior aerospace engineer', 'seniority', 'Senior, lead and principal aerospace engineers (any spelling, e.g. "Sr."); aerospace engineers at other levels and engineering managers in aerospace are adjacent; senior engineers in other fields are marginal.'],
  ['fire department leadership', 'seniority', 'Fire service leaders: fire chiefs, deputy, assistant, division and battalion chiefs, fire marshals; fire captains and lieutenants are adjacent.'],
  ['pilot at alaska airlines', 'role+company', 'Pilots (captains, first officers, chief pilots, check pilots) at Alaska Airlines or Alaska Air Group; pilots at Horizon Air or other airlines and non-pilot Alaska Airlines staff are partial. Unrelated employers with "Alaska" in the name are not Alaska Airlines.'],
  ['producer netflix', 'role+company', 'Producers at Netflix (producer, executive producer, line producer); producers elsewhere and other Netflix production staff are partial.'],
  ['engineer at spacex', 'role+company', 'Engineers at SpaceX (including Starlink, which is part of SpaceX); engineers at other space companies and non-engineers at SpaceX are partial.'],
  ['john deere', 'company-only', 'Anyone at John Deere / Deere & Company; John Deere dealership staff are closely related.'],
  ['people at the faa', 'company-only', 'Anyone at the Federal Aviation Administration (any spelling); people described as former FAA are partial.'],
  ['who could help me get a part 107 waiver approved', 'natural-language', 'People who can help with FAA Part 107 waivers or authorizations: FAA UAS integration and flight standards staff, drone regulatory affairs people and consultants, aviation and drone lawyers, people the owner noted as having handled waivers or COAs; drone program managers are partial.'],
  ['someone who shoots aerial footage for films', 'natural-language', 'Aerial cinematographers, drone camera operators, aerial DPs, helicopter camera pilots and aerial film companies; directors of photography and camera operators without an aerial signal are partial.'],
  ['who can introduce me to fire departments that want drones', 'natural-language', 'People inside fire departments, especially those running or championing drone programs (UAS coordinators, chiefs), plus people who work with fire departments on drones (public-safety drone sales and customer success, fire-chief associations); other fire service staff are partial.'],
  ['someone who knows crop spraying rules', 'natural-language', 'People who know the rules for crop spraying: aerial applicators and ag pilots, spray-drone operators and compliance staff, pesticide licensing and compliance staff, pesticide safety educators; agronomists and applicators are partial.'],
  ['someone who can help me hire pilots', 'natural-language', 'Pilot recruiters, aviation recruiters and pilot-hiring talent acquisition staff; chief pilots are closely related; general recruiters are marginal.'],
  ['dispatchers', 'cross-domain', 'Dispatchers of any kind: aircraft and flight dispatchers, 911 and public safety dispatchers and telecommunicators, EMS, fire, police, marine and truck dispatchers; dispatch supervisors and managers are closely related.'],
  ['airline captains', 'cross-domain', 'Captains who fly for airlines or cargo airlines (pilots in command); captains at charter operators are closely related. Fire, police, ship and military-rank captains are not airline captains.'],
  ['film producers', 'cross-domain', 'Film and TV producers (producer, executive, line, associate, co- and VFX producers); news, game, music and advertising producers are partial. Insurance producers and farm producers are not.'],
  ['veterinarians', 'stem-plural', 'Veterinarians (DVM, small and large animal, equine, emergency, industry technical-services vets); veterinary technicians and assistants are marginal.'],
  ['geologists', 'stem-plural', 'Geologists (exploration, senior, research); geophysicists and geotechnical engineers are closely related; other mining and oil and gas engineers are marginal.'],
  ['cinematographer', 'typo', 'Cinematographers and directors of photography (query misspelled), including aerial cinematographers; camera operators are closely related.'],
  ['paramedc', 'typo', 'Paramedics (query misspelled), including firefighter/paramedics, flight and critical care paramedics; EMTs are closely related.'],
  ['aerospase engineer', 'typo', 'Aerospace engineers (query misspelled), any level, including closely titled aerospace roles; other engineers at aerospace companies are adjacent.'],
  ['precision agriculture', 'domain', 'People working in precision agriculture: precision ag specialists and managers, ag-tech and spray-drone companies, precision ag product people at equipment makers; other agriculture roles are partial.'],
  ['space industry', 'domain', 'People at space companies and agencies (SpaceX and Starlink, Blue Origin, NASA and JPL, Rocket Lab, ULA, Relativity, Planet, Firefly).'],
  ['public safety', 'domain', 'People in public safety: police and sheriff, fire service, EMS, 911 dispatch, emergency management, search and rescue, federal law enforcement; public-safety drone sales and programs are related.'],
  ['beta tester', 'note', 'People who beta-tested (or offered to beta-test) the owner\'s products, known from the owner\'s notes; professional QA and test roles are marginal; working at BETA Technologies does not make someone a beta tester.'],
  ['wildfire', 'note', 'People who work on wildfire: wildland firefighters and fire agencies, aerial firefighting, wildfire mitigation and detection, and people whose notes link them to wildfire work.'],
  ['flight test engineer', 'strict', 'Flight test engineers (incl. senior, flight test instrumentation engineers); test pilots are adjacent; other test or field test engineers are marginal. Strict title-only.', true],
];
const queries = Q.map(([text, category, intent, strict], i) => {
  const q = { id: `v${pad2(i + 1)}`, text, category, split: 'holdout' };
  if (strict) q.strict = true;
  q.intent = intent;
  return q;
});

// ---------------------------------------------------------------- write
fs.mkdirSync(path.join(OUT, 'labeling'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'connections.json'), JSON.stringify(rows, null, 1) + '\n');
fs.writeFileSync(path.join(OUT, 'context.json'), JSON.stringify(vctx, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'queries.json'), JSON.stringify(queries, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'labeling', 'sectors.json'), JSON.stringify(sectors, null, 1) + '\n');

const enriched = rows.filter((r) => 'Connected On (ISO)' in r).length;
const notes = rows.filter((r) => r.Note).length;
const blanks = rows.filter((r) => !r.Position || !r.Company).length;
const bySector = {};
for (const s of Object.values(sectors)) { const top = s.split('/')[0]; bySector[top] = (bySector[top] ?? 0) + 1; }
console.log(JSON.stringify({ rows: rows.length, enriched, notes, blanks, queries: queries.length, bySector }));
