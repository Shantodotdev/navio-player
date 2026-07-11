# AGENTS.md

## Project

Navio Player is a local-first desktop media player and downloader. It is built as a Tauri 2 application with a Vite/TanStack Start SPA frontend and a Rust backend.

The frontend uses React 19, TypeScript, TanStack Router, Tailwind CSS 4, Zustand, and Vidstack. The Rust backend handles local library scanning, JSON persistence, media streaming, Tauri commands, and downloader operations.

The product is designed to work without accounts or a remote application backend. Treat local privacy, safe filesystem access, and reliable playback as core requirements.

## Working Rules

- Follow the user's current request first.
- For simple tasks, make the smallest focused change without writing a plan.
- Do not run lint, tests, type checks, builds, or development servers after every small change; the user will test small changes.
- After major coding work, run the relevant checks for both frontend and tauri (rust)
- Never run `npm run dev`, `npm run tauri dev`, or build commands without explicit permission.
- Use `npm install` for dependency changes so `package.json` and `package-lock.json` stay synchronized.
- Preserve unrelated user changes.
- Never run git write commands unless the user explicitly asks.
- Do not use `any`; keep TypeScript strict and prefer precise types.
- Never read or expose secrets from environment files or local machine configuration.
- Do not hand-edit generated files, including `src/routeTree.gen.ts`, `dist/`, `src-tauri/target/`, or generated lockfile content.
- Use cmd for commands, not powershell. When giving commands to the user, use normal commands such as `npm run dev`.

## Sources Of Truth

For substantial work, read:

1. `AGENTS.md`
2. `README.md`
3. The relevant design/spec document under `docs/`
4. The affected frontend and/or Rust code

For small tasks, read this file and the affected code.

- Current implementation details come from the live code and `package.json`.
- Product behavior comes from the README, design specs, and existing UI unless the user requests a change.
- Preserve the existing visual direction and local-first architecture unless the user asks for a redesign or architectural change.

## Project Structure

- `src/routes/` — TanStack Router route components.
- `src/components/` — shared React UI components.
- `src/store/` — shared browser state managed with Zustand.
- `src/hooks/` — reusable React hooks.
- `src/lib/` — frontend utilities and domain helpers.
- `src/styles.css` — global styles and Tailwind/theme definitions.
- `src/routeTree.gen.ts` — generated TanStack Router route tree; regenerate with `npm run generate-routes` rather than editing it.
- `src-tauri/src/` — Rust application, Tauri commands, media server, scanner, downloader, and persistence code.
- `src-tauri/capabilities/` — Tauri permission and capability definitions.
- `public/` — static frontend assets.
- `docs/` — design specs and implementation notes.

## Frontend Guidelines

- Keep strict TypeScript enabled and use `import type` for type-only imports.
- Use the `function` keyword for named React components and functions. Arrow functions are fine for callbacks and small local transformations.
- Prefer components that are focused and reusable; keep route-specific composition in the route file or a nearby component.
- Use Zustand for shared client state and component state for local UI state.
- Keep media/player state behavior centralized in the existing stores and media helpers; do not duplicate playback state in unrelated components.
- Treat Tauri APIs as optional at browser-development time. Handle unavailable Tauri APIs gracefully so the SPA remains usable in a browser.
- Use Tailwind CSS 4 and existing design tokens/classes. Preserve the current dark media-player visual language and responsive behavior.
- Reuse existing components before adding new UI primitives or dependencies.
- Add comments only for non-obvious behavior.
- Do not introduce server-only or Node-only imports into browser code.
- Validate and narrow unknown data returned from Tauri commands, filesystem-backed JSON, or external downloader processes before using it.

## Tauri And Rust Guidelines

- Keep filesystem, process, downloader, and OS-specific work in Rust/Tauri rather than exposing it directly to the frontend.
- Validate paths and permissions at the Rust boundary. Do not trust paths, filenames, URLs, or command arguments supplied by the frontend.
- Keep Tauri capabilities minimal and update `src-tauri/capabilities/` when a new frontend permission is genuinely required.
- Preserve the local JSON library and playlist data contracts unless the user explicitly requests a migration.
- Keep streaming behavior compatible with HTTP range requests so audio/video seeking continues to work.
- Prefer typed Tauri command inputs and outputs with clear error handling; do not silently swallow backend failures.
- Format Rust changes with `cargo fmt`. Use `cargo clippy` or Rust tests for major backend changes when the toolchain is available.
- Do not hand-edit `Cargo.lock`; update it through Cargo when dependency changes are requested.

## Commands

Common commands:

```text
npm run dev              # browser SPA development server
npm run tauri dev        # Tauri desktop development
npm run lint             # ESLint
npm run typecheck        # TypeScript validation
npm run test             # Vitest tests
npm run build            # frontend production build
npm run tauri build      # desktop release build
npm run generate-routes  # regenerate TanStack Router routes
cargo check              # checking Rust code at compile time
```

## Verification

- Small changes: inspect the affected code only unless the user asks for checks.
- Major frontend changes: run `npm run lint`.
- Any Rust changes: run `cargo fmt --check`, and `cargo clippy`.
- Do not claim tests or checks passed when they were not run.
- Report checks that could not run because tooling or platform requirements are missing.

## Maintenance

Update this file when the application architecture, frontend stack, Rust/Tauri structure, testing setup, or release workflow changes materially.
