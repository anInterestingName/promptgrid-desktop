# PromptGrid Desktop

PromptGrid Desktop is a local-first desktop app for AI visual direction exploration.

The first version focuses on a simple loop:

```text
Input one idea
-> split it into 9 prompt directions
-> generate a 3x3 image grid
-> compare results
-> regenerate or expand from a selected cell
-> save everything locally
```

## Status

Project initialized with a Tauri v2 + React + TypeScript + Vite scaffold, Chinese/English UI support, and a local mock 3x3 prototype. AI calls, SQLite persistence, and export generation are intentionally still mocked or placeholder-only.

## Phase 1 Principle

Phase 1 is local-first:

- No custom cloud backend.
- No login.
- No cloud sync.
- No mini program or mobile app.
- User configures their own AI API key.
- Projects, images, prompts, tasks, and exports live on the user's machine.

## Planned Stack

```text
Tauri v2
React + TypeScript + Vite
Rust Tauri commands
SQLite
Local filesystem storage
External AI APIs
```

## Docs

- [Agent Guide](./agent.md)
- [Product Brief](./docs/product-brief.md)
- [Technical Plan](./docs/technical-plan.md)
- [Roadmap](./docs/roadmap.md)
- [Implementation Tasks](./docs/implementation-tasks.md)
- [Decision Log](./docs/decision-log.md)

## Scripts

```text
npm run dev          # Start the Vite web UI for frontend development.
npm run build        # Type-check and build the frontend.
npm run lint         # Run ESLint.
npm run format       # Format project files with Prettier.
npm run tauri:dev    # Start the Tauri desktop app. Requires Rust/Cargo.
npm run tauri:build  # Build the Tauri desktop app. Requires Rust/Cargo.
```

The broader idea-stage planning archive is in:

```text
../../ideas/ai-image-grid-desktop-app/
```

## Next Step

Add local persistence with SQLite and project-owned image storage, then connect real provider implementations behind the planned API boundaries.
