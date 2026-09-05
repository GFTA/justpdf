# Getting JustPDF onto F-Droid

F-Droid builds every app itself, from source, on its own infrastructure, and
signs the result with the **F-Droid signing key** (not the key in this repo).
So there is nothing secret to hand over — only a build recipe and a request.

## 1. Store listing text & screenshots

Already in the repo under `fastlane/metadata/android/{en-US,de-DE}/`. F-Droid
reads these automatically once the app is added. Add screenshots later at
`fastlane/metadata/android/en-US/images/phoneScreenshots/1.png` etc.

## 2. Submit a Request For Packaging (or go straight to a build recipe)

- **RFP (lightweight):** open an issue at
  <https://gitlab.com/fdroid/rfp/-/issues> titled "JustPDF" with the source URL.
  A volunteer may pick it up.
- **Faster:** fork <https://gitlab.com/fdroid/fdroiddata>, add
  `metadata/de.artur.justpdf.yml` (copy of `fdroid/de.artur.justpdf.yml` here),
  run `fdroid readmeta && fdroid rewritemeta de.artur.justpdf` and
  `fdroid build -v -l de.artur.justpdf` locally if you can, then open a merge
  request.

Every new release: push a `vX.Y.Z` tag with a bumped `versionCode`
(`UpdateCheckMode: Tags` picks it up automatically).

## 3. Known review point: the Pdfium native library

Rendering uses `io.legere:pdfiumandroid`, whose AAR bundles a prebuilt
`libpdfium.so` (Chromium's PDFium, BSD-licensed, open source, but not compiled
by F-Droid). F-Droid reviewers may:

- accept it, since it comes from a versioned Maven Central artifact with a free
  license (this is how several existing F-Droid apps ship PDFium), or
- ask for the `.so` to be built from source (impractical for PDFium), or
- ask for it to be flagged as a `NonFreeAssets` anti-feature.

If it becomes a blocker, the fallback is a build flavour that swaps the renderer
for Android's built-in `android.graphics.pdf.PdfRenderer` (loses text search).
Not done yet — cross that bridge if a reviewer raises it.

## 4. This repo's own releases are separate

`.github/workflows/release.yml` builds and signs APKs with **our** release key
on every `v*` tag and attaches them to the GitHub Release. Those are for direct
sideloading and are independent of the F-Droid build.
