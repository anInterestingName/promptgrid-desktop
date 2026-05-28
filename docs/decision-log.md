# Decision Log

## 0001: Use Local-First Desktop Architecture

Decision:

Phase 1 will be a local-first desktop app.

Rationale:

- Faster MVP.
- Avoids account, sync, payment, and backend complexity.
- Fits the product's positioning as a creative desktop workspace.
- Gives users direct ownership of project assets.

Consequences:

- User must bring their own AI API key.
- Cross-device sync is deferred.
- Mini program and mobile app are deferred.

## 0002: Use Tauri + React + TypeScript

Decision:

Use Tauri v2 with React + TypeScript + Vite.

Rationale:

- Tauri is suitable for lightweight desktop apps.
- Rust command layer fits local filesystem, SQLite, image export, and secure boundaries.
- React + TypeScript is productive for complex UI.

Consequences:

- Rust is required for local command work.
- Tauri mobile support is not treated as the mobile strategy for now.

## 0003: Defer Go Backend

Decision:

Do not implement Go backend in Phase 1.

Rationale:

- Current product goal is desktop validation.
- Cloud backend only becomes useful once accounts, sync, built-in credits, or multi-device use become necessary.

Consequences:

- Keep data models and provider boundaries migration-friendly.
- Revisit Go backend during the cloud preparation phase.

## 0004: Make Cell Expansion Core MVP

Decision:

Selected cell expansion is a P0 MVP workflow.

Rationale:

- Competitors already support multi-image results or variation workflows.
- FangCun needs a clear differentiator beyond batch generation.
- Expansion turns the app into an exploration workspace.

Consequences:

- The data model should support `parentTaskId` or exploration rounds.
- UI must clearly distinguish regenerate from expand.

## 0005: Defer CSV Batch Import

Decision:

CSV prompt import is deferred to Beta.

Rationale:

- It is useful for production workflows, but it shifts the product toward generic batch generation.
- MVP should focus on single-idea exploration.

Consequences:

- Keep prompt variant data structured enough to support import later.
