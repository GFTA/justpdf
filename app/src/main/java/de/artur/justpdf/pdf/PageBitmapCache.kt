package de.artur.justpdf.pdf

import android.graphics.Bitmap
import android.util.LruCache

/**
 * Small bitmap cache keyed by "pageIndex@widthBucket". Sized by byte budget so a
 * handful of full-screen pages stay resident while scrolling.
 */
class PageBitmapCache(maxBytes: Int = DEFAULT_BUDGET) {

    private val cache = object : LruCache<String, Bitmap>(maxBytes) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
        override fun entryRemoved(evicted: Boolean, key: String, oldValue: Bitmap, newValue: Bitmap?) {
            if (oldValue != newValue && !oldValue.isRecycled) oldValue.recycle()
        }
    }

    fun key(pageIndex: Int, widthPx: Int): String = "$pageIndex@${widthPx / BUCKET * BUCKET}"

    fun get(pageIndex: Int, widthPx: Int): Bitmap? = cache.get(key(pageIndex, widthPx))

    fun put(pageIndex: Int, widthPx: Int, bitmap: Bitmap) {
        cache.put(key(pageIndex, widthPx), bitmap)
    }

    fun clear() = cache.evictAll()

    companion object {
        private const val BUCKET = 64
        private val DEFAULT_BUDGET =
            (Runtime.getRuntime().maxMemory() / 8).toInt().coerceIn(16 * 1024 * 1024, 96 * 1024 * 1024)
    }
}
