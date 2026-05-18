# Roadmap

## Phase 1: Local Desktop MVP

Goal:

Validate the local desktop workflow.

Scope:

- Tauri + React application scaffold.
- Mock 3x3 grid prototype.
- Prompt analysis mock.
- Local generation queue mock.
- Real prompt variant API.
- Real image generation API.
- SQLite project history.
- Local image storage.
- Single image export.
- Grid export.

Explicitly out of scope:

- Cloud backend.
- Login.
- Cloud sync.
- Mini program.
- Mobile app.
- Payment.

## Phase 2: Local Desktop Beta

Goal:

Improve desktop productivity without adding cloud complexity.

Scope:

- 4x4 and 5x5 grids.
- Style templates.
- Batch export.
- CSV prompt import.
- Cost estimate.
- Project import/export.
- Reference image experiments.

## Phase 3: Desktop Productization

Goal:

Make the app distributable.

Scope:

- Windows installer.
- macOS package.
- Auto update.
- Error logs.
- API key secure storage.
- Settings migration.
- Local backup/restore.

## Phase 4: Cloud Backend Preparation

Only start after desktop validation.

Possible stack:

```text
Go API backend
PostgreSQL
Redis / Asynq / Temporal
Object storage
Auth
Billing or credit system
```

Cloud backend responsibilities:

- Accounts.
- Cloud projects.
- Cross-device sync.
- Shared generation queue.
- Cloud image storage.
- Usage and cost accounting.

## Phase 5: Mini Program

Positioning:

Lightweight viewing, sharing, and quick generation.

Not a full replacement for the desktop workspace.

## Phase 6: Mobile App

Positioning:

Mobile project review, collection, sharing, and light generation.

Likely stack:

```text
React Native / Expo
or Flutter
```

## Phase 7: Web Version

Positioning:

Trial, sharing, and lightweight account access.

Web should not be started before the desktop workflow is proven.
