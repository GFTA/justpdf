package de.artur.justpdf.ui.viewer

import android.graphics.Bitmap
import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import de.artur.justpdf.AppContainer
import de.artur.justpdf.pdf.HighlightRect
import de.artur.justpdf.pdf.PageBitmapCache
import de.artur.justpdf.pdf.PdfRenderSession
import de.artur.justpdf.pdf.SearchMatch
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import de.artur.justpdf.ui.dec

sealed interface ViewerStatus {
    data object Loading : ViewerStatus
    data object Ready : ViewerStatus
    data class Error(val message: String) : ViewerStatus
}

data class SearchState(
    val query: String = "",
    val active: Boolean = false,
    val running: Boolean = false,
    val matches: List<SearchMatch> = emptyList(),
    val current: Int = -1,
) {
    val currentMatch: SearchMatch? get() = matches.getOrNull(current)
}

data class ViewerUiState(
    val status: ViewerStatus = ViewerStatus.Loading,
    val title: String = "",
    val pageCount: Int = 0,
    val initialPage: Int = 0,
    val aspects: List<Float> = emptyList(),
    val search: SearchState = SearchState(),
)

class ViewerViewModel(
    private val container: AppContainer,
    savedState: SavedStateHandle,
) : ViewModel() {

    private val uriArg: String = dec(savedState.get<String>("uri").orEmpty())
    private val nameArg: String = dec(savedState.get<String>("name").orEmpty())
    private val uri: Uri = Uri.parse(uriArg)

    private val _state = MutableStateFlow(ViewerUiState(title = nameArg.ifBlank { "PDF" }))
    val state: StateFlow<ViewerUiState> = _state.asStateFlow()

    private val cache = PageBitmapCache()
    private val renderMutex = Mutex()
    private var session: PdfRenderSession? = null
    private var searchJob: Job? = null
    private var persistJob: Job? = null

    init {
        viewModelScope.launch { openDocument() }
    }

    private suspend fun openDocument() {
        val storedPage = runCatching {
            container.recentsRepository.recents.first().firstOrNull { it.uri == uriArg }?.lastPage
        }.getOrNull() ?: 0

        runCatching {
            PdfRenderSession.open(container.appContext, container.pdfiumCore, uri)
        }.onSuccess { s ->
            session = s
            runCatching {
                container.recentsRepository.touch(uriArg, nameArg.ifBlank { "document.pdf" }, storedPage)
            }
            _state.value = _state.value.copy(
                status = ViewerStatus.Ready,
                pageCount = s.pageCount,
                initialPage = storedPage.coerceIn(0, (s.pageCount - 1).coerceAtLeast(0)),
                aspects = List(s.pageCount) { A4_ASPECT },
            )
            prefetchAspects(s)
        }.onFailure { t ->
            _state.value = _state.value.copy(
                status = ViewerStatus.Error(t.message ?: "Could not open this PDF."),
            )
        }
    }

    private fun prefetchAspects(s: PdfRenderSession) {
        viewModelScope.launch {
            val current = _state.value.aspects.toMutableList()
            for (i in 0 until s.pageCount) {
                val size = runCatching { s.pageSize(i) }.getOrNull() ?: continue
                if (i < current.size) current[i] = size.aspect
                if (i % 8 == 0 || i == s.pageCount - 1) {
                    _state.value = _state.value.copy(aspects = current.toList())
                }
            }
            _state.value = _state.value.copy(aspects = current.toList())
        }
    }

    suspend fun bitmapFor(pageIndex: Int, widthPx: Int): Bitmap? {
        val s = session ?: return null
        if (widthPx <= 0) return null
        cache.get(pageIndex, widthPx)?.let { if (!it.isRecycled) return it }
        return renderMutex.withLock {
            cache.get(pageIndex, widthPx)?.let { if (!it.isRecycled) return@withLock it }
            val bmp = runCatching { s.renderPage(pageIndex, widthPx) }.getOrNull()
            if (bmp != null) cache.put(pageIndex, widthPx, bmp)
            bmp
        }
    }

    suspend fun highlightsFor(match: SearchMatch, widthPx: Int, heightPx: Int): List<HighlightRect> {
        val s = session ?: return emptyList()
        return runCatching { s.highlightRects(match, widthPx, heightPx) }.getOrDefault(emptyList())
    }

    fun onPageSettled(pageIndex: Int) {
        persistJob?.cancel()
        persistJob = viewModelScope.launch {
            runCatching { container.recentsRepository.updateLastPage(uriArg, pageIndex) }
        }
    }

    // ---- Search ----

    fun openSearch() {
        _state.value = _state.value.copy(search = _state.value.search.copy(active = true))
    }

    fun closeSearch() {
        searchJob?.cancel()
        _state.value = _state.value.copy(search = SearchState())
    }

    fun updateQuery(q: String) {
        _state.value = _state.value.copy(search = _state.value.search.copy(query = q))
    }

    fun runSearch() {
        val query = _state.value.search.query.trim()
        searchJob?.cancel()
        if (query.isEmpty()) {
            _state.value = _state.value.copy(
                search = _state.value.search.copy(matches = emptyList(), current = -1, running = false),
            )
            return
        }
        val s = session ?: return
        _state.value = _state.value.copy(search = _state.value.search.copy(running = true))
        searchJob = viewModelScope.launch {
            val matches = runCatching { s.search(query) }.getOrDefault(emptyList())
            _state.value = _state.value.copy(
                search = _state.value.search.copy(
                    matches = matches,
                    current = if (matches.isEmpty()) -1 else 0,
                    running = false,
                ),
            )
        }
    }

    fun nextMatch() = stepMatch(1)
    fun prevMatch() = stepMatch(-1)

    private fun stepMatch(delta: Int) {
        val se = _state.value.search
        if (se.matches.isEmpty()) return
        val next = (se.current + delta + se.matches.size) % se.matches.size
        _state.value = _state.value.copy(search = se.copy(current = next))
    }

    override fun onCleared() {
        searchJob?.cancel()
        session?.close()
        session = null
        cache.clear()
    }

    companion object {
        const val A4_ASPECT = 0.7071f
    }
}
