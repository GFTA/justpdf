package de.artur.justpdf.ui.home

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import de.artur.justpdf.AppContainer
import de.artur.justpdf.data.PdfEntry
import de.artur.justpdf.data.RecentFile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

data class HomeUiState(
    val recents: List<RecentFile> = emptyList(),
    val folderUri: String? = null,
    val folderFiles: List<PdfEntry> = emptyList(),
    val folderLoading: Boolean = false,
    val fullScanEnabled: Boolean = false,
    val scanFiles: List<PdfEntry> = emptyList(),
    val scanLoading: Boolean = false,
)

class HomeViewModel(private val container: AppContainer) : ViewModel() {

    private val _state = MutableStateFlow(HomeUiState())
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    val thumbnailer get() = container.pdfThumbnailer

    init {
        viewModelScope.launch {
            container.recentsRepository.recents.collect { list ->
                _state.value = _state.value.copy(recents = list)
            }
        }
        viewModelScope.launch {
            container.settingsRepository.settings
                .map { it.folderTreeUri }
                .distinctUntilChanged()
                .collect { uri ->
                    _state.value = _state.value.copy(folderUri = uri)
                    reloadFolder(uri)
                }
        }
        viewModelScope.launch {
            container.settingsRepository.settings
                .map { it.fullScanEnabled }
                .distinctUntilChanged()
                .collect { enabled ->
                    _state.value = _state.value.copy(fullScanEnabled = enabled)
                    reloadScan(enabled)
                }
        }
    }

    fun refresh() {
        reloadFolder(_state.value.folderUri)
        reloadScan(_state.value.fullScanEnabled)
    }

    fun setFolder(uriString: String) {
        viewModelScope.launch { container.settingsRepository.setFolderTreeUri(uriString) }
    }

    fun clearFolder() {
        viewModelScope.launch { container.settingsRepository.setFolderTreeUri(null) }
    }

    fun removeRecent(uri: String) {
        viewModelScope.launch { container.recentsRepository.remove(uri) }
    }

    private fun reloadFolder(uriString: String?) {
        if (uriString == null) {
            _state.value = _state.value.copy(folderFiles = emptyList(), folderLoading = false)
            return
        }
        _state.value = _state.value.copy(folderLoading = true)
        viewModelScope.launch {
            val files = runCatching {
                container.documentRepository.listFolder(Uri.parse(uriString))
            }.getOrDefault(emptyList())
            _state.value = _state.value.copy(folderFiles = files, folderLoading = false)
        }
    }

    private fun reloadScan(enabled: Boolean) {
        if (!enabled) {
            _state.value = _state.value.copy(scanFiles = emptyList(), scanLoading = false)
            return
        }
        _state.value = _state.value.copy(scanLoading = true)
        viewModelScope.launch {
            val files = runCatching {
                container.documentRepository.scanDevice()
            }.getOrDefault(emptyList())
            _state.value = _state.value.copy(scanFiles = files, scanLoading = false)
        }
    }
}
