# Changelog

All notable changes to **Chat Sidebar for OpenCode** are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.3] — 2026-08-22

### Changed

- Improved Visual Studio Marketplace listing metadata (keyword-led description,
  expanded tags, gallery banner) and GitHub repository discoverability
  (topics, description, social preview). No functional changes.

## [1.0.2] — 2026-08-22

### Fixed

- Fixed message list bottom alignment issue where short chat conversations stayed anchored to the bottom and newly submitted user messages failed to scroll to the top.

## [1.0.1] — 2026-08-22

### Changed

- Renamed extension to "Chat Sidebar for OpenCode" throughout the codebase and documentation.

## [1.0.0] — 2026-08-22

### Changed

- First public release: open-sourced under MIT with a bilingual README
  (English / 繁體中文 split across dedicated files) and the full
  `opencodePanel.*` settings surface documented.

## [0.8.15] — 2026-08-21

### Fixed

- Question-card replies now fall back to the instance-level
  `POST /question/{requestID}/reply` route when the session-scoped canonical
  route returns 404, fixing question cards that accepted an answer but never
  resumed the model.

## [0.8.14] — 2026-08-21

### Fixed

- Sticky fade rendering, code-block containment, and duplicate-output cleanup.

## [0.8.13] — 2026-08-21

### Fixed

- Tool output truncation and session resync fan-out.

## [0.8.12] — 2026-08-21

### Fixed

- Stop-scroll gate behavior and lazy creation of new-chat sessions.

## [0.8.11] — 2026-08-21

### Fixed

- Header rendering, streaming delta handling, whitespace preservation, and
  settings patches.

## [0.8.10] — 2026-08-21

### Changed

- Extracted composer and chat strings into the shared i18n table (en / zh-TW
  parity).

## [0.8.9] — 2026-08-21

### Fixed

- E-batch UI patches.

## [0.8.8] — 2026-08-20

### Fixed

- Auto-arm race condition on session binding.

## [0.6.7] — earlier

### Fixed

- Stale-selection self-heal, session re-bind, and picker dropdown fixes.

## [0.6.1] — earlier

### Changed

- Full code rehab with strict typing; supersedes the self-deployed 0.6.0.

## [0.5.9] — earlier

Incremental fixes and polish.

## [0.2.1] — earlier

### Fixed

- Sessions-view fix, welcome hero, and visual polish.

## [0.2.0] — earlier

### Changed

- Chat-first layout: conversation owns the sidebar; session list becomes a
  left drawer.

[1.0.0]: https://github.com/SenCha930511/chat-sidebar-for-opencode/releases
[0.8.15]: https://github.com/SenCha930511/chat-sidebar-for-opencode/releases
