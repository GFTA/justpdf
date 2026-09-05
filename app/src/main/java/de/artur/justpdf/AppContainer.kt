package de.artur.justpdf

import android.content.Context
import de.artur.justpdf.data.DocumentRepository
import de.artur.justpdf.data.RecentsRepository
import de.artur.justpdf.data.SettingsRepository
import io.legere.pdfiumandroid.PdfiumCore
import io.legere.pdfiumandroid.util.AlreadyClosedBehavior
import io.legere.pdfiumandroid.util.Config

/** Hand-rolled dependency graph. No DI framework, nothing to audit. */
class AppContainer(context: Context) {
    private val app = context.applicationContext
    val appContext: Context get() = app

    val settingsRepository: SettingsRepository by lazy { SettingsRepository(app) }
    val recentsRepository: RecentsRepository by lazy { RecentsRepository(app) }
    val documentRepository: DocumentRepository by lazy { DocumentRepository(app) }
    val pdfiumCore: PdfiumCore by lazy {
        // IGNORE: our render/close paths can legitimately race a page close; don't crash.
        PdfiumCore(app, Config(alreadyClosedBehavior = AlreadyClosedBehavior.IGNORE))
    }
}
