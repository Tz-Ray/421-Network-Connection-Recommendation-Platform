# Sprint 3 Report 3/24 to 5/1

GitHub: https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform

## What's New (User Facing)
We added the core connection recommendation workflow. Users can now upload a LinkedIn-style CSV file, preview the loaded connections, confirm the imported network, enter search criteria, and receive ranked connection recommendations. The Recommender page now includes basic local matching, job-title alias support, weak-match labeling, AI-assisted reranking, and explanations for why each person was recommended. A separate AI tab was also added so users can chat with their loaded network and request intro recommendations in natural language. Authentication and navigation behavior were also improved, including login/logout flow fixes, protected route handling, dashboard sidebar routing, and smoother movement between Dashboard, Recommender, and AI sections.

## Work Summary (Developer Facing)
During this sprint, the team moved the project from a mostly static dashboard prototype toward a functional MVP centered on connection search and recommendation. We implemented CSV ingestion for LinkedIn-style exports, handled messy CSV structures such as missing titles and incomplete fields, created a local ranking system using title/company matching and aliases, and integrated a local Gemini proxy so AI functionality could work without exposing the API key in the frontend. A major challenge was dealing with sparse or low-quality CSV data, especially rows with blank Position fields, which made recommendation quality difficult when only company names were available. We also learned that AI should not be treated as a replacement for missing data; instead, it works best as a reranker and explanation layer on top of local retrieval. Several iterations were spent improving the UI output, cleaning AI responses, preventing raw JSON from showing to users, and making the recommendation behavior more transparent.

## Unfinished Work
Some recommendation-quality work remains unfinished because the current matcher is still limited by the completeness of the uploaded CSV data, especially when many rows have blank or incomplete Position fields. AI reranking and the AI chat workflow are functional in the development environment, but they still need more refinement around consistent response formatting, stronger prompts, cleaner explanations, and more reliable production deployment. The team also identified CSV enrichment as an important next step but did not complete it during this sprint; the planned direction is to explore local browser automation with tools such as Playwright or Puppeteer to search public snippets using a connection’s name and company, then parse that information into additional fields such as title, role keywords, location, or education.


## Completed Issues/User Stories
Here are links to the issues that we completed in this sprint:

https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/25
https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/26
https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/27

 ## Incomplete Issues/User Stories
 Here are links to issues we worked on but did not complete in this sprint:
 
https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/28 - Tooling still undecided.
https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/29 - Requires more testing.
https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/issues/30 - CSV data is sparse, requires searching for more accurate data.
 

## Code Files for Review
Please review the following code files, which were actively developed during this sprint, for quality:
https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/blob/main/screens/ProfileScreen.tsx
https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/blob/main/ProtectedRoute.tsx
https://github.com/Tz-Ray/421-Network-Connection-Recommendation-Platform/blob/main/components/ChatWidget.tsx
 
## Retrospective Summary
Here's what went well:
Core CSV upload and recommendation workflow was implemented.
Authentication, logout, and sidebar routing became more stable.
Gemini AI integration was added through a local proxy for safer development.
 
Here's what we'd like to improve:
Improve recommendation quality for incomplete CSV data.
Make AI responses and explanations cleaner and more consistent.
Polish the UI for the Recommender and AI tab.
  
Here are changes we plan to implement in the next sprint:
Explore CSV enrichment using local browser automation.
Add better semantic role classification and aliases.
Add user-editable tags or notes to improve matching accuracy.