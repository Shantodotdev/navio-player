# Global Toast and Error Feedback Design

## Goal

Give Navio consistent, actionable feedback for user-triggered operations without turning transient player diagnostics into notification noise.

## Scope

The first pass covers user-triggered operations in Library, Playlists, Settings, and Downloader. It includes success, information, warning, and error notifications; automatic and manual dismissal; duplicate suppression; bounded stacking; and optional actions such as Retry.

Inline validation remains inside forms and confirmation modals because those errors are most useful beside the relevant control. Low-level playback, media preparation, background subscription, and browser-development warnings remain in the console unless a user-facing recovery action exists.

## Architecture

A dedicated Zustand store owns the session-only toast queue. It exposes typed actions to add, dismiss, and clear notifications. The store accepts an optional stable deduplication key and otherwise derives one from the notification content. Repeated matching notifications refresh the existing item instead of producing a stack of duplicates.

One root-level `ToastViewport` renders the queue above routes, the Now Playing drawer, and Theater. The component owns dismissal timers because timer lifecycle belongs to the mounted renderer rather than the state container. At most four notifications are retained, with the oldest non-persistent item removed first when the limit is reached.

No third-party notification dependency is added.

## Notification Contract

Each toast contains:

- A generated identifier.
- A `success`, `error`, `warning`, or `info` variant.
- A concise title.
- An optional supporting description.
- An optional deduplication key.
- An optional action label and callback.
- An optional duration override.

Success and information notifications dismiss after four seconds. Warnings dismiss after six seconds. Errors dismiss after eight seconds. An explicit persistent duration disables automatic dismissal. Every notification remains manually dismissible.

## Interaction and Visual Behavior

Notifications appear in the upper-right content area below Navio's title bar so they remain visible without covering player controls. They use Navio's dark panels, subtle borders, maroon brand accent, and semantic icon colors. New items animate in with restrained translation and opacity; dismissal uses a short exit transition. Reduced-motion preferences remove meaningful movement.

The viewport is an ARIA live region. Errors use assertive announcement semantics, while other variants use polite announcements. Close and action controls are keyboard accessible. An action runs once and dismisses its toast immediately before starting the callback.

## Initial Integrations

- Library: folder scan success/failure and folder removal success/failure.
- Playlists: create, rename, delete, add-track, and remove-track success/failure. Inline naming validation remains in its modal.
- Settings: download-folder changes, download-history clearing, reset failures, and settings-save failures. Full reset success is followed by reload and does not require a visible toast.
- Downloader: inspection, start, pause, resume/retry, cancel, removal, and folder-open failures; successful state-changing actions receive concise confirmation where useful.

Operations continue to throw or return errors according to their existing contracts. UI event handlers catch those failures and show contextual messages. Store methods that currently swallow user-triggered failures are changed to rethrow after restoring loading state, allowing the initiating UI to decide the message and recovery action.

## Error Messages

Unknown thrown values are narrowed through one shared helper. Meaningful backend strings are preserved when safe to show. Empty, technical, or unavailable messages fall back to operation-specific language. Notifications do not expose local implementation details, stack traces, or secrets.

## Testing

Unit tests cover queue limits, duplicate replacement, variant defaults, manual dismissal, and clearing. Component tests cover rendering, accessibility roles, timer dismissal, close controls, and single-run actions. Integration-focused tests cover the error-message helper and representative Library or Settings operation feedback.

The completed frontend change is verified with focused Vitest tests, ESLint, and TypeScript checks. No development server or production build is required.

## Non-Goals

- Persisting notifications across restarts.
- A notification history screen.
- Native operating-system notifications.
- Toasting every playback or background synchronization warning.
- Replacing inline form validation or destructive-action confirmation dialogs.
