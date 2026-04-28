# Sample SoMe-Auto

`Sample SoMe-Auto` is a local web application for social media scheduling and publishing.

## Current architecture

- Flask backend API
- SQLAlchemy (SQLite by default)
- JWT auth with access and refresh tokens
- APScheduler for post execution and token maintenance
- Browser frontend (HTML/CSS/JS) served by Flask
- Scheduled + Posted tabs support both list and calendar views
- Left-side page filter bar with select all / deselect all
- Planning tab with one sheet per page and Excel-style row planning
- Post edit/delete controls until published
- Settings includes manager-focused FAQ section

## Quick start

1. Create and activate a virtual environment.
2. Install dependencies.
3. Start the app.

```bash
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
python backend/app.py
```

Open: `http://localhost:5000`

## Bootstrap login

The app bootstraps one protected developer account from `instance/users.json`.

If the file does not exist yet, the bootstrap account defaults to:

- Username: `Example User`
- Password: `change-me-example-password`

You can override the bootstrap owner with:

- `PRIMARY_DEVELOPER_USERNAME`
- `PRIMARY_DEVELOPER_DISPLAY_NAME`
- `PRIMARY_DEVELOPER_EMAIL`
- `PRIMARY_DEVELOPER_PASSWORD`

Additional users are created, edited, activated, deactivated, and deleted inside the web app under **Settings**.

## Environment variables

Core:

- `JWT_SECRET_KEY`
- `DATABASE_URL` (default: SQLite under `instance/`)
- `UPLOAD_DIR` (default: `uploads/`)
- `API_TIMEOUT_SECONDS` (default: `30`)
- `APP_TIMEZONE` (default: `Africa/Johannesburg`)
- `PUBLIC_BASE_URL` (required for Instagram/Pinterest media URLs)
- `MEDIA_URL_SIGNING_SECRET` (optional; falls back to `JWT_SECRET_KEY`)
- `AUTO_TRYCLOUDFLARE_TUNNEL` (default: `1`; auto-starts quick tunnel and refreshes `PUBLIC_BASE_URL` each app run when not using a custom domain)
- `FLASK_DEBUG` (default: `1`; app runs with reloader disabled in `start.py` to avoid duplicate schedulers/tunnels)
- `PRIMARY_DEVELOPER_USERNAME`
- `PRIMARY_DEVELOPER_DISPLAY_NAME`
- `PRIMARY_DEVELOPER_EMAIL`
- `PRIMARY_DEVELOPER_PASSWORD`

Token refresh:

- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `PINTEREST_APP_ID`
- `PINTEREST_APP_SECRET`

Notes:

- For Instagram/Pinterest publish from local uploads, `PUBLIC_BASE_URL` must be publicly reachable (domain or tunnel URL).
- For automatic Meta token normalization (short-lived -> long-lived and Facebook page-token derivation), fill in the Facebook App ID and App Secret once in Global Settings. Environment variables `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` still work as a fallback.

## Permanent Cloudflare tunnel (stable URL)

Use this when you want a fixed public hostname instead of a temporary `trycloudflare.com` URL.

Prerequisites:

- A Cloudflare account
- A domain managed in Cloudflare DNS
- `cloudflared` installed (`winget install Cloudflare.cloudflared`)

Setup:

```powershell
cd social-media-manager
powershell -ExecutionPolicy Bypass -File .\scripts\setup-cloudflare-tunnel.ps1 -Hostname "social.yourdomain.com"
```

What the setup script does:

- runs one-time `cloudflared tunnel login` if needed
- creates (or reuses) named tunnel `social-media-manager`
- creates DNS route for your hostname
- writes tunnel config to `runtime/cloudflared/config.yml`
- updates `PUBLIC_BASE_URL` in `start.py` to `https://social.yourdomain.com`

Run tunnel:

```powershell
cd social-media-manager
powershell -ExecutionPolicy Bypass -File .\scripts\run-cloudflare-tunnel.ps1
```

Then start the app:

```powershell
cd social-media-manager
python start.py
```

## Phase 2 live posting behavior

Live posting is controlled by app setting `live_posting_enabled`:

- `false`: safe simulated publishing
- `true`: real API calls

Platform behavior:

- Facebook: text, single image/video, multi-image post supported
- Twitter/X: text + image/video upload supported
- LinkedIn: text and uploaded image/video post supported
- Instagram Graph API: single media post via temporary signed URL supported
- Pinterest: single image pin via public URL supported

## Account field notes

When adding an account:

- `platform` is required
- `access_token` is required for most providers
- `api_key`, `api_secret`, `access_token_secret` are required for Twitter
- `page_id_external` is optional for some platforms but strongly recommended:
  - Facebook: target page ID
  - LinkedIn: author URN or person ID
  - Instagram: business account ID (required)
  - Pinterest: board ID (optional; first board is used if omitted)

## Token refresh

- Manual: `POST /api/accounts/:id/refresh`
- Automatic: scheduler checks expiring tokens every 6 hours
- Supported refresh providers: Facebook, LinkedIn, Pinterest

## Integration checks

Use the **Integrations** tab in the web app to verify:

- environment variable readiness
- account credential completeness
- temporary media URL delivery status
- provider warnings before enabling live posting

## Multi-page scaling and scope

- Settings and integrations can now be scoped to:
  - global defaults (all pages)
  - a single page override
- `live_posting_enabled` supports page-level overrides, so one page can stay in simulation while another publishes live.
- Tokens and integration readiness can be filtered by page.
- Page listing API supports search and pagination for large installations.
- Planning sheets are automatically created for each page.
- Planning rows can upload creative media and schedule posts directly from row data.

## Important API endpoints

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/pages`
- `GET /api/pages?page=1&per_page=25&q=search`
- `POST /api/pages`
- `POST /api/pages/:id/accounts`
- `POST /api/accounts/:id/test`
- `POST /api/accounts/:id/refresh`
- `GET /api/posts`
- Planner-driven scheduling only:
- `POST /api/planning/rows/:id/schedule`
- `POST /api/planning/rows/:id/creative`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/pages/:id/settings`
- `PUT /api/pages/:id/settings`
- `GET /api/integrations/check`
- `GET /api/pages/:id/integrations/check`
- `GET /api/tokens/status?page_id=:id`
- `GET /api/planning/sheets`
- `GET /api/pages/:id/planning`
- `POST /api/pages/:id/planning/rows`
- `PUT /api/planning/rows/:id`
- `POST /api/planning/rows/bulk-update`
- `DELETE /api/planning/rows/:id`
- `POST /api/planning/rows/:id/creative`
- `POST /api/planning/rows/:id/schedule`

