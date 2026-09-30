# Sprint 4 Report (Aug 27, 2026 to Sep 30, 2026)

GitHub: https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform

## YouTube link of Sprint 4 Video

Link to be added.

## What's New (User Facing)

- **Full LinkedIn export import.** The Recommender now accepts the `.zip` from LinkedIn's "Get a copy of your
  data", as well as `Connections.csv` and JSON. The zip is opened in the browser and only 14 allowlisted files
  are read. An import summary shows the files used, how many connections each matched, warnings and the
  skipped files. Message text is never kept, only counts and dates.
- **Ranking by relationship strength.** Among equally good matches, people you know better rank higher
  (recent and two-way messages, shared employers, target companies, endorsements, recommendations). Result
  cards show chips such as `12 msgs · Aug 2026` or `Former colleague`. The Connections page has Messages and
  Last contact columns and a "Warmest first" sort; the Dashboard has a "Messaged in the last 12 months" tile.
- **A smarter search.** Search now reads titles by meaning: whole words only, abbreviations and acronyms,
  related roles, industries, company name variants and typo repair. Each result says what kind of match it
  was.
- **Relevant / Irrelevant feedback.** Each result card has two vote buttons. Your votes are saved per search,
  and the next Search or AI Rerank for that query puts relevant people first and irrelevant people last.
- **Your connections are saved to your account.** Confirmed uploads are stored in Firestore. A new
  Connections page lists them, and "Use in Recommender" loads them back without re-uploading.
- **A real Dashboard.** Connections saved, the share missing a title, distinct companies, a Top companies
  chart and your five most recent connections, all from your saved data.
- **Password reset.** "Forgot Password?" on the login screen sends a reset email, and the app has its own
  reset-password page.
- **Smoother sign-in.** No "Verifying Session…" flash between pages, and sign-in errors are readable
  messages instead of Firebase codes.
- **Clearer AI output.** The chat bubble lists recommended people by name, role and company instead of
  internal ids.
- **Hosted app notice.** On https://connectionrecommender.web.app the AI features are switched off, and every
  AI surface says so.

## Work Summary (Developer Facing)

The sprint had 15 commits. It opened by merging Alan Qiu's Sprint 3 profile screen and chat widget (`ed03e2d`)
into the new Firestore work. Alan Qiu built ranking feedback (`2d90f8b`); Tz-Ray Wang built the Firestore
storage, the export import, relationship ranking and the ranker rewrite. The first half hardened what Sprint 3 left:
connections moved from the browser session into Firestore, the app got a single auth provider, and the AI
proxy now requires a Firebase sign-in, rate-limits each user and allows only known origins. The main barrier
from Sprint 3 was sparse data: many exported rows have a blank title. Instead of scraping public profiles, we
import the user's own full LinkedIn export, which adds real relationship facts per connection while keeping
only derived counts and dates. A second barrier was Gemini itself. Gemini 2.5's "thinking" tokens used up the
output budget and cut rerank replies off, and the free tier allows 20 requests per model per day. We turned
thinking off for JSON replies, added quota-aware retries and an optional fallback model, and added a mock mode
for testing. Because the project uses no paid plans, the proxy cannot be hosted on Firebase or Google Cloud,
so the hosted app is built with AI switched off. We rewrote the local ranker and measured it with NDCG@10 on
labelled sample networks, tuning on one set and checking on held-out sets. The biggest lesson was that scores
on the tuning set overstate real quality: the ranker went from 0.610 to 0.980 on the tuning set, but only from
0.590 to 0.687 on a blind held-out network. We also added shared synthetic test data so the importer can be
tested against known answers.

Planned deliverables (from [reports/plans/cpts423-sprint-4-6-deliverables.pdf](../plans/cpts423-sprint-4-6-deliverables.pdf)):

| Deliverable | Owner | Status | Evidence |
|---|---|---|---|
| 1. Basic AI Profile Pipeline | Alan Qiu | Not started; moved to Sprint 5 | No code; [#52](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/52) |
| 2. Saved Search History and Connection Bookmarking | Tz-Ray Wang | Not started; moved to Sprint 5 | No code; [#53](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/53) |
| 3. Ranking Feedback and Tuning | Both | Done | Feedback: `2d90f8b` (#50). Tuning: ranker rewrite `0ecec47` (#49); benchmark below |

Ranker benchmark, NDCG@10, old ranker to new ranker (`0ecec47`):

| Benchmark set | Old | New |
|---|---|---|
| Tuning set (dev) | 0.610 | 0.980 |
| Holdout 2 | 0.447 | 0.926 |
| Holdout 3 | 0.516 | 0.912 |
| Holdout 4 (clean, blind) | 0.590 | 0.687 |

The benchmark scripts and the ranking unit tests are not in the repository. The tests in the repository are
the test-data tests: `node --test testdata/tests/*.test.ts` runs 286 tests, all passing.

## Unfinished Work

- **AI Profile Pipeline** (planned deliverable 1, [#52](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/52)) and **Saved Search History and Connection
  Bookmarking** (planned deliverable 2, [#53](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/53)) were not started. The sprint's time went to the full
  LinkedIn export import, relationship ranking and the ranker rewrite (#41, #42, #49), which attack the same
  sparse-profile-data problem locally. Both move to Sprint 5. The planned client review (run a query, save the
  criteria, star two profiles) needs deliverable 2, so it could not be run as planned.
- **Ranking feedback defects** found while testing #50, all open for Sprint 5:
  - [#54](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/54) Search waits on a Firestore read of the user's votes and shows no loading state.
  - [#55](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/55) A slow AI Rerank can overwrite the results of a newer Search.
  - [#56](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/56) An Irrelevant vote usually hides the row instead of moving it last.
  - [#57](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/57) The "moved N up and N down" counts cover the whole 50-row pool, not just the 10 shown.
  - [#58](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/58) The vote's reason line can fall past the 8-reason display cap.
  - [#59](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/59) The candidate id uses weak URL normalization, and rows without a URL that share a name and
    company collide.
  - [#60](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/60) A double click writes two feedback log entries.
- **Hosting is behind.** https://connectionrecommender.web.app runs the `bfbdc15` build, with AI switched off
  (`VITE_AI_PROXY_URL=off`) because the project uses no paid plans and hosting the proxy on Firebase or Google
  Cloud needs one. The new ranker (`0ecec47`) and ranking feedback (`2d90f8b`) are not deployed there yet.

## Completed Issues/User Stories

Here are links to the issues that we completed in this sprint:

- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/9 - Forgot password/Reset password
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/15 - Reorganize github structure
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/31 - Save Imported Connections to Firestore and Add a Connections Page
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/32 - Use a Single Auth Provider and Show Clear Sign-in Errors
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/33 - Fix Truncated AI Rerank Replies and Return Proper Proxy Errors
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/34 - Fix the Cloud Functions Build and Keep the Gemini Key Out of the Client Bundle
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/35 - Fix Stale Data Loads and Cached Connections After Logout
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/36 - Fix Chat Widget Proxy URL and Early Messages, and the Profile Avatar
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/37 - Require Sign-in, Rate Limits and an Origin Allowlist on the AI Proxy
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/38 - Show Real Connection Data on the Dashboard
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/39 - Complete the README and Replace Template Copy
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/40 - Add a License and Fix Repository Metadata and Broken Report Links
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/41 - Import the Full LinkedIn Data Export (.zip)
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/42 - Rank Connections by Relationship Strength
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/43 - Allow a Production Build with AI Turned Off
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/44 - Show Names Instead of Candidate IDs in AI Answers
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/45 - Fix Dashboard Chart Label and Button Clipping
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/46 - Explain That AI Features Are Unavailable on the Hosted App
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/47 - Add Developer Setup Docs: .env.example and Server and Functions READMEs
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/48 - Make the Fallback AI Model Optional and Clean Up Chat Recommendations
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/49 - Rewrite the Local Search Ranker Around Query and Title Meaning
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/50 - Add Relevant / Irrelevant Feedback That Reorders Search Results
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/51 - Add Shared Test Data: 20 Interlinked Sample LinkedIn Networks

## Incomplete Issues/User Stories

Here are links to issues we worked on but did not complete in this sprint:

- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/28 - Research CSV Profile Enhancement Workflow: we replaced scraping with importing the user's own LinkedIn export (#41, #42), but the research on automated public-profile lookup that this issue asks for was not done.
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/29 - Refine AI Recommendation Response Formatting: improved by #33, #44 and #48, but left open until the formatting is reviewed with live Gemini replies, which the hosted app cannot show because AI is off there.
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/30 - Improve Matching Accuracy for Incomplete Connection Data: the ranker rewrite (#49) and export import (#41) help, but a row that matches nothing in the query still scores 0 and is dropped (`lib/search.ts`), so rows with a missing title can stay invisible.
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/52 - AI profile enrichment pipeline (Alan Qiu): planned for Sprint 4 but not started; moved to Sprint 5.
- https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/53 - Saved searches and connection bookmarking (Tz-Ray Wang): planned for Sprint 4 but not started; moved to Sprint 5.

## Code Files for Review

Please review the following code files, which were actively developed during this sprint, for quality:

- [lib/linkedinExport.ts](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/blob/main/lib/linkedinExport.ts) - reads the LinkedIn export zip in the browser and joins its files to connections.
- [lib/relationship.ts](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/blob/main/lib/relationship.ts) - relationship bonus, chips and the privacy-limited AI summary.
- [lib/search.ts](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/blob/main/lib/search.ts) - the rewritten local ranker shared by Search and AI Rerank.
- [lib/telemetry.ts](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/blob/main/lib/telemetry.ts) - writes and reads ranking feedback votes.
- [screens/RecommenderScreen.tsx](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/blob/main/screens/RecommenderScreen.tsx) - upload, import summary, search, AI Rerank and vote handling.
- [server/index.js](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/blob/main/server/index.js) - the AI proxy: sign-in check, rate limits, Gemini calls and fallbacks.

## Retrospective Summary

Here's what went well:

- We solved the sparse-data problem from Sprint 3 with the user's own LinkedIn export instead of scraping,
  and without storing message text.
- The ranker rewrite was measured, not guessed: NDCG@10 rose on the tuning set and on all three held-out
  networks.
- Ranking feedback (planned deliverable 3) shipped with Firestore rules that validate every field.
- The AI proxy is now protected by sign-in, per-user rate limits and an origin allowlist.
- Shared synthetic test data (286 passing tests) gives both of us the same known-answer data.

Here's what we'd like to improve:

- Two of the three planned deliverables were not started, because the export import, relationship ranking
  and ranker rewrite (#41, #42, #49) took the sprint's time.
- Held-out quality (0.687 NDCG@10 on the blind network) is far below the tuning score (0.980).
- Testing ranking feedback after it shipped found seven follow-up fixes; testing it before merging would
  catch these earlier.
- The hosted app is behind the code and has no AI features.

Here are changes we plan to implement in the next sprint:

- Build the AI profile pipeline ([#52](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/52)) and saved searches with bookmarking ([#53](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/53)), and run the
  client review they enable.
- Fix the seven ranking feedback defects ([#54](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/54) to [#60](https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/60)).
- Redeploy Hosting so the live app has the new ranker and ranking feedback.
- Fill in the Sprint 5 and 6 goals in the plan and review progress against it mid-sprint.
- Open an issue for each deliverable at the start of the sprint, so progress is tracked on the board as it
  happens.
