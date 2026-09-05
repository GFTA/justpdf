package de.artur.justpdf.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import de.artur.justpdf.AppContainer
import de.artur.justpdf.data.Settings
import de.artur.justpdf.data.ThemeMode
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SettingsViewModel(private val container: AppContainer) : ViewModel() {

    val settings: StateFlow<Settings> = container.settingsRepository.settings
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), Settings())

    fun setThemeMode(mode: ThemeMode) {
        viewModelScope.launch { container.settingsRepository.setThemeMode(mode) }
    }

    fun setFullScanEnabled(enabled: Boolean) {
        viewModelScope.launch { container.settingsRepository.setFullScanEnabled(enabled) }
    }

    fun clearRecents() {
        viewModelScope.launch { container.recentsRepository.clear() }
    }
}
