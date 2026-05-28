# FangCun

[简体中文](./README.zh-CN.md)

FangCun is a local-first desktop workspace for AI visual direction
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

FangCun is not meant to be only a batch image generator. The core value is
AI-assisted prompt branching, grid-first comparison, cell-level iteration, and
local ownership of project history and assets.

## Next Development Plan: Grid Memory and Continue Creation

The next phase will redesign the current "expand from cell" action as a
"continue creation" or "refine direction" workflow for grid exploration only.

Target interaction:

```text
User likes one grid cell
-> clicks Continue Creation
-> the cell prompt becomes the seed idea for the next round
-> the generated cell image becomes the reference image
-> the text model creates adjustment plans and final image prompts
-> FangCun creates the next grid round
-> the user reviews or edits the prompts
-> the image model performs second-pass creation from the reference image
```

This belongs to the grid exploration workflow. The object-to-image workflow
needs to preserve one product or object identity, so it should not freely branch
from arbitrary detail cells. It should later use separate actions such as
"optimize main image", "edit detail image", or "replan detail images", always
anchored to the source image, main image, and detail-image role.

Round and attempt semantics should be split:

- `gridRound` represents one complete exploration board and owns the direction
  structure.
- `cellAttempt` represents one generation attempt for a single cell and owns the
  per-cell version history.

Rules:

- The first analyzed and generated grid is `gridRound = 1`.
- Regenerating one cell does not create a new `gridRound`; it only increments or
  records that cell's `cellAttempt`.
- Regenerating the current full grid does not create a new `gridRound`; it
  records new attempts for the affected cells.
- Continuing from one selected cell creates `gridRound + 1`.
- Reanalyzing from the original idea can also create a new `gridRound`, marked
  with `root_prompt` as the source.

The foundation should be append-only generation logs, so memory is built from
traceable facts instead of only the current cell state. Suggested ownership:

- Conversation folders store raw logs as the source of truth.
- SQLite stores indexes, current state, and fast lookup fields.

Conversation folders can be organized by round:

```text
conversation-xxx/
  conversation.json
  grid-runs/
    grid-9/
      round-001/
        round.json
        analysis-log.jsonl
        generation-log.jsonl
        cells/
          cell-001/
            attempts/
              attempt-001.json
              attempt-002.json
            images/
              attempt-001.png
```

Each attempt log should record the operation type, input prompts, input images,
model parameters, round context, parent cell, adjustment plan, final prompt,
output image path, errors, duration, and whether the user adopted or favorited
the result. Higher-level features such as rollback, comparison, preference
memory, continue creation, and analysis memory can then be built from these
logs.

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

The desktop dev server uses a separate Vite port at `http://127.0.0.1:1421`,
so it can run alongside the browser UI.

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
npm run dev:tauri-ui Start the Vite UI used by Tauri at http://127.0.0.1:1421
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

- Redesign grid exploration around continue creation and direction refinement.
- Add conversation-folder logs for every grid round and cell attempt.
- Use SQLite for current state, indexes, and log summaries.
- Let prompt analysis read round, parent-cell, reference-image, and user-edit
  context.
- Separate cell action semantics for grid exploration and object-to-image.
- Implement real retry, regenerate, continue creation, and export flows.
- Add Windows and macOS packaging notes.

## License

See [LICENSE](./LICENSE).
