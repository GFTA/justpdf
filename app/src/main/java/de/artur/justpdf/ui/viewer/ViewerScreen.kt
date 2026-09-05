package de.artur.justpdf.ui.viewer

import android.net.Uri
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material.icons.filled.Numbers
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import de.artur.justpdf.R
import de.artur.justpdf.pdf.SearchMatch
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
    var showGoToPage by remember { mutableStateOf(false) }

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
                    canGoToPage = state.status is ViewerStatus.Ready && state.pageCount > 1,
                    onBack = onBack,
                    onSearch = viewModel::openSearch,
                    onGoToPage = { showGoToPage = true },
                    onShare = { context.sharePdf(decodedUri, state.title) },
                    onPrint = { context.printPdf(decodedUri, state.title) },
                )
            }
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when (val status = state.status) {
                is ViewerStatus.Loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                is ViewerStatus.Error -> ErrorContent(
                    message = status.message,
                    onRemoveFromRecent = {
                        viewModel.removeFromRecents()
                        onBack()
                    },
                    modifier = Modifier.align(Alignment.Center),
                )
                is ViewerStatus.Ready -> ViewerPages(state = state, viewModel = viewModel)
            }
        }
    }

    if (showGoToPage && state.pageCount > 0) {
        GoToPageDialog(
            pageCount = state.pageCount,
            onDismiss = { showGoToPage = false },
            onGo = { page ->
                showGoToPage = false
                viewModel.requestGoToPage(page - 1)
            },
        )
    }
}

@Composable
private fun ErrorContent(
    message: String,
    onRemoveFromRecent: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text = message, color = MaterialTheme.colorScheme.error)
        TextButton(onClick = onRemoveFromRecent) {
            Text(stringResource(R.string.remove_from_recent))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GoToPageDialog(
    pageCount: Int,
    onDismiss: () -> Unit,
    onGo: (Int) -> Unit,
) {
    var text by remember { mutableStateOf("") }
    val page = text.toIntOrNull()
    val valid = page != null && page in 1..pageCount

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.go_to_page)) },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { new -> text = new.filter { it.isDigit() }.take(6) },
                singleLine = true,
                label = { Text(stringResource(R.string.page_number)) },
                supportingText = { Text("1 – $pageCount") },
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Number,
                    imeAction = ImeAction.Go,
                ),
                keyboardActions = KeyboardActions(onGo = { if (valid) onGo(page!!) }),
            )
        },
        confirmButton = {
            TextButton(onClick = { if (valid) onGo(page!!) }, enabled = valid) {
                Text(stringResource(R.string.ok))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
        },
    )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ViewerPages(state: ViewerUiState, viewModel: ViewerViewModel) {
    val listState = rememberLazyListState(initialFirstVisibleItemIndex = state.initialPage)
    val density = LocalDensity.current

    // Zoom model (mirrors the official "transformable inside a scroll container" sample):
    //  - pinch scales 1x..5x. `canPan = { scale > 1f }` keeps the gesture from stealing
    //    one-finger vertical scrolls at 1x.
    //  - two-finger drag pans while zoomed; double-tap toggles 1x <-> 2.5x.
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var viewport by remember { mutableStateOf(Offset.Zero) }

    fun clampOffset(raw: Offset, s: Float): Offset {
        val maxX = (viewport.x * (s - 1f) / 2f).coerceAtLeast(0f)
        val maxY = (viewport.y * (s - 1f) / 2f).coerceAtLeast(0f)
        return Offset(raw.x.coerceIn(-maxX, maxX), raw.y.coerceIn(-maxY, maxY))
    }

    val transformState = rememberTransformableState { zoomChange, panChange, _ ->
        val newScale = (scale * zoomChange).coerceIn(1f, 5f)
        scale = newScale
        offset = if (newScale <= 1.001f) Offset.Zero else clampOffset(offset + panChange, newScale)
    }

    val currentPage by remember {
        derivedStateOf { listState.firstVisibleItemIndex }
    }
    LaunchedEffect(currentPage) { viewModel.onPageSettled(currentPage) }

    // Scroll to the active search match.
    LaunchedEffect(state.search.current, state.search.matches) {
        state.search.currentMatch?.let { listState.animateScrollToItem(it.pageIndex) }
    }

    // Go-to-page requests from the menu.
    LaunchedEffect(Unit) {
        viewModel.scrollToPage.collect { listState.animateScrollToItem(it) }
    }

    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        val baseWidthPx = with(density) { maxWidth.roundToPx() }
        viewport = Offset(constraints.maxWidth.toFloat(), constraints.maxHeight.toFloat())
        val renderWidthPx = (baseWidthPx * scale.coerceIn(1f, 3f)).roundToInt()

        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .transformable(state = transformState, canPan = { scale > 1f })
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
    canGoToPage: Boolean,
    onBack: () -> Unit,
    onSearch: () -> Unit,
    onGoToPage: () -> Unit,
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
                if (canGoToPage) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.go_to_page)) },
                        leadingIcon = { Icon(Icons.Filled.Numbers, contentDescription = null) },
                        onClick = { menu = false; onGoToPage() },
                    )
                }
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
