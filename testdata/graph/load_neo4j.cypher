// Neo4j loader for testdata/graph/*.csv (Neo4j 5.x).
// 1. Copy the CSV files in this folder into the database's import/ directory.
// 2. Run: cypher-shell -u neo4j -p <password> -f load_neo4j.cypher
// Empty CSV fields load as null. Dates are ISO (YYYY-MM-DD).

CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.personId IS UNIQUE;
CREATE CONSTRAINT company_id IF NOT EXISTS FOR (c:Company) REQUIRE c.companyId IS UNIQUE;
CREATE CONSTRAINT school_id IF NOT EXISTS FOR (s:School) REQUIRE s.schoolId IS UNIQUE;

LOAD CSV WITH HEADERS FROM 'file:///people.csv' AS row
MERGE (p:Person {personId: row.personId})
SET p.firstName = row.firstName, p.lastName = row.lastName, p.fullName = row.fullName,
    p.url = row.url, p.slug = row.slug, p.homeCommunity = row.homeCommunity,
    p.secondCommunity = row.secondCommunity, p.functionId = row.functionId,
    p.seniorityId = row.seniorityId, p.industryId = row.industryId,
    p.currentCompanyId = row.currentCompanyId, p.currentTitle = row.currentTitle,
    p.location = row.location, p.email = row.email, p.isOwner = (row.isOwner = 'true'),
    p.exportsAppearingIn = toInteger(row.exportsAppearingIn);

LOAD CSV WITH HEADERS FROM 'file:///companies.csv' AS row
MERGE (c:Company {companyId: row.companyId})
SET c.name = row.name, c.industryId = row.industryId, c.industryName = row.industryName,
    c.size = row.size, c.communities = split(row.communities, ';'), c.generic = (row.generic = 'true');

LOAD CSV WITH HEADERS FROM 'file:///schools.csv' AS row
MERGE (s:School {schoolId: row.schoolId})
SET s.name = row.name, s.communities = split(row.communities, ';');

LOAD CSV WITH HEADERS FROM 'file:///owners.csv' AS row
MATCH (p:Person {personId: row.personId})
SET p:Owner, p.datasetId = row.datasetId, p.datasetFormat = row.format,
    p.exportDate = date(row.exportDate), p.datasetFile = row.file;

LOAD CSV WITH HEADERS FROM 'file:///edges_connected.csv' AS row
MATCH (a:Person {personId: row.sourcePersonId}), (b:Person {personId: row.targetPersonId})
CREATE (a)-[:CONNECTED_TO {connectedOn: date(row.connectedOn), datasetId: row.datasetId}]->(b);

LOAD CSV WITH HEADERS FROM 'file:///edges_employment.csv' AS row
MATCH (p:Person {personId: row.personId}), (c:Company {companyId: row.companyId})
CREATE (p)-[:WORKED_AT {companyName: row.companyName, title: row.title, startDate: date(row.startDate),
  endDate: CASE WHEN row.endDate IS NULL OR row.endDate = '' THEN null ELSE date(row.endDate) END}]->(c);

LOAD CSV WITH HEADERS FROM 'file:///edges_education.csv' AS row
MATCH (p:Person {personId: row.personId}), (s:School {schoolId: row.schoolId})
CREATE (p)-[:STUDIED_AT {degree: row.degree, startYear: toInteger(row.startYear), endYear: toInteger(row.endYear)}]->(s);

LOAD CSV WITH HEADERS FROM 'file:///edges_messaged.csv' AS row
MATCH (o:Person {personId: row.ownerPersonId}), (p:Person {personId: row.personId})
CREATE (o)-[:MESSAGED {datasetId: row.datasetId, messageCount: toInteger(row.messageCount),
  messagesSent: toInteger(row.messagesSent), messagesReceived: toInteger(row.messagesReceived),
  firstMessagedAt: date(row.firstMessagedAt), lastMessagedAt: date(row.lastMessagedAt)}]->(p);

LOAD CSV WITH HEADERS FROM 'file:///edges_endorsed.csv' AS row
MATCH (e:Person {personId: row.endorserPersonId}), (o:Person {personId: row.endorseePersonId})
CREATE (e)-[:ENDORSED {datasetId: row.datasetId, skill: row.skill, endorsedOn: date(row.endorsedOn),
  status: row.status, countedByImporter: (row.countedByImporter = 'true')}]->(o);

// Example checks against expected_graph.json:
// Mutual connections of two owners (ownerPairs[].mutualConnections):
//   MATCH (a:Owner {datasetId: 'N01'})-[:CONNECTED_TO]->(m)<-[:CONNECTED_TO]-(b:Owner {datasetId: 'C01'})
//   RETURN count(DISTINCT m);
// Hops between owners (shortestPaths[].hops), ignoring direction:
//   MATCH (a:Owner {datasetId: 'N01'}), (b:Owner {datasetId: 'N05'})
//   MATCH p = shortestPath((a)-[:CONNECTED_TO*..10]-(b)) RETURN length(p);
