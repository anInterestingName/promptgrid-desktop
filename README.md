# PromptGrid Desktop

[简体中文](./README.zh-CN.md)

PromptGrid Desktop is a local-first desktop workspace for AI visual direction
exploration. It turns one creative idea into a grid of editable prompt
directions, then helps users compare, regenerate, expand, and export image
results from that grid.

## Current Status

This repository currently contains a working mock prototype built with Tauri v2,
React, TypeScript, and Vite.

Implemented:

- Desktop app shell through Tauri.
- Three-panel visual exploration workspace.
- Original prompt input and editable prompt variants.
- Mock 3x3 image generation grid.
- Per-cell task states, preview modal, regenerate, and expand actions.
- Chinese/English UI switching.
- Switchable color theme system.

Not implemented yet:

- Real AI provider calls.
- SQLite persistence.
- Local project-owned image storage.
- Real single-image and grid export generation.

## Product Idea

The first product loop is intentionally simple:

```text
Input one idea
-> split it into 9 prompt directions
-> generate a 3x3 image grid
-> compare results
-> regenerate weak cells or expand from strong cells
-> save/export everything locally
```

PromptGrid is not meant to be only a batch image generator. The core value is
AI-assisted prompt branching, grid-first comparison, cell-level iteration, and
local ownership of project history and assets.

## Phase 1 Principles

- Desktop only.
- Local-first data model.
- No custom cloud backend.
- No login or account system.
- No cloud sync.
- No mini program or mobile app.
- Users configure their own AI API keys.
- Projects, images, prompts, tasks, and exports live on the user's machine.

## Tech Stack

```text
Desktop shell: Tauri v2
Frontend: React + TypeScript + Vite
State: Zustand
UI primitives: Radix UI
Icons: lucide-react
Local command layer: Rust Tauri commands
Planned database: SQLite
Planned storage: Local filesystem project folders
Planned providers: External text and image AI APIs
```

## Requirements

For frontend-only development:

- Node.js compatible with Vite 7.
- npm.

For the desktop app:

- Rust/Cargo.
- Tauri v2 system prerequisites for the target OS.
- On Windows: WebView2 and MSVC build tools.

## Quick Start

Install dependencies:

```bash
npm install
```

Start the web UI in a browser:

```bash
npm run dev
```

Start the desktop app:

```bash
npm run tauri:dev
```

Build the frontend:

```bash
npm run build
```

Build the desktop app package:

```bash
npm run tauri:build
```

## Scripts

```text
npm run dev          Start the Vite web UI at http://127.0.0.1:1420
npm run build        Type-check and build the frontend
npm run preview      Preview the production frontend build
npm run tauri        Run the Tauri CLI
npm run tauri:dev    Start the Tauri desktop app in development mode
npm run tauri:build  Build the Tauri desktop app package
npm run lint         Run ESLint
npm run format       Format project files with Prettier
```

## Project Structure

```text
.
|-- src/                  React application source
|   |-- components/        Workspace, sidebar, prompt panel, and top bar
|   |-- data/              Mock project data
|   |-- state/             Zustand store
|   `-- styles/            App styles
|-- src-tauri/            Tauri v2 Rust application shell
|   |-- capabilities/      Tauri capability configuration
|   |-- icons/             App icons for desktop packaging
|   `-- src/               Rust entry points and commands
|-- docs/                 Product and implementation planning docs
`-- dist/                 Frontend production build output
```

## Documentation

- [Agent Guide](./agent.md)
- [Product Brief](./docs/product-brief.md)
- [Technical Plan](./docs/technical-plan.md)
- [Roadmap](./docs/roadmap.md)
- [Implementation Tasks](./docs/implementation-tasks.md)
- [Decision Log](./docs/decision-log.md)

The broader idea-stage planning archive is in:

```text
../../ideas/ai-image-grid-desktop-app/
```

## Roadmap

Next focus areas:

- Add SQLite-backed local persistence.
- Save generated images into project-owned folders.
- Add provider boundaries for text and image AI services.
- Add secure API key settings.
- Implement real retry, regenerate, expand, and export flows.
- Add Windows and macOS packaging notes.

## License

See [LICENSE](./LICENSE).
