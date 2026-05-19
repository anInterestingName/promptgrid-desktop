# Implementation Tasks

## M0: Project Foundation

- [x] Initialize Tauri + React + TypeScript + Vite.
- [x] Add lint and format scripts.
- [x] Add basic project README scripts.
- [x] Establish app folder structure.
- [x] Add placeholder app shell.

## M1: Mock Prototype

- [x] Build three-panel desktop layout.
- [x] Add project sidebar mock.
- [x] Add original prompt input.
- [x] Add style, aspect ratio, quality controls.
- [x] Generate 9 mock prompt variants.
- [x] Edit prompt variants.
- [x] Build 3x3 grid component.
- [x] Simulate local generation queue.
- [x] Show task states per cell.
- [x] Add image preview modal.
- [x] Add cell regenerate mock.
- [x] Add cell expand mock.
- [x] Add export button placeholders.
- [x] Add Chinese/English interface switching.
- [x] Add switchable color theme system.

## M2: Local Persistence

- [x] Add SQLite integration.
- [x] Create `projects` table.
- [x] Create `image_tasks` table.
- [x] Create `settings` table.
- [x] Persist local project state.
- [x] Persist task state.
- [ ] Save generated images into project folder.
- [ ] Reopen recent projects.

## M3: Real AI Integration

- [ ] Add provider abstraction.
- [x] Add API key settings UI.
- [x] Store API key securely or behind local command boundary.
- [ ] Implement prompt variant provider.
- [ ] Implement image provider.
- [ ] Add retry behavior.
- [ ] Add provider error mapping.
- [ ] Add basic cost/usage display if available.

## M4: Export

- [ ] Export single original image.
- [ ] Compose 3x3 grid PNG.
- [ ] Export grid PNG.
- [ ] Add export naming rules.
- [ ] Add export error handling.

## M5: Productization

- [ ] Add Windows build script.
- [ ] Add macOS build notes.
- [ ] Add local error logs.
- [ ] Add settings migration plan.
- [ ] Add project import/export format.

## Future Only

- [ ] Go cloud backend.
- [ ] Mini program.
- [ ] Mobile app.
- [ ] Web version.
- [ ] Account system.
- [ ] Cloud sync.
