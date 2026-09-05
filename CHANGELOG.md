# Changelog

## [Unreleased]

## [1.1.0] - 2026-09-06
### Added
- Pinch-to-zoom (1x–5x) in the viewer, alongside double-tap zoom.
- "Go to page" dialog in the viewer overflow menu.
- Broken recent entries (file moved / permission lost) now offer to remove
  themselves from the list instead of just showing an error.
- Release builds are signed with a real release key (via a gitignored
  `keystore.properties`; CI uses repository secrets).
### Changed
- On-disk thumbnail cache is now capped at 32 MB and pruned on startup.

## [1.0.1] - 2026-09-06
### Added
- Home screen shows PDFs as a card grid with a rendered first-page preview
  thumbnail (cached in memory and on disk).
- German translation (`values-de`).

## [1.0.0] - 2026-09-05
### Added
- Open PDFs from "Open with", the system file picker, or a chosen folder (SAF).
- Folder view listing every PDF in a picked directory, no runtime permissions.
- Recent files list; remembers the last page per document.
- Continuous vertical page scrolling, double-tap zoom, drag-to-pan.
- Full-text search with match count, next/previous navigation and on-page
  highlighting.
- Share and print via the Android system services.
- Optional "Scan whole device" setting (all-files access), off by default.
- Light / dark / follow-system theme; Material You dynamic color on Android 12+.

### Notably absent
- No `INTERNET` permission. No ads. No analytics. No crash reporter.
