package de.artur.justpdf.ui.viewer

import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import de.artur.justpdf.R
import de.artur.justpdf.ui.AppViewModelFactory
import de.artur.justpdf.util.printPdf
import de.artur.justpdf.util.sharePdf
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ViewerScreen(
    rawUri: String,
    onBack: () -> Unit,
    viewModel: ViewerViewModel = viewModel(factory = AppViewModelFactory),
) {
    val context = LocalContext.current
    val state by viewModel.state.collectAsStateWithLifecycle()
    val decodedUri = remember(rawUri) { Uri.parse(rawUri) }

    Scaffold(
        topBar = {
            if (state.search.active) {
                SearchBar(
                    state = state.search,
                    onQueryChange = viewModel::updateQuery,
                    onSubmit = viewModel::runSearch,
                    onPrev = viewModel::prevMatch,
                    onNext = viewModel::nextMatch,
                    onClose = viewModel::closeSearch,
                )
            } else {
                ViewerTopBar(
                    title = state.title,
                    onBack = onBack,
                    onSearch = viewModel::openSearch,
                    onShare = { context.sharePdf(decodedUri, state.title) },
                    onPrint = { context.printPdf(decodedUri, state.title) },
                )
            }
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when (val status = state.status) {
                is ViewerStatus.Loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                is ViewerStatus.Error -> Text(
                    text = status.message,
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    color = MaterialTheme.colorScheme.error,
                )
                is ViewerStatus.Ready -> ViewerPages(state = state, viewModel = viewModel)
            }
        }
    }
}

@Composable
private fun ViewerPages(state: ViewerUiState, viewModel: ViewerViewModel) {
    val listState = rememberLazyListState(initialFirstVisibleItemIndex = state.initialPage)
    val density = LocalDensity.current

    // Double-tap toggles between fit-width (1x) and a 2.5x reading zoom. While zoomed,
    // one-finger drag pans; double-tap again resets. No pinch in v1 so the gesture
    // never competes with the list's vertical scroll.
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }

    val currentPage by remember {
        derivedStateOf { listState.firstVisibleItemIndex }
    }
    LaunchedEffect(currentPage) { viewModel.onPageSettled(currentPage) }

    // Scroll to the active search match.
    LaunchedEffect(state.search.current, state.search.matches) {
        state.search.currentMatch?.let { listState.animateScrollToItem(it.pageIndex) }
    }

    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        val baseWidthPx = with(density) { maxWidth.roundToPx() }
        val viewportW = constraints.maxWidth.toFloat()
        val viewportH = constraints.maxHeight.toFloat()
        val renderWidthPx = (baseWidthPx * scale.coerceIn(1f, 3f)).roundToInt()

        fun clampOffset(raw: Offset): Offset {
            val maxX = (viewportW * (scale - 1f) / 2f).coerceAtLeast(0f)
            val maxY = (viewportH * (scale - 1f) / 2f).coerceAtLeast(0f)
            return Offset(raw.x.coerceIn(-maxX, maxX), raw.y.coerceIn(-maxY, maxY))
        }

        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .pointerInput(Unit) {
                    detectTapGestures(
                        onDoubleTap = {
                            if (scale > 1.05f) {
                                scale = 1f
                                offset = Offset.Zero
                            } else {
                                scale = 2.5f
                            }
                        },
                    )
                }
                .pointerInput(scale) {
                    if (scale > 1.05f) {
                        detectDragGestures { change, drag ->
                            offset = clampOffset(offset + drag)
                            change.consume()
                        }
                    }
                }
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    translationX = offset.x
                    translationY = offset.y
                },
            contentPadding = PaddingValues(vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(count = state.pageCount, key = { it }) { index ->
                PageItem(
                    index = index,
                    aspect = state.aspects.getOrElse(index) { ViewerViewModel.A4_ASPECT },
                    widthPx = renderWidthPx,
                    pageCount = state.pageCount,
                    highlightMatch = state.search.currentMatch?.takeIf { it.pageIndex == index },
                    viewModel = viewModel,
                )
            }
        }

        PageIndicator(
            text = "${(currentPage + 1).coerceAtMost(state.pageCount)} / ${state.pageCount}",
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 16.dp),
        )
    }
}

@Composable
private fun PageIndicator(text: String, modifier: Modifier = Modifier) {
    androidx.compose.material3.Surface(
        modifier = modifier,
        color = MaterialTheme.colorScheme.inverseSurface.copy(alpha = 0.85f),
        contentColor = MaterialTheme.colorScheme.inverseOnSurface,
        shape = androidx.compose.foundation.shape.RoundedCornerShape(50),
        tonalElevation = 3.dp,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
        )
    }
}

@Composable
private fun PageItem(
    index: Int,
    aspect: Float,
    widthPx: Int,
    pageCount: Int,
    highlightMatch: SearchMatch?,
    viewModel: ViewerViewModel,
) {
    val bitmap by produceState<android.graphics.Bitmap?>(initialValue = null, index, widthPx) {
        value = viewModel.bitmapFor(index, widthPx)
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp)
            .aspectRatio(aspect.coerceIn(0.2f, 5f))
            .background(Color.White),
        contentAlignment = Alignment.Center,
    ) {
        val bmp = bitmap
        if (bmp != null && !bmp.isRecycled) {
            Image(
                bitmap = bmp.asImageBitmap(),
                contentDescription = stringResource(R.string.page_of, index + 1, pageCount),
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit,
            )
            if (highlightMatch != null) {
                HighlightOverlay(bmp.width, bmp.height, highlightMatch, viewModel)
            }
        } else {
            CircularProgressIndicator(modifier = Modifier.size(28.dp))
        }
    }
}

@Composable
private fun HighlightOverlay(
    bmpWidth: Int,
    bmpHeight: Int,
    match: SearchMatch,
    viewModel: ViewerViewModel,
) {
    val rects by produceState(initialValue = emptyList<de.artur.justpdf.pdf.HighlightRect>(), match, bmpWidth) {
        value = viewModel.highlightsFor(match, bmpWidth, bmpHeight)
    }
    if (rects.isEmpty()) return
    androidx.compose.foundation.Canvas(modifier = Modifier.fillMaxSize()) {
        val sx = size.width / bmpWidth
        val sy = size.height / bmpHeight
        rects.forEach { r ->
            drawRect(
                color = Color(0x66FFEB3B),
                topLeft = androidx.compose.ui.geometry.Offset(r.left * sx, r.top * sy),
                size = androidx.compose.ui.geometry.Size(
                    (r.right - r.left) * sx,
                    (r.bottom - r.top) * sy,
                ),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ViewerTopBar(
    title: String,
    onBack: () -> Unit,
    onSearch: () -> Unit,
    onShare: () -> Unit,
    onPrint: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    TopAppBar(
        title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
            }
        },
        actions = {
            IconButton(onClick = onSearch) {
                Icon(Icons.Filled.Search, contentDescription = stringResource(R.string.search))
            }
            IconButton(onClick = { menu = true }) {
                Icon(Icons.Filled.MoreVert, contentDescription = null)
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.share)) },
                    leadingIcon = { Icon(Icons.Filled.Share, contentDescription = null) },
                    onClick = { menu = false; onShare() },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.print)) },
                    leadingIcon = { Icon(Icons.Filled.Print, contentDescription = null) },
                    onClick = { menu = false; onPrint() },
                )
            }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SearchBar(
    state: SearchState,
    onQueryChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onClose: () -> Unit,
) {
    TopAppBar(
        title = {
            TextField(
                value = state.query,
                onValueChange = onQueryChange,
                singleLine = true,
                placeholder = { Text(stringResource(R.string.search_hint)) },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { onSubmit() }),
                modifier = Modifier.fillMaxWidth(),
            )
        },
        navigationIcon = {
            IconButton(onClick = onClose) {
                Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.close))
            }
        },
        actions = {
            val label = when {
                state.running -> "…"
                state.matches.isEmpty() && state.query.isNotBlank() ->
                    stringResource(R.string.search_no_matches)
                state.matches.isEmpty() -> ""
                else -> stringResource(R.string.search_matches, state.current + 1, state.matches.size)
            }
            if (label.isNotEmpty()) {
                Text(label, style = MaterialTheme.typography.labelMedium)
            }
            IconButton(onClick = onPrev, enabled = state.matches.isNotEmpty()) {
                Icon(Icons.Filled.KeyboardArrowUp, contentDescription = stringResource(R.string.prev_match))
            }
            IconButton(onClick = onNext, enabled = state.matches.isNotEmpty()) {
                Icon(Icons.Filled.KeyboardArrowDown, contentDescription = stringResource(R.string.next_match))
            }
        },
    )
}
