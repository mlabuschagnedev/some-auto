# SoMe-Auto

SoMe-Auto is a planner-first social media operations platform. It manages content planning, creative readiness, page-specific settings, simulated or live publishing, scheduled execution, integration diagnostics, and post history.

This repository is a sanitized public copy. Production databases, uploaded media, processed client CSVs, logs, service-account files, browser profiles, and real credentials are intentionally excluded. Use `example.env` as the reference for local configuration.

## What It Does

- Manages pages or brands as the main operational unit.
- Stores planning sheets and planning rows for each page.
- Turns approved planning rows into scheduled posts.
- Supports simulated publishing by default, with live posting controlled by settings.
- Tracks scheduled, posted, failed, and manual-pending post states.
- Handles creative uploads and platform-aware media validation.
- Runs background jobs for publishing, warnings, token checks, and upload cleanup.
- Supports page-level setting overrides for staged rollout.

## Project Layout

- `social-media-manager-dev/` is the main development codebase with a modular Flask backend and React + TypeScript frontend.
- `social-media-manager/` is the packaged runtime mirror.
- `autopost.py` is an adjacent spreadsheet and email-driven automation helper.
- `backup_tool.py` is a utility script kept with the original project structure.
- `example.env` contains safe sample environment values.

## Setup

From the development app:

```powershell
cd social-media-manager-dev
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
python start.py
```

Open:

```text
http://localhost:5000
```

For the React frontend:

```powershell
cd social-media-manager-dev\frontend
npm install
npm run dev
```

## Configuration

Create a local `.env` using `example.env` as the reference. Keep real values out of Git.

Important variables include:

- `PRIMARY_DEVELOPER_USERNAME`
- `PRIMARY_DEVELOPER_EMAIL`
- `PRIMARY_DEVELOPER_PASSWORD`
- `DATABASE_URL`
- `PUBLIC_BASE_URL`
- `EMAIL_FROM`
- `SMTP_SERVER`
- `SMTP_USER`
- `SMTP_PASS`
- `FACEBOOK_APP_ID`
- `FACEBOOK_APP_SECRET`
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `PINTEREST_APP_ID`
- `PINTEREST_APP_SECRET`

The app can run safely in simulation mode while credentials and page settings are being configured.
