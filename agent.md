# FangCun Agent Guide

## Project Identity

`fangcun-desktop` is the implementation project for FangCun / 方寸画境, a local-first desktop app for AI visual direction exploration.

The product is not a generic batch image generator. Its core workflow is:

```text
One creative idea
-> AI splits it into multiple prompt directions
-> Local queue generates a 3x3 image grid
-> User compares, edits, regenerates, and expands a selected cell
-> Project history and assets stay on the user's machine
```

## Current Product Decision

Phase 1 is strictly local-first:

- No custom cloud backend.
- No account system.
- No cloud sync.
- No server-side task queue.
- No mini program.
- No mobile app.
- No payment or built-in credit system.
- User brings their own AI API key.
- Projects, prompts, images, settings, task states, and exports are stored locally.

Future expansion can include a Go cloud backend, mini program, mobile app, and Web version, but those are roadmap items only after the desktop product is validated.

## Recommended Stack

Initial implementation:

```text
Desktop shell: Tauri v2
Frontend: React + TypeScript + Vite
UI primitives: Radix UI or shadcn/ui
Icons: lucide-react
State: Zustand
Local database: SQLite
Local runtime layer: Rust via Tauri commands
HTTP client: Rust reqwest
Image processing: Rust image crate
Storage: app data directory plus optional user-selected output folder
```

Do not introduce Go, Python, Java, cloud services, or a remote database into Phase 1 implementation unless the plan is explicitly updated.

## MVP Scope

MVP must support:

- Create/open local project.
- Input original prompt.
- Generate 9 prompt variants through an AI text model.
- Edit each prompt variant.
- Generate 3x3 images through an image API.
- Show per-cell task states: pending, running, completed, failed, cancelled.
- Retry failed cell.
- Regenerate completed cell.
- Expand from a selected cell into a new 3x3 exploration round.
- Preview single image.
- Export single image.
- Export composed grid image.
- Save local history in SQLite.

MVP should not include:

- 4x4 or 5x5 as core requirement.
- CSV import.
- Cloud sync.
- Account/login.
- Team workspace.
- Local model deployment.
- Reference-image advanced variations.

## Architecture Rules

- Keep AI provider access behind an interface so OpenAI is not hard-coded across the app.
- Keep project data model stable with durable IDs, not filesystem paths as primary identity.
- Use local queue semantics for image generation; each grid cell is an independent task.
- Persist task state often enough that app restart does not destroy completed work.
- Store generated images under a project-owned folder.
- Keep API keys out of logs, screenshots, exported project files, and normal text settings.
- Keep frontend UI state separate from persisted project state.
- Prefer small, typed commands between React and Rust.

## Product Experience Rules

- The grid is the main workspace, not an afterthought.
- "Analyze prompts" and "Generate images" are separate user actions.
- "Regenerate" means rerun the same cell prompt.
- "Expand" means use one cell as the seed for a new set of prompt directions.
- Show completed images immediately; never wait for all tasks to finish before rendering partial results.
- Failure must be recoverable from the cell itself.
- Desktop UI should feel like a quiet productivity tool, not a marketing landing page.

## Source Planning Docs

The idea-stage docs live at:

```text
../../ideas/ai-image-grid-desktop-app/
```

Important files:

- `plan.md`
- `prd.md`
- `tasks.md`
- `research.md`
- `prototype-notes.md`
- `roadmap.md`

This implementation project should keep a concise copy of working docs under `docs/`, while the idea folder remains the broader planning archive.

## Current Next Step

Before coding product features:

1. Initialize Tauri + React + TypeScript.
2. Add basic lint/format scripts.
3. Build the mock 3x3 prototype.
4. Keep AI calls mocked until the core UI flow is usable.
5. Then add local SQLite and real AI provider calls.
