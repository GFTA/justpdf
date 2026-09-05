package de.artur.justpdf.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

enum class ThemeMode { SYSTEM, LIGHT, DARK }

data class Settings(
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val fullScanEnabled: Boolean = false,
    val folderTreeUri: String? = null,
)

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

class SettingsRepository(private val context: Context) {

    private object Keys {
        val THEME = stringPreferencesKey("theme_mode")
        val FULL_SCAN = booleanPreferencesKey("full_scan_enabled")
        val TREE_URI = stringPreferencesKey("folder_tree_uri")
    }

    val settings: Flow<Settings> = context.settingsDataStore.data.map { p ->
        Settings(
            themeMode = p[Keys.THEME]?.let { runCatching { ThemeMode.valueOf(it) }.getOrNull() }
                ?: ThemeMode.SYSTEM,
            fullScanEnabled = p[Keys.FULL_SCAN] ?: false,
            folderTreeUri = p[Keys.TREE_URI],
        )
    }

    suspend fun setThemeMode(mode: ThemeMode) {
        context.settingsDataStore.edit { it[Keys.THEME] = mode.name }
    }

    suspend fun setFullScanEnabled(enabled: Boolean) {
        context.settingsDataStore.edit { it[Keys.FULL_SCAN] = enabled }
    }

    suspend fun setFolderTreeUri(uri: String?) {
        context.settingsDataStore.edit {
            if (uri == null) it.remove(Keys.TREE_URI) else it[Keys.TREE_URI] = uri
        }
    }
}
