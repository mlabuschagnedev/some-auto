# MSS SoME-Auto Development App

`social-media-manager-dev` is the current working application for MSS SoME-Auto. It combines a Flask API, PostgreSQL-first SQLAlchemy data model, APScheduler automation, provider integrations, analytics/reporting jobs, and a React + TypeScript frontend.

The product is planner-first: posts normally begin as planning rows, not isolated post records. The queue and history views monitor work that has already moved out of the planner.

## Current Architecture

- Flask backend API with modular blueprints under `backend/routes/`.
- Business logic split across service modules under `backend/services/`.
- SQLAlchemy models for pages, social accounts, posts, settings, planner rows, reference sheets, platform post references, and insight snapshots.
- PostgreSQL for normal operation. SQLite is allowed only for explicit isolated testing with `ALLOW_SQLITE_FOR_TESTS=1`.
- JWT auth with access and refresh tokens.
- JSON-backed user store in `instance/users.json` for bootstrap and internal users.
- APScheduler for due posts, planner warnings, auto-scheduling, token refresh, orphaned upload pruning, and social-insight refresh.
- React 19 + TypeScript + Vite frontend in `frontend/src/`.
- Local upload storage with signed public-media URLs when providers need fetchable media.
- Optional Cloudflare tunnel automation for local public media access.

## Product Capabilities

- Page and account management for Facebook, Instagram, LinkedIn, X/Twitter, and Pinterest.
- Page search, pagination, image uploads, LinkedIn page URLs, and automatic planning-sheet creation.
- Per-page social account records with platform-specific credential and external-ID fields.
- Planner rows with job number, month, date, time, theme, copy, link, format, creative notes, deadline, MSS notes, designer, row color, warning state, and linked post state.
- CSV planning import from `imports/planning/inbox/`, including page resolution, duplicate detection, row normalization, processed-file archiving, and import reports.
- Creative upload management for planner rows, including multiple files, reorder support, replacement cleanup, and platform-aware validation.
- Instagram-safe image ratio detection and browser-side crop support.
- Planner-row scheduling, auto-scheduling, and immediate planner-row publishing.
- Safe simulation mode by default, with global and page-level `live_posting_enabled` overrides for staged rollout.
- Meta token normalization and propagation for Facebook and Instagram account records.
- LinkedIn global configuration and manual-assist completion flow.
- Facebook native scheduled-post handoff when a scheduled post is inside the Meta scheduling buffer.
- X/Twitter media upload path using OAuth 1.0a credentials.
- Pinterest image pin path using public media URLs and board selection.
- Scheduled, posting, manual-pending, posted, failed, retried, rescheduled, and deleted post handling.
- Integration and token diagnostics for account readiness, environment readiness, and media URL delivery.
- Global and page reference sheets for operational information.
- User management for developer, admin, and designer roles.
- Warning emails for planner deadlines, missing creative, incomplete row fields, and rows approaching publish time without ready status.
- Analytics for Facebook and Instagram account/page metrics, post references, post insight snapshots, top posts, trend rows, and diagnostic insight rows.
- Marketing report export to `.xlsx` from a workbook template.
- Google Sheets report sync with report/campaign spreadsheet matching when credentials are configured.

## Quick Start

1. Create and activate a virtual environment.
2. Install Python dependencies.
3. Configure PostgreSQL.
4. Start the Flask app.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
$env:DATABASE_URL = "postgresql+psycopg://mss_some_auto:mss_some_auto@localhost:5432/mss_some_auto"
python start.py
```

Open:

```text
http://localhost:5000
```

Run the React development server when working on the frontend:

```powershell
cd frontend
npm install
npm run dev
```

Build the frontend:

```powershell
cd frontend
npm run build
```

## Bootstrap Login

The app bootstraps a protected developer account from `instance/users.json`.

If the file does not exist yet, the defaults are:

- Username: `marcel`
- Password: `admin123`

Override the bootstrap owner with:

- `PRIMARY_DEVELOPER_USERNAME`
- `PRIMARY_DEVELOPER_DISPLAY_NAME`
- `PRIMARY_DEVELOPER_EMAIL`
- `PRIMARY_DEVELOPER_PASSWORD`

Additional users are created, edited, activated, deactivated, and deleted inside the web app under Settings.

## Environment Variables

Core:

- `JWT_SECRET_KEY`
- `DATABASE_URL`
- `DATABASE_POOL_SIZE`
- `DATABASE_MAX_OVERFLOW`
- `DATABASE_POOL_RECYCLE_SECONDS`
- `ALLOW_SQLITE_FOR_TESTS`
- `UPLOAD_DIR`
- `PLANNING_IMPORT_DIR`
- `API_TIMEOUT_SECONDS`
- `APP_TIMEZONE`
- `PUBLIC_BASE_URL`
- `MEDIA_URL_SIGNING_SECRET`
- `AUTO_TRYCLOUDFLARE_TUNNEL`
- `FLASK_DEBUG`
- `DISABLE_SCHEDULER`
- `PRIMARY_DEVELOPER_USERNAME`
- `PRIMARY_DEVELOPER_DISPLAY_NAME`
- `PRIMARY_DEVELOPER_EMAIL`
- `PRIMARY_DEVELOPER_PASSWORD`

Email and warnings:

- `EMAIL_FROM`
- `EMAIL_TO`
- `SMTP_SERVER`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_SECURITY`

Provider setup:

- `FACEBOOK_APP_ID`
- `FACEBOOK_APP_SECRET`
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_API_VERSION`
- `PINTEREST_APP_ID`
- `PINTEREST_APP_SECRET`
- `SOCIAL_INSIGHTS_META_API_VERSION`
- `SOCIAL_INSIGHTS_META_API_FALLBACK_VERSION`
- `SOCIAL_INSIGHTS_REFRESH_INTERVAL_SECONDS`
- `SOCIAL_INSIGHTS_MIN_REFRESH_SECONDS`
- `SOCIAL_INSIGHTS_ACCOUNT_PACE_SECONDS`

Marketing report export and sync:

- `MARKETING_REPORT_TEMPLATE_PATH`
- `GOOGLE_REPORT_CREDENTIALS_PATH`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `GOOGLE_REPORT_SPREADSHEET_ID`
- `GOOGLE_CAMPAIGN_SPREADSHEET_ID`

## Live Posting Behavior

`live_posting_enabled` controls whether real provider APIs are called.

- `false`: safe simulation. The app can exercise planner, scheduler, queue, and history behavior without public posting.
- `true`: live provider calls for supported accounts.

The setting can be global or overridden per page, so one page can stay in simulation while another page publishes live.

Platform behavior:

- Facebook: text, image, video, and multi-image paths are implemented; eligible scheduled posts can be handed to Meta native scheduling and later synced.
- Instagram: Graph API media creation uses temporary public media URLs and validates media rules before scheduling.
- LinkedIn: account binding and global token state exist, but final publishing is modeled as manual assist in the product workflow.
- X/Twitter: text plus media upload path is implemented when OAuth credentials are present.
- Pinterest: single-image pin path is implemented when media URLs and board data are available.

## Permanent Cloudflare Tunnel

Use this when local uploads must be reachable at a stable public hostname.

Prerequisites:

- A Cloudflare account.
- A domain managed in Cloudflare DNS.
- `cloudflared` installed.

Setup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-cloudflare-tunnel.ps1 -Hostname "social.yourdomain.com"
```

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-cloudflare-tunnel.ps1
python start.py
```

## Important API Areas

Auth and users:

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/verify`
- `POST /api/auth/logout`
- `GET /api/users`
- `POST /api/users`
- `PUT /api/users/:username`
- `DELETE /api/users/:username`

Pages and accounts:

- `GET /api/pages`
- `GET /api/pages?page=1&per_page=25&q=search`
- `POST /api/pages`
- `GET /api/pages/:id`
- `PUT /api/pages/:id`
- `DELETE /api/pages/:id`
- `POST /api/pages/:id/accounts`
- `PUT /api/accounts/:id`
- `DELETE /api/accounts/:id`
- `POST /api/accounts/:id/test`
- `POST /api/accounts/:id/refresh`

Planner and posts:

- `GET /api/planning/sheets`
- `GET /api/pages/:id/planning?month=YYYY-MM`
- `POST /api/pages/:id/planning/rows`
- `PUT /api/planning/rows/:id`
- `POST /api/planning/rows/bulk-update`
- `DELETE /api/planning/rows/:id`
- `POST /api/planning/rows/:id/creative`
- `POST /api/planning/rows/:id/schedule`
- `POST /api/planning/rows/:id/publish`
- `POST /api/planning/import-csvs`
- `GET /api/posts`
- `POST /api/posts/:id/linkedin/manual`
- `DELETE /api/posts/:id`
- `POST /api/posts/:id/retry`
- `POST /api/posts/:id/reschedule`

Settings, diagnostics, and reference sheets:

- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/pages/:id/settings`
- `PUT /api/pages/:id/settings`
- `GET /api/reference-sheets/:sheet_key`
- `PUT /api/reference-sheets/:sheet_key`
- `GET /api/pages/:id/reference-sheets/:sheet_key`
- `PUT /api/pages/:id/reference-sheets/:sheet_key`
- `GET /api/health`
- `GET /api/scheduler/status`
- `GET /api/tokens/status`
- `GET /api/integrations/check`
- `GET /api/pages/:id/integrations/check`

Analytics and reports:

- `GET /api/analytics/accounts`
- `GET /api/analytics/summary`
- `GET /api/analytics/trends`
- `GET /api/analytics/accounts/:id`
- `GET /api/analytics/accounts/:id/trends`
- `GET /api/analytics/accounts/:id/insights`
- `GET /api/analytics/posts`
- `GET /api/analytics/posts/:id`
- `GET /api/analytics/raw`
- `POST /api/analytics/refresh`
- `GET /api/analytics/refresh/status`
- `GET /api/analytics/export-report.xlsx`
- `POST /api/analytics/export-report`

## Operational Boundaries

- The app is intentionally monolithic. Flask, scheduling, API work, file serving, and frontend serving run together.
- Live provider behavior depends on valid tokens, page IDs, app permissions, public media reachability, and provider approval.
- LinkedIn is deliberately modeled as manual assist for final posting rather than pretending full automation is available.
- Report export/sync depends on local report templates and Google credentials that are not committed to the repo.
