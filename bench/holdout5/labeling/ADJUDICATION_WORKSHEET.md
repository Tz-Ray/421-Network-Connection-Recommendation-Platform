# Holdout 5 adjudication worksheet

Inputs: `labels_A.json` (A), `labels_B.json` (B), the pools in `pool_manifest.json`.
Fill in Final (0-3) and Reason for every pending row, copy the finals into a decisions file shaped like
`decisions.template.json`, then run `merge_labels.mjs A B --decisions <file> --write-qrels`.

## Agreement

- Pairs shown to labelers (every query x every candidate in its pool, absent = 0): 6144
- Exact agreement, all shown pairs: 5325 / 6144 = 86.7% (inflated by agreed zeros)
- Pairs graded > 0 by at least one labeler: 2910; exact: 2091 / 2910 = 71.9%; within one grade: 2881 / 2910 = 99.0%
- Within one grade, all shown pairs: 6115 / 6144 = 99.5%
- Quadratic-weighted Cohen's kappa, all shown pairs: 0.943

Confusion (rows = A, columns = B, grades 0-3):

| A \ B | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| 0 | 3234 | 80 | 8 | 1 |
| 1 | 435 | 561 | 63 | 1 |
| 2 | 16 | 142 | 614 | 44 |
| 3 | 1 | 2 | 26 | 916 |

## Pool check (audit rows)

Each query's pool included 15 random rows from outside its pool rule. Audit rows graded > 0 by either labeler: 6.
A hit means the rule may have missed relevant people for that query; consider widening the rule and re-labeling.

| Query | Row | Title @ Company | A | B |
|---|---|---|---|---|
| v08 "cfi" | v1864 | Line Check Airman @ Delta Air Lines | 2 | 1 |
| v10 "senior aerospace engineer" | v2011 | Senior Software Engineer @ Netflix | 1 | 0 |
| v14 "engineer at spacex" | v0137 | Flight Test Engineer @ Anduril Industries | 1 | 1 |
| v22 "dispatchers" | v0590 | Operations Manager @ Cascade Ambulance | 1 | 0 |
| v30 "precision agriculture" | v0474 | Computer Vision Engineer @ Wing | 2 | 0 |
| v32 "public safety" | v0448 | Clinical Base Manager @ Airlift Northwest | 2 | 2 |

## Auto-merged

- Agreed pairs kept as is: 2091
- |A-B| = 1 with both >= 1, rounded half up: 275
  v03/v1995 1/2->2; v04/v0174 2/1->2; v04/v1161 2/1->2; v04/v1866 2/1->2; v05/v0255 1/2->2; v05/v0369 1/2->2; v05/v0541 1/2->2; v05/v1198 1/2->2; v05/v1205 1/2->2; v05/v2044 1/2->2; v06/v0310 3/2->3; v06/v0448 3/2->3; v06/v0775 2/1->2; v06/v1148 3/2->3; v06/v1254 2/1->2; v06/v1275 3/2->3; v06/v1284 3/2->3; v06/v1331 3/2->3; v06/v1523 2/1->2; v06/v1824 2/1->2; v07/v0021 3/2->3; v07/v0195 2/3->3; v07/v0390 2/3->3; v07/v0405 1/2->2; v07/v0490 2/3->3; v07/v0504 2/3->3; v07/v0505 2/3->3; v07/v0573 2/3->3; v07/v0624 2/3->3; v07/v0634 1/2->2; v07/v0778 2/3->3; v07/v0801 3/2->3; v07/v0803 1/2->2; v07/v0821 2/3->3; v07/v0852 2/1->2; v07/v0867 2/3->3; v07/v0933 1/2->2; v07/v0954 2/1->2; v07/v1049 2/3->3; v07/v1197 1/2->2; v07/v1280 2/1->2; v07/v1413 2/1->2; v07/v1490 1/2->2; v07/v1701 3/2->3; v07/v1776 2/3->3; v07/v1807 2/1->2; v07/v1835 1/2->2; v07/v1988 2/1->2; v07/v1990 1/2->2; v07/v2038 1/2->2; v08/v0403 2/1->2; v08/v0408 2/1->2; v08/v1453 2/1->2; v08/v1722 2/1->2; v08/v1738 2/1->2; v08/v1883 2/1->2; v08/v2003 2/1->2; v08/v1864 2/1->2; v10/v0043 2/1->2; v10/v0901 2/1->2; v10/v1033 2/1->2; v10/v1682 2/1->2; v12/v0093 1/2->2; v12/v0274 1/2->2; v12/v0329 1/2->2; v12/v0479 1/2->2; v12/v0667 1/2->2; v12/v0697 1/2->2; v12/v0878 1/2->2; v12/v0958 2/1->2; v12/v1068 1/2->2; v12/v1297 1/2->2; v12/v1314 1/2->2; v12/v1550 1/2->2; v13/v0031 2/1->2; v13/v0108 2/1->2; v13/v0110 2/1->2; v13/v0244 2/1->2; v13/v0453 2/1->2; v13/v0530 1/2->2; v13/v0567 2/1->2; v13/v1400 1/2->2; v13/v1431 2/1->2; v13/v1600 2/1->2; v13/v2018 2/1->2; v14/v0167 1/2->2; v14/v1778 1/2->2; v17/v0148 1/2->2; v17/v0157 1/2->2; v17/v0354 2/3->3; v17/v0536 2/1->2; v17/v0736 3/2->3; v17/v0752 2/3->3; v17/v1087 2/1->2; v17/v1367 2/1->2; v17/v1545 2/1->2; v17/v1612 1/2->2; v18/v0265 1/2->2; v18/v0505 2/1->2; v18/v0593 3/2->3; v18/v1192 1/2->2; v18/v1204 1/2->2; v19/v0102 1/2->2; v19/v0240 1/2->2; v19/v0243 1/2->2; v19/v0283 1/2->2; v19/v0522 1/2->2; v19/v0591 1/2->2; v19/v0629 2/3->3; v19/v0649 2/3->3; v19/v0715 1/2->2; v19/v0853 2/3->3; v19/v1193 2/3->3; v19/v1631 1/2->2; v19/v1743 1/2->2; v19/v1888 1/2->2; v19/v1957 1/2->2; v20/v0182 2/1->2; v20/v0223 3/2->3; v20/v1684 3/2->3; v21/v0155 2/1->2; v21/v0366 2/1->2; v21/v0917 2/1->2; v21/v1165 2/1->2; v22/v0085 2/1->2; v22/v0352 2/1->2; v22/v0363 2/1->2; v22/v0644 3/2->3; v22/v0988 2/1->2; v22/v1454 2/1->2; v22/v1911 3/2->3; v22/v1977 2/1->2; v23/v0697 2/3->3; v23/v0755 1/2->2; v23/v0935 2/1->2; v23/v1109 2/1->2; v25/v1012 2/3->3; v27/v0265 1/2->2; v27/v0586 2/1->2; v27/v1192 1/2->2; v27/v1204 1/2->2; v29/v0037 2/1->2; v29/v0049 2/1->2; v29/v0111 2/1->2; v29/v0169 2/1->2; v29/v0234 2/1->2; v29/v0251 2/1->2; v29/v0284 2/1->2; v29/v0302 2/1->2; v29/v0327 2/1->2; v29/v0387 2/1->2; v29/v0412 2/1->2; v29/v0515 2/1->2; v29/v0518 2/1->2; v29/v0520 2/1->2; v29/v0657 2/1->2; v29/v0663 2/1->2; v29/v0679 2/1->2; v29/v0761 2/1->2; v29/v0804 2/1->2; v29/v0918 2/1->2; v29/v0941 2/1->2; v29/v1009 2/1->2; v29/v1037 2/1->2; v29/v1064 2/1->2; v29/v1123 2/1->2; v29/v1134 2/1->2; v29/v1229 2/1->2; v29/v1241 2/1->2; v29/v1268 2/1->2; v29/v1318 2/1->2; v29/v1392 2/1->2; v29/v1395 2/1->2; v29/v1421 2/1->2; v29/v1424 2/1->2; v29/v1433 2/1->2; v29/v1447 2/1->2; v29/v1458 2/1->2; v29/v1535 2/1->2; v29/v1573 2/1->2; v29/v1603 2/1->2; v29/v1632 2/1->2; v29/v1685 2/1->2; v29/v1701 2/1->2; v29/v1740 2/1->2; v29/v1767 2/1->2; v29/v1773 2/1->2; v29/v1780 2/1->2; v29/v1783 2/1->2; v29/v1798 2/1->2; v29/v1841 2/1->2; v29/v1848 2/1->2; v29/v1869 2/1->2; v29/v1872 2/1->2; v29/v1892 2/1->2; v29/v1893 2/1->2; v29/v1909 2/1->2; v29/v1916 2/1->2; v29/v1958 2/1->2; v29/v1961 2/1->2; v29/v1966 2/1->2; v29/v1978 2/1->2; v29/v2002 2/1->2; v29/v2020 2/1->2; v29/v2027 2/1->2; v29/v2028 2/1->2; v29/v2048 2/1->2; v30/v0205 2/1->2; v30/v0223 2/1->2; v30/v0285 2/1->2; v30/v0405 2/1->2; v30/v0468 2/1->2; v30/v0576 2/1->2; v30/v0577 2/3->3; v30/v0634 2/1->2; v30/v0807 2/1->2; v30/v1083 2/1->2; v30/v1197 2/1->2; v30/v1260 3/2->3; v30/v1322 2/3->3; v30/v1438 2/3->3; v30/v1495 2/1->2; v30/v1569 2/1->2; v30/v1684 2/1->2; v30/v1687 2/1->2; v30/v1730 2/1->2; v32/v0036 1/2->2; v32/v0092 1/2->2; v32/v0094 1/2->2; v32/v0107 2/3->3; v32/v0168 1/2->2; v32/v0221 2/3->3; v32/v0261 2/3->3; v32/v0276 1/2->2; v32/v0286 2/3->3; v32/v0311 2/1->2; v32/v0346 2/3->3; v32/v0425 2/3->3; v32/v0497 2/3->3; v32/v0564 2/3->3; v32/v0594 3/2->3; v32/v0621 2/3->3; v32/v0646 2/3->3; v32/v0656 3/2->3; v32/v0723 2/3->3; v32/v0739 3/2->3; v32/v0794 1/2->2; v32/v0815 1/2->2; v32/v0856 3/2->3; v32/v0910 2/3->3; v32/v0928 3/2->3; v32/v0994 3/2->3; v32/v1023 1/2->2; v32/v1035 3/2->3; v32/v1048 1/2->2; v32/v1084 2/3->3; v32/v1128 2/1->2; v32/v1129 2/3->3; v32/v1138 2/3->3; v32/v1149 2/3->3; v32/v1282 3/2->3; v32/v1401 2/1->2; v32/v1523 2/1->2; v32/v1593 2/3->3; v32/v1606 2/3->3; v32/v1657 3/2->3; v32/v1690 3/2->3; v32/v1787 1/2->2; v32/v1824 2/1->2; v32/v1838 2/3->3; v32/v1843 2/3->3; v32/v1944 1/2->2; v34/v0294 2/3->3; v34/v0928 2/1->2; v34/v0994 2/1->2

| Query | Text | Shown | auto 3 | auto 2 | auto 1 | pending |
|---|---|---|---|---|---|---|
| v01 | air traffic controller | 135 | 13 | 6 | 4 | 1 |
| v02 | agronomist | 222 | 19 | 5 | 12 | 3 |
| v03 | chief pilot | 251 | 8 | 2 | 123 | 23 |
| v04 | a&p mechanic | 97 | 19 | 22 | 18 | 5 |
| v05 | dp | 152 | 10 | 6 | 11 | 1 |
| v06 | ems | 221 | 54 | 13 | 8 | 54 |
| v07 | uas | 221 | 106 | 31 | 26 | 8 |
| v08 | cfi | 97 | 19 | 11 | 1 | 18 |
| v09 | vfx | 164 | 16 | 6 | 19 | 4 |
| v10 | senior aerospace engineer | 289 | 9 | 24 | 42 | 43 |
| v11 | fire department leadership | 210 | 21 | 15 | 5 | 40 |
| v12 | pilot at alaska airlines | 258 | 8 | 58 | 17 | 67 |
| v13 | producer netflix | 143 | 3 | 34 | 17 | 6 |
| v14 | engineer at spacex | 81 | 13 | 31 | 7 | 13 |
| v15 | john deere | 67 | 19 | 8 | 0 | 4 |
| v16 | people at the faa | 82 | 34 | 2 | 2 | 0 |
| v17 | who could help me get a part 107 waiver approved | 254 | 18 | 38 | 11 | 29 |
| v18 | someone who shoots aerial footage for films | 213 | 7 | 18 | 16 | 9 |
| v19 | who can introduce me to fire departments that want drones | 276 | 32 | 65 | 20 | 46 |
| v20 | someone who knows crop spraying rules | 132 | 19 | 33 | 22 | 9 |
| v21 | someone who can help me hire pilots | 144 | 8 | 12 | 21 | 1 |
| v22 | dispatchers | 85 | 30 | 11 | 9 | 5 |
| v23 | airline captains | 305 | 21 | 9 | 27 | 11 |
| v24 | film producers | 260 | 20 | 21 | 9 | 6 |
| v25 | veterinarians | 49 | 14 | 1 | 3 | 0 |
| v26 | geologists | 105 | 6 | 3 | 11 | 5 |
| v27 | cinematographer | 183 | 10 | 10 | 9 | 2 |
| v28 | paramedc | 182 | 27 | 12 | 16 | 10 |
| v29 | aerospase engineer | 289 | 19 | 126 | 2 | 20 |
| v30 | precision agriculture | 229 | 23 | 52 | 41 | 42 |
| v31 | space industry | 88 | 61 | 0 | 0 | 0 |
| v32 | public safety | 354 | 241 | 52 | 15 | 3 |
| v33 | beta tester | 93 | 7 | 0 | 4 | 40 |
| v34 | wildfire | 157 | 35 | 68 | 9 | 16 |
| v35 | flight test engineer | 56 | 17 | 14 | 4 | 0 |

## Pending: |A-B| >= 2 (29)

| Query | Row | Title @ Company | A | B | Final | Reason |
|---|---|---|---|---|---|---|
| v03 "chief pilot" | v0536 | Head of Flight Operations @ Wing | 2 | 0 |  |  |
| v03 "chief pilot" | v1367 | Head of Flight Operations @ Percepto | 2 | 0 |  |  |
| v03 "chief pilot" | v1545 | Head of Flight Operations @ Skydio | 2 | 0 |  |  |
| v06 "ems" | v0028 | Pilot, Bell 407 @ Airlift Northwest | 2 | 0 |  |  |
| v06 "ems" | v0595 | Flight Paramedic @ Life Flight Network | 3 | 0 |  |  |
| v07 "uas" | v0865 | Aerial Cinematographer @ HoverFrame Media — note: Shot the aerial sequences for a Netflix series on our drones. | 1 | 3 |  |  |
| v07 "uas" | v1040 | Drone Survey Lead @ Rio Tinto — note: Beta user of our LiDAR survey workflow at the Kennecott pit. | 3 | 1 |  |  |
| v07 "uas" | v1080 | Flight Test Engineer @ Wisk Aero | 2 | 0 |  |  |
| v08 "cfi" | v0841 | Professor of Aeronautical Science @ Embry-Riddle Aeronautical University - Worldwide | 2 | 0 |  |  |
| v10 "senior aerospace engineer" | v0732 | Aerospace Engineer @ Lockheed Martin | 0 | 2 |  |  |
| v11 "fire department leadership" | v1058 | ARFF Captain @ Denver International Airport | 0 | 2 |  |  |
| v11 "fire department leadership" | v1067 | ARFF Captain @ Los Angeles World Airports | 0 | 2 |  |  |
| v13 "producer netflix" | v0382 | Producer @ ROOT SPORTS | 2 | 0 |  |  |
| v14 "engineer at spacex" | v0801 | Aerospace Engineer, UAS Traffic Management @ NASA | 2 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v1922 | Regulatory Affairs Manager @ Joby Aviation | 2 | 0 |  |  |
| v18 "someone who shoots aerial footage for films" | v0250 | Media Production Lead @ Skyfield Aerial | 0 | 2 |  |  |
| v18 "someone who shoots aerial footage for films" | v0257 | Helicopter Pilot (Newscopter) @ KING 5 News | 2 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0344 | Customer Success Manager, Public Safety @ DroneDeploy | 3 | 1 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v1483 | (no title) @ CAL FIRE | 0 | 2 |  |  |
| v20 "someone who knows crop spraying rules" | v0664 | Regulatory Specialist @ Skyfield Aerial — note: Owns our Part 107 waiver and COA paperwork; tracks every DroneZone application. | 2 | 0 |  |  |
| v23 "airline captains" | v2039 | Airline Pilot @ American Airlines | 2 | 0 |  |  |
| v29 "aerospase engineer" | v0732 | Aerospace Engineer @ Lockheed Martin | 0 | 3 |  |  |
| v29 "aerospase engineer" | v0980 | Hardware Engineer @ Shield AI | 2 | 0 |  |  |
| v29 "aerospase engineer" | v0987 | Propulsion Engineer @ United Launch Alliance | 0 | 2 |  |  |
| v30 "precision agriculture" | v1586 | Grower @ Yakima Valley Hops Co. — note: Beta-tested the spray-drone mission planner on 400 acres of hops. | 0 | 2 |  |  |
| v30 "precision agriculture" | v0474 | Computer Vision Engineer @ Wing | 2 | 0 |  |  |
| v32 "public safety" | v1429 | MH-65 Pilot @ United States Coast Guard | 2 | 0 |  |  |
| v34 "wildfire" | v1276 | Aircraft Maintenance Engineer @ Coulson Aviation | 2 | 0 |  |  |
| v34 "wildfire" | v1793 | Deputy Fire Chief @ Phoenix Fire Department | 0 | 2 |  |  |

## Pending: 0 vs 1 (515) — 1 unless plainly off-intent

| Query | Row | Title @ Company | A | B | Final | Reason |
|---|---|---|---|---|---|---|
| v01 "air traffic controller" | v1920 | Airspace Specialist @ Federal Aviation Administration | 1 | 0 |  |  |
| v02 "agronomist" | v0990 | Soil Conservationist @ USDA APHIS | 1 | 0 |  |  |
| v02 "agronomist" | v1168 | Agronomy Sales Representative @ CHS Inc. | 0 | 1 |  |  |
| v02 "agronomist" | v1728 | Soil Conservationist @ USDA | 1 | 0 |  |  |
| v03 "chief pilot" | v0306 | Flight Instructor @ Embry-Riddle Aeronautical University | 0 | 1 |  |  |
| v03 "chief pilot" | v0357 | Pilot Training Lead @ Supernal | 1 | 0 |  |  |
| v03 "chief pilot" | v0471 | Flight Operations Manager @ Amazon Air | 1 | 0 |  |  |
| v03 "chief pilot" | v0489 | Flight Operations Manager @ DroneDeploy | 1 | 0 |  |  |
| v03 "chief pilot" | v0583 | Flight Instructor @ CAE | 0 | 1 |  |  |
| v03 "chief pilot" | v0700 | Chief Flight Instructor @ Galvin Flying | 0 | 1 |  |  |
| v03 "chief pilot" | v0869 | Flight Instructor @ L3Harris Airline Academy | 0 | 1 |  |  |
| v03 "chief pilot" | v0958 | Manager, Flight Operations Training @ Alaska Airlines | 1 | 0 |  |  |
| v03 "chief pilot" | v1237 | Student Pilot @ CAE | 0 | 1 |  |  |
| v03 "chief pilot" | v1238 | Flight Operations Manager @ Kalitta Air | 1 | 0 |  |  |
| v03 "chief pilot" | v1252 | Assistant Chief Flight Instructor @ Rainier Flight Academy | 0 | 1 |  |  |
| v03 "chief pilot" | v1290 | Certified Flight Instructor @ ATP Flight School | 0 | 1 |  |  |
| v03 "chief pilot" | v1332 | Manager, Flight Operations Training @ United Airlines | 1 | 0 |  |  |
| v03 "chief pilot" | v1339 | Certified Flight Instructor @ ATP Flight School | 0 | 1 |  |  |
| v03 "chief pilot" | v1487 | Chief Flight Instructor @ Rainier Flight Academy — note: Offered to beta test our flight-log app with his flight school students. | 0 | 1 |  |  |
| v03 "chief pilot" | v1591 | Flight Instructor @ Embry-Riddle Aeronautical University | 0 | 1 |  |  |
| v03 "chief pilot" | v1821 | Flight Operations Manager @ Wing | 1 | 0 |  |  |
| v03 "chief pilot" | v1971 | Flight Instructor @ Galvin Flying | 0 | 1 |  |  |
| v03 "chief pilot" | v2029 | Certified Flight Instructor @ L3Harris Airline Academy | 0 | 1 |  |  |
| v03 "chief pilot" | v2040 | Assistant Chief Flight Instructor @ L3Harris Airline Academy | 0 | 1 |  |  |
| v04 "a&p mechanic" | v0078 | Crew Chief (15T) @ U.S. Army | 1 | 0 |  |  |
| v04 "a&p mechanic" | v0147 | Dedicated Crew Chief, C-17 @ USAF | 1 | 0 |  |  |
| v04 "a&p mechanic" | v0844 | Crew Chief (15T) @ Army National Guard | 1 | 0 |  |  |
| v04 "a&p mechanic" | v1142 | Tooling Coordinator @ HAECO Americas | 1 | 0 |  |  |
| v04 "a&p mechanic" | v1200 | Crew Chief @ U.S. Air Force | 1 | 0 |  |  |
| v05 "dp" | v0625 | Photographer @ Self-employed | 1 | 0 |  |  |
| v06 "ems" | v0024 | 911 Dispatcher @ Valley Communications Center | 1 | 0 |  |  |
| v06 "ems" | v0053 | Registered Nurse @ UW Medicine | 1 | 0 |  |  |
| v06 "ems" | v0184 | Emergency Manager @ Federal Emergency Management Agency | 1 | 0 |  |  |
| v06 "ems" | v0347 | Firefighter @ (no company) | 1 | 0 |  |  |
| v06 "ems" | v0348 | Emergency Management Coordinator @ Team Rubicon | 1 | 0 |  |  |
| v06 "ems" | v0365 | Firefighter @ Puget Sound Fire | 1 | 0 |  |  |
| v06 "ems" | v0386 | Lieutenant @ Los Angeles County Fire Department | 1 | 0 |  |  |
| v06 "ems" | v0452 | Fire Captain @ Bellevue Fire Department — note: Beta tester for our thermal payload; sends detailed bug reports after every call-out. | 1 | 0 |  |  |
| v06 "ems" | v0495 | Firefighter @ Eastside Fire & Rescue | 1 | 0 |  |  |
| v06 "ems" | v0539 | Emergency Management Specialist @ Washington Emergency Management Division | 1 | 0 |  |  |
| v06 "ems" | v0549 | RN, ICU @ Swedish Medical Center | 1 | 0 |  |  |
| v06 "ems" | v0551 | Captain @ Puget Sound Fire | 1 | 0 |  |  |
| v06 "ems" | v0644 | Call Receiver @ Valley Communications Center | 1 | 0 |  |  |
| v06 "ems" | v0662 | Trauma Surgeon @ Harborview Medical Center | 1 | 0 |  |  |
| v06 "ems" | v0721 | Emergency Communications Dispatcher @ SNO911 | 1 | 0 |  |  |
| v06 "ems" | v0723 | Communications Center Manager @ City of Austin 911 Call Center | 1 | 0 |  |  |
| v06 "ems" | v0731 | 911 Dispatcher @ City of Austin 911 Call Center | 1 | 0 |  |  |
| v06 "ems" | v0759 | Registered Nurse @ Providence | 1 | 0 |  |  |
| v06 "ems" | v0813 | Emergency Manager @ Washington Emergency Management Division | 1 | 0 |  |  |
| v06 "ems" | v0872 | Captain @ Puget Sound Fire | 1 | 0 |  |  |
| v06 "ems" | v0879 | Emergency Management Coordinator @ Pierce County Department of Emergency Management | 1 | 0 |  |  |
| v06 "ems" | v0909 | Emergency Management Coordinator @ FEMA | 1 | 0 |  |  |
| v06 "ems" | v0950 | Aviation Survival Technician (Rescue Swimmer) @ U.S. Coast Guard | 1 | 0 |  |  |
| v06 "ems" | v0960 | Fire Captain @ Seattle Fire Department | 1 | 0 |  |  |
| v06 "ems" | v1043 | Aviation Survival Technician (Rescue Swimmer) @ U.S. Coast Guard | 1 | 0 |  |  |
| v06 "ems" | v1084 | Communications Center Manager @ NORCOM 911 | 1 | 0 |  |  |
| v06 "ems" | v1166 | Emergency Management Coordinator @ FEMA | 1 | 0 |  |  |
| v06 "ems" | v1210 | Registered Nurse @ Seattle Children's | 1 | 0 |  |  |
| v06 "ems" | v1225 | 911 Dispatcher @ SNO911 | 1 | 0 |  |  |
| v06 "ems" | v1226 | Respiratory Therapist @ UW Medicine | 1 | 0 |  |  |
| v06 "ems" | v1228 | 911 Dispatcher @ NORCOM 911 | 1 | 0 |  |  |
| v06 "ems" | v1244 | Emergency Communications Dispatcher @ City of Austin 911 Call Center | 1 | 0 |  |  |
| v06 "ems" | v1274 | Fire Captain @ Spokane Valley Fire Department | 1 | 0 |  |  |
| v06 "ems" | v1279 | Firefighter @ Seattle Fire Department | 1 | 0 |  |  |
| v06 "ems" | v1374 | Fire Dispatcher @ NORCOM 911 | 1 | 0 |  |  |
| v06 "ems" | v1479 | Firefighter @ Los Angeles County Fire Department | 1 | 0 |  |  |
| v06 "ems" | v1617 | Lieutenant @ Seattle Fire Department | 1 | 0 |  |  |
| v06 "ems" | v1638 | Fire Captain @ Seattle Fire Department | 1 | 0 |  |  |
| v06 "ems" | v1709 | Registered Nurse @ Swedish Medical Center | 1 | 0 |  |  |
| v06 "ems" | v1804 | 911 Dispatcher @ NORCOM 911 | 1 | 0 |  |  |
| v06 "ems" | v1818 | Registered Nurse @ Swedish Medical Center | 1 | 0 |  |  |
| v06 "ems" | v1827 | Firefighter @ Bellevue Fire Department | 1 | 0 |  |  |
| v06 "ems" | v1871 | Fire Dispatcher @ Phoenix Fire Regional Dispatch Center | 1 | 0 |  |  |
| v06 "ems" | v1875 | Firefighter @ Austin Fire Department | 1 | 0 |  |  |
| v06 "ems" | v1898 | Public Safety Telecommunicator @ SNO911 | 1 | 0 |  |  |
| v06 "ems" | v1911 | Call Receiver @ NORCOM 911 | 1 | 0 |  |  |
| v06 "ems" | v1918 | Emergency Management Specialist @ Team Rubicon | 1 | 0 |  |  |
| v06 "ems" | v1924 | Firefighter @ Seattle Fire Department | 1 | 0 |  |  |
| v06 "ems" | v1970 | Emergency Communications Dispatcher @ City of Austin 911 Call Center | 1 | 0 |  |  |
| v06 "ems" | v1982 | Fire Captain @ Puget Sound Fire | 1 | 0 |  |  |
| v06 "ems" | v2016 | Emergency Communications Dispatcher @ Phoenix Fire Regional Dispatch Center | 1 | 0 |  |  |
| v06 "ems" | v2032 | Nurse Practitioner @ UW Medicine | 1 | 0 |  |  |
| v07 "uas" | v1010 | Field Agronomist @ Corteva Agriscience — note: Ran the side-by-side plots comparing drone and ground spraying. | 0 | 1 |  |  |
| v07 "uas" | v1278 | Aerial Coordinator @ Skyline Aerial Cinema | 1 | 0 |  |  |
| v07 "uas" | v1586 | Grower @ Yakima Valley Hops Co. — note: Beta-tested the spray-drone mission planner on 400 acres of hops. | 0 | 1 |  |  |
| v07 "uas" | v1621 | Hardware Engineer @ Flock Safety | 1 | 0 |  |  |
| v07 "uas" | v1890 | Program Manager, Technology @ International Association of Fire Chiefs — note: Can introduce us to fire chiefs evaluating drone programs. | 1 | 0 |  |  |
| v08 "cfi" | v0065 | Aviation Instructor (CTE) @ Raisbeck Aviation High School — note: Runs the drone club; asked for a guest talk on Part 107 careers. | 1 | 0 |  |  |
| v08 "cfi" | v0079 | Director of Training @ CAE | 1 | 0 |  |  |
| v08 "cfi" | v0195 | Part 107 Instructor @ DJI | 1 | 0 |  |  |
| v08 "cfi" | v0357 | Pilot Training Lead @ Supernal | 1 | 0 |  |  |
| v08 "cfi" | v0504 | Part 107 Instructor @ DroneDeploy | 1 | 0 |  |  |
| v08 "cfi" | v0565 | Pilot Training Coordinator @ CAE | 1 | 0 |  |  |
| v08 "cfi" | v0624 | Assistant Professor, Unmanned Systems @ Purdue University School of Aviation and Transportation Technology | 1 | 0 |  |  |
| v08 "cfi" | v0778 | Assistant Professor, Unmanned Systems @ Embry-Riddle Aeronautical University — note: Roommate at Embry-Riddle; runs their UAS research lab. | 1 | 0 |  |  |
| v08 "cfi" | v0788 | Training Manager @ Cascade Drone Services | 1 | 0 |  |  |
| v08 "cfi" | v0958 | Manager, Flight Operations Training @ Alaska Airlines | 1 | 0 |  |  |
| v08 "cfi" | v1093 | Pilot Training Coordinator @ ATP Flight School | 1 | 0 |  |  |
| v08 "cfi" | v1133 | Training Manager @ Wing | 1 | 0 |  |  |
| v08 "cfi" | v1237 | Student Pilot @ CAE | 0 | 1 |  |  |
| v08 "cfi" | v1286 | Training Center Manager @ L3Harris Airline Academy | 1 | 0 |  |  |
| v08 "cfi" | v1332 | Manager, Flight Operations Training @ United Airlines | 1 | 0 |  |  |
| v08 "cfi" | v1711 | Training Center Manager @ ATP Flight School | 1 | 0 |  |  |
| v08 "cfi" | v1948 | Training Lead @ Skyfield Aerial | 1 | 0 |  |  |
| v09 "vfx" | v0132 | Graphics Engineer @ Nintendo of America | 1 | 0 |  |  |
| v09 "vfx" | v1526 | Art Director @ Valve | 1 | 0 |  |  |
| v09 "vfx" | v1699 | Art Director @ PopCap Games | 1 | 0 |  |  |
| v09 "vfx" | v1942 | Graphics Engineer @ Bungie | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v0037 | Launch Engineer @ Rocket Lab | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v0111 | Liaison Engineer @ Pratt & Whitney | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v0234 | Airworthiness Engineer @ Supernal | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v0251 | Certification Engineer @ Joby Aviation | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v0302 | Test Engineer @ Blue Origin | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v0327 | Spacecraft Operations Engineer @ Blue Origin | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v0412 | Systems Engineer @ Northrop Grumman | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v0515 | Mission Operations Engineer @ Blue Origin | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v0518 | Reliability Engineer @ Gulfstream Aerospace | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v0679 | Systems Engineer @ Lockheed Martin | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v0804 | Systems Engineer III @ Honeywell Aerospace | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v0997 | Avionics Engineer @ The Boeing Company | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1009 | Launch Engineer @ Blue Origin | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1080 | Flight Test Engineer @ Wisk Aero | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1123 | Airworthiness Engineer @ BETA Technologies | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1134 | Electric Propulsion Engineer @ BETA Technologies | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1265 | Flight Test Engineer @ Supernal | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1318 | Build Reliability Engineer @ Rocket Lab | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1395 | Mission Engineer @ General Atomics Aeronautical Systems | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1424 | Systems Engineer III @ BAE Systems | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1433 | Systems Engineer @ Lockheed Martin | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1440 | Structures Repair Engineer @ StandardAero | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1447 | Electric Propulsion Engineer @ Supernal | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1535 | Reliability Engineer @ Boeing | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1551 | Avionics Engineer @ Blue Origin | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1573 | Systems Engineer III @ General Dynamics | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1603 | Test Engineer @ Blue Origin | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1632 | Build Reliability Engineer @ SpaceX | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1659 | Avionics Engineer @ NASA | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1701 | Autonomy Engineer @ Kratos Defense | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1761 | Flight Test Engineer @ BETA Technologies | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1780 | Spacecraft Operations Engineer @ Blue Origin | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1783 | Reliability Engineer @ L3Harris Technologies | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1872 | Liaison Engineer @ Pratt & Whitney | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1885 | Flight Test Engineer @ Archer Aviation | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1909 | Systems Engineer @ General Dynamics | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1916 | Liaison Engineer @ Boeing | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1925 | Flight Test Engineer @ BETA Technologies | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1954 | Avionics Engineer @ Northrop Grumman | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v1966 | Test Engineer @ Space Exploration Technologies | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v2020 | Mission Operations Engineer @ Rocket Lab | 1 | 0 |  |  |
| v10 "senior aerospace engineer" | v2011 | Senior Software Engineer @ Netflix | 1 | 0 |  |  |
| v11 "fire department leadership" | v0304 | Firefighter/Paramedic @ Phoenix Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v0310 | Firefighter/EMT @ Phoenix Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v0337 | Technical Rescue Specialist @ Austin Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v0340 | Firefighter/Paramedic @ Los Angeles County Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v0347 | Firefighter @ (no company) | 1 | 0 |  |  |
| v11 "fire department leadership" | v0365 | Firefighter @ Puget Sound Fire | 1 | 0 |  |  |
| v11 "fire department leadership" | v0495 | Firefighter @ Eastside Fire & Rescue | 1 | 0 |  |  |
| v11 "fire department leadership" | v0632 | Firefighter/Paramedic @ Denver Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v0722 | Fire Apparatus Engineer @ Phoenix Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v0812 | Firefighter/Paramedic @ Los Angeles County Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v0883 | FF/PM @ Seattle Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v0928 | Public Information Officer @ Eastside Fire & Rescue | 1 | 0 |  |  |
| v11 "fire department leadership" | v0994 | Public Information Officer @ Seattle Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v1046 | ARFF Firefighter @ Denver International Airport | 0 | 1 |  |  |
| v11 "fire department leadership" | v1048 | Fire Operations Manager @ Coulson Aviation | 0 | 1 |  |  |
| v11 "fire department leadership" | v1053 | Customer Success Manager, Fire & Rescue @ Skydio — note: Knows which fire departments are piloting drone programs this year. | 1 | 0 |  |  |
| v11 "fire department leadership" | v1102 | Firefighter/Paramedic @ Seattle Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v1211 | EMS Chief @ Austin-Travis County EMS | 1 | 0 |  |  |
| v11 "fire department leadership" | v1233 | Firefighter/Paramedic @ Los Angeles County Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v1275 | Firefighter/EMT @ Austin Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v1279 | Firefighter @ Seattle Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v1284 | Firefighter/EMT @ Puget Sound Fire | 1 | 0 |  |  |
| v11 "fire department leadership" | v1331 | Firefighter/EMT @ Denver Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v1408 | Engineer @ Spokane Valley Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v1474 | Hazmat Technician @ Austin Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v1479 | Firefighter @ Los Angeles County Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v1521 | ARFF Firefighter @ Denver International Airport | 0 | 1 |  |  |
| v11 "fire department leadership" | v1555 | Engineer @ Phoenix Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v1560 | Hazmat Technician @ Puget Sound Fire | 1 | 0 |  |  |
| v11 "fire department leadership" | v1593 | EMS Coordinator @ Spokane Valley Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v1606 | EMS Coordinator @ Los Angeles County Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v1656 | EMS Chief @ American Medical Response | 1 | 0 |  |  |
| v11 "fire department leadership" | v1787 | Fire Operations Manager @ Coulson Aviation | 0 | 1 |  |  |
| v11 "fire department leadership" | v1809 | Technical Rescue Specialist @ Bellevue Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v1827 | Firefighter @ Bellevue Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v1875 | Firefighter @ Austin Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v1924 | Firefighter @ Seattle Fire Department | 1 | 0 |  |  |
| v11 "fire department leadership" | v2034 | Fire Apparatus Engineer @ Los Angeles County Fire Department | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0028 | Pilot, Bell 407 @ Airlift Northwest | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0036 | Air Tanker Pilot @ Coulson Aviation | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0039 | MQ-9 Pilot @ USAF | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0058 | CFI / Commercial Drone Pilot @ Self-employed | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0092 | Captain, C-130 Air Tanker @ Coulson Aviation | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0094 | Air Tanker Pilot @ Coulson Aviation | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0096 | Experimental Test Pilot @ Bell Textron | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0097 | UAS Pilot @ DJI | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0130 | MQ-9 Pilot @ U.S. Air Force | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0168 | Mission Pilot @ Civil Air Patrol | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0209 | Test Pilot @ Pratt & Whitney | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0257 | Helicopter Pilot (Newscopter) @ KING 5 News | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0276 | EMS Helicopter Pilot @ Airlift Northwest | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0334 | Agricultural Pilot @ Columbia Ag Aviation | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0350 | Experimental Test Pilot @ Raytheon | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0408 | KC-135 Instructor Pilot @ Washington Air National Guard | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0415 | UAS Pilot @ Skyfield Aerial | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0446 | Research Test Pilot @ NASA Armstrong Flight Research Center | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0459 | Experimental Test Pilot @ Joby Aviation | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0466 | Naval Aviator @ U.S. Navy | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0491 | Commercial Drone Pilot @ Wing | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0586 | Helicopter Camera Pilot @ Wolfe Air Aviation | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0616 | Flight Test Pilot @ BRINC | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0643 | Helicopter Pilot @ U.S. Army | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0703 | Naval Aviator @ United States Marine Corps | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0760 | Air Interdiction Agent (Pilot) @ U.S. Customs and Border Protection | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0766 | Aircraft Maintenance Technician @ Horizon Air | 0 | 1 |  |  |
| v12 "pilot at alaska airlines" | v0794 | Captain, C-130 Air Tanker @ Coulson Aviation | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0815 | Helicopter Pilot, Firefighting @ 10 Tanker Air Carrier | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0820 | Experimental Test Pilot @ Joby Aviation | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0843 | Experimental Test Pilot @ L3Harris Technologies | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0890 | C-17 Pilot @ USAF | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0900 | Drone Pilot @ Matternet | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0902 | Remote Pilot in Command @ Zipline | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0905 | Drone Pilot @ Skydio | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0908 | Agricultural Pilot @ Rantizo | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0940 | Drone Pilot @ DJI Enterprise | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0948 | Drone Pilot @ Northwind Aerial Imaging | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v0951 | RPA Pilot @ Washington Air National Guard | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1023 | EMS Helicopter Pilot @ PHI Air Medical | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1031 | Ag Pilot @ Rantizo | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1072 | Pilot, Bell 407 @ PHI Air Medical | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1130 | Senior UAS Pilot @ Skyfield Aerial | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1177 | UAS Pilot @ DJI | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1183 | Senior UAS Pilot @ Skyfield Aerial | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1254 | Base Lead Pilot @ PHI Air Medical | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1299 | Remote Pilot in Command @ DJI | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1300 | Ag Pilot @ Columbia Ag Aviation | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1323 | Capt, USAF / C-17 Aircraft Commander @ U.S. Air Force | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1360 | Helicopter Pilot @ U.S. Marine Corps | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1429 | MH-65 Pilot @ United States Coast Guard | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1443 | Director of Safety @ Horizon Air | 0 | 1 |  |  |
| v12 "pilot at alaska airlines" | v1445 | UAS Test Pilot @ Anduril Industries | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1453 | MQ-9 Instructor Pilot @ U.S. Air Force — note: Old squadron mate from Creech AFB. | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1475 | UAS Pilot @ Skyfield Aerial | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1512 | UAS Pilot @ BRINC | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1576 | Flight Dispatcher @ Alaska Airlines | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1702 | UAS Test Pilot @ General Atomics Aeronautical Systems | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1876 | Pilot / Fisheries Biologist @ Alaska Department of Fish and Game | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1883 | UH-60 Instructor Pilot @ Army National Guard | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1906 | Flight Test Pilot @ Skydio | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1915 | UAS Pilot @ BRINC | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1937 | Test Pilot @ Archer Aviation | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1992 | Test Pilot @ Raytheon | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v1995 | Chief Test Pilot @ BETA Technologies | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v2026 | Commercial Drone Pilot @ Parrot | 1 | 0 |  |  |
| v12 "pilot at alaska airlines" | v2045 | RPA Pilot @ United States Air Force | 1 | 0 |  |  |
| v13 "producer netflix" | v0597 | Unit Production Manager @ Warner Bros. Discovery | 1 | 0 |  |  |
| v13 "producer netflix" | v0696 | Location Manager @ Granite Peak Productions | 1 | 0 |  |  |
| v13 "producer netflix" | v0837 | Location Scout @ Low Orbit Films | 1 | 0 |  |  |
| v13 "producer netflix" | v0972 | Production Coordinator @ Legendary Entertainment | 1 | 0 |  |  |
| v13 "producer netflix" | v1732 | (no title) @ Netflix | 0 | 1 |  |  |
| v14 "engineer at spacex" | v0060 | Launch Director @ NASA | 1 | 0 |  |  |
| v14 "engineer at spacex" | v0158 | Recruiter @ Relativity Space | 1 | 0 |  |  |
| v14 "engineer at spacex" | v0493 | Supply Chain Manager @ United Launch Alliance | 1 | 0 |  |  |
| v14 "engineer at spacex" | v0554 | Production Technician @ Firefly Aerospace | 1 | 0 |  |  |
| v14 "engineer at spacex" | v0558 | Launch Director @ Blue Origin | 1 | 0 |  |  |
| v14 "engineer at spacex" | v0747 | Production Technician @ Rocket Lab | 1 | 0 |  |  |
| v14 "engineer at spacex" | v0962 | Recruiter @ Rocket Lab | 1 | 0 |  |  |
| v14 "engineer at spacex" | v0991 | Mission Manager @ Firefly Aerospace | 1 | 0 |  |  |
| v14 "engineer at spacex" | v1152 | Supply Chain Manager @ Rocket Lab | 1 | 0 |  |  |
| v14 "engineer at spacex" | v1184 | Mission Manager @ Planet | 1 | 0 |  |  |
| v14 "engineer at spacex" | v1214 | Recruiter @ Blue Origin | 1 | 0 |  |  |
| v14 "engineer at spacex" | v1320 | Production Technician @ NASA | 1 | 0 |  |  |
| v15 "john deere" | v0095 | Service Technician @ Washington Tractor | 1 | 0 |  |  |
| v15 "john deere" | v0138 | Integrated Solutions Manager @ Washington Tractor | 1 | 0 |  |  |
| v15 "john deere" | v0802 | Sales Representative @ Washington Tractor | 1 | 0 |  |  |
| v15 "john deere" | v1426 | Service Manager @ Washington Tractor | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v0009 | Air Traffic Controller @ FAA | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v0058 | CFI / Commercial Drone Pilot @ Self-employed | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v0065 | Aviation Instructor (CTE) @ Raisbeck Aviation High School — note: Runs the drone club; asked for a guest talk on Part 107 careers. | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v0274 | Chief Pilot, UAS Operations @ Zipline | 0 | 1 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v0294 | Aviation Underwriter, Unmanned Aircraft @ Global Aerospace — note: Underwrites our drone fleet; asks about wildfire missions every renewal. | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v0506 | Air Traffic Control Specialist @ Federal Aviation Administration | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v0553 | Operations Supervisor, Seattle Center @ Federal Aviation Administration | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v0613 | Air Traffic Controller @ FAA | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v0624 | Assistant Professor, Unmanned Systems @ Purdue University School of Aviation and Transportation Technology | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v0757 | Air Traffic Controller @ Federal Aviation Administration (FAA) | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v0778 | Assistant Professor, Unmanned Systems @ Embry-Riddle Aeronautical University — note: Roommate at Embry-Riddle; runs their UAS research lab. | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v0788 | Training Manager @ Cascade Drone Services | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v0801 | Aerospace Engineer, UAS Traffic Management @ NASA | 0 | 1 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v0912 | Operations Supervisor, Seattle Center @ Federal Aviation Administration (FAA) | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v0955 | Certified Professional Controller @ Federal Aviation Administration | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v1021 | Air Traffic Manager @ Federal Aviation Administration | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v1040 | Drone Survey Lead @ Rio Tinto — note: Beta user of our LiDAR survey workflow at the Kennecott pit. | 0 | 1 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v1117 | Drone Survey Lead @ Newmont | 0 | 1 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v1133 | Training Manager @ Wing | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v1482 | Air Traffic Control Specialist @ Federal Aviation Administration | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v1538 | Air Traffic Control Specialist @ FAA | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v1647 | Front Line Manager, ATC @ Federal Aviation Administration (FAA) | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v1744 | Drone Survey Lead @ Kennecott Utah Copper | 0 | 1 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v1794 | Air Traffic Assistant @ Federal Aviation Administration | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v1842 | Air Traffic Controller @ Federal Aviation Administration | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v1890 | Program Manager, Technology @ International Association of Fire Chiefs — note: Can introduce us to fire chiefs evaluating drone programs. | 0 | 1 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v1929 | (no title) @ Federal Aviation Administration | 1 | 0 |  |  |
| v17 "who could help me get a part 107 waiver approved" | v1948 | Training Lead @ Skyfield Aerial | 1 | 0 |  |  |
| v18 "someone who shoots aerial footage for films" | v0058 | CFI / Commercial Drone Pilot @ Self-employed | 1 | 0 |  |  |
| v18 "someone who shoots aerial footage for films" | v0491 | Commercial Drone Pilot @ Wing | 1 | 0 |  |  |
| v18 "someone who shoots aerial footage for films" | v0643 | Helicopter Pilot @ U.S. Army | 1 | 0 |  |  |
| v18 "someone who shoots aerial footage for films" | v0816 | Video Editor @ CNN | 1 | 0 |  |  |
| v18 "someone who shoots aerial footage for films" | v1125 | Creative Video Producer @ Seattle Mariners | 1 | 0 |  |  |
| v18 "someone who shoots aerial footage for films" | v1360 | Helicopter Pilot @ U.S. Marine Corps | 1 | 0 |  |  |
| v18 "someone who shoots aerial footage for films" | v1544 | Creative Video Producer @ Seattle Storm | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0023 | UAS Operator @ Shield AI | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0075 | Head of Sales @ Skyfield Aerial | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0097 | UAS Pilot @ DJI | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0104 | Marketing Manager @ DroneDeploy | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0122 | Customer Success Lead @ Skyfield Aerial | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0155 | Recruiter @ Cascade Drone Services | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0170 | Incident Meteorologist @ NOAA National Weather Service — note: Forecasts for wildfire incident teams; good contact for fire-season TFRs and smoke. | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0213 | Marketing Manager @ Zipline | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0366 | Recruiter @ Zipline | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0388 | Search and Rescue Coordinator @ Team Rubicon | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0390 | Principal @ Clearline Aviation Consulting — note: Former FAA UAS Integration Office; now helps operators with waivers and COAs. Got our BVLOS waiver approved in six weeks. | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0415 | UAS Pilot @ Skyfield Aerial | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0489 | Flight Operations Manager @ DroneDeploy | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0490 | Drone Regulatory Consultant @ Altitude Regulatory Advisors | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0491 | Commercial Drone Pilot @ Wing | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0599 | sUAS Operator @ Zipline | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0664 | Regulatory Specialist @ Skyfield Aerial — note: Owns our Part 107 waiver and COA paperwork; tracks every DroneZone application. | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0719 | UAS Integration Specialist @ FAA | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0768 | Partner, Aviation & Drone Law @ Hollister & Wade LLP — note: Reviewed our operations-over-people waiver (107.39) and the insurance language in our public safety contracts. | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0815 | Helicopter Pilot, Firefighting @ 10 Tanker Air Carrier | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0886 | Program Manager, UAS Integration Office @ Federal Aviation Administration | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0900 | Drone Pilot @ Matternet | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0902 | Remote Pilot in Command @ Zipline | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0905 | Drone Pilot @ Skydio | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0940 | Drone Pilot @ DJI Enterprise | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0946 | Regulatory Affairs Manager @ Parrot | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v0948 | Drone Pilot @ Northwind Aerial Imaging | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v1130 | Senior UAS Pilot @ Skyfield Aerial | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v1177 | UAS Pilot @ DJI | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v1183 | Senior UAS Pilot @ Skyfield Aerial | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v1299 | Remote Pilot in Command @ DJI | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v1352 | UAS Operator @ Anduril Industries | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v1359 | Data Analyst @ Skyfield Aerial | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v1454 | Quality Assurance Specialist, 911 @ Phoenix Fire Regional Dispatch Center | 0 | 1 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v1475 | UAS Pilot @ Skyfield Aerial | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v1493 | Regulatory Affairs Manager @ Skydio | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v1512 | UAS Pilot @ BRINC | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v1567 | Senior Policy Advisor, UAS @ Federal Aviation Administration (FAA) | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v1670 | sUAS Operator @ Matternet | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v1679 | Head of Regulatory Affairs @ Skydio | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v1867 | UAS Waiver Specialist, Flight Standards @ Federal Aviation Administration | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v1915 | UAS Pilot @ BRINC | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v1944 | Chief Pilot, Air Tanker Operations @ Coulson Aviation — note: Night-flying air tankers on the Bootleg and Cedar Creek fires; open to pairing tankers with our wildfire mapping drones. | 1 | 0 |  |  |
| v19 "who can introduce me to fire departments that want drones" | v2026 | Commercial Drone Pilot @ Parrot | 1 | 0 |  |  |
| v20 "someone who knows crop spraying rules" | v0490 | Drone Regulatory Consultant @ Altitude Regulatory Advisors | 1 | 0 |  |  |
| v20 "someone who knows crop spraying rules" | v0990 | Soil Conservationist @ USDA APHIS | 1 | 0 |  |  |
| v20 "someone who knows crop spraying rules" | v1049 | Safety & Compliance Manager @ Skyfield Aerial | 1 | 0 |  |  |
| v20 "someone who knows crop spraying rules" | v1168 | Agronomy Sales Representative @ CHS Inc. | 0 | 1 |  |  |
| v20 "someone who knows crop spraying rules" | v1728 | Soil Conservationist @ USDA | 1 | 0 |  |  |
| v20 "someone who knows crop spraying rules" | v1759 | Program Specialist @ Washington State Department of Agriculture | 1 | 0 |  |  |
| v20 "someone who knows crop spraying rules" | v1847 | Regulatory Compliance Specialist @ Williams Companies | 1 | 0 |  |  |
| v20 "someone who knows crop spraying rules" | v1962 | District Conservationist @ USDA | 1 | 0 |  |  |
| v21 "someone who can help me hire pilots" | v1790 | Account Manager @ Aerotek | 0 | 1 |  |  |
| v22 "dispatchers" | v0232 | Load Planner @ J.B. Hunt Transport | 1 | 0 |  |  |
| v22 "dispatchers" | v0362 | Maintenance Controller @ StandardAero | 1 | 0 |  |  |
| v22 "dispatchers" | v0428 | Maintenance Controller @ Cascade Aircraft Maintenance | 1 | 0 |  |  |
| v22 "dispatchers" | v1507 | Load Planner @ Atlas Air | 1 | 0 |  |  |
| v22 "dispatchers" | v0590 | Operations Manager @ Cascade Ambulance | 1 | 0 |  |  |
| v23 "airline captains" | v0092 | Captain, C-130 Air Tanker @ Coulson Aviation | 0 | 1 |  |  |
| v23 "airline captains" | v0263 | B757/767 @ Delta Air Lines | 1 | 0 |  |  |
| v23 "airline captains" | v0342 | B757/767 @ Delta Air Lines | 1 | 0 |  |  |
| v23 "airline captains" | v0775 | Chief Pilot @ Life Flight Network | 1 | 0 |  |  |
| v23 "airline captains" | v0794 | Captain, C-130 Air Tanker @ Coulson Aviation | 0 | 1 |  |  |
| v23 "airline captains" | v1087 | Chief Pilot @ Skyfield Aerial | 1 | 0 |  |  |
| v23 "airline captains" | v1329 | Flight Engineer @ Atlas Air | 1 | 0 |  |  |
| v23 "airline captains" | v1750 | Flight Engineer @ UPS Airlines | 1 | 0 |  |  |
| v23 "airline captains" | v1801 | Owner & Chief Pilot @ Valley Air Crop Care — note: Third-generation crop duster; knows every aerial application rule and the 137 certificate process. | 1 | 0 |  |  |
| v23 "airline captains" | v1944 | Chief Pilot, Air Tanker Operations @ Coulson Aviation — note: Night-flying air tankers on the Bootleg and Cedar Creek fires; open to pairing tankers with our wildfire mapping drones. | 1 | 0 |  |  |
| v24 "film producers" | v0696 | Location Manager @ Granite Peak Productions | 0 | 1 |  |  |
| v24 "film producers" | v0837 | Location Scout @ Low Orbit Films | 0 | 1 |  |  |
| v24 "film producers" | v0957 | Production Manager @ Sub Pop Records | 1 | 0 |  |  |
| v24 "film producers" | v1457 | Location Manager @ Netflix | 0 | 1 |  |  |
| v24 "film producers" | v1782 | Post-Production Supervisor @ Warner Bros. Discovery | 0 | 1 |  |  |
| v24 "film producers" | v1928 | Post-Production Supervisor @ Netflix | 0 | 1 |  |  |
| v26 "geologists" | v0974 | Mine Manager @ Newmont | 1 | 0 |  |  |
| v26 "geologists" | v1081 | Mine Superintendent @ Rio Tinto | 1 | 0 |  |  |
| v26 "geologists" | v1160 | Drilling Engineer @ Kinder Morgan | 0 | 1 |  |  |
| v26 "geologists" | v1185 | Remote Sensing Specialist @ Rio Tinto | 1 | 0 |  |  |
| v26 "geologists" | v1533 | Process Engineer @ Freeport-McMoRan | 1 | 0 |  |  |
| v27 "cinematographer" | v0505 | Real Estate Photographer & Part 107 Pilot @ Self-employed | 1 | 0 |  |  |
| v27 "cinematographer" | v0625 | Photographer @ Self-employed | 1 | 0 |  |  |
| v28 "paramedc" | v0005 | Clinical Educator @ American Medical Response | 1 | 0 |  |  |
| v28 "paramedc" | v0448 | Clinical Base Manager @ Airlift Northwest | 1 | 0 |  |  |
| v28 "paramedc" | v0590 | Operations Manager @ Cascade Ambulance | 1 | 0 |  |  |
| v28 "paramedc" | v0874 | EMS Dispatcher @ Cascade Ambulance | 1 | 0 |  |  |
| v28 "paramedc" | v1148 | Clinical Base Manager @ Air Methods | 1 | 0 |  |  |
| v28 "paramedc" | v1523 | Emergency Medicine Physician @ Swedish Medical Center | 1 | 0 |  |  |
| v28 "paramedc" | v1593 | EMS Coordinator @ Spokane Valley Fire Department | 1 | 0 |  |  |
| v28 "paramedc" | v1606 | EMS Coordinator @ Los Angeles County Fire Department | 1 | 0 |  |  |
| v28 "paramedc" | v1611 | Operations Manager @ Cascade Ambulance | 1 | 0 |  |  |
| v28 "paramedc" | v1824 | Emergency Medicine Physician @ Virginia Mason Franciscan Health | 1 | 0 |  |  |
| v29 "aerospase engineer" | v0060 | Launch Director @ NASA | 1 | 0 |  |  |
| v29 "aerospase engineer" | v0163 | Field Service Representative @ RTX | 1 | 0 |  |  |
| v29 "aerospase engineer" | v0167 | Research Scientist @ Firefly Aerospace | 1 | 0 |  |  |
| v29 "aerospase engineer" | v0523 | Field Service Representative @ Kratos Defense | 1 | 0 |  |  |
| v29 "aerospase engineer" | v0540 | Avionics Technician @ Delta TechOps | 1 | 0 |  |  |
| v29 "aerospase engineer" | v0555 | Avionics Technician @ AAR Corp | 1 | 0 |  |  |
| v29 "aerospase engineer" | v0558 | Launch Director @ Blue Origin | 1 | 0 |  |  |
| v29 "aerospase engineer" | v0730 | Lead Avionics Technician @ AAR Corp | 1 | 0 |  |  |
| v29 "aerospase engineer" | v0876 | Aerospace & Defense Consultant @ Booz Allen Hamilton | 1 | 0 |  |  |
| v29 "aerospase engineer" | v0973 | Research Scientist @ SpaceX | 1 | 0 |  |  |
| v29 "aerospase engineer" | v1002 | Avionics Technician @ HAECO Americas | 1 | 0 |  |  |
| v29 "aerospase engineer" | v1541 | Avionics Technician @ Delta TechOps | 1 | 0 |  |  |
| v29 "aerospase engineer" | v1570 | Field Service Representative @ General Atomics Aeronautical Systems | 1 | 0 |  |  |
| v29 "aerospase engineer" | v1778 | Research Scientist @ Blue Origin | 1 | 0 |  |  |
| v29 "aerospase engineer" | v1865 | Aerospace & Defense Consultant @ Leidos | 1 | 0 |  |  |
| v29 "aerospase engineer" | v1901 | Lead Avionics Technician @ Cascade Aircraft Maintenance | 1 | 0 |  |  |
| v29 "aerospase engineer" | v1905 | Field Service Representative @ Boeing | 1 | 0 |  |  |
| v30 "precision agriculture" | v0073 | Orchard Manager @ Chateau Ste. Michelle | 0 | 1 |  |  |
| v30 "precision agriculture" | v0126 | Plant Breeder @ Simplot | 0 | 1 |  |  |
| v30 "precision agriculture" | v0182 | Plant Health Inspector @ Washington State Department of Agriculture | 1 | 0 |  |  |
| v30 "precision agriculture" | v0199 | Orchard Manager @ Sunny Ridge Orchards | 0 | 1 |  |  |
| v30 "precision agriculture" | v0208 | Research Scientist, Plant Breeding @ Nutrien Ag Solutions | 0 | 1 |  |  |
| v30 "precision agriculture" | v0293 | Territory Sales Manager @ Simplot | 0 | 1 |  |  |
| v30 "precision agriculture" | v0375 | Owner @ Blue Mountain Wheat Ranch | 0 | 1 |  |  |
| v30 "precision agriculture" | v0442 | Dealer Development Manager @ CNH Industrial | 0 | 1 |  |  |
| v30 "precision agriculture" | v0449 | Service Technician @ CNH Industrial | 0 | 1 |  |  |
| v30 "precision agriculture" | v0477 | Operations Manager @ Hartwell Family Farms | 0 | 1 |  |  |
| v30 "precision agriculture" | v0498 | Plant Breeder @ Bayer Crop Science | 0 | 1 |  |  |
| v30 "precision agriculture" | v0499 | Machine Operator @ Deere & Company | 0 | 1 |  |  |
| v30 "precision agriculture" | v0619 | (no title) @ John Deere | 0 | 1 |  |  |
| v30 "precision agriculture" | v0628 | Seed Sales Representative @ Bayer Crop Science | 0 | 1 |  |  |
| v30 "precision agriculture" | v0641 | Territory Manager @ Deere & Company | 0 | 1 |  |  |
| v30 "precision agriculture" | v0686 | Service Technician @ Kubota Tractor Corporation | 0 | 1 |  |  |
| v30 "precision agriculture" | v0762 | Diesel Mechanic @ Papé Machinery | 0 | 1 |  |  |
| v30 "precision agriculture" | v0798 | Machine Operator @ John Deere | 0 | 1 |  |  |
| v30 "precision agriculture" | v0802 | Sales Representative @ Washington Tractor | 0 | 1 |  |  |
| v30 "precision agriculture" | v0898 | Owner @ Yakima Valley Hops Co. | 0 | 1 |  |  |
| v30 "precision agriculture" | v0968 | Service Technician @ Papé Machinery | 0 | 1 |  |  |
| v30 "precision agriculture" | v0990 | Soil Conservationist @ USDA APHIS | 1 | 0 |  |  |
| v30 "precision agriculture" | v1007 | Owner/Operator @ Columbia Basin Potato Growers | 0 | 1 |  |  |
| v30 "precision agriculture" | v1168 | Agronomy Sales Representative @ CHS Inc. | 0 | 1 |  |  |
| v30 "precision agriculture" | v1176 | Owner @ Pham Family Farm | 0 | 1 |  |  |
| v30 "precision agriculture" | v1426 | Service Manager @ Washington Tractor | 0 | 1 |  |  |
| v30 "precision agriculture" | v1485 | Producer @ Columbia Basin Potato Growers | 0 | 1 |  |  |
| v30 "precision agriculture" | v1517 | Supply Chain Analyst @ Deere & Company | 0 | 1 |  |  |
| v30 "precision agriculture" | v1588 | Research Scientist, Plant Breeding @ Simplot | 0 | 1 |  |  |
| v30 "precision agriculture" | v1601 | Marketing Manager @ Nutrien Ag Solutions | 0 | 1 |  |  |
| v30 "precision agriculture" | v1642 | Service Manager @ RDO Equipment Co. | 0 | 1 |  |  |
| v30 "precision agriculture" | v1683 | Territory Manager @ Case IH | 0 | 1 |  |  |
| v30 "precision agriculture" | v1707 | Product Marketing Manager @ Case IH | 0 | 1 |  |  |
| v30 "precision agriculture" | v1728 | Soil Conservationist @ USDA | 1 | 0 |  |  |
| v30 "precision agriculture" | v1739 | Territory Sales Manager @ Bayer Crop Science | 0 | 1 |  |  |
| v30 "precision agriculture" | v1749 | Welder @ Deere & Company | 0 | 1 |  |  |
| v30 "precision agriculture" | v1764 | Marketing Manager @ Nutrien Ag Solutions | 0 | 1 |  |  |
| v30 "precision agriculture" | v1765 | Parts Manager @ RDO Equipment Co. | 0 | 1 |  |  |
| v30 "precision agriculture" | v1950 | Dealer Development Manager @ John Deere | 0 | 1 |  |  |
| v30 "precision agriculture" | v2024 | Seed Sales Representative @ Nutrien Ag Solutions | 0 | 1 |  |  |
| v32 "public safety" | v0768 | Partner, Aviation & Drone Law @ Hollister & Wade LLP — note: Reviewed our operations-over-people waiver (107.39) and the insurance language in our public safety contracts. | 1 | 0 |  |  |
| v32 "public safety" | v1391 | Port Security Manager @ The Northwest Seaport Alliance | 0 | 1 |  |  |
| v33 "beta tester" | v0071 | Flight Test Instrumentation Engineer @ Raytheon | 1 | 0 |  |  |
| v33 "beta tester" | v0096 | Experimental Test Pilot @ Bell Textron | 1 | 0 |  |  |
| v33 "beta tester" | v0133 | Quality Assurance Manager @ StandardAero | 1 | 0 |  |  |
| v33 "beta tester" | v0137 | Flight Test Engineer @ Anduril Industries | 1 | 0 |  |  |
| v33 "beta tester" | v0209 | Test Pilot @ Pratt & Whitney | 1 | 0 |  |  |
| v33 "beta tester" | v0256 | Flight Test Engineer @ Boeing | 1 | 0 |  |  |
| v33 "beta tester" | v0302 | Test Engineer @ Blue Origin | 1 | 0 |  |  |
| v33 "beta tester" | v0339 | Flight Test Engineer @ Kratos Defense | 1 | 0 |  |  |
| v33 "beta tester" | v0350 | Experimental Test Pilot @ Raytheon | 1 | 0 |  |  |
| v33 "beta tester" | v0446 | Research Test Pilot @ NASA Armstrong Flight Research Center | 1 | 0 |  |  |
| v33 "beta tester" | v0459 | Experimental Test Pilot @ Joby Aviation | 1 | 0 |  |  |
| v33 "beta tester" | v0616 | Flight Test Pilot @ BRINC | 1 | 0 |  |  |
| v33 "beta tester" | v0629 | UAS Program Manager, Wildland Fire @ Washington State Department of Natural Resources — note: Flew thermal mapping with us on the Cedar Creek wildfire; runs their night operations drones. | 1 | 0 |  |  |
| v33 "beta tester" | v0820 | Experimental Test Pilot @ Joby Aviation | 1 | 0 |  |  |
| v33 "beta tester" | v0843 | Experimental Test Pilot @ L3Harris Technologies | 1 | 0 |  |  |
| v33 "beta tester" | v0865 | Aerial Cinematographer @ HoverFrame Media — note: Shot the aerial sequences for a Netflix series on our drones. | 1 | 0 |  |  |
| v33 "beta tester" | v1010 | Field Agronomist @ Corteva Agriscience — note: Ran the side-by-side plots comparing drone and ground spraying. | 1 | 0 |  |  |
| v33 "beta tester" | v1025 | Flight Test Engineer @ BRINC | 1 | 0 |  |  |
| v33 "beta tester" | v1080 | Flight Test Engineer @ Wisk Aero | 1 | 0 |  |  |
| v33 "beta tester" | v1124 | Flight Test Instrumentation Engineer @ Northrop Grumman | 1 | 0 |  |  |
| v33 "beta tester" | v1265 | Flight Test Engineer @ Supernal | 1 | 0 |  |  |
| v33 "beta tester" | v1335 | Flight Test Engineer @ Collins Aerospace | 1 | 0 |  |  |
| v33 "beta tester" | v1347 | Flight Test Instrumentation Engineer @ Honeywell Aerospace | 1 | 0 |  |  |
| v33 "beta tester" | v1438 | Field Test Engineer @ Raven Industries | 1 | 0 |  |  |
| v33 "beta tester" | v1445 | UAS Test Pilot @ Anduril Industries | 1 | 0 |  |  |
| v33 "beta tester" | v1454 | Quality Assurance Specialist, 911 @ Phoenix Fire Regional Dispatch Center | 1 | 0 |  |  |
| v33 "beta tester" | v1603 | Test Engineer @ Blue Origin | 1 | 0 |  |  |
| v33 "beta tester" | v1702 | UAS Test Pilot @ General Atomics Aeronautical Systems | 1 | 0 |  |  |
| v33 "beta tester" | v1761 | Flight Test Engineer @ BETA Technologies | 1 | 0 |  |  |
| v33 "beta tester" | v1776 | Flight Test Engineer @ Zipline | 1 | 0 |  |  |
| v33 "beta tester" | v1856 | Flight Test Engineer @ Lockheed Martin | 1 | 0 |  |  |
| v33 "beta tester" | v1885 | Flight Test Engineer @ Archer Aviation | 1 | 0 |  |  |
| v33 "beta tester" | v1906 | Flight Test Pilot @ Skydio | 1 | 0 |  |  |
| v33 "beta tester" | v1925 | Flight Test Engineer @ BETA Technologies | 1 | 0 |  |  |
| v33 "beta tester" | v1937 | Test Pilot @ Archer Aviation | 1 | 0 |  |  |
| v33 "beta tester" | v1966 | Test Engineer @ Space Exploration Technologies | 1 | 0 |  |  |
| v33 "beta tester" | v1991 | Senior Flight Test Engineer @ Gulfstream Aerospace | 1 | 0 |  |  |
| v33 "beta tester" | v1992 | Test Pilot @ Raytheon | 1 | 0 |  |  |
| v33 "beta tester" | v1995 | Chief Test Pilot @ BETA Technologies | 1 | 0 |  |  |
| v33 "beta tester" | v2035 | Senior Flight Test Engineer @ Boeing | 1 | 0 |  |  |
| v34 "wildfire" | v0032 | Flight Paramedic @ Airlift Northwest — note: Asked whether drones could deliver AEDs ahead of the helicopter. | 0 | 1 |  |  |
| v34 "wildfire" | v0153 | Extension Entomologist @ University of California Agriculture and Natural Resources | 1 | 0 |  |  |
| v34 "wildfire" | v0283 | Drone Unit Supervisor @ Snohomish County Sheriff's Office — note: Signed up their sheriff's office drone unit as a beta site for our DFR software; wrote their COA application herself. | 1 | 0 |  |  |
| v34 "wildfire" | v0301 | Director of Advocacy @ AUVSI — note: Met at XPONENTIAL 2025; tracks every FAA drone rulemaking. | 1 | 0 |  |  |
| v34 "wildfire" | v0390 | Principal @ Clearline Aviation Consulting — note: Former FAA UAS Integration Office; now helps operators with waivers and COAs. Got our BVLOS waiver approved in six weeks. | 1 | 0 |  |  |
| v34 "wildfire" | v0664 | Regulatory Specialist @ Skyfield Aerial — note: Owns our Part 107 waiver and COA paperwork; tracks every DroneZone application. | 1 | 0 |  |  |
| v34 "wildfire" | v0748 | Captain, Drone as First Responder Program @ Chula Vista Police Department — note: Introduced us to other DFR programs; candid about FAA waiver timelines. | 1 | 0 |  |  |
| v34 "wildfire" | v0768 | Partner, Aviation & Drone Law @ Hollister & Wade LLP — note: Reviewed our operations-over-people waiver (107.39) and the insurance language in our public safety contracts. | 1 | 0 |  |  |
| v34 "wildfire" | v0865 | Aerial Cinematographer @ HoverFrame Media — note: Shot the aerial sequences for a Netflix series on our drones. | 1 | 0 |  |  |
| v34 "wildfire" | v1040 | Drone Survey Lead @ Rio Tinto — note: Beta user of our LiDAR survey workflow at the Kennecott pit. | 1 | 0 |  |  |
| v34 "wildfire" | v1047 | Extension Entomologist @ University of California Agriculture and Natural Resources | 1 | 0 |  |  |
| v34 "wildfire" | v1330 | County Extension Educator @ University of California Agriculture and Natural Resources | 1 | 0 |  |  |
| v34 "wildfire" | v1586 | Grower @ Yakima Valley Hops Co. — note: Beta-tested the spray-drone mission planner on 400 acres of hops. | 1 | 0 |  |  |
| v34 "wildfire" | v1988 | Solutions Engineer @ DroneDeploy — note: Was in the first beta cohort for our mapping pipeline; strong on photogrammetry. | 1 | 0 |  |  |

## Pending: graded but not in that query's pool (0)

| Query | Row | Title @ Company | A | B | Final | Reason |
|---|---|---|---|---|---|---|
