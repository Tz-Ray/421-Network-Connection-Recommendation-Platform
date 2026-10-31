# Sprint 5 Report (Oct 1, 2026 to Oct 31, 2026)

GitHub: https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform

## YouTube link of Sprint 5 Video (Make this video unlisted)

Link to be added after recording.

## What's New (User Facing)

- **AI works on the live site.** AI Rerank, the AI page and the floating chat now work on
  https://connectionrecommender.web.app for allowlisted team and demo accounts. The AI goes through a free
  Cloudflare Worker that checks your sign-in and limits how many requests each person can make per day. When AI
  is switched off, the site says so instead of showing buttons that fail.
- **Saved searches and Saved Connections.** Save the current search under a title and run it again with one
  click. A star on every result saves that person to a Saved Connections panel. Both are stored in your account
  and only you can read them.
- **Ranking feedback fixes.** Search shows "Searching…" while it loads your votes. A slow AI Rerank can no
  longer replace the results of a newer search. People you mark Irrelevant move to a collapsed "Marked
  irrelevant (N)" section instead of disappearing, and you can change your vote there. The "moved up/down"
  counts now match what you see, the vote note always shows, and a double click saves one vote, not two. Your
  older votes still apply.
- **Network page and shared connection graph.** If you choose to share, you can see how many people you have
  in common with other members who also share. The Network page shows an interactive graph (you in the centre,
  other members around you, the people you share in between), the sharing controls, and a "What the database
  stores" view. The Connections page has an "In common" column and a "Most in common" sort. Only a one-way hash
  of each profile link and member display names are stored.
- **Meaning-based search.** A new switch on the Recommender (off by default) also finds people by meaning, not
  only by matching words. For example, "reliability engineering" finds a Site Reliability Engineer. Turning it
  on downloads a ~23 MB model once and runs it in your browser; your connections never leave it. The page says
  this before you turn it on.

## Work Summary (Developer Facing)

The two of us split the sprint about evenly. Alan Qiu fixed the seven ranking feedback defects found at the end
of Sprint 4, brought the chat widget and AI Rerank to the live site through the free Cloudflare AI proxy, which he
co-owned, and co-owned the CI and AI-proxy integration tests and the UI redesign direction; he also presented the
Sprint 5 plan to the client on Oct 6. Tz-Ray Wang built saved searches and Saved Connections, the shared connection graph and Network page,
and meaning-based search with its ranking benchmark, co-owned the Cloudflare AI proxy, prototyped SQL insights,
and wrote the minutes and reports. The biggest barrier was cost. The plan called for hosting the AI proxy on
Cloud Run, but that needs Google's paid Blaze plan and the project uses no paid plans. We moved the proxy to a
free Cloudflare Worker with the same contract as our local proxy, so the AI features work the same against either one. The
Gemini free tier allows only 20 requests per model per day, so we added an access switch (off, allowlist,
public), per-user and shared daily limits stored in a Durable Object, a fallback model, and a mock mode so tests
spend no quota. A second barrier was size: a 23 MB embedding model does not belong in a normal page load, so
meaning-based search is off by default, says what it will download, runs in a Web Worker, and loads its runtime
from a CDN instead of adding 27 MB to our bundle. A third was privacy: showing common connections without a
server could leak who knows whom, so sharing is opt-in, only hashed profile links are stored, and the
Firestore rules let you read a person's record only if you are on it. We learned to write an end-to-end check
with each feature, run it before merging, and run it before and after every deploy: the check for saved searches
caught a bug before it was committed.

Planned deliverables (from [reports/plans/cpts423-sprint-4-6-deliverables.pdf](../plans/cpts423-sprint-4-6-deliverables.pdf), pages 3-4):

| Deliverable | Owner | Status | Evidence |
|---|---|---|---|
| Production Cloud Deployment | Alan Qiu and Tz-Ray Wang | Done, on a different platform: the frontend is on Firebase Hosting and the AI proxy on a free Cloudflare Worker (deployed Oct 15) instead of Cloud Run, which needs a paid plan. The hosted build points at the Worker, so nothing depends on localhost. AI is limited to allowlisted accounts because of the Gemini free tier. | `8cb260f`, [#64](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/64); last Hosting deploy Oct 27 (`73da212`) |
| Account Registration & Data Isolation | Tz-Ray Wang | Done. Email/password and Google sign-in, password reset, and sessions that survive a reload. Connections, saved searches, favorites and votes are readable only by their owner. | 62 Firestore rules tests on the emulator, including cross-account isolation |
| Recommendation Chat Widget | Alan Qiu | Done. A floating widget on every signed-in page answers plain-language questions from your own connections, keeps the last 8 messages as context, and works alongside Search. It works on the live site for allowlisted accounts. | `components/ChatWidget.tsx`; `8cb260f` |
| Scale & Stability Validation | Alan Qiu and Tz-Ray Wang | Mostly done. Synthetic networks of 820, 1,050 and 1,450 connections import and search without errors. The ranker takes 8-15 ms warm at 30,000 rows. Meaning-based search on 1,450 rows takes 17.5 s the first time and 60-110 ms after that. The seven feedback defects (#54-#60) were fixed with a regression check. Not done: a formal concurrent-load test of chat and search. | `testdata/generator/generate.mjs`; `9c33c0c` |
| Saved searches and bookmarking (moved from Sprint 4) | Tz-Ray Wang | Done | `9c33c0c`, [#53](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/53) |
| AI profile enrichment pipeline (moved from Sprint 4) | Alan Qiu | Not done; moved to Sprint 6 for a decision | [#52](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/52) |

Testing (run on Oct 31, 2026 unless noted; all passed):

| Level | What | Result |
|---|---|---|
| Static | TypeScript type check and production build | pass |
| Unit / data | `testdata/tests`: importer answers on 20 synthetic networks | 286/286 |
| Unit | Meaning-based search (`lib/semantic/*.test.ts`) | 19/19 |
| Unit (local suites) | Ranker, ranking invariants, graph view model | 196/196 |
| Integration | Cloudflare Worker on local workerd with a real Firebase sign-in: auth, CORS, body size cap, access switch, rate limits that survive a restart | 24/24 |
| Integration | Node AI proxy with mock Gemini: tokens, origins, limits, response shapes | 24/24 |
| Integration | Firestore security rules on the emulator, including cross-account isolation and the graph rules | 62/62 |
| System (live site) | End-to-end browser run on https://connectionrecommender.web.app: login, zip upload (42 connections, 14 files), confirm and save, search, meaning-based search (24/24 checks), a vote moves a person up, connections, dashboard | 8/8 steps, 0 console errors |
| System (live site) | Saved searches and Saved Connections | pass |
| Performance | Meaning-based search on the live site: ready in 7.9 s the first time, warm search 0.8 s; 1,450 rows 17.5 s cold, 60-110 ms warm (Oct 27) | recorded |
| Quality | Ranking benchmark NDCG@10, dev set (24 queries) | 0.994 |
| User testing | The client has tried the live website. In the meetings, the client liked the demo and the new features (Oct 6) and called the Oct 27 update "a good update". The new UI designs (#62) are not live and have not been reviewed by the client. | — |

**Responsible use of generative AI.** The team used Claude Code (Anthropic) as a coding and documentation
assistant: drafting code and tests, reviewing changes, drafting minutes from our own notes, and drafting reports
and slides. In the product, Gemini 2.5 Flash reranks results and answers chat questions; it receives only
short, capped summaries, never message text, notes or the user's name, and it is off unless the access switch
allows it. Every change runs the type check, the test suites and the end-to-end browser check before commit, and
a privacy scan runs before every push. We saw the limits of AI help: AI-tuned ranking looked near-perfect on its
tuning set (0.994) but scored 0.687 on a blind network in Sprint 4; an AI-written change stored "(no name)"
favorites and was caught by the end-to-end check; and the benchmark's relevance labels are AI-made, which
`bench/README.md` states. The team reviews, tests and decides, and all deliverables are our responsibility.

## Unfinished Work

- **AI profile enrichment pipeline** ([#52](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/52), Alan Qiu) was not built. Enriching hundreds of
  profiles with Gemini does not fit the free tier's 20 requests per model per day. The LinkedIn export import
  and meaning-based search address the same missing-title problem in the browser. It moves to Sprint 6 for a
  decision.
- **Concurrent-load test.** Scale was checked on synthetic networks of up to 1,450 connections, but there is no
  formal test of many users running chat and search at the same time.
- **CI and AI-proxy integration tests** ([#65](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/65)) are on the `experimental/ci` branch. The 24 proxy
  tests pass, but the CI workflow file is not pushed yet.
- **SQL insights screen** ([#67](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/67)) is a prototype on the `experimental/sql-insights` branch with
  62 passing tests. It is not on the live site.
- **UI redesign** ([#62](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/62)): new designs exist, but no direction is chosen yet. They are not live
  and the client has not reviewed them.

## Completed Issues/User Stories

Here are links to the issues that we completed in this sprint:

- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/53 - Add Saved Searches and Connection Bookmarking
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/54 - Show a Loading State While Search Awaits Ranking Feedback
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/55 - Fix Race Where a Slow AI Rerank Overwrites a Newer Search
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/56 - Fix Irrelevant-Voted Rows Disappearing from Search Results
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/57 - Fix Moved Up/Down Counts to Reflect Visible Results, Not the Pool
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/58 - Fix Vote Note Hidden by the Eight-Reason Display Cap
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/59 - Fix Weak URL Normalization in candidateIdFor Causing Mismatched Votes
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/60 - Add In-Flight Guard to Stop Duplicate Ranking Telemetry Writes
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/61 - Add a Shared Graph of Common Connections Across Users
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/64 - Host the AI Proxy on a Free Cloudflare Worker for Demo Days
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/66 - Prototype On-Device Semantic Search with a Reproducible Ranking Benchmark

## Incomplete Issues/User Stories

Here are links to issues we worked on but did not complete in this sprint:

- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/52 - Add AI Profile Enrichment Pipeline for Missing Industry and Summary Fields: enriching hundreds of profiles with Gemini does not fit the free tier's 20 requests per model per day, so it moves to Sprint 6 for a decision.
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/65 - Add GitHub Actions CI and AI Proxy Integration Tests: the tests pass on the `experimental/ci` branch, but the workflow file is not pushed yet.
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/67 - Prototype an In-Browser SQL Insights Screen: the prototype works on the `experimental/sql-insights` branch but is an experiment, not a planned deliverable, and is not on the live site.
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/62 - Choose a Direction for the Website UI Redesign: designs exist, but the client has not reviewed them and no direction is chosen; it is in the Backlog for Sprint 6.
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/63 - Review and Adopt Automated Tests for the Network Page and Meaning-Based Search: the tests have not been reviewed and adopted yet; it is in the Backlog for Sprint 6.
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/28 - Research CSV Profile Enhancement Workflow: we replaced scraping with importing the user's own LinkedIn export, but the research on automated public-profile lookup that this issue asks for was not done.
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/29 - Refine AI Recommendation Response Formatting: AI replies now show on the live site for allowlisted accounts, but the formatting has not yet been reviewed with live Gemini replies.
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/30 - Improve Matching Accuracy for Incomplete Connection Data: meaning-based search helps, but with it off a row that matches nothing in the query still scores 0 and is dropped (`lib/search.ts`), and with it on only up to 10 dropped rows whose title and company are close in meaning are added back, so a row with no title and no company still never appears.

## Code Files for Review

Please review the following code files, which were actively developed during this sprint, for quality:

- [lib/telemetry.ts](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/blob/main/lib/telemetry.ts) - ranking feedback votes with stable person ids from normalized profile links.
- [lib/savedItems.ts](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/blob/main/lib/savedItems.ts) - reads and writes saved searches and Saved Connections.
- [components/SavedSearches.tsx](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/blob/main/components/SavedSearches.tsx) - the saved searches panel on the Recommender.
- [lib/networkGraph.ts](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/blob/main/lib/networkGraph.ts) - opt-in sharing, sync and common-connection counts for the shared graph.
- [screens/NetworkScreen.tsx](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/blob/main/screens/NetworkScreen.tsx) - the Network page: sharing controls, interactive graph and stored-data view.
- [lib/semantic/semanticRank.ts](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/blob/main/lib/semantic/semanticRank.ts) - runs the keyword ranker, embeds rows and the query, and combines the two.
- [lib/semantic/fusion.ts](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/blob/main/lib/semantic/fusion.ts) - how meaning scores reorder and add results.
- [worker/src/index.js](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/blob/main/worker/src/index.js) - the Cloudflare Worker AI proxy: routing, CORS, sign-in check and access switch.

## Retrospective Summary

Here's what went well:

- AI now works on the live site at no cost.
- Three new features shipped to the live site: saved searches with Saved Connections, the Network page, and
  meaning-based search.
- Automated testing at every level: unit, integration, security rules and end-to-end runs on the live site.
- The client found our weekly email updates very helpful.

Here's what we'd like to improve:

- The AI enrichment deliverable slipped twice.
- Issues were opened and closed in batches instead of as the work happened.
- There is no formal concurrent-load test.
- The client has not reviewed the new UI.

Here are changes we plan to implement in the next sprint:

- Open and close issues as the work happens.
- Show a demo every week.
- Schedule a client test session on the live site.
- Time-box new ideas such as the Chrome extension: Sprint 6 only, and only if the core work is done.
