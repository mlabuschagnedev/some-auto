# Sample SoMe-Auto System Overview

## 1. What This System Is

Sample SoMe-Auto is a planner-first social media management platform built for a company or agency that needs to organize content production, track creative readiness, schedule posts, publish to connected social platforms, and preserve a useful record of past work.

The system is not designed as a lightweight "type a caption and post it now" utility. Its real purpose is to become the operational control layer between:

- business requests
- content planning
- design production
- approvals
- scheduling
- publishing
- reporting and historical reference

In practical terms, it gives a business one place where pages, platforms, planner rows, creatives, schedules, warnings, publishing state, user permissions, and post history all live together.

## 2. The End Goal of the Product

The end goal of this program is to let a company manage social media like an internal production system rather than an ad hoc collection of chats, emails, scattered folders, and last-minute manual posting.

The intended final business outcome is:

- content is planned early
- each page has a clear content pipeline
- designers know what must be produced
- managers know what is missing
- publishing happens on time
- platform constraints are enforced before failure
- old posts remain searchable and useful for future ideas
- access rights are controlled inside the app instead of through fragile shared credentials

This makes the app valuable not only as a posting tool, but as an internal operating framework for social media execution.

## 3. Core Product Philosophy

The current system is built around a few strong design decisions.

### 3.1 Planner-first operation

The planner is the source of truth. Posts are meant to begin life as planning rows, not as isolated post records. The queue and history sections are for monitoring, reference, and backend cleanup, not for primary content creation.

### 3.2 Page-centric management

Everything is anchored to a Page. A page represents a real client brand, department, branch, or business presence. Social accounts, planning sheets, posts, and integrations all attach to a page.

### 3.3 Safe-by-default publishing

The app distinguishes between simulated publishing and real publishing. That means a company can onboard credentials, verify flows, and test readiness before enabling live API posting.

### 3.4 Hybrid automation

Where the app has stable API support, it automates publishing. Where platform approval or provider limitations block full automation, it falls back to structured manual-assist workflows instead of pretending automation exists.

### 3.5 Operational accountability

The planner is not just for writing copy. It also carries deadlines, designers, creative readiness, job colors, notes, linked accounts, and warning logic. This turns content planning into trackable operational work.

### 3.6 Historical memory

The planner is monthly based and past months stay available for review. That means the app doubles as a knowledge archive for previous campaigns, ideas, copy approaches, special requests, and design decisions.

## 4. High-Level Business Problem It Solves

Without a system like this, most businesses run social media through fragmented workflows:

- strategy sits in WhatsApp or email
- designers get verbal instructions
- captions live in random docs
- media lives in folders with weak naming
- scheduling depends on one person remembering to do it
- platform-specific rules are caught too late
- managers have poor visibility
- old content gets lost

Sample SoMe-Auto fixes that by turning social media delivery into a structured workflow with clear states, automation, alerts, and retained history.

## 5. High-Level Architecture

The product is a monolithic web application with a clear split between backend API, frontend UI, storage, and background automation.

### 5.1 Backend

The backend is a Flask application. It exposes JSON API endpoints, serves the frontend files, handles authentication, stores and retrieves operational data, runs scheduler jobs, manages platform publishing, and enforces business rules.

### 5.2 Frontend

The frontend is a browser application built with plain HTML, CSS, and JavaScript. It is intentionally simple in stack choice, but feature-rich in behavior. The frontend holds a central state object and renders the app tabs, forms, planner grid, modal interfaces, queue views, and integration management surfaces.

### 5.3 Database

The default database is SQLite through SQLAlchemy. This is appropriate for a locally run internal business tool and keeps setup simple while still supporting structured relational data.

### 5.4 Background scheduler

APScheduler runs inside the app process. It performs recurring background work such as:

- checking for due posts
- auto-scheduling planning rows
- sending warning emails
- refreshing expiring tokens
- pruning old storage

### 5.5 File storage

Creative uploads are stored locally under the uploads directory. The app serves those files directly and can also generate temporary public links for platforms that need externally reachable media URLs.

### 5.6 Public access layer

For local development and deployment without public hosting, the app can use a Cloudflare tunnel so remote platforms can fetch media from a public URL even while the app runs locally.

## 6. Technical Stack Summary

- Flask backend API
- SQLAlchemy ORM
- SQLite by default
- JWT access and refresh tokens
- APScheduler for recurring jobs
- Pillow for image inspection and image-cropping support
- requests for external API calls
- plain JavaScript frontend
- HTML/CSS frontend served by Flask

This stack was chosen for pragmatism: it is easier to operate, easier to understand, and faster to change than a heavily fragmented microservice system.

## 7. Core Data Model

The system revolves around a small set of strong entities.

### 7.1 Page

A Page is the top-level content container for a brand or business presence. A page has:

- a name
- a description
- an optional image
- an optional LinkedIn page URL
- connected social accounts
- one planning sheet
- scheduled and posted content

This structure keeps content, integrations, and history grouped by business entity.

### 7.2 SocialAccount

A SocialAccount represents a platform connection for a page. It stores:

- platform type
- optional account name
- provider credentials
- external account identifiers
- token expiry data
- connection health state

The account layer lets one page publish to multiple platforms while keeping platform-specific credentials separate.

### 7.3 Post

A Post is the executable publishing record created from planning data. It stores:

- content
- media
- target platforms
- scheduled time
- publish status
- platform-specific result IDs
- platform URLs
- error details
- LinkedIn manual-assist completion state

Posts are what the scheduler actually processes.

### 7.4 PlanningSheet

Each page gets one PlanningSheet. This is the container for planner rows.

### 7.5 PlanningRow

PlanningRow is the operational heart of the product. A row contains:

- linked accounts
- job number
- date
- time
- theme
- post copy
- link
- format
- final creative notes
- deadline
- internal notes
- uploaded creative media
- designer assignment
- planner month
- job color
- warning state
- optional scheduled post link

This means the planner is not just a calendar. It is effectively the production worksheet for each piece of content.

### 7.6 AppSetting and PageSetting

Global settings control system-wide defaults. Page settings allow overrides per page. This lets one company operate with shared defaults while still allowing specific pages to behave differently.

## 8. Authentication, Roles, and Control Model

The system uses JWT authentication with access and refresh tokens.

### 8.1 User storage

The current live auth source is a JSON user store in `instance/users.json`. The owner account is bootstrapped there and protected.

### 8.2 Roles

The system currently uses three main roles:

- developer
- admin
- designer

### 8.3 Owner account

The owner account is a protected top-level account intended for Example User. It has developer-level reach and is protected from deletion by other users. Certain sensitive flows, especially the current LinkedIn manual-assist path, are restricted to the owner.

### 8.4 Why this matters operationally

This role split allows a company to give different staff access without giving everyone unrestricted platform control.

Typical effect:

- developers manage system-level setup, configuration, and platform structure
- admins manage planning and operational content work
- designers work in the planner and creative pipeline
- the owner retains top-level authority

## 9. The Planner: The Real Center of the Product

The most important part of the application is the Planning tab.

### 9.1 Monthly design

The planner is month-based. Users select a month and work inside that month. Past months remain available for reference, which turns the planner into a long-term institutional memory rather than a temporary workspace.

### 9.2 Why month-based planning matters

It supports:

- campaign planning in advance
- internal review across periods
- reuse of successful concepts
- visibility into special client requests from earlier work
- easier seasonal and recurring-content planning

### 9.3 Planner fields as business process data

Each row combines creative, scheduling, and accountability data in one place. This is what makes the tool operationally stronger than a basic post scheduler.

### 9.4 Row colors

The job color system is used as a visual operational status marker. A row color is not decorative. It communicates readiness or blockage state.

Most importantly, the green ready color is used as part of the gating logic for scheduling readiness.

### 9.5 Month behavior

Past months remain viewable. They are for reference and learning, not for creating new scheduled work in the past.

### 9.6 Planner-first scheduling rule

Rows become scheduled posts from the planner. This is a deliberate control decision. It means the content pipeline is tied to structured planning data instead of bypassing the workflow.

## 10. Creative Management and Media Rules

The creative column is not a simple file field. It contains operational logic.

### 10.1 Creative uploads

Users can attach images and videos directly to planner rows. Those creatives then follow the row into scheduling and publishing.

### 10.2 Instagram and Facebook compatibility enforcement

For pages connected to both Facebook and Instagram, the app enforces a stricter creative rule:

- no multiple videos
- no mixing images and videos in one row for that combined path

This is designed to prevent real-world platform mismatch failures.

### 10.3 Instagram image ratio protection

The app checks uploaded images against acceptable Instagram image ratio limits. If an image is invalid for Instagram, the user gets an in-app cropper flow rather than discovering the problem only after scheduling.

### 10.4 In-app cropper

The cropper is intentionally constrained to Instagram-safe ratio presets:

- 4:5
- 1:1
- 1.91:1

This is a practical quality control feature. It prevents unsuitable assets from moving deeper into the workflow.

## 11. Scheduling Model

Scheduling is intentionally strict.

### 11.1 Scheduling source of truth

Actual scheduling is driven by the row's date and time values.

### 11.2 Deadline is not the schedule

The deadline field exists for internal production warning logic, not for publish timing. This is important because it separates:

- internal "work must be ready by this point"
- actual "the post goes live at this time"

### 11.3 Auto-scheduling window

The auto-scheduler monitors rows and automatically schedules qualifying planner rows when they are inside the configured lead window before the real post time.

The current lead window is 26 minutes so Facebook posts can still be handed off to Meta with a true 25-minute minimum buffer before publish time.

### 11.4 Conditions for scheduling

A row must be sufficiently complete and valid before it can become a scheduled post. This protects the system against garbage-in scheduling.

### 11.5 No past-date scheduling

The app rejects scheduling rows into the past. This protects operational sanity and prevents accidental invalid queue data.

## 12. Warning Email Logic

Warning emails are part of the internal management value of the system.

### 12.1 What warning emails are for

They are there to prevent silent failure inside the production process.

### 12.2 Current warning categories

The app currently sends warnings for:

- a job approaching scheduled time but not green-ready
- a row approaching deadline while important planning fields are still incomplete
- a row approaching deadline with no creative attached

### 12.3 Audience routing

The warning system distinguishes between:

- admin or Reviewer-style operational warnings
- designer-targeted creative warnings

That means the app does not just detect risk. It directs the warning toward the people responsible for acting on it.

## 13. Scheduled Queue and Posted History

The non-planner post views still matter, but they serve different purposes.

### 13.1 Scheduled Queue

The Scheduled Queue exists to monitor what has already been scheduled. It provides:

- list view
- calendar view
- page filters
- queue visibility
- backend cleanup actions

It is not the primary content authoring surface.

### 13.2 Posted History

The Posted tab is the record of what happened after scheduling. It provides:

- posted results
- failed results
- post history
- long-term cleanup ability
- backend storage maintenance

The company benefit is that old posts can be reviewed for performance context, inspiration, compliance memory, and content reuse.

## 14. Direct Posting Was Intentionally Removed

Earlier versions supported more direct post creation paths. The current system is deliberately more disciplined:

- direct post creation is disabled
- direct post editing is disabled
- direct publish-now behavior is disabled

This is important because it forces the business to operate through the planner, which is the intended production model.

That design decision reduces chaos and preserves planning integrity.

## 15. Platform Behavior by Network

The system does not treat every platform identically. Each network has its own operational path.

### 15.1 Meta: Facebook and Instagram

Meta is currently the strongest automation path in the product.

Key characteristics:

- global Meta token management
- Facebook App ID and App Secret stored in settings
- Facebook and Instagram account usage through shared Meta infrastructure
- real posting supported when live mode is enabled
- Instagram media handling depends on reachable public media URLs
- platform-specific restrictions are pre-checked in the planner where possible

Business value:

- fewer token-management mistakes
- stronger operational stability
- one control center for Meta-connected pages

### 15.2 LinkedIn

LinkedIn is currently handled in manual-assist mode because Community Management approval is pending on the LinkedIn side.

The current design is intentionally streamlined:

- LinkedIn remains selectable as a page platform
- the page stores a LinkedIn page URL
- the post still carries LinkedIn as part of its platform list
- when a LinkedIn-included post becomes relevant, the owner receives a structured popup
- the popup provides the post copy, creative previews, download actions, page link, and scheduled time
- the owner manually schedules the post on LinkedIn and marks the LinkedIn step done

This is a very important design choice. It allows the company to launch the operational system now instead of waiting for LinkedIn approval, while still keeping LinkedIn inside the same planning workflow.

### 15.3 X / Twitter

The codebase contains a live X integration path built around OAuth 1.0a credentials and media upload support. In practical deployment terms, it is available when valid credentials and access are present.

### 15.4 Pinterest

Pinterest support exists in the system for image-pin publishing through the platform integration path. It depends on correct tokens, reachable media URLs, and board selection rules.

## 16. Token and Credential Strategy

Credential sprawl is a major failure point in social media systems. This app reduces that.

### 16.1 Global Meta token model

Instead of forcing every Meta-connected account to be managed separately, the app centralizes the Meta token flow in settings. It then propagates that capability into Facebook and Instagram account behavior.

### 16.2 Global settings vs page overrides

The product distinguishes between:

- global defaults
- per-page overrides

This lets a company standardize most behavior while still handling exceptions.

### 16.3 Integration readiness checks

The Integrations tab provides a readiness layer that answers practical questions such as:

- are required credentials present
- are accounts complete enough to publish
- is media delivery properly configured
- are any warnings active before live mode is enabled

That is valuable because it moves diagnosis earlier in the workflow.

## 17. Live Posting vs Simulation

One of the strongest operational safety features is the global or page-level live posting switch.

### 17.1 Simulation mode

When live posting is disabled, the system can still run the workflow without actually hitting provider APIs. This is useful during onboarding, testing, training, and credential setup.

### 17.2 Live mode

When live posting is enabled, the system performs real API publishing where the provider path is operational.

### 17.3 Why this matters to a business

It allows a company to roll out the system responsibly rather than risking accidental public posting during setup.

## 18. Operational Flow from Start to Finish

The normal lifecycle of content in this system is:

1. A page is created.
2. Social accounts are attached to that page.
3. Global and page settings are configured.
4. The planner is used to create row-based content for the relevant month.
5. Designers and managers fill in fields, upload creatives, and move rows toward readiness.
6. Deadlines drive warning emails if work is incomplete.
7. Once a row is ready, it is scheduled from the planner.
8. The scheduler monitors due posts.
9. Real platform publishing occurs where live automation is available.
10. LinkedIn, for now, is completed through owner-driven manual assist.
11. Results appear in queue or history.
12. Old work remains available as an archive and reference source.

This is a full operational pipeline, not just a post form.

## 19. Why the Monthly Planner Makes the System Stronger

The monthly view is especially important for real company use.

It gives the business:

- a natural planning rhythm
- visibility across campaigns
- a reusable archive
- a stable content calendar structure
- easy cross-month idea retrieval
- better alignment between designers, managers, and scheduling staff

Many companies lose value by treating each post as isolated. This system preserves continuity.

## 20. Why This Improves a Company in Practice

If a company uses this system properly, the improvement is not theoretical. It changes day-to-day operations in concrete ways.

### 20.1 Better planning discipline

Because the planner is mandatory, content gets structured earlier and more consistently.

### 20.2 Fewer missed posts

The scheduler and warning system reduce reliance on memory and last-minute manual handling.

### 20.3 Better accountability

Rows show who is responsible, what is missing, what month it belongs to, and whether it is ready.

### 20.4 Fewer platform-related failures

Creative rules, ratio checks, token checks, and integration checks catch problems earlier.

### 20.5 Better leadership visibility

Managers can see pages, queue volume, posted history, planner state, and readiness without chasing people manually.

### 20.6 Better knowledge retention

Past campaigns remain available. That means the company keeps its own content memory instead of losing ideas over time.

### 20.7 Easier scaling

As more pages, clients, or branches are added, the company can keep a consistent operating model instead of inventing a new process every time.

### 20.8 Reduced bottlenecks

The system is designed so that not everything depends on one person remembering everything. The process becomes shared, visible, and trackable.

## 21. Design Strengths of the Current Build

The strongest qualities of the current build are:

- planner-first discipline
- page-based structure
- monthly archival thinking
- live/simulated safety split
- role-aware access
- hybrid automation where full automation is not yet possible
- concrete platform-specific validation
- centralized operational visibility

These qualities make it more valuable than a simple scheduler.

## 22. Current Boundaries and Honest Limitations

A strong system overview should also be honest about current boundaries.

- LinkedIn is in manual-assist mode, not full API automation
- full platform confidence on every network depends on credential readiness and live validation
- the system currently uses SQLite by default, which is fine for local/internal operation but not the same as a heavier multi-server deployment model
- the product is intentionally monolithic, which is a strength for simplicity, but it also means the app process owns API work, scheduling, and UI serving together

These are not necessarily weaknesses. In the current business context they are mostly pragmatic tradeoffs.

## 23. What This Product Really Becomes for a Company

If adopted properly, this application becomes:

- a social media planning board
- a design coordination layer
- a scheduling engine
- a publishing controller
- an operational warning system
- a permissions-managed internal tool
- a memory bank of past campaigns

That combination is what gives it real business value.

## 24. Final Summary

Sample SoMe-Auto is designed to make social media execution structured, reliable, and scalable.

Its biggest value is not that it can post to social platforms. Many tools can do that.

Its biggest value is that it creates an internal operating system for social media work:

- planning is centralized
- responsibilities are visible
- creatives are tied to real schedule rows
- deadlines trigger warnings
- publishing is controlled
- platform rules are enforced
- past work stays available
- the company becomes less dependent on chaos, memory, and informal communication

That is why this system can materially improve a company. It turns social media from a reactive task into a managed operational process.

