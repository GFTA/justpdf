# JustPDF

A small, honest PDF viewer for Android. No ads. No trackers. **No network access at all.**

JustPDF exists because the PDF-viewer category on the app stores is a landfill of
adware — apps that exist only to show full-screen ads, that buy search keywords like
"pdf reader" and run ads styled as fake *"Security warning: your phone may be
infected"*. Older, less technical people install those and get milked. This is the
opposite of that.

## What it does

- **Open PDFs** — from "Open with" in any app, from the system file picker, or from a
  folder you choose once.
- **Folder view** — pick a folder (e.g. `Download`) once via the Storage Access
  Framework; JustPDF lists every PDF inside it. No runtime permissions.
- **Recent files** — quick access to what you opened last, remembers your last page.
- **Read** — continuous vertical scrolling, double-tap to zoom, drag to pan.
- **Search** — full-text search across the document with match navigation and
  on-page highlighting.
- **Share / Print** — hand the file to the Android share sheet or the system print
  service. The original bytes, untouched.

## What it will never do

- Request `android.permission.INTERNET`. Check `AndroidManifest.xml` and the merged
  manifest in any build — it isn't there and never will be.
- Bundle an ad SDK, an analytics SDK, or a crash reporter that phones home.
- Nag, upsell, or show interstitials.

## Permissions

| Permission | When | Why |
|---|---|---|
| *(none by default)* | — | Opening files and browsing a chosen folder use the Storage Access Framework, which needs no manifest permission. |
| `MANAGE_EXTERNAL_STORAGE` | Only if **you** turn on *Settings → Scan whole device* | Android offers no narrow "read documents" permission. Listing every PDF on the device is only possible with all-files access. Off by default; the app works fully without it. |
| `READ_EXTERNAL_STORAGE` | API < 30, same toggle | Older Android equivalent of the above. |

## Tech

- Kotlin, Jetpack Compose, Material 3. Single module, no DI framework.
- PDF rendering via [`io.legere:pdfiumandroid`](https://github.com/johngray1965/PdfiumAndroidKt)
  — a native (JNI) binding to Google's Pdfium. It does no networking.
- `minSdk 24`, `targetSdk 35`.

## Build

```bash
git clone https://github.com/GFTA/justpdf
cd justpdf
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Or open the folder in Android Studio (Ladybug or newer) and hit Run.

## Known limitations (v1)

- Zoom is double-tap + drag-to-pan only; pinch-to-zoom is not wired up yet because it
  fights the scrolling list. Planned.
- Search highlight rectangles are best-effort; on some documents the box may be
  slightly off. Match navigation and the page jump are reliable.
- "Scan whole device" relies on the MediaStore index; a direct filesystem walk is the
  fallback.

## License

[GPL-3.0-or-later](LICENSE). See [TRADEMARK.md](TRADEMARK.md) for the name and icon.

If you fork this: the GPL requires you to publish your full source too, so an
ad-supported closed fork isn't possible. Please also read TRADEMARK.md before
shipping under a different name.

---

*Not affiliated with Google or the Pdfium project.*
