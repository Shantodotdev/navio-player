# Shuffle and Repeat Playback Design

## Goal

Make the existing Player Bar shuffle and repeat controls functional while keeping queue behavior consistent across the Player Bar, Now Playing drawer, theater view, watch route, and MCP-controlled playback.

Shuffle and repeat are session-only playback state. Both reset to off whenever Navio starts.

## Playback Modes

Shuffle is a boolean mode. Enabling it keeps the current track playing, preserves the canonical playlist shown in Now Playing, and randomizes only the remaining tracks. Disabling it resumes navigation through the canonical playlist from the current track.

Repeat has three modes and cycles in this order:

1. `off`
2. `all`
3. `one`
4. `off`

Repeat-one applies only when media ends naturally. Pressing Next still advances to another track. Repeat-all wraps after the final track. Repeat-off stops playback after the final track.

## Shared Player State

`playerStore` owns all playback-mode state and transitions:

- `shuffleEnabled`: whether shuffled traversal is active.
- `repeatMode`: `"off" | "all" | "one"`.
- A shuffled order of track IDs for the current cycle.
- A playback history of track IDs used by Previous while shuffle is active.

The canonical `playlist` remains unchanged so enabling shuffle never visually rearranges the queue. Track IDs, rather than indexes, keep shuffled state valid when queue indexes change.

The store exposes actions to toggle shuffle, cycle repeat mode, advance after natural media completion, and navigate Next or Previous. All media surfaces call these shared actions instead of implementing mode logic locally.

## Shuffle Traversal

Enabling shuffle creates an order containing every other current playlist track exactly once. The active track remains unchanged and begins the playback history.

Next consumes the shuffled order. Previous returns through actual shuffled playback history. Moving backward makes the departed track available to Next again so forward navigation remains coherent.

At the end of a shuffled cycle:

- Repeat-off stops playback.
- Repeat-all creates a fresh shuffled order and continues without immediately selecting the same track when another track exists.
- Repeat-one restarts the current track only on natural completion.

Disabling shuffle clears shuffled traversal state and resolves the current track's canonical playlist index before normal navigation resumes.

Queue additions and removals rebuild or filter the pending shuffled order without replaying tracks already visited in the current cycle. Removing the current track continues to use the store's existing replacement behavior, then resets shuffled history around that replacement.

## Natural End, Manual Navigation, and Errors

The Now Playing media element and watch route replace direct `nextTrack()` calls in `onEnded` with a dedicated natural-completion action:

- Repeat-one seeks to zero and starts the same media again.
- Otherwise, playback advances according to shuffle and repeat-all.
- At the final track with repeat-off, playback stops at the completed duration without clearing the queue.

Manual Next and Previous do not trigger repeat-one. Playback errors also bypass repeat-one and try another track so a broken media file cannot loop indefinitely.

## Player Bar UI

The existing Shuffle and Repeat buttons become typed controls with disabled states when no track is loaded.

- Shuffle uses the brand color while active.
- Repeat uses the brand color for repeat-all.
- Repeat-one uses the brand color and a small `1` badge on the icon.
- Repeat button labels describe the next transition: enable repeat-all, enable repeat-one, or disable repeat.
- Shuffle labels announce whether shuffle is currently on or off.

No new keyboard shortcuts or persisted settings are added.

## Verification

Store tests cover normal traversal, repeat-off stopping, repeat-all wrapping, repeat-one natural completion, manual Next while repeat-one is active, shuffled uniqueness, shuffled history, disabling shuffle, and queue mutation. Component-level inspection verifies button state, labels, and repeat-one indicator wiring. Relevant frontend checks run because this changes core playback behavior.
