# SoMe-Auto

SoMe-Auto is the sanitized public copy of `MSS SoME-Auto`, a planner-first social media operations platform. It is built for managing social media as an internal production workflow: page setup, planning rows, creative readiness, scheduling, live or simulated publishing, platform diagnostics, analytics, and reporting all live in one tool.

This repository intentionally excludes production databases, uploaded media, logs, real credentials, browser profiles, service-account files, and other private runtime state. Use `example.env` as a safe configuration reference and keep real secrets out of Git.

## Current Source of Truth

- This README describes the current `social-media-manager-dev/` application, not the older packaged mirror.
- `social-media-manager-dev/` is the active working app: modular Flask API, PostgreSQL-first storage, APScheduler background jobs, provider integrations, analytics/reporting, and a React + TypeScript + Vite frontend.
- `social-media-manager/` is a packaged/static runtime mirror kept for deployment history and comparison. It is not the authoritative current dev surface.
- `autopost.py` and `backup_tool.py` are older adjacent utilities kept with the original project structure.

## Major Current Capabilities

- Manage multiple pages, brands, clients, or branches as first-class workspaces.
- Attach Facebook, Instagram, LinkedIn, X/Twitter, and Pinterest account records to each page.
- Keep one planning sheet per page, grouped by planning month, with rows for job number, copy, theme, designer, deadlines, notes, links, format, creative status, and scheduling state.
- Import planning CSVs from an inbox, map them to pages, dedupe repeated rows, and archive processed files.
- Upload one or more creative files to planner rows, reorder existing and pending media, and validate media against page platform rules before scheduling.
- Enforce Facebook and Instagram combined-media rules, including no mixed image/video bundles and no multi-video bundles for that path.
- Detect Instagram-invalid image ratios and support an in-browser crop workflow with feed-safe presets.
- Schedule approved planner rows into post records, auto-schedule qualifying rows shortly before their target time, or publish directly from a planner row when an admin needs immediate execution.
- Run in safe simulation mode by default, with live posting enabled globally or per page.
- Publish or simulate Facebook, Instagram, X/Twitter, and Pinterest posts, while keeping LinkedIn in an explicit manual-assist flow.
- Hand eligible scheduled Facebook posts off to Meta native scheduling when the configured buffer allows it, then sync remote state back into local post history.
- Track scheduled, posting, manual-pending, posted, failed, retried, rescheduled, and deleted post states.
- Retry failed posts, reschedule queued posts, and cancel pending Facebook remote schedules when a queued post is deleted or moved.
- Centralize Meta and LinkedIn token handling, including token health checks, propagation to accounts, and scheduled refresh work.
- Diagnose account readiness, environment readiness, token state, media URL reachability, and scheduler health.
- Store page-level settings overrides so one page can publish live while another remains in simulation.
- Maintain global and page reference sheets for operational information such as contact details, login notes, and page-specific reference data.
- Send deadline, creative, and readiness warning emails to the right operational or designer recipients.
- Prune orphaned uploads and repair additive runtime schema gaps on startup.

## Analytics, Pulled Posts, and Metrics

The analytics work is now a major part of the app, not a placeholder. The current dev app has a real Facebook and Instagram reporting pipeline:

- Pulls and stores Facebook Page and Instagram Business account metrics into database snapshots instead of only showing one-off API responses.
- Tracks account-level views, reach, visits/profile views, followers, engagement/content interactions, reactions, and Instagram media count where Meta exposes those values.
- Pulls recent remote Facebook posts and Instagram media from Meta, not only posts created inside the app.
- Matches pulled remote posts back to local post records by provider ID first, then caption/date matching when the provider ID was not already stored.
- Backfills remote-only posts into local post history with captions, platform IDs, thumbnails, media type, published date, and permalink when the post exists on Meta but was not originally created through SoMe-Auto.
- Stores post-level insight snapshots for Facebook views, reach, engagement, comments, shares, reactions, and clicks.
- Stores post-level insight snapshots for Instagram reach, views, likes, comments, shares, saved count, and total interactions.
- Keeps platform post references in `PlatformPostReference` and metric history in `AccountInsightSnapshot`, `SocialInsight`, and `PostInsightSnapshot` records.
- Runs scheduled social-insight refreshes through APScheduler and also supports manual refreshes with queued/running/finished progress state.
- Provides an Analytics workspace with overview KPIs, trend charts, platform comparison, account comparison, post-performance cards, account tables, diagnostics, raw rows, filters, sorting, and date ranges.
- Exports a marketing report workbook from an Excel template and can sync the prepared report values and post-content rows into Google Sheets when report credentials are configured.

Analytics is strongest for Facebook and Instagram because those are the platforms currently backed by Meta insight APIs. LinkedIn, X/Twitter, and Pinterest remain part of the publishing/integration workflow, but not the same full insight pipeline.

## Architecture

The current development app is a monolithic but well-separated web application:

- Flask exposes JSON API blueprints for auth, pages, planning, posts, settings, diagnostics, assets, and analytics.
- Service modules hold business logic for user management, page/account operations, planner workflows, publishing state, settings, diagnostics, asset delivery, and analytics/reporting.
- SQLAlchemy models store pages, accounts, posts, settings, planner rows, reference sheets, platform post references, and insight snapshots.
- APScheduler runs due-post processing, planner warning checks, auto-scheduling, token refresh, upload pruning, and scheduled social-insight refresh.
- The React frontend provides the current workspace experience: dashboard, projects/pages, planner, analytics, activity, notifications, settings, and help surfaces.
- Local uploads can be served directly or through temporary signed public URLs for providers that need externally reachable media.
- Cloudflare tunnel scripts are included for stable public media access during local operation.

## Quick Start

From the development app:

```powershell
cd social-media-manager-dev
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

For the React frontend dev server:

```powershell
cd social-media-manager-dev\frontend
npm install
npm run dev
```

Build the frontend:

```powershell
cd social-media-manager-dev\frontend
npm run build
```

## Configuration Notes

`DATABASE_URL` should point to PostgreSQL for normal use. SQLite is intentionally blocked unless `ALLOW_SQLITE_FOR_TESTS=1` is set for isolated testing.

Important environment values include:

- `PRIMARY_DEVELOPER_USERNAME`
- `PRIMARY_DEVELOPER_DISPLAY_NAME`
- `PRIMARY_DEVELOPER_EMAIL`
- `PRIMARY_DEVELOPER_PASSWORD`
- `JWT_SECRET_KEY`
- `DATABASE_URL`
- `PUBLIC_BASE_URL`
- `MEDIA_URL_SIGNING_SECRET`
- `EMAIL_FROM`
- `EMAIL_TO`
- `SMTP_SERVER`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_SECURITY`
- `FACEBOOK_APP_ID`
- `FACEBOOK_APP_SECRET`
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `PINTEREST_APP_ID`
- `PINTEREST_APP_SECRET`
- `MARKETING_REPORT_TEMPLATE_PATH`
- `GOOGLE_REPORT_CREDENTIALS_PATH` or `GOOGLE_APPLICATION_CREDENTIALS`
- `GOOGLE_REPORT_SPREADSHEET_ID`
- `GOOGLE_CAMPAIGN_SPREADSHEET_ID`

The app is safe to run in simulation mode while credentials, public media access, report templates, and per-page settings are being configured.

## Repository Hygiene

The `.gitignore` keeps runtime-only data out of the public copy:

- `.env` files
- local databases
- `instance/`
- `runtime/`
- `uploads/`
- planner import inbox and processed client CSVs, except placeholders
- frontend `node_modules/` and `dist/`
- logs, service-account files, credentials, and secret JSON files

Do not commit real client media, production credentials, service-account JSON, or live database snapshots.
