# Shuffle and Repeat Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session-only Spotify-style shuffle and repeat behavior to Navio's shared player and Player Bar controls.

**Architecture:** Keep the canonical playlist unchanged and store shuffled pending IDs plus played-history IDs in `playerStore`. Route natural media completion through a dedicated action so repeat-one differs from manual Next, then bind the existing Player Bar buttons to the shared state.

**Tech Stack:** React 19, TypeScript, Zustand 5, Vitest, Tailwind CSS 4, Lucide React

## Global Constraints

- Shuffle and repeat reset to off on each Navio launch.
- Repeat cycles `off → all → one → off`.
- Shuffle keeps the current track and canonical queue order unchanged.
- Repeat-one applies only to natural completion; manual Next and playback errors advance.
- Do not add dependencies, persisted settings, keyboard shortcuts, or git commits.

---

### Task 1: Shared playback-mode state machine

**Files:**
- Create: `src/store/playerStore.test.ts`
- Modify: `src/store/playerStore.ts`

**Interfaces:**
- Produces: `RepeatMode = "off" | "all" | "one"`
- Produces: state fields `shuffleEnabled`, `repeatMode`, `shufflePendingIds`, `shuffleHistoryIds`
- Produces: actions `toggleShuffle(): void`, `cycleRepeatMode(): void`, `handleTrackEnded(): void`
- Preserves: `nextTrack(): void` and `prevTrack(): void` for UI and MCP consumers

- [ ] **Step 1: Add deterministic store tests**

Create fixtures for three tracks and a narrow media-element stub. Reset all new playback fields in `beforeEach`. Cover:

```ts
it("stops at the final track when repeat is off", () => {
  seedAt(trackThree, 2);
  usePlayerStore.getState().handleTrackEnded();
  expect(usePlayerStore.getState()).toMatchObject({
    currentTrack: trackThree,
    playIndex: 2,
    isPlaying: false,
  });
});

it("restarts natural completion in repeat-one but lets manual Next advance", () => {
  seedAt(trackOne, 0);
  usePlayerStore.setState({ repeatMode: "one" });
  usePlayerStore.getState().handleTrackEnded();
  expect(media.currentTime).toBe(0);
  usePlayerStore.getState().nextTrack();
  expect(usePlayerStore.getState().currentTrack).toBe(trackTwo);
});

it("visits each shuffled track once and Previous follows history", () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  seedAt(trackOne, 0);
  usePlayerStore.getState().toggleShuffle();
  usePlayerStore.getState().nextTrack();
  const shuffledTrack = usePlayerStore.getState().currentTrack;
  usePlayerStore.getState().prevTrack();
  expect(usePlayerStore.getState().currentTrack).toBe(trackOne);
  usePlayerStore.getState().nextTrack();
  expect(usePlayerStore.getState().currentTrack).toBe(shuffledTrack);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npm run test:unit -- src/store/playerStore.test.ts`

Expected: failures because the playback-mode fields and actions do not exist.

- [ ] **Step 3: Implement shared traversal helpers and actions**

Add typed helpers for shuffling IDs, loading a selected track, stopping at the queue end, and rebuilding pending shuffle IDs. `nextTrack` consumes pending shuffled IDs or advances canonically; `prevTrack` walks shuffle history; `handleTrackEnded` restarts repeat-one or delegates to traversal with natural-end semantics.

Core contract:

```ts
export type RepeatMode = "off" | "all" | "one";

interface PlayerState {
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  shufflePendingIds: string[];
  shuffleHistoryIds: string[];
  toggleShuffle: () => void;
  cycleRepeatMode: () => void;
  handleTrackEnded: () => void;
}
```

When repeat-off reaches the end, set only `isPlaying: false`. When repeat-all reaches the end in shuffle mode, generate a fresh cycle excluding the current ID before selecting its first track.

- [ ] **Step 4: Run the focused store tests**

Run: `npm run test:unit -- src/store/playerStore.test.ts`

Expected: all tests in the new file pass.

---

### Task 2: Natural media completion wiring

**Files:**
- Modify: `src/components/NowPlayingDrawer.tsx`
- Modify: `src/routes/watch.tsx`

**Interfaces:**
- Consumes: `handleTrackEnded(): void` from `playerStore`
- Preserves: `nextTrack(): void` for playback-error recovery and manual controls

- [ ] **Step 1: Replace natural-end advancement**

Destructure `handleTrackEnded` from the store in both media surfaces and replace only the `nextTrack()` call inside each `onEnded` handler:

```tsx
onEnded={() => {
  // Preserve the existing theater-state persistence first.
  handleTrackEnded();
}}
```

Do not replace `handleMediaError` advancement or manual Next button callbacks.

- [ ] **Step 2: Inspect both event paths**

Run: `rg -n -C 8 "onEnded|handleTrackEnded|handleMediaError" src/components/NowPlayingDrawer.tsx src/routes/watch.tsx`

Expected: both `onEnded` handlers call `handleTrackEnded`; error recovery still calls `nextTrack`.

---

### Task 3: Player Bar controls and final verification

**Files:**
- Modify: `src/components/PlayerBar.tsx`

**Interfaces:**
- Consumes: `shuffleEnabled`, `repeatMode`, `toggleShuffle()`, `cycleRepeatMode()`

- [ ] **Step 1: Bind Shuffle and Repeat controls**

Destructure the four store members. Add typed click handlers, disabled states without a current track, active brand color, accessible labels, and the repeat-one badge:

```tsx
<button
  type="button"
  onClick={toggleShuffle}
  disabled={!currentTrack}
  aria-label={shuffleEnabled ? "Disable shuffle" : "Enable shuffle"}
  className={shuffleEnabled ? "text-brand-light" : "text-zinc-400"}
>
  <Shuffle size={15} />
</button>

<button
  type="button"
  onClick={cycleRepeatMode}
  disabled={!currentTrack}
  aria-label={repeatLabel}
  className="relative"
>
  <Repeat size={15} />
  {repeatMode === "one" && <span aria-hidden="true">1</span>}
</button>
```

- [ ] **Step 2: Run relevant frontend verification**

Run: `npm run test:unit -- src/store/playerStore.test.ts src/lib/mcpControl.test.ts`

Expected: all selected tests pass.

Run: `npm run lint`

Expected: ESLint exits successfully with no errors.

- [ ] **Step 3: Inspect final changes**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only the design, plan, player store/test, Player Bar, Now Playing drawer, and watch route are modified or new.
