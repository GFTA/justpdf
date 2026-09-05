package de.artur.justpdf.data

import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import androidx.documentfile.provider.DocumentFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Finds PDFs on the device.
 *
 *  - [listFolder] walks a Storage Access Framework tree the user picked once.
 *    No runtime permissions involved.
 *  - [scanDevice] uses MediaStore and is only meaningful when the user granted
 *    "All files access" (MANAGE_EXTERNAL_STORAGE). Without it, MediaStore returns
 *    only files this app itself created, which is fine — the list is just short.
 */
class DocumentRepository(private val context: Context) {

    suspend fun listFolder(treeUri: Uri): List<PdfEntry> = withContext(Dispatchers.IO) {
        val root = DocumentFile.fromTreeUri(context, treeUri) ?: return@withContext emptyList()
        val out = ArrayList<PdfEntry>()
        val stack = ArrayDeque<Pair<DocumentFile, String>>()
        stack.add(root to "")
        while (stack.isNotEmpty()) {
            val (dir, path) = stack.removeLast()
            val children = runCatching { dir.listFiles() }.getOrNull() ?: continue
            for (child in children) {
                if (child.isDirectory) {
                    stack.add(child to "$path${child.name}/")
                } else if (isPdf(child.name, child.type)) {
                    out.add(
                        PdfEntry(
                            uri = child.uri.toString(),
                            name = child.name ?: "document.pdf",
                            sizeBytes = child.length(),
                            lastModified = child.lastModified(),
                            relativePath = path.ifEmpty { null },
                        ),
                    )
                }
            }
        }
        out.sortedByDescending { it.lastModified }
    }

    suspend fun scanDevice(): List<PdfEntry> = withContext(Dispatchers.IO) {
        val out = ArrayList<PdfEntry>()
        // "external" is the legacy volume name and resolves on every supported API level,
        // unlike MediaStore.VOLUME_EXTERNAL which only exists from API 29.
        val collection = MediaStore.Files.getContentUri("external")
        val projection = arrayOf(
            MediaStore.Files.FileColumns._ID,
            MediaStore.Files.FileColumns.DISPLAY_NAME,
            MediaStore.Files.FileColumns.SIZE,
            MediaStore.Files.FileColumns.DATE_MODIFIED,
            MediaStore.Files.FileColumns.RELATIVE_PATH,
        )
        val selection = "${MediaStore.Files.FileColumns.MIME_TYPE} = ?"
        val args = arrayOf("application/pdf")
        val sort = "${MediaStore.Files.FileColumns.DATE_MODIFIED} DESC"

        runCatching {
            context.contentResolver.query(collection, projection, selection, args, sort)?.use { c ->
                val idCol = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
                val nameCol = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME)
                val sizeCol = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
                val dateCol = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_MODIFIED)
                val pathCol = c.getColumnIndex(MediaStore.Files.FileColumns.RELATIVE_PATH)
                while (c.moveToNext()) {
                    val id = c.getLong(idCol)
                    out.add(
                        PdfEntry(
                            uri = android.content.ContentUris.withAppendedId(collection, id).toString(),
                            name = c.getString(nameCol) ?: "document.pdf",
                            sizeBytes = c.getLong(sizeCol),
                            lastModified = c.getLong(dateCol) * 1000L,
                            relativePath = if (pathCol >= 0) c.getString(pathCol) else null,
                        ),
                    )
                }
            }
        }

        // Fallback direct filesystem walk for API levels / OEMs where the MediaStore
        // index is incomplete but we do hold all-files access.
        if (out.isEmpty()) {
            val roots = listOf(
                Environment.getExternalStorageDirectory(),
                File("/storage/emulated/0"),
            ).filterNotNull().distinct()
            for (r in roots) walkFs(r, out)
        }

        out.distinctBy { it.uri.lowercase() }.sortedByDescending { it.lastModified }
    }

    private fun walkFs(root: File, out: MutableList<PdfEntry>, depth: Int = 0) {
        if (depth > 12 || !root.isDirectory) return
        val children = root.listFiles() ?: return
        for (f in children) {
            if (f.isDirectory) {
                if (f.name.startsWith(".") || f.name == "Android") continue
                walkFs(f, out, depth + 1)
            } else if (isPdf(f.name, null)) {
                out.add(
                    PdfEntry(
                        uri = Uri.fromFile(f).toString(),
                        name = f.name,
                        sizeBytes = f.length(),
                        lastModified = f.lastModified(),
                        relativePath = f.parentFile?.absolutePath,
                    ),
                )
            }
        }
    }

    private fun isPdf(name: String?, type: String?): Boolean {
        if (type == "application/pdf") return true
        return name?.substringAfterLast('.', "")?.equals("pdf", ignoreCase = true) == true
    }
}
