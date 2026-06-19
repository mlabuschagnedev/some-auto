# MSS SoME-Auto Runtime Mirror Overview

This folder is a packaged/static runtime mirror from the earlier app layout. It remains in the repository for deployment history and comparison, but the active implementation is `../social-media-manager-dev/`.

## Current Product Shape

The current MSS SoME-Auto development app is a planner-first social media operations platform. It connects:

- pages and client/brand workspaces
- social account records
- monthly planning rows
- creative upload handling
- platform-aware validation
- scheduled and immediate planner-row publishing
- safe simulation versus live posting
- Meta token normalization
- LinkedIn manual assist
- Facebook native scheduled-post handoff
- warning emails
- diagnostics
- reference sheets
- Facebook/Instagram account analytics
- pulled remote Facebook posts and Instagram media
- post-level metric snapshots
- Excel and Google Sheets marketing reporting

## Why The Runtime Mirror Exists

The mirror keeps the older deployable folder structure available. That is useful for understanding how the app was originally packaged, but it should not be used as the authoritative description of what the current development app can do.

For the current technical overview, read:

```text
../social-media-manager-dev/SYSTEM_OVERVIEW.md
```

## Stable Concepts Shared With The Current App

The core product ideas remain the same:

- social media work is page-centric
- planner rows are the main source of truth
- creative files stay attached to planning work
- scheduled posts and posted history are operational records
- simulation mode protects setup and onboarding
- page-level settings allow staged rollout
- warnings and diagnostics reduce silent failure

## Major Current Additions In The Dev App

The development app has moved beyond this mirror in important areas:

- modular route and service backend
- PostgreSQL-first database configuration
- React + TypeScript workspace frontend
- reference-sheet editor
- planner CSV import reports
- multi-file creative upload and crop handling
- failed-post retry and queued-post reschedule endpoints
- Meta remote scheduled-post sync
- Facebook and Instagram account analytics snapshots
- pulled remote Facebook/Instagram post and media history
- remote-only post backfill into local history
- post-level metrics for views, reach, interactions, comments, shares, saves, likes, reactions, and clicks where available
- top-post, trend, account-comparison, post-card, diagnostics, and raw-row reporting
- Excel workbook export
- Google Sheets report sync
- scheduled analytics refresh with pacing and status tracking

Treat this folder as a runtime artifact and `social-media-manager-dev` as the current system.
