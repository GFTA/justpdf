package de.artur.justpdf.pdf

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.util.LruCache
import io.legere.pdfiumandroid.PdfiumCore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

/**
 * Renders the first page of a PDF to a small bitmap for grid tiles. Two-level cache:
 * an in-memory LRU and a JPEG on disk under cacheDir/thumbs, so scrolling back to a
 * tile is instant and the work survives process death.
 */
class PdfThumbnailer(
    context: Context,
    private val core: PdfiumCore,
) {
    private val appContext = context.applicationContext
    private val dir = File(appContext.cacheDir, "thumbs").apply { mkdirs() }
    private val mutex = Mutex()

    private val mem = object : LruCache<String, Bitmap>(memBudget()) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
    }

    init {
        // Keep the on-disk thumbnail cache bounded; runs once, off the main thread.
        Thread {
            runCatching {
                val files = dir.listFiles()?.sortedByDescending { it.lastModified() } ?: return@runCatching
                var used = 0L
                for (f in files) {
                    used += f.length()
                    if (used > MAX_DISK_BYTES) f.delete()
                }
            }
        }.apply { isDaemon = true; priority = Thread.MIN_PRIORITY }.start()
    }

    suspend fun get(uriString: String, targetWidthPx: Int): Bitmap? = withContext(Dispatchers.IO) {
        val width = targetWidthPx.coerceIn(96, 1024)
        val key = "${sha1(uriString)}@$width"
        mem.get(key)?.let { if (!it.isRecycled) return@withContext it }

        val file = File(dir, "$key.jpg")
        if (file.exists()) {
            BitmapFactory.decodeFile(file.absolutePath)?.let { cached ->
                mem.put(key, cached)
                return@withContext cached
            }
            file.delete()
        }

        val bitmap = runCatching { render(Uri.parse(uriString), width) }.getOrNull()
            ?: return@withContext null

        runCatching {
            FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 80, it) }
        }
        mem.put(key, bitmap)
        bitmap
    }

    private suspend fun render(uri: Uri, width: Int): Bitmap? = mutex.withLock {
        val pfd = appContext.contentResolver.openFileDescriptor(uri, "r") ?: return@withLock null
        pfd.use {
            val doc = core.newDocument(it)
            try {
                if (doc.getPageCount() <= 0) return@withLock null
                val page = doc.openPage(0)
                try {
                    val wPt = page.getPageWidthPoint().coerceAtLeast(1)
                    val hPt = page.getPageHeightPoint().coerceAtLeast(1)
                    val height = (width.toLong() * hPt / wPt).toInt().coerceIn(1, 4096)
                    val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                    bmp.eraseColor(Color.WHITE)
                    page.renderPageBitmap(bmp, 0, 0, width, height, renderAnnot = false)
                    bmp
                } finally {
                    page.close()
                }
            } finally {
                doc.close()
            }
        }
    }

    private fun sha1(value: String): String =
        MessageDigest.getInstance("SHA-1").digest(value.toByteArray())
            .joinToString("") { "%02x".format(it) }

    private companion object {
        const val MAX_DISK_BYTES = 32L * 1024 * 1024

        fun memBudget(): Int =
            (Runtime.getRuntime().maxMemory() / 16).toInt().coerceIn(8 * 1024 * 1024, 32 * 1024 * 1024)
    }
}
