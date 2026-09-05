package de.artur.justpdf.pdf

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.RectF
import android.net.Uri
import android.os.ParcelFileDescriptor
import io.legere.pdfiumandroid.FindFlags
import io.legere.pdfiumandroid.PdfDocument
import io.legere.pdfiumandroid.PdfiumCore
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

data class PageSize(val widthPoints: Int, val heightPoints: Int) {
    val aspect: Float get() = if (heightPoints == 0) 1f else widthPoints.toFloat() / heightPoints
}

data class SearchMatch(
    val pageIndex: Int,
    val startChar: Int,
    val charCount: Int,
)

/** A rectangle in bitmap-pixel space for a rendered page of a known size. */
data class HighlightRect(val left: Float, val top: Float, val right: Float, val bottom: Float)

/**
 * Opens one PDF and serves page bitmaps / text search results. Not thread-safe by
 * itself: every native call is funnelled through [mutex] on [dispatcher].
 */
class PdfRenderSession private constructor(
    private val core: PdfiumCore,
    private val pfd: ParcelFileDescriptor,
    private val document: PdfDocument,
    private val dispatcher: CoroutineDispatcher,
) {
    private val mutex = Mutex()
    private val sizeCache = HashMap<Int, PageSize>()

    val pageCount: Int = document.getPageCount()

    suspend fun pageSize(index: Int): PageSize = withContext(dispatcher) {
        mutex.withLock {
            sizeCache[index]?.let { return@withContext it }
            val page = document.openPage(index)
            try {
                PageSize(page.getPageWidthPoint(), page.getPageHeightPoint())
                    .also { sizeCache[index] = it }
            } finally {
                page.close()
            }
        }
    }

    suspend fun renderPage(index: Int, targetWidthPx: Int): Bitmap = withContext(dispatcher) {
        val size = pageSize(index)
        val width = targetWidthPx.coerceIn(MIN_WIDTH_PX, MAX_WIDTH_PX)
        var height = (width / size.aspect).toInt().coerceAtLeast(1)
        if (width.toLong() * height > MAX_PIXELS) {
            height = (MAX_PIXELS / width).toInt().coerceAtLeast(1)
        }
        mutex.withLock {
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(Color.WHITE)
            val page = document.openPage(index)
            try {
                page.renderPageBitmap(bitmap, 0, 0, width, height, renderAnnot = true)
            } finally {
                page.close()
            }
            bitmap
        }
    }

    suspend fun search(query: String): List<SearchMatch> = withContext(dispatcher) {
        if (query.isBlank()) return@withContext emptyList()
        val matches = ArrayList<SearchMatch>()
        mutex.withLock {
            for (i in 0 until pageCount) {
                val page = runCatching { document.openPage(i) }.getOrNull() ?: continue
                val textPage = runCatching { page.openTextPage() }.getOrNull()
                if (textPage == null) {
                    page.close(); continue
                }
                try {
                    val find = textPage.findStart(query, emptySet<FindFlags>(), 0) ?: continue
                    try {
                        while (find.findNext()) {
                            matches.add(
                                SearchMatch(
                                    pageIndex = i,
                                    startChar = find.getSchResultIndex(),
                                    charCount = find.getSchCount(),
                                ),
                            )
                            if (matches.size >= MAX_MATCHES) break
                        }
                    } finally {
                        find.closeFind()
                    }
                } finally {
                    textPage.close()
                    page.close()
                }
                if (matches.size >= MAX_MATCHES) break
            }
        }
        matches
    }

    /** Highlight rectangles for [match], in pixel space of a page bitmap [bitmapWidth] x [bitmapHeight]. */
    suspend fun highlightRects(
        match: SearchMatch,
        bitmapWidth: Int,
        bitmapHeight: Int,
    ): List<HighlightRect> = withContext(dispatcher) {
        val size = pageSize(match.pageIndex)
        if (size.widthPoints == 0 || size.heightPoints == 0) return@withContext emptyList()
        val sx = bitmapWidth / size.widthPoints.toFloat()
        val sy = bitmapHeight / size.heightPoints.toFloat()
        val out = ArrayList<HighlightRect>()
        mutex.withLock {
            val page = runCatching { document.openPage(match.pageIndex) }.getOrNull()
                ?: return@withContext emptyList()
            val textPage = runCatching { page.openTextPage() }.getOrNull()
            if (textPage == null) {
                page.close(); return@withContext emptyList()
            }
            try {
                val count = textPage.textPageCountRects(match.startChar, match.charCount)
                for (r in 0 until count) {
                    val box: RectF = textPage.textPageGetRect(r) ?: continue
                    val left = box.left * sx
                    val right = box.right * sx
                    val top = bitmapHeight - box.top * sy
                    val bottom = bitmapHeight - box.bottom * sy
                    out.add(
                        HighlightRect(
                            left = minOf(left, right),
                            top = minOf(top, bottom),
                            right = maxOf(left, right),
                            bottom = maxOf(top, bottom),
                        ),
                    )
                }
            } finally {
                textPage.close()
                page.close()
            }
        }
        out
    }

    fun close() {
        runCatching { document.close() }
        runCatching { pfd.close() }
    }

    companion object {
        private const val MIN_WIDTH_PX = 64
        private const val MAX_WIDTH_PX = 4096
        private const val MAX_PIXELS = 12_000_000L
        private const val MAX_MATCHES = 2000

        /** Opens [uri]. Throws on unreadable / encrypted-without-password / corrupt files. */
        suspend fun open(
            context: Context,
            core: PdfiumCore,
            uri: Uri,
            dispatcher: CoroutineDispatcher = Dispatchers.IO,
        ): PdfRenderSession = withContext(dispatcher) {
            val pfd = context.contentResolver.openFileDescriptor(uri, "r")
                ?: throw IllegalStateException("Cannot open file descriptor for $uri")
            val doc = try {
                core.newDocument(pfd)
            } catch (t: Throwable) {
                runCatching { pfd.close() }
                throw t
            }
            PdfRenderSession(core, pfd, doc, dispatcher)
        }
    }
}
