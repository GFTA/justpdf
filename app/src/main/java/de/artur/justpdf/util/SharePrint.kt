package de.artur.justpdf.util

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import java.io.FileOutputStream

fun Context.sharePdf(uri: Uri, displayName: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "application/pdf"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TITLE, displayName)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

fun Context.printPdf(uri: Uri, displayName: String) {
    val printManager = getSystemService(Context.PRINT_SERVICE) as? PrintManager ?: return
    val jobName = displayName.removeSuffix(".pdf")
    printManager.print(
        jobName,
        StreamingPdfAdapter(this, uri, jobName),
        PrintAttributes.Builder().build(),
    )
}

/** Streams an already-formed PDF straight to the print framework, no re-rendering. */
private class StreamingPdfAdapter(
    private val context: Context,
    private val uri: Uri,
    private val jobName: String,
) : PrintDocumentAdapter() {

    override fun onLayout(
        oldAttributes: PrintAttributes?,
        newAttributes: PrintAttributes?,
        cancellationSignal: CancellationSignal?,
        callback: LayoutResultCallback,
        extras: Bundle?,
    ) {
        if (cancellationSignal?.isCanceled == true) {
            callback.onLayoutCancelled()
            return
        }
        val info = PrintDocumentInfo.Builder("$jobName.pdf")
            .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
            .build()
        callback.onLayoutFinished(info, newAttributes != oldAttributes)
    }

    override fun onWrite(
        pages: Array<out PageRange>?,
        destination: ParcelFileDescriptor,
        cancellationSignal: CancellationSignal?,
        callback: WriteResultCallback,
    ) {
        try {
            context.contentResolver.openInputStream(uri).use { input ->
                FileOutputStream(destination.fileDescriptor).use { output ->
                    if (input == null) {
                        callback.onWriteFailed("Cannot read source PDF")
                        return
                    }
                    val buffer = ByteArray(16 * 1024)
                    while (true) {
                        if (cancellationSignal?.isCanceled == true) {
                            callback.onWriteCancelled()
                            return
                        }
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                    }
                    output.flush()
                }
            }
            callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
        } catch (t: Throwable) {
            callback.onWriteFailed(t.message)
        }
    }
}
