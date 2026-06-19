# MSS SoME-Auto Runtime Mirror

This folder is the packaged/static runtime mirror that was kept from the earlier app shape. The current source of truth for active development is:

```text
../social-media-manager-dev/
```

Use the dev folder when you need the current React + TypeScript frontend, modular Flask route/service split, PostgreSQL-first setup, analytics/reporting features, reference sheets, Facebook native scheduling handoff, and the latest planner workflow.

## What This Runtime Mirror Represents

The runtime mirror documents the deployable concept of MSS SoME-Auto:

- page-based social media management
- planner-first content workflow
- creative uploads
- scheduled and posted history
- simulated versus live publishing
- platform account setup
- planner warning logic
- optional Cloudflare tunnel support for public media URLs

It should not be treated as the complete current capability surface. Newer implementation details live in `social-media-manager-dev/`.

## Current Primary Capabilities In The Dev App

- PostgreSQL-first Flask backend.
- React + TypeScript + Vite frontend.
- Planner rows as the source of truth for scheduled and immediate posts.
- Facebook, Instagram, LinkedIn manual assist, X/Twitter, and Pinterest account support.
- Page-level live posting overrides.
- Meta and LinkedIn global token handling.
- Facebook native scheduled-post handoff and sync.
- Facebook/Instagram analytics snapshots and top-post reporting.
- Excel marketing report export and Google Sheets sync.
- Global and page reference sheets.
- User management for developer, admin, and designer roles.

## Running The Current App

Run the current development app from `social-media-manager-dev`:

```powershell
cd ..\social-media-manager-dev
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

For frontend development:

```powershell
cd ..\social-media-manager-dev\frontend
npm install
npm run dev
```

## Cloudflare Tunnel Scripts

The runtime mirror still includes the tunnel helper scripts:

- `scripts/setup-cloudflare-tunnel.ps1`
- `scripts/run-cloudflare-tunnel.ps1`

These are useful when local uploaded media must be reachable by remote providers through a stable public hostname.
