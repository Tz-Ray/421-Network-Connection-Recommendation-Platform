# Holdout 5 adjudication notes

Sources read: `LABELER_PROMPT.md`, `pools/v01.md`..`v35.md`, `ADJUDICATION_WORKSHEET.md`, `decisions.template.json`.
Final grades are in `decisions.json` (544 keys: 29 large-gap rows + 515 "0 vs 1" rows; every value an integer 0-3).
Each grade comes from the query's intent and the candidate's title, company and note. Where a pool held agreed
(non-pending) rows with the same situation, the final grade was set to match them. Some of those agreed values are
visible in the worksheet's auto-merge list; the others are inferred because both labelers gave the same grade.

## Large-gap rows (|A-B| >= 2), 29

| Query | Row | Candidate | A/B | Final | Reason |
|---|---|---|---|---|---|
| v03 | v0536 | Head of Flight Operations @ Wing | 2/0 | 2 | Heads flight ops at a drone operator: the role chief pilots sit in or report to. A closely related role, though not the chief-pilot title. |
| v03 | v1367 | Head of Flight Operations @ Percepto | 2/0 | 2 | Same situation as v0536. |
| v03 | v1545 | Head of Flight Operations @ Skydio | 2/0 | 2 | Same situation as v0536. |
| v06 | v0028 | Pilot, Bell 407 @ Airlift Northwest | 2/0 | 2 | Air-medical (HEMS) pilot, so part of air-medical EMS but not a clinician. Matches the auto-merged 2s for Base Lead Pilot @ PHI and Chief Pilot @ Life Flight. |
| v06 | v0595 | Flight Paramedic @ Life Flight Network | 3/0 | 3 | Flight paramedics are named in the intent. B's 0 looks like an omission. |
| v07 | v0865 | Aerial Cinematographer @ HoverFrame Media (note: shot aerial sequences on our drones) | 1/3 | 3 | The note shows they fly drones, so they are a drone operator. |
| v07 | v1040 | Drone Survey Lead @ Rio Tinto (note: beta user of LiDAR workflow) | 3/1 | 3 | Leads drone survey work, so a drone operator. Same title as the agreed Newmont and Kennecott rows. |
| v07 | v1080 | Flight Test Engineer @ Wisk Aero | 2/0 | 1 | Wisk builds autonomous (uncrewed) eVTOL aircraft: next to UAS work, but the title has no UAS signal and Wisk is not a drone company. The other eVTOL flight test engineers were agreed. |
| v08 | v0841 | Professor of Aeronautical Science @ Embry-Riddle Worldwide | 2/0 | 2 | Aeronautical Science is Embry-Riddle's pilot-training curriculum, so this is academic ground instruction (ground instructors are closely related). |
| v10 | v0732 | Aerospace Engineer @ Lockheed Martin | 0/2 | 2 | An aerospace engineer at another level is adjacent per the intent. |
| v11 | v1058 | ARFF Captain @ Denver International Airport | 0/2 | 2 | An airport fire department captain. Captains are adjacent. |
| v11 | v1067 | ARFF Captain @ Los Angeles World Airports | 0/2 | 2 | Same as v1058. |
| v13 | v0382 | Producer @ ROOT SPORTS | 2/0 | 2 | A TV producer at a different employer: producers elsewhere are partial, and the person does the asked-for job. |
| v14 | v0801 | Aerospace Engineer, UAS Traffic Management @ NASA | 2/0 | 2 | An engineer at another space organization (NASA) is partial. |
| v17 | v1922 | Regulatory Affairs Manager @ Joby Aviation | 2/0 | 2 | Aviation regulatory affairs with the FAA, but at an eVTOL company rather than a drone company. A closely related role. |
| v18 | v0250 | Media Production Lead @ Skyfield Aerial | 0/2 | 2 | Leads media production at a drone-services company, which gives an aerial signal. The role is production lead, not explicitly the person shooting. |
| v18 | v0257 | Helicopter Pilot (Newscopter) @ KING 5 News | 2/0 | 2 | A helicopter pilot who flies a camera platform, but for news, not film. |
| v19 | v0344 | Customer Success Manager, Public Safety @ DroneDeploy | 3/1 | 3 | Public-safety drone customer success is named in the intent. |
| v19 | v1483 | (no title) @ CAL FIRE | 0/2 | 2 | Blank title, so judged on the company: inside a fire agency, with no drone or leadership signal. Partial. |
| v20 | v0664 | Regulatory Specialist @ Skyfield Aerial (note: Part 107 waiver/COA paperwork) | 2/0 | 1 | Drone regulatory work, but the note covers Part 107 and COAs, not spray or Part 137 rules. Graded 1 like the other drone-regulatory people in this query (consultant v0490, Skyfield compliance manager v1049). |
| v23 | v2039 | Airline Pilot @ American Airlines | 2/0 | 2 | An airline pilot of unstated rank. Matches the auto-merged 2s for "Airline Pilot @ Alaska Airlines" (v0935, v1109). |
| v29 | v0732 | Aerospace Engineer @ Lockheed Martin | 0/3 | 3 | Exactly the asked-for title. A's 0 looks like an omission. |
| v29 | v0980 | Hardware Engineer @ Shield AI | 2/0 | 2 | Shield AI makes defense aircraft and drones, so this is another engineer at an aerospace company (adjacent). |
| v29 | v0987 | Propulsion Engineer @ United Launch Alliance | 0/2 | 2 | Propulsion engineers at aerospace companies were auto-merged at 2 (v1134, v1447). Same grade here. |
| v30 | v1586 | Grower @ Yakima Valley Hops Co. (note: beta-tested spray-drone mission planner on 400 acres) | 0/2 | 2 | A grower whose note shows hands-on spray-drone precision-ag use. Above the 1 given to other ag roles. |
| v30 | v0474 | Computer Vision Engineer @ Wing | 2/0 | 0 | Wing does drone delivery, not ag-tech or spray drones, and nothing in the row points to agriculture. (This was also an audit row, so it does not mean the pool rule missed someone.) |
| v32 | v1429 | MH-65 Pilot @ United States Coast Guard | 2/0 | 2 | The MH-65 is the Coast Guard's search-and-rescue helicopter, so this is related to public safety. Matches CAP Mission Pilot and USCG Marine Science Technician, both auto-merged at 2. |
| v34 | v1276 | Aircraft Maintenance Engineer @ Coulson Aviation | 2/0 | 2 | Support role at an aerial firefighting operator. |
| v34 | v1793 | Deputy Fire Chief @ Phoenix Fire Department | 0/2 | 2 | A fire-agency leader. The other deputy and assistant chiefs in this pool (LA County, Seattle, Phoenix) were agreed, so A's 0 looks like an omission. |

Large-gap finals: 3 = 5, 2 = 21, 1 = 2, 0 = 1.

## "0 vs 1" rows, 515: situation rules

Each row defaults to 1, meaning a related field, an employer-only match, or a role the intent names as marginal.
A row gets 0 only when it is plainly off-intent or the intent explicitly excludes it, and gets 2 where the intent's
wording requires it. Rules by query:

- **v01 air traffic controller** (1 row): an FAA Airspace Specialist works in airspace and ATC procedures and is not one of the excluded kinds → 1. Totals: 0s 0, 1s 1.
- **v02 agronomist** (3): soil conservationists (USDA, USDA APHIS) count as soil-science-type roles, which the intent calls marginal → 1. Agronomy Sales Representative @ CHS is agronomy-related → 1. Totals: 0s 0, 1s 3.
- **v03 chief pilot** (20):
  - Chief and Assistant Chief Flight Instructors → 0, because the intent says chief flight instructors are not chief pilots (v0700, v1252, v1487, v2040).
  - Student Pilot @ CAE → 0: a trainee, not a working pilot.
  - Flight Instructors and CFIs (8) → 1: they are pilots, and "other pilots are marginal". The airline Instructor Pilots in this pool were agreed.
  - Flight Operations Managers (Amazon Air, Kalitta, DroneDeploy, Wing), Manager of Flight Operations Training (Alaska, United) and Pilot Training Lead @ Supernal (7) → 1: flight-ops management, marginal.
  - Totals: 0s 5, 1s 15.
- **v04 a&p mechanic** (5):
  - Military crew chiefs (Crew Chief 15T @ Army and Army National Guard, Dedicated Crew Chief C-17 @ USAF, Crew Chief @ USAF) → 2. They are military aircraft maintainers (15T is the UH-60 repairer MOS) doing the job without FAA certification, so closely related, like avionics technicians. Raised above both labelers.
  - Tooling Coordinator @ HAECO (MRO support) → 1.
  - Totals: 0s 0, 1s 1, 2s 4.
- **v05 dp** (1): a self-employed photographer is in a related field → 1. Totals: 0s 0, 1s 1.
- **v06 ems** (52) → 1. This covers 911 and fire dispatchers and call receivers, hospital RNs and NPs, respiratory therapists, trauma surgeons, firefighters, fire captains and lieutenants, emergency managers (FEMA, state, county, Team Rubicon) and USCG rescue swimmers. These are neighboring public-safety and medical roles, none of them the excluded electronics-manufacturing EMS. Totals: 0s 0, 1s 52.
- **v07 uas** (5): Corteva agronomist (note on drone vs ground spraying), Skyline Aerial Cinema aerial coordinator, hops grower (spray-drone beta), Flock Safety hardware engineer and IAFC program manager (note on drone programs) → 1 each, as drone-adjacent. Totals: 0s 0, 1s 5.
- **v08 cfi** (17):
  - Student Pilot @ CAE → 0: receives instruction rather than giving it.
  - Flight-training management (CAE Director of Training, CAE and ATP Pilot Training Coordinators, L3Harris and ATP Training Center Managers, Alaska and United Flight Ops Training Managers, Supernal Pilot Training Lead) → 1.
  - Drone instructors and trainers (Part 107 Instructor @ DJI and DroneDeploy, Training Manager @ Cascade Drone Services and Wing, Training Lead @ Skyfield) → 1.
  - Academic UAS and aviation educators (Assistant Professors of Unmanned Systems at Purdue and Embry-Riddle, the high-school CTE aviation instructor) → 1.
  - Totals: 0s 1, 1s 16.
- **v09 vfx** (4): game-studio Art Directors (Valve, PopCap) and Graphics Engineers (Nintendo, Bungie) work in related CG and art fields → 1. Totals: 0s 0, 1s 4.
- **v10 senior aerospace engineer** (42):
  - Non-senior, non-"aerospace" engineers at aerospace companies (launch, liaison, systems, reliability, avionics, flight test, propulsion, airworthiness, mission, autonomy and test engineers) → 1.
  - Senior Software Engineer @ Netflix (audit row) → 1, because the intent says senior engineers in other fields are marginal.
  - Totals: 0s 0, 1s 42.
- **v11 fire department leadership** (38) → 1. This covers rank-and-file fire service (firefighters, FF/PM, FF/EMT, apparatus engineers, hazmat and technical rescue, PIOs, EMS coordinators at fire departments), ARFF firefighters, EMS Chiefs at EMS agencies, Coulson Fire Operations Managers and Skydio's fire-and-rescue CSM (note on fire departments). All are fire-service-adjacent, not leaders. Totals: 0s 0, 1s 38.
- **v12 pilot at alaska airlines** (67):
  - Non-airline pilots (military, helicopter, EMS, tanker, ag, test, drone/UAS/RPA pilots) → 1: a related field, below the "other airlines" partial.
  - Pilot / Fisheries Biologist @ Alaska Dept of Fish and Game → 1: the "Alaska" employer does not count, but they are a pilot like the others.
  - Non-pilot Horizon Air staff (AMT, Director of Safety) and Flight Dispatcher @ Alaska Airlines → 1: only the company matches.
  - Totals: 0s 0, 1s 67.
- **v13 producer netflix** (5): production staff elsewhere (UPM, location manager and scout, production coordinator) → 1. "(no title) @ Netflix" is a company-only match → 1. Totals: 0s 0, 1s 5.
- **v14 engineer at spacex** (12): non-engineers at other space companies (launch directors, recruiters, supply chain, production technicians, mission managers) → 1. Totals: 0s 0, 1s 12.
- **v15 john deere** (4): Washington Tractor staff → 2. Washington Tractor is a John Deere dealership, and the intent calls dealership staff closely related. This matches the 2s given to RDO and Papé dealer staff in the same pool (the auto-merged 2s). Raised above both labelers. Totals: 0s 0, 1s 0, 2s 4.
- **v17 part 107 waiver** (28) → 1:
  - FAA air traffic staff (controllers, ATCS, Seattle Center supervisors, Air Traffic Manager, Front Line Manager, Air Traffic Assistant, a no-title FAA employee): FAA, but not UAS integration or flight standards.
  - Drone pilots, trainers and instructors, Zipline's UAS chief pilot, drone survey leads, the UAS underwriter, UAS academics, the NASA UTM engineer and the IAFC program manager: drone- or airspace-adjacent.
  - Totals: 0s 0, 1s 28.
- **v18 aerial footage for films** (7): drone pilots without a film signal, military helicopter pilots, the CNN video editor and sports-team creative video producers → 1. Totals: 0s 0, 1s 7.
- **v19 fire departments that want drones** (44) → 1:
  - Drone-company staff not specific to public safety (pilots, operators, marketing, recruiters, data analyst, Skyfield sales and CS), drone regulatory people (FAA UAS staff, consultants, the drone lawyer, regulatory affairs managers), the wildfire incident meteorologist, the Team Rubicon SAR coordinator, firefighting helicopter and air-tanker pilots: related.
  - QA Specialist @ Phoenix Fire Regional Dispatch: fire-adjacent dispatch staff.
  - Totals: 0s 0, 1s 44.
- **v20 crop spraying rules** (8):
  - Regulatory Compliance Specialist @ Williams Companies → 0: natural-gas pipeline compliance is plainly off-intent.
  - Drone regulatory consultant and Skyfield Safety & Compliance Manager → 1: drone rules, no spray signal.
  - USDA soil and district conservationists, WSDA Program Specialist and CHS agronomy sales → 1: related ag or ag-regulatory work.
  - Totals: 0s 1, 1s 7.
- **v21 hire pilots** (1): Account Manager @ Aerotek (staffing agency) is close to a general recruiter → 1. Totals: 0s 0, 1s 1.
- **v22 dispatchers** (5): load planners (J.B. Hunt, Atlas Air), maintenance controllers (MX ops control) and the Cascade Ambulance Operations Manager → 1. Totals: 0s 0, 1s 5.
- **v23 airline captains** (10):
  - "B757/767 @ Delta Air Lines" (2 rows) → 2. The title plainly means a Delta 757/767 pilot of unstated rank, the same situation as the auto-merged "Airline Pilot @ Alaska" 2s and v2039 above. Raised above both labelers.
  - Non-airline captains and chief pilots (C-130 air-tanker captains, air-medical, drone, crop-dusting and air-tanker chief pilots) and cargo-airline Flight Engineers → 1. The air-tanker captains are pilots in command, not the excluded fire-department rank.
  - Totals: 0s 0, 1s 8, 2s 2.
- **v24 film producers** (6): location managers and scouts, post-production supervisors and a record-label production manager → 1. Totals: 0s 0, 1s 6.
- **v26 geologists** (5): mine manager and superintendent, process and drilling engineers (other mining and oil-and-gas engineers are marginal) and a Rio Tinto remote sensing specialist → 1. Totals: 0s 0, 1s 5.
- **v27 cinematographer** (2): self-employed photographers (one a Part 107 pilot) → 1. Totals: 0s 0, 1s 2.
- **v28 paramedc** (10): EMS clinical and ops managers, the EMS dispatcher, EMS coordinators, the AMR clinical educator and ER physicians → 1. Totals: 0s 0, 1s 10.
- **v29 aerospase engineer** (17): non-engineers at aerospace companies (launch directors, field service reps, research scientists, aerospace and defense consultants) and avionics technicians → 1. Totals: 0s 0, 1s 17.
- **v30 precision agriculture** (40) → 1. This covers ag roles with no precision signal: growers and farm owners, orchard and ops managers, plant breeders, seed and territory sales, ag-input marketing, Deere, CNH, Case IH and Kubota staff, ag-dealer service, parts and sales staff (RDO, Papé, Washington Tractor), WSDA plant health inspectors and USDA soil conservationists. The intent says "other agriculture roles are partial", and these sit in a related field. Totals: 0s 0, 1s 40.
- **v32 public safety** (2): drone lawyer whose note mentions public-safety contracts, and Port Security Manager → 1. Totals: 0s 0, 1s 2.
- **v33 beta tester** (40):
  - Professional test and QA roles (flight test and instrumentation engineers, test pilots, test engineers, field test engineer, QA manager, 911 QA specialist) → 1, which the intent calls marginal. This includes the flight test roles at BETA Technologies: working at BETA is not evidence, but their test role still gives 1.
  - Agronomist whose note describes running drone-vs-ground spray trial plots → 1: trial-like work.
  - Notes that show only operational use of the owner's product, with no beta or test signal (WA DNR thermal-mapping partner v0629, HoverFrame cinematographer v0865) → 0.
  - Totals: 0s 2, 1s 38.
- **v34 wildfire** (14) → 0, all plainly off-intent: UC ANR extension entomologists and educator, the flight paramedic (AED note), sheriff and police DFR drone leads, AUVSI advocacy, waiver consultant, Skyfield regulatory specialist, drone lawyer, aerial cinematographer, mine drone survey lead, hops grower and DroneDeploy solutions engineer. None of their titles, companies or notes ties to wildfire work. Totals: 0s 14, 1s 0.

"0 vs 1" finals: 1 = 482, 0 = 23, 2 = 10.
