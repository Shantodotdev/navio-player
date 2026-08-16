# Platform-native window chrome implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use native macOS and Linux title bars while preserving Navio's custom Windows title bar.

**Architecture:** Tauri platform-specific configuration owns whether the window is decorated. The React title bar reads the actual decoration state instead of independently detecting an operating system, and the existing decoration-changing fullscreen workaround is compiled only for Windows.

**Tech Stack:** Tauri 2 configuration, Rust, React 19, TypeScript, Vitest

## Global constraints

- Keep the custom frameless title bar on Windows.
- Use native window decorations on macOS and Linux.
- Preserve the custom title bar in browser development.
- Add no operating-system dependency or user-agent detection.
- Do not run a development server or application build.
- Do not create Git commits without explicit user permission.

---

### Task 1: Platform-specific Tauri decorations

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Create: `src-tauri/tauri.windows.conf.json`
- Modify: `src-tauri/src/commands.rs`

**Interfaces:**
- Produces: decorated main windows by default and an undecorated main window on Windows.
- Preserves: `set_theater_fullscreen(app_handle, fullscreen) -> Result<bool, String>`.

- [ ] **Step 1: Parse the shared config and demonstrate that native decorations are currently disabled**

Run a Node assertion that expects `app.windows[0].decorations === true`; it must fail while the shared value is `false`.

- [ ] **Step 2: Enable shared native decorations and add the complete Windows override**

Set `decorations` to `true` in `tauri.conf.json`. Add `tauri.windows.conf.json` with the same main-window properties and `decorations: false` so platform merging cannot discard size, title, or startup state.

- [ ] **Step 3: Keep theater decoration mutations Windows-only**

Wrap the temporary `set_decorations(true)` on fullscreen entry and `set_decorations(false)` on exit in `#[cfg(windows)]` blocks. macOS and Linux should call only `set_fullscreen` and `set_focus`.

- [ ] **Step 4: Parse both configs and verify their effective decoration policies**

Run a Node assertion for shared `true` and Windows override `false`.

### Task 2: Decoration-aware React title bar

**Files:**
- Modify: `src/components/Titlebar.tsx`
- Create: `src/components/Titlebar.test.tsx`

**Interfaces:**
- Produces: `shouldUseCustomTitlebar(isTauriRuntime: boolean, isDecorated: boolean | null): boolean`.
- Consumes: `getCurrentWindow().isDecorated(): Promise<boolean>` from `@tauri-apps/api/window`.

- [ ] **Step 1: Write failing behavior tests**

Test that browser development renders the custom bar, an undecorated Tauri window renders it, and a decorated Tauri window does not.

- [ ] **Step 2: Run the focused test and confirm the missing policy fails**

Run `npm test -- src/components/Titlebar.test.tsx`.

- [ ] **Step 3: Implement decoration-aware rendering**

Keep browser development enabled by default. In Tauri, obtain the current window, query `isDecorated`, save the window for button actions, and render the controls only when the window reports `false`. Ignore late async results after unmount and log a bounded warning if the query fails.

- [ ] **Step 4: Run focused and project checks**

Run `npm test -- src/components/Titlebar.test.tsx`, `npm run lint`, `cargo fmt --check`, and `cargo clippy`.

- [ ] **Step 5: Inspect the final diff**

Run `git diff --check` and confirm only the agreed configuration, fullscreen, title-bar, test, spec, and plan files changed.
