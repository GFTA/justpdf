package de.artur.justpdf.util

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.util.Locale

data class UriInfo(val name: String, val sizeBytes: Long)

fun Context.queryUriInfo(uri: Uri): UriInfo {
    var name: String? = null
    var size = -1L
    runCatching {
        contentResolver.query(uri, null, null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                val nameIdx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIdx = c.getColumnIndex(OpenableColumns.SIZE)
                if (nameIdx >= 0) name = c.getString(nameIdx)
                if (sizeIdx >= 0 && !c.isNull(sizeIdx)) size = c.getLong(sizeIdx)
            }
        }
    }
    if (name.isNullOrBlank()) {
        name = uri.lastPathSegment?.substringAfterLast('/')?.substringAfterLast(':') ?: "document.pdf"
    }
    if (!name!!.endsWith(".pdf", ignoreCase = true)) name += ".pdf"
    return UriInfo(name!!, size)
}

fun formatSize(bytes: Long): String {
    if (bytes <= 0) return ""
    val units = arrayOf("B", "KB", "MB", "GB")
    var value = bytes.toDouble()
    var i = 0
    while (value >= 1024 && i < units.lastIndex) {
        value /= 1024; i++
    }
    return if (i == 0) "${bytes} B" else String.format(Locale.getDefault(), "%.1f %s", value, units[i])
}
