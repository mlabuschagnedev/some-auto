# MSS SoME-Auto System Overview

## 1. What This System Is

MSS SoME-Auto is a planner-first social media operations platform. It is meant to manage the full workflow around content planning, creative production, approvals, scheduling, publishing, diagnostics, analytics, and reporting.

It is not just a "type a caption and post it" tool. Its stronger purpose is to become the internal control layer between:

- business requests
- monthly content planning
- designers and creative production
- approvals and readiness states
- scheduled publishing
- live provider integrations
- manual LinkedIn completion
- analytics and management reporting
- historical reference

In practical terms, it gives the business one workspace where pages, social accounts, planner rows, media files, scheduled posts, platform rules, warnings, permissions, insight snapshots, and report outputs stay connected.

## 2. Product Goal

The goal is to turn social media execution into a managed production system instead of a loose mix of spreadsheets, chats, folders, and last-minute reminders.

The business outcome is:

- content is planned early and grouped by page and month
- designers can see what has to be produced
- managers can see what is incomplete, ready, queued, posted, or failed
- scheduling and publishing are controlled
- platform-specific problems are caught before publish time
- historical campaign work remains useful
- analytics and reporting are tied back to actual page and post records
- access is controlled through app roles instead of shared credentials

## 3. Core Philosophy

### Planner-first operation

The planner is the source of truth. Normal posts begin as PlanningRows and move into Post records only when they are scheduled or published from the planner.

### Page-centric management

Everything starts from a Page. A page represents a client, brand, branch, or business presence. Accounts, planner sheets, settings, reference sheets, posts, history, and analytics all attach to page-level work.

### Safe-by-default publishing

The app defaults to simulated publishing. Live posting is controlled by `live_posting_enabled` globally or per page.

### Hybrid automation

The app automates providers where the path is practical, and it models human work explicitly where platform approval or process limitations still require it. LinkedIn manual assist is the clearest example.

### Operational memory

Planning is month-based and old rows remain available. The system becomes a memory bank for previous campaigns, recurring client requests, copy approaches, and design notes.

## 4. High-Level Architecture

The development app is a monolithic web application with separated internal layers.

### Backend

The backend is Flask. It exposes JSON API blueprints, handles auth, stores operational data through SQLAlchemy, runs background jobs, validates media, coordinates integrations, and serves frontend assets.

### Frontend

The current frontend is React + TypeScript + Vite. The workspace includes dashboard, projects/pages, planner, analytics, activity, notifications, settings, help, modal workflows, data tables, filters, charts, upload flows, and composer/crop tooling.

### Database

PostgreSQL is the normal database. SQLite is blocked by default and only available for explicit isolated tests with `ALLOW_SQLITE_FOR_TESTS=1`.

### Background scheduler

APScheduler runs inside the app process and handles:

- due-post processing every 30 seconds
- planner warning emails
- auto-scheduling planner rows near their target time
- Facebook native scheduled-post handoff and state sync
- token health checks and token refresh
- orphaned upload pruning
- scheduled Facebook/Instagram social-insight refresh

### Storage

Uploads are stored locally under `uploads/`. The app can serve them directly or create signed temporary public URLs for providers that need fetchable media.

### Public media access

Cloudflare tunnel scripts support local operation where Instagram, Pinterest, or report assets need public media access.

## 5. Technical Stack

- Flask
- Flask-JWT-Extended
- Flask-SQLAlchemy
- PostgreSQL through `psycopg`
- APScheduler
- requests and requests-oauthlib
- Pillow
- openpyxl
- Google API client and Google Auth
- React 19
- TypeScript
- Vite

## 6. Core Data Model

### Page

A Page is the top-level business unit. It stores name, description, image path, LinkedIn page URL, social accounts, planning sheet, posts, and page-level settings.

### SocialAccount

A SocialAccount stores a platform connection for a page: platform, account name, tokens, API keys, external IDs, expiry metadata, test status, and activity state.

### Post

A Post is the executable publishing record created from a planning row. It stores copy, media refs, target platforms, scheduled time, status, provider IDs, provider URLs, Facebook remote schedule state, errors, and LinkedIn manual completion state.

### PlanningSheet and PlanningRow

Each page has one PlanningSheet. PlanningRows carry the real operational work: job number, month, date, time, theme, copy, links, format, final creative notes, deadlines, MSS notes, designer assignment, creative files, row color, warning keys, non-actionable state, and linked post ID.

### Settings

AppSetting stores global defaults and credential state. PageSetting stores page-level overrides for default post time, timezone, auto-schedule, notifications, and live posting.

### Reference Sheets

Global reference sheets store shared operational data such as contact info and login details. Page reference sheets store page-specific info sheets. The frontend includes an editable spreadsheet-like reference editor.

### Analytics Models

Analytics data is stored in:

- `SocialInsight`
- `AccountInsightSnapshot`
- `InstagramFollowerSnapshot`
- `PlatformPostReference`
- `PostInsightSnapshot`

These models let the app store account metrics, follower snapshots, remote post references, and post-level insight snapshots instead of only showing transient API responses.

## 7. Authentication and Roles

The browser uses JWT access and refresh tokens. The live auth source is a JSON user store in `instance/users.json`, with a protected primary developer account.

Roles:

- `developer`
- `admin`
- `designer`

The role model controls operational access such as user management, admin planner actions, report sync, and settings-level work. The owner account is protected from deletion or takeover by normal user-management flows.

## 8. Planner Workflow

The Planning tab is the core of the product.

A normal content item moves like this:

1. A page exists.
2. A planning row is created or imported into that page's monthly planner.
3. Copy, theme, deadline, designer, notes, target date, and target time are filled in.
4. Creative media is uploaded.
5. The app validates media against active page platforms.
6. An admin schedules the row or publishes it directly from the planner.
7. A Post record is created and linked back to the row.
8. The scheduler or immediate publishing flow executes the post.
9. Results, URLs, failures, or manual LinkedIn state are stored.
10. The row color and post history stay synced.

The planner also supports non-actionable rows so notes, headings, or disabled work can remain in the sheet without becoming publishable content.

## 9. CSV Import

CSV planning import reads files from `imports/planning/inbox/`. The importer:

- maps files to pages using explicit and normalized filename matching
- rejects ambiguous page matches
- normalizes row payloads
- computes row signatures
- skips duplicates already in the planner
- creates PlanningRows for valid imported rows
- moves processed files into `imports/planning/processed/`
- returns a report of files seen, processed, failed, rows imported, skipped rows, months imported, and issues

This makes spreadsheet intake repeatable without blindly duplicating content.

## 10. Creative and Media Handling

Creative upload handling is platform-aware:

- uploads are stored as managed image or video refs
- planner rows can hold multiple creative refs
- replaced media is cleaned up when no longer referenced
- Instagram image ratios are validated
- the frontend can crop images into valid feed ratios
- pages with both Facebook and Instagram active cannot schedule incompatible mixed-media bundles

The media layer also supports signed public URLs, remote URL validation, local upload serving, path normalization, and orphan cleanup.

## 11. Scheduling and Publishing

Scheduling is strict:

- planner rows must be actionable
- date and time must parse
- scheduled time must be in the future
- copy is required
- creative media is required
- active platforms must exist
- media must pass platform-aware validation
- auto-scheduling can require the approved ready color

Admin users can also publish directly from a planner row. This still creates a Post record and links it to the row, so the planner remains the origin of the action.

Post statuses include:

- `draft`
- `scheduled`
- `posting`
- `manual_pending`
- `posted`
- `failed`

Failed posts can be retried. Queued posts can be rescheduled. Scheduled or draft posts can be deleted, with linked planner rows and pending Facebook remote schedules cleaned up.

## 12. Facebook Native Scheduling

For eligible Facebook posts, the scheduler can hand the post to Meta native scheduling before local publish time. This is controlled by the configured Facebook buffer. Local state stores the remote post ID, remote state, remote scheduled time, last sync time, and last remote error.

The scheduler later syncs remote state and treats published remote posts as successful platform results.

## 13. Platform Behavior

### Facebook and Instagram

Meta is the strongest automation path. The app can normalize user tokens, derive page access tokens, validate Instagram business account bindings, publish/simulate media posts, and refresh account/post insights.

### LinkedIn

LinkedIn is deliberately represented as manual assist for final posting. The app stores LinkedIn page URLs, account binding state, global LinkedIn token metadata, and a manual completion endpoint. A post can remain `manual_pending` until a user records that the LinkedIn step is done.

### X/Twitter

The X path uses OAuth 1.0a credentials and supports text plus image/video upload when credentials and provider access are available.

### Pinterest

Pinterest support covers image pin publishing through public media URLs and board selection rules when tokens are configured.

## 14. Token and Credential Strategy

The app reduces credential sprawl by centralizing token state where practical:

- Meta app ID and secret can live in settings.
- Meta user tokens can be normalized, exchanged, cached, and propagated to Facebook/Instagram account records.
- Global LinkedIn access and refresh token metadata can be stored and propagated.
- Scheduler jobs check token health and refresh expiring tokens.
- Diagnostics report missing fields, token warnings, and live-readiness issues.

## 15. Analytics and Reporting

Analytics covers Facebook and Instagram.

The system can:

- refresh account insights
- store account-level metrics such as views, reach, visits, followers, engagement, reactions, and media count where available
- discover and store recent Facebook post and Instagram media references
- refresh post-level metrics such as reach, views, reactions, comments, shares, saves, likes, clicks, and engagement where available
- show account comparison, trends, top posts, raw rows, and diagnostics
- run manual analytics refreshes with progress state
- run scheduled refreshes with pacing
- export an Excel marketing report from a workbook template
- sync report values and post-content rows into Google Sheets when credentials and spreadsheet IDs are configured

The analytics layer is built around saved snapshots, not just live API reads, so historical reporting can survive API volatility and repeated view loads.

## 16. Warning Emails

Planning warnings are used to prevent silent operational failure.

The current warning classes include:

- rows approaching scheduled time without ready status
- rows approaching deadline with missing operational fields
- rows approaching deadline with no creative attached

Recipient routing distinguishes admin/operations warnings from designer-specific creative warnings.

## 17. Diagnostics

Diagnostics cover:

- health endpoint
- scheduler status
- token status
- global and page-scoped integration checks
- media URL readiness
- account credential completeness
- provider warnings
- analytics refresh status

This lets setup problems be found before live posting is enabled.

## 18. Reference Sheets

Reference sheets are editable operational worksheets stored in settings. They give the app a place to hold structured internal data without creating a separate spreadsheet dependency for every small note.

Current sheet types:

- global contact info
- global login details
- page info sheet one
- page info sheet two

## 19. Safety and Recovery Design

Important safety protections include:

- SQLite blocked by default for normal operation
- Flask reloader disabled by `start.py` to avoid duplicate schedulers
- scheduler jobs use `max_instances=1`
- due posts are claimed by status update before execution
- planner rows cannot schedule into the past
- invalid media is blocked before scheduling
- local upload refs are normalized before serving or cleanup
- stale upload pruning runs on a schedule
- runtime schema repair adds missing columns for evolved deployments
- Facebook remote schedules are canceled when a queued local post is deleted or rescheduled
- analytics refreshes use a lock and status payload to avoid concurrent manual refresh collisions

## 20. Honest Boundaries

- Live provider success depends on provider permissions, token validity, account IDs, app approval, and public media access.
- LinkedIn final posting is currently manual assist, not full automatic posting.
- Analytics is strongest for Facebook and Instagram. Other platforms are managed primarily as publishing/integration targets.
- Report export and Google Sheets sync need local/private templates and credentials that are intentionally not committed.
- The app is monolithic by design. That keeps it practical for local/internal operation, but it means the app process owns API work, scheduling, file serving, and frontend serving together.

## 21. Summary

MSS SoME-Auto has grown into an internal operating system for social media work. Its value is not only that it can publish posts. Its value is that it connects planning, creative readiness, scheduling, provider constraints, warnings, live/simulated rollout, manual LinkedIn completion, analytics, reporting, and historical memory into one controlled workflow.
