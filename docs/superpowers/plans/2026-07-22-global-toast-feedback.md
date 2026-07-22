# Global Toast and Error Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consistent, accessible, actionable notifications for user-triggered Navio operations.

**Architecture:** A session-only Zustand store owns a bounded typed toast queue. A root `ToastViewport` owns timers and rendering, while routes and stores use shared message narrowing to report operation outcomes without exposing technical details.

**Tech Stack:** React 19, TypeScript 6, Zustand 5, Tailwind CSS 4, Lucide React, Vitest, Testing Library.

## Global Constraints

- Add no third-party notification dependency.
- Keep inline form and modal validation inline.
- Keep low-level playback and background subscription warnings console-only.
- Show feedback for user-triggered Library, Playlists, Settings, and Downloader operations.
- Retain at most four notifications and suppress duplicate stacking.
- Respect reduced-motion preferences and provide accessible live-region behavior.
- Do not run a development server or production build.
- Do not perform git writes unless the user explicitly requests them.

---

### Task 1: Toast queue domain

**Files:**
- Create: `src/store/toastStore.ts`
- Create: `src/store/toastStore.test.ts`

**Interfaces:**
- Produces: `ToastVariant`, `ToastInput`, `ToastItem`, `useToastStore`, and `toast` convenience methods.
- Store actions: `show(input: ToastInput): string`, `dismiss(id: string): void`, and `clear(): void`.

- [ ] **Step 1: Write failing queue tests**

Cover default durations (`success`/`info` 4000 ms, `warning` 6000 ms, `error` 8000 ms), stable duplicate replacement, a four-item limit, dismissal, clearing, and preserving an optional action callback.

- [ ] **Step 2: Verify the tests fail for the missing module**

Run: `npm run test:unit -- src/store/toastStore.test.ts`

Expected: FAIL because `toastStore.ts` does not exist.

- [ ] **Step 3: Implement the typed store**

Use this public contract:

```ts
export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastInput {
  variant: ToastVariant;
  title: string;
  description?: string;
  dedupeKey?: string;
  durationMs?: number | null;
  action?: { label: string; run: () => void | Promise<void> };
}

export interface ToastItem extends ToastInput {
  id: string;
  durationMs: number | null;
}
```

Generate IDs with `crypto.randomUUID()` when available and a deterministic-safe timestamp/counter fallback otherwise. Deduplicate by `dedupeKey` or by variant/title/description. Reinsert refreshed duplicates at the newest position and cap the queue at four.

- [ ] **Step 4: Verify the queue tests pass**

Run: `npm run test:unit -- src/store/toastStore.test.ts`

Expected: all toast-store tests pass.

---

### Task 2: Accessible toast viewport

**Files:**
- Create: `src/components/ToastViewport.tsx`
- Create: `src/components/ToastViewport.test.tsx`
- Modify: `src/routes/__root.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `useToastStore((state) => state.toasts)` and `dismiss(id)`.
- Produces: root-mounted `ToastViewport` with automatic dismissal and optional actions.

- [ ] **Step 1: Write failing component tests**

Render a real store-backed viewport and assert semantic status/alert roles, visible title and description, manual close, fake-timer automatic dismissal, and an action that dismisses before invoking its callback once.

- [ ] **Step 2: Verify the component tests fail**

Run: `npm run test:unit -- src/components/ToastViewport.test.tsx`

Expected: FAIL because `ToastViewport.tsx` does not exist.

- [ ] **Step 3: Implement the viewport and toast item**

Render a fixed upper-right stack below the title bar at a z-index above Theater. Use `CircleCheck`, `CircleAlert`, `TriangleAlert`, `Info`, and `X`; semantic color accents; keyboard-accessible buttons; and one timer effect per item. Dismiss before running an action and catch action rejection by showing a new error toast.

- [ ] **Step 4: Add restrained animation styles**

Add `toast-enter` and `toast-exit` keyframes and disable movement under `prefers-reduced-motion: reduce`. Avoid layout-affecting animation properties.

- [ ] **Step 5: Mount the viewport once**

Place `<ToastViewport />` next to `KeyboardShortcuts` in the root body so route changes and Theater do not unmount it.

- [ ] **Step 6: Verify component and queue tests pass**

Run: `npm run test:unit -- src/store/toastStore.test.ts src/components/ToastViewport.test.tsx`

Expected: all focused tests pass without React warnings.

---

### Task 3: Safe error-message narrowing

**Files:**
- Create: `src/lib/errorMessage.ts`
- Create: `src/lib/errorMessage.test.ts`
- Modify: `src/routes/downloader.tsx`

**Interfaces:**
- Produces: `getErrorMessage(error: unknown, fallback: string): string`.

- [ ] **Step 1: Write failing helper tests**

Cover non-empty `Error.message`, non-empty string errors, whitespace-only strings, objects, null, and fallback trimming.

- [ ] **Step 2: Verify helper tests fail**

Run: `npm run test:unit -- src/lib/errorMessage.test.ts`

Expected: FAIL because `errorMessage.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Return trimmed messages only. Never serialize arbitrary objects or stack traces. Replace Downloader's local `getDownloadErrorMessage` with the shared helper.

- [ ] **Step 4: Verify helper and downloader domain tests pass**

Run: `npm run test:unit -- src/lib/errorMessage.test.ts src/lib/downloads.test.ts`

Expected: all focused tests pass.

---

### Task 4: Library and playlist operation feedback

**Files:**
- Modify: `src/store/libraryStore.ts`
- Modify: `src/routes/library.tsx`
- Modify: `src/components/CreatePlaylistModal.tsx`
- Modify: `src/components/PlaylistEditorModal.tsx`
- Modify: `src/routes/playlists.tsx`
- Test: `src/store/libraryStore.test.ts`

**Interfaces:**
- Consumes: `toast.success`, `toast.error`, and `getErrorMessage`.
- Changes: `addFolder()` returns `Promise<string | null>` and `deleteFolder(folder)` rethrows failures after restoring state.

- [ ] **Step 1: Write failing library-store tests**

Assert user-triggered scan and delete failures reject instead of being swallowed. Preserve dialog cancellation as a successful `null` result rather than an error.

- [ ] **Step 2: Verify the store tests fail**

Run: `npm run test:unit -- src/store/libraryStore.test.ts`

Expected: new rejection assertions fail against the current swallowed-error behavior.

- [ ] **Step 3: Update operation contracts**

Return the selected folder path from successful `addFolder`, return `null` on cancellation, rethrow scan/delete failures, and keep `isLoading` restoration in `finally`.

- [ ] **Step 4: Add Library route feedback**

Wrap Add folder and Remove folder clicks in named async handlers. Show success messages containing the folder name and contextual error messages via `getErrorMessage`.

- [ ] **Step 5: Add playlist feedback**

Keep validation errors inline in create/editor modals. After successful create, rename, delete, add-track, or remove-track actions, show concise success notifications. Show toast errors only for persistence/operation failures while retaining inline validation copy.

- [ ] **Step 6: Verify focused library and component tests**

Run: `npm run test:unit -- src/store/libraryStore.test.ts src/components/SettingsActionModal.test.tsx`

Expected: focused tests pass.

---

### Task 5: Settings and downloader feedback

**Files:**
- Modify: `src/routes/settings.tsx`
- Modify: `src/store/settingsStore.ts`
- Modify: `src/routes/downloader.tsx`
- Test: `src/store/settingsStore.test.ts`

**Interfaces:**
- Consumes: `toast.success`, `toast.error`, `toast.info`, and `getErrorMessage`.
- Settings updates continue returning `Promise<void>` and reject persistence failures.

- [ ] **Step 1: Write failing settings rollback tests**

Assert a failed `save_settings` call restores the previous settings value and rejects, preventing the UI from silently keeping an unpersisted preference.

- [ ] **Step 2: Verify the settings test fails**

Run: `npm run test:unit -- src/store/settingsStore.test.ts`

Expected: rollback assertion fails against the current optimistic-only behavior.

- [ ] **Step 3: Implement settings rollback and feedback handlers**

Restore the previous snapshot when persistence fails. Replace the temporary Settings message with toasts for folder updates and history clearing. Keep destructive modal errors inline and add a global error toast for persistence failures outside modal confirmation flows.

- [ ] **Step 4: Integrate Downloader feedback**

Keep URL and range validation inline. Show a success toast when a download is queued. Show errors for inspection/start/action/folder-open failures. Show concise success feedback for pause, resume/retry, cancel, and history removal. Do not toast every progress event or completed item event.

- [ ] **Step 5: Verify focused settings and downloader tests**

Run: `npm run test:unit -- src/store/settingsStore.test.ts src/lib/downloads.test.ts src/lib/errorMessage.test.ts`

Expected: focused tests pass.

---

### Task 6: Verification and roadmap alignment

**Files:**
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Mark the global toast roadmap item complete**

Convert the Milestone 2 toast bullet to a checked task while leaving the remaining Milestone 2 items pending.

- [ ] **Step 2: Run the complete frontend test suite**

Run: `npm run test:unit`

Expected: all frontend test files pass.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: exit code 0 with no ESLint errors.

- [ ] **Step 4: Run TypeScript validation**

Run: `npm run typecheck`

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 5: Inspect the final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors, no generated files, and only files listed in this plan plus the design and plan documents.
