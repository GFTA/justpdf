package de.artur.justpdf.data

data class PdfEntry(
    val uri: String,
    val name: String,
    val sizeBytes: Long,
    val lastModified: Long,
    val relativePath: String? = null,
)
