# Project Tracking

_Last updated: 2025-10-01_

## Summary
- **Total Story Points:** 37
- **Completed Story Points:** 35
- **In-Progress Story Points:** 0
- **Remaining Story Points:** 2
- **Progress:** 94.6%

_Update this section whenever task status or story points change to keep progress accurate._

## Milestone A – Foundations
| ID | Task | Story Points | Status | Notes |
| --- | --- | --- | --- | --- |
| A1 | Clarify solution requirements and success criteria. | 1 | ✅ Done | Requirements confirmed with user (Next.js 14, S3 sync, JSON rewrite). |
| A2 | Scaffold Next.js 14 App Router TypeScript project. | 3 | ✅ Done | `npx create-next-app@latest . --ts --app --eslint --tailwind --use-npm --yes` |
| A3 | Capture configuration strategy for S3-compatible storage (env management, bucket naming, IAM). | 3 | ✅ Done | `.env` contract enforced via `lib/env.ts`; README documents required variables. |

## Milestone B – Data Pipeline
| ID | Task | Story Points | Status | Notes |
| --- | --- | --- | --- | --- |
| B1 | Build JSON ingestion utility validating against BotC script schema. | 5 | ✅ Done | `lib/processScript.ts` parses, validates, and collects assets using official schema. |
| B2 | Implement image discovery & download for every referenced asset. | 5 | ✅ Done | Traverses characters/meta, fetches assets with error handling. |
| B3 | Upload images to S3-compatible bucket with friendly naming convention. | 8 | ✅ Done | Storage adapter handles S3 uploads and local fallback with `Script_Name_UID/Character_Name_Alignment.ext` pattern. |
| B4 | Rewrite script JSON with localized asset URLs and persist metadata snapshot. | 3 | ✅ Done | Saves original/rewritten scripts and manifest to S3. |
| B5 | Add optional US proxy download mode to bypass geo-blocked hosts. | 2 | ✅ Done | Fetches random US HTTP proxy from Proxifly list and exposes UI toggle. |

## Milestone C – Experience & Quality
| ID | Task | Story Points | Status | Notes |
| --- | --- | --- | --- | --- |
| C1 | Create UI flow to upload script, trigger processing, and display results. | 3 | ✅ Done | Client-side form with summary table and JSON preview. |
| C2 | Implement automated tests (unit + integration) covering ingestion and S3 sync. | 2 | ⏳ To Do | Include mocked S3 client and schema fixtures. |
| C3 | Author user-facing docs and operational runbook. | 2 | ✅ Done | README updated with end-to-end workflow guidance. |

---

### How to Use This Tracker
1. Update the **Status** column as tasks progress: use `To Do`, `In Progress`, or `Done`.
2. Adjust **Story Points** if estimates change, then recompute the summary totals above.
3. Add new rows (and optionally new milestones) for emerging work.
4. Keep timestamps of updates to maintain history.

### Progress Calculation Template
When updating, compute:
- `Completed Points = Σ(points where Status = Done)`
- `In-Progress Points = Σ(points where Status = In Progress)`
- `Progress % = (Completed Points / Total Points) × 100`

Maintain this document alongside pull requests to preserve live visibility into project health.
