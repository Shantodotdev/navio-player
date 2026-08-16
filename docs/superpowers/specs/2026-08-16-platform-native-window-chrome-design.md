# Platform-native window chrome design

## Goal

Keep Navio's custom frameless title bar on Windows while using the operating system's native title bar and window controls on macOS and Linux.

## Design

- The shared Tauri configuration enables native window decorations.
- A Windows-specific Tauri configuration overrides the main window to remain undecorated.
- The React `Titlebar` asks the current Tauri window whether it is decorated and renders custom controls only for an undecorated window. Browser development keeps the existing custom bar so its layout remains representative of the Windows shell.
- The decoration toggle used during theater fullscreen is compiled only on Windows. macOS and Linux enter and leave fullscreen without changing their native decoration policy.
- No operating-system plugin or user-agent detection is added; the real window state remains the source of truth.

## Verification

- A frontend regression test covers decorated, undecorated, and browser-only title-bar behavior.
- Rust formatting and Clippy validate the platform-conditional fullscreen change.
- Tauri configuration files are parsed to confirm native decorations by default and the Windows override.
- No development server or application build is run as part of this focused change.
