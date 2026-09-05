package de.artur.justpdf

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import de.artur.justpdf.data.Settings
import de.artur.justpdf.ui.JustPdfRoot
import de.artur.justpdf.ui.theme.JustPdfTheme

class MainActivity : ComponentActivity() {

    private var pendingUri by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        pendingUri = extractPdfUri(intent)

        val settingsFlow = (application as JustPdfApp).container.settingsRepository.settings

        setContent {
            val settings by settingsFlow.collectAsStateWithLifecycle(initialValue = Settings())
            JustPdfTheme(themeMode = settings.themeMode) {
                JustPdfRoot(
                    initialPdfUri = pendingUri,
                    onInitialConsumed = { pendingUri = null },
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        extractPdfUri(intent)?.let { pendingUri = it }
    }

    private fun extractPdfUri(intent: Intent?): String? {
        if (intent?.action != Intent.ACTION_VIEW) return null
        val uri = intent.data ?: return null
        runCatching {
            contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        return uri.toString()
    }
}
