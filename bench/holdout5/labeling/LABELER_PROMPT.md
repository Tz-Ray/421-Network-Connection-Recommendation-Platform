# Holdout 5 labeling instructions

Both labelers receive this text unchanged. Work alone: do not look at another labeler's output, and do not
discuss the task with anyone.

## The task

Someone is searching their own LinkedIn connections (about 2,000 people) for whom to contact. For each search
query you get a list of candidate connections. Grade how well each candidate matches what the searcher asked
for.

The searcher runs a drone-services company. They used to fly for an airline and for the U.S. Air Force. Use
this only to understand ambiguous words. The intent text of each query is the definition of what they want,
and it takes precedence over your own reading of the query.

## What to read, and what not to read

- Read only this file and the 35 files in `pools/` (`pools/v01.md` to `pools/v35.md`). Each file holds one
  query: its id, its text, its intent, and the candidates as one JSON object per line (`id`, `title`,
  `company`, and `note` when the searcher wrote a private note about that person).
- Do not open anything else in the repository. That includes `pool_manifest.json`, `sectors.json`, the
  generator scripts, `connections.json`, any `labels_*.json` file and the `bench/` harness. Do not run any
  search, ranking or scoring code. Your grades must come from your own reading of each candidate.
- You may use general knowledge of companies and job titles (for example, that Starlink is part of SpaceX, or
  that a CFII is a flight instructor).

## Grade scale

Judge every candidate in a query's file against that query's intent. Grades:

- **3**: exactly what the searcher asked for. Right function or role, and any company, seniority or other
  constraint stated in the query is met.
- **2**: clearly relevant. Right function, but a stated constraint is only partly met (for example an adjacent
  seniority level, the right role at a different employer, or a closely related role).
- **1**: marginal. A related field, or only the company matches on a role query.
- **0**: not relevant.

How the intent's wording maps to grades: "closely related" or "adjacent" usually means 2. "Partial" means 2
when the person clearly does the asked-for job but misses one stated constraint (such as the employer), and 1
when they are only in a related field. "Marginal" means 1. "Not ..." means 0.

Rules:

- Grade topical relevance only. Ignore how close the searcher is to the person.
- Judge each candidate from its title, company and note. A blank title (`""`) is not evidence of any role:
  judge such a person from the company and the note alone. Messy or abbreviated titles count by what they
  plainly mean ("sr aerospace eng." is a senior aerospace engineer).
- A note is the searcher's own private note about that person. For note-type intents, a note can be the main
  evidence.
- Be consistent: two candidates with the same title and situation in the same query get the same grade.
- Some candidates in each file are plainly unrelated. That is expected. Grade them 0 by leaving them out.

## Output

Write one JSON file to the path you are given (`labels_A.json` or `labels_B.json` in this folder). Shape:

```json
{
  "v01": { "v0123": 3, "v0456": 1 },
  "v02": {},
  "v03": { "v0042": 2 }
}
```

- One key per query id, `v01` to `v35`, all 35 present. Use `{}` for a query where nobody is relevant.
- Inside, list only candidates with grade 1, 2 or 3 (integers). Leave grade-0 candidates out.
- Use only candidate ids that appear in that query's file.
- No comments, no other keys, valid JSON.

When you finish, report how many graded entries you wrote per query and anything in the instructions you
found ambiguous.
