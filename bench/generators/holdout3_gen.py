# Holdout 3 generator (academia, energy policy, government, journalism, foundations).
# Run: python3 bench/generators/holdout3_gen.py [outDir]
import json, random, hashlib, os, sys
random.seed(4213)
OUT=os.path.join(os.path.abspath(sys.argv[1] if len(sys.argv)>1 else os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','holdout3')),'')
ROWS = """
Hannah|Okafor|University of Michigan|Asst. Prof. of Public Policy
Diego|Ferreira|Univ. of Michigan|Postdoctoral Scholar, Energy Institute
Mei Lin|Zhao|UMich|PhD Candidate, Environmental Engineering
Samuel|Adeyemi|University of Michigan|Associate Professor of Economics
Rachel|Goldberg|Stanford University|Professor & PI, Sustainable Systems Lab
Tomás|Rivera|Stanford|Postdoctoral Research Fellow
Aisha|Karimi|Stanford University|Assoc. Prof., Energy Resources Engineering
Ben|Whitaker|Stanford Graduate School of Business|Lecturer in Management
Olivia|Brennan|Harvard Kennedy School|Adjunct Lecturer in Public Policy
Kenji|Watanabe|Harvard University|Research Fellow, Belfer Center
Grace|Mbeki|UC Berkeley|Assistant Professor, Goldman School of Public Policy
Lucas|Moreau|University of California, Berkeley|PhD Student, Energy & Resources Group
Priyanka|Deshpande|UC Berkeley|Postdoc
Martin|Kowalczyk|MIT|Principal Research Scientist
Fatou|Diallo|Massachusetts Institute of Technology|Principal Investigator, Grid Resilience Lab
Hyun-woo|Park|MIT Energy Initiative|Graduate Research Assistant
Elena|Petrova|Georgetown University|Dean of Students
Marcus|Bell|Georgetown University|Associate Dean for Academic Affairs, McCourt School
Julia|Sandoval|University of Texas at Austin|Associate Professor & PI, Energy Poverty Research Group
Andre|Thompson|UT Austin|Grants Administrator, Office of Sponsored Projects
Sophie|Lindqvist|Columbia University|Assistant Professor of Climate Policy
Nikhil|Rao|Columbia University|Senior Research Scholar, Center on Global Energy Policy
Chloe|Nakamura|Yale School of the Environment|Postdoctoral Associate
Ibrahim|Haddad|Yale University|Department Chair, Economics
Wei|Chen|Arizona State University|Asst Professor, School of Sustainability
Owen|McCarthy|University of Wisconsin–Madison|Professor Emeritus, Agricultural & Applied Economics
Nadia|Hussain|Univ. of Wisconsin-Madison|Doctoral Candidate, Nelson Institute
Keisha|Robinson|Howard University|Director of Student Success
Rafael|Ortiz|Community College of Denver|Dean of Workforce Development
Emma|Johansson|Carnegie Mellon University|Research Assistant Professor, Engineering & Public Policy
Patrick|O'Neill|University of Michigan-Ann Arbor|Program Manager, Graham Sustainability Institute
Zainab|Ali|University of Michigan|Fellowship Coordinator
Jonathan|Hale|U.S. Department of Energy|Program Manager, Office of Electricity
Maria|Gonzalez|DOE|Senior Advisor, Loan Programs Office
Aaliyah|Brooks|Department of Energy|Policy Advisor, Office of Energy Efficiency & Renewable Energy
Thomas|Nguyen|National Renewable Energy Laboratory|Senior Analyst, Grid Integration
Rebecca|Stein|U.S. Senate|Chief of Staff to Sen. Whitfield
Aiden|Clarke|Michigan House of Representatives|Communications Director
Laila|Farouk|U.S. House of Representatives|Legislative Aide
Connor|Walsh|California State Assembly|Legislative Assistant
Jasmine|Ortega|U.S. Senate Committee on Energy and Natural Resources|Professional Staff Member
Ryan|Mitchell|Office of Rep. Alvarez|Legislative Director
Anjali|Mehta|Michigan Public Service Commission|Commissioner
Derek|Olsen|California Public Utilities Commission|Senior Regulatory Analyst
Sarah|Kim|U.S. Environmental Protection Agency|Environmental Protection Specialist
Michael|Brown|EPA|Deputy Chief of Staff
Yasmin|Saleh|Michigan Department of Environment, Great Lakes, and Energy|Energy Policy Analyst
Carlos|Mendes|Colorado Energy Office|Policy Analyst II
Hannah|Weiss|Congressional Research Service|Analyst in Energy Policy
Emily|Carter|City of Detroit|Chief Sustainability Officer
Nora|Fitzgerald|U.S. Senate|Legislative Correspondent
Isaac|Levin|New York State Senate|Chief of Staff to Sen. Martinez-Ruiz
Tanya|Petrov|Federal Energy Regulatory Commission|Energy Industry Analyst
Dylan|Harris|Minnesota State Legislature|Legislative Aide (Session Staff)
Gabriel|Stone|Brookings Institution|Senior Fellow, Metropolitan Policy Program
Maya|Patel|Brookings|Research Assistant
Lars|Eriksen|Resources for the Future|Fellow
Tiana|Jackson|RFF|Senior Research Associate
Pedro|Alvarez|World Resources Institute|Director, U.S. Energy Program
Amara|Nwosu|WRI|Research Analyst
Sven|Holm|RMI|Principal, Carbon-Free Buildings
Destiny|Howard|Center for American Progress|Policy Analyst
Colin|Reed|Bipartisan Policy Center|Associate Director, Energy Program
Ethan|Brooks|Niskanen Center|Senior Policy Analyst
Arjun|Iyer|Energy Innovation Policy & Technology LLC|Policy Analyst
Denise|Harper|Clearwater Energy Futures|Executive Director
Felix|Grant|Clearwater Energy Futures|Director of Research
Rosa|Jimenez|Clearwater Energy Futures|Policy Analyst
Sean|Doyle|Clearwater Energy Futures|Development Manager
Harold|Winslow|Clearwater Energy Futures, Inc.|Board Chair
Nina|Castillo|The Energy Foundation|Senior Program Officer, Climate
Jamal|Carter|Energy Foundation|Program Officer, Power Sector
Allison|Park|William and Flora Hewlett Foundation|Program Officer, Environment
Brian|Cho|Hewlett Foundation|Program Associate
Lauren|Fisher|Bloomberg Philanthropies|Program Manager, Beyond Carbon
Marisol|Vega|The Kresge Foundation|Chief Program Officer
Tom|Becker|Kresge Foundation|Grants Manager
Irene|Kwan|MacArthur Foundation|Director, Climate Solutions
Hana|Suzuki|Natural Resources Defense Council|Senior Attorney, Climate & Clean Energy
Omar|Farah|Elevate Energy|Executive Director
Claire|Dubois|Solar United Neighbors|E.D.
Robert|Vance|Environmental Defense Fund|Managing Director, Energy Transition
Winston|Hayes|Detroit Educational Development Corp.|Director of Education
Ruth|Abernathy|Joyce Foundation|Program Officer, Environment
Kofi|Asante|NRDC|Energy Advocate
Julia|Hart|The New York Times|Climate Reporter
David|Feldman|NYT|Energy Correspondent
Kim|Tran|New York Times|Graphics Editor
Priya|Nair|The New York Times|Business Reporter
Marcus|Lee|The Washington Post|Staff Writer, Climate & Environment
Ellen|Shaw|Washington Post|Copy Editor
Ravi|Kapoor|Bloomberg News|Energy Reporter
Anna|Schmidt|The Wall Street Journal|Reporter, Utilities & Power
Gloria|Mensah|Detroit Free Press|Staff Writer
Frank|Morales|E&E News|Managing Editor
Jess|Lang|Canary Media|Senior Reporter
Tamika|Owens|Grist|Staff Writer
Adam|Price|Politico|Energy Reporter
Zoe|Bennett|Heatmap News|Video Editor
Sam|Whitlow|Self-employed|Freelance Journalist
Ahmed|Saleh|DTE Energy|Grid Modernization Engineer
Kristin|Olson|Consumers Energy|Senior Grid Modernization Engineer
Kevin|Doerr|Duke Energy|Transmission Planner
Jorge|Salazar|Pacific Gas and Electric Company|Distribution Engineer
Stephanie|Wu|PG&E|Manager, Regulatory Affairs
Brandon|Hughes|Xcel Energy|Director of Resource Planning
Ayesha|Rahman|Con Edison|Senior Specialist, Customer Energy Solutions
Henrik|Dahl|Ørsted|Offshore Wind Development Manager
Travis|Cole|Sunrun|Solar Installation Supervisor
Megan|Fraser|Enbridge|Pipeline Integrity Engineer
Daniel|Obi|MISO|Market Analyst
Dean|Kowalski|Southern Company|Plant Manager
Quinn|Harlow|GridPoint Analytics|Data Analyst
Mohammed|Ali|National Grid|Grid Modernization Engineer
Paul|Grayson|Edison Electric Institute|Director, Energy Policy
Nathan|Kerr|Ford Motor Company|Battery Cell Engineer
Linda|Novak|General Motors|Plant Manager, Orion Assembly
Gary|Pruitt|The Doe Run Company|Environmental Compliance Manager
Mike|DeLuca|Turner Construction Company|Superintendent
Rick|Alvarado|Walsh Construction|Assistant Superintendent
Heather|Lamb|Skanska USA|Senior Project Manager
Yuki|Tanaka|Gensler|Project Architect
Naomi|Fischer|SmithGroup|Architect, Sustainable Design Leader
Oscar|Lindgren|Perkins&Will|Project Architect
Kyle|Morgan|Whirlpool Corporation|Heat Pump Product Engineer
Arun|Gupta|First Solar|Manufacturing Engineer
Jason|Lee|Google|Software Engineer
Vivian|Tsai|Google|Senior Program Manager, Sustainability
Rahul|Verma|Microsoft|Principal Program Manager
Chris|Evans|Microsoft|Solutions Architect
Deepa|Menon|Amazon Web Services|Solutions Architect
Tyler|Hammond|Salesforce|Account Executive
Leila|Ahmadi|Tesla|Senior Product Manager, Energy
Mateo|Silva|Stripe|Data Scientist
Jake|Thornton|Palantir Technologies|Deployment Strategist
Farah|Siddiqui|Meta|Policy Manager, Energy & Sustainability
Ellie|Warren|Uplight|Product Manager
Hugo|Martins|Arcadia|Senior Software Engineer
Gavin|McKee|WattTime|Executive Director
Anil|Kumar|IBM|Staff Software Engineer
Mira|Joshi|Oracle|Technical Writer
Sean|Kelly|Apple|Engineering Manager
Lin|Zhou|NVIDIA|AI Research Scientist
Beatrice|Owusu|Coursera|Director of University Partnerships
Nick|Moreno|Handshake|Head of University Relations
Megan|Ross|Instructure|Education Technology Consultant
Ola|Bakare|GitHub|Senior Developer Advocate
Ivan|Sokolov|Solaris Data Systems|Backend Engineer
Charles|Whitman|Goldman Sachs|Vice President, Sustainable Finance
Harriet|Gridley|J.P. Morgan|Managing Director, Energy Investment Banking
Jane|Doering|Wells Fargo|Relationship Banker
Kyle|Peterson|Morgan Stanley|Analyst
Simone|Laurent|BlackRock|Director, Infrastructure Investments
Aaron|Feld|Generate Capital|Investment Principal
Jin|Park|Brookfield Renewable|Senior Associate
Diane|Keller|Breakthrough Energy Ventures|Principal
Max|Holloway|Lower Carbon Capital|Partner
Rosa|Lin|Moody's Investors Service|Credit Analyst, Public Utilities
Omar|Khalil|Fidelity Investments|Financial Advisor
Nancy|Quinlan|State Farm|Policy Services Specialist
Tariq|Nasser|Citi|Energy Transition Research Analyst
Will|Harrington|KKR|Associate, Infrastructure
""".strip().splitlines()

# rows (by first|last) whose Position is blanked (~5%)
BLANK_POS = {'Mei Lin Zhao','Maria Gonzalez','Tyler Hammond','Kyle Peterson','Kofi Asante','Gloria Mensah','Owen McCarthy','Omar Khalil'}
BLANK_CO = {'Kyle Peterson':'','Omar Khalil':''}

NOTES = {
 'Nina Castillo': 'met at the Aspen energy forum; she funds offshore wind work',
 'Henrik Dahl': 'gave me a tour of the offshore wind port in New Bedford',
 'David Feldman': 'interviewed me about my rate design paper, happy to talk again',
 'Fatou Diallo': 'co-author on the grid resilience paper; she is the PI on our DOE grant',
 'Hannah Okafor': 'my former colleague from the Ford School, great mentor',
 'Laila Farouk': 'helped me set up the committee briefing on heat pumps',
 'Anjali Mehta': 'met at NARUC; interested in our utility bill affordability work',
 'Denise Harper': 'hired me at Clearwater',
 'Irene Kwan': 'potential funder for the offshore wind supply chain study',
 'Tom Becker': 'knows every program officer at Kresge, offered intros',
 'Omar Farah': 'ask about a joint grant on weatherization',
 'Keisha Robinson': 'introduced me to the HBCU energy fellows program',
 'Chris Evans': 'college roommate, builds building energy dashboards',
}
EXTRA_ENRICH = {'Felix Grant','Rosa Jimenez','Diego Ferreira','Samuel Adeyemi','Jamal Carter','Allison Park',
 'Gabriel Stone','Lars Eriksen','Julia Hart','Marcus Lee','Ahmed Saleh','Rebecca Stein','Jonathan Hale',
 'Sophie Lindqvist','Hana Suzuki','Colin Reed','Anna Schmidt','Rachel Goldberg','Kristin Olson','Vivian Tsai',
 'Charles Whitman','Mike DeLuca','Grace Mbeki','Derek Olsen','Pedro Alvarez','Ruth Abernathy','Emma Johansson'}
MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
rows=[]; seen=set()
for i,l in enumerate(ROWS):
    f,la,co,po = l.split('|')
    full=f'{f} {la}'
    if full in BLANK_POS: po=''
    if full in BLANK_CO: co=''
    slug=(f+'-'+la).lower().replace(' ','-').replace("'",'').replace('á','a').replace('ø','o')
    h=hashlib.md5(full.encode()).hexdigest()[:6]
    url=f'https://www.linkedin.com/in/{slug}/' if random.random()<0.35 else f'https://www.linkedin.com/in/{slug}-{h}/'
    y=random.randint(2012,2026); m=random.randint(1,12 if y<2026 else 8); d=random.randint(1,28)
    r={'_id':f'k{i+1:03d}','First Name':f,'Last Name':la,'Full Name':full,'Company':co,'Position':po,'URL':url,
       'Connected On':f'{d:02d} {MON[m-1]} {y}'}
    if full in NOTES or full in EXTRA_ENRICH:
        n=random.choice([1,2,3,4,6,9,14,22,35])
        sent=random.choice([0,0,1,2,3,5]); rec=random.choice([0,0,1,2,4])
        r['Messages']=n; r['Messages Sent']=sent; r['Messages Received']=rec
        ly=random.randint(2019,2026); lm=random.randint(1,12 if ly<2026 else 9)
        r['Last Messaged']=f'{ly}-{lm:02d}-{random.randint(1,28):02d}'
        if random.random()<0.4: r['Endorsements']=random.randint(1,12)
        if random.random()<0.3: r['Invitation']=random.choice(['incoming','outgoing'])
        if random.random()<0.15: r['Recommended You']=True
    if full in NOTES: r['Note']=NOTES[full]
    assert full not in seen, full; seen.add(full)
    rows.append(r)
json.dump(rows,open(OUT+'connections.json','w'),indent=1,ensure_ascii=False)

ctx={
 "name":"Morgan Achebe-Lindqvist",
 "headline":"Senior Policy Researcher at Clearwater Energy Futures | Energy affordability, utility regulation, grid policy",
 "industry":"Non-profit Organizations",
 "positions":[
  {"company":"Clearwater Energy Futures","title":"Senior Policy Researcher","current":True},
  {"company":"University of Michigan","title":"Postdoctoral Scholar, Energy Institute","current":False},
  {"company":"Stanford University","title":"Graduate Research Fellow","current":False}],
 "schools":["Stanford University","Macalester College"],
 "skills":["Public Policy","Energy Policy","Econometrics","Utility Regulation","Stata","R","Grant Writing","Stakeholder Engagement","Survey Design","Rate Design"],
 "followedCompanies":["Energy Foundation","RMI","Canary Media","Resources for the Future","U.S. Department of Energy"],
 "appliedCompanies":["World Resources Institute"],
 "appliedTitles":["Research Director"],
 "dreamCompanies":["RMI","Energy Foundation","Resources for the Future"],
 "desiredTitles":["Director of Research","Senior Fellow"],
 "source":{"fileName":"Basic_LinkedInDataExport_09-18-2026.zip","importedAt":"2026-09-18T15:22:40.000Z"}}
json.dump(ctx,open(OUT+'context.json','w'),indent=2)

Q=[
 ("program officer","role-exact",None,"Foundation program officers (grant makers), including senior program officers."),
 ("ed","abbreviation",None,"ED = Executive Director of an organization (incl. 'E.D.'); not editors, education or deans."),
 ("pi","abbreviation",None,"PI = principal investigator leading a research lab or grant; not pipeline, capital or philanthropies."),
 ("doe","abbreviation",None,"People at the U.S. Department of Energy (DOE) or its national labs; not surnames like Doerr/Doering or Doe Run."),
 ("associate professor","seniority",None,"Tenured associate professors (incl. 'Assoc. Prof.'); assistant/full professors are adjacent seniority."),
 ("reporter new york times","role+company",None,"Reporters/correspondents at The New York Times (any company spelling, e.g. NYT)."),
 ("stanford","company-only",None,"Anyone at Stanford (Stanford University, Stanford, Stanford GSB)."),
 ("someone who covers energy for a newspaper","natural-language",None,"Journalists whose beat is energy, power or utilities at a newspaper or news outlet."),
 ("who could introduce me to a program officer at a foundation","natural-language",None,"Program officers at foundations, or foundation staff close to them (program associates, grants managers)."),
 ("postdocs","stem-plural",None,"Postdoctoral researchers (Postdoc, Postdoctoral Scholar/Fellow/Associate)."),
 ("legislative aides","stem-plural",None,"Legislative aides and assistants in legislatures; not people named Aiden."),
 ("superintendant","typo",None,"Construction superintendents (misspelled query), incl. assistant superintendents."),
 ("jounalist","typo",None,"Journalists (misspelled query): reporters, correspondents, staff writers."),
 ("utilities","domain",None,"People working at electric/gas utilities or on utility regulation (utility commissions, grid operators)."),
 ("higher education","domain",None,"People working in universities or colleges, faculty and administrators alike."),
 ("offshore wind","note",None,"People connected to offshore wind, including via the owner's own notes."),
 ("grid modernization engineer","strict",True,"Engineers whose title is grid modernization engineering; strict title-only."),
 ("chief of staff","role-exact",None,"Chiefs of staff (legislative or agency), incl. deputy chief of staff."),
]
qs=[]
for i,(t,c,s,intent) in enumerate(Q):
    q={"id":f"k{i+1:02d}","text":t,"category":c,"split":"test"}
    if s: q["strict"]=True
    q["intent"]=intent; qs.append(q)
json.dump(qs,open(OUT+'queries.json','w'),indent=2)
print(len(rows), sum(1 for r in rows if 'Messages' in r), sum(1 for r in rows if 'Note' in r), sum(1 for r in rows if not r['Position']))
