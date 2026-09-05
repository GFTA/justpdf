package de.artur.justpdf.ui.home

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.text.format.DateUtils
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.FileOpen
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import de.artur.justpdf.R
import de.artur.justpdf.data.PdfEntry
import de.artur.justpdf.pdf.PdfThumbnailer
import de.artur.justpdf.ui.AppViewModelFactory
import de.artur.justpdf.util.formatSize
import de.artur.justpdf.util.queryUriInfo

private const val THUMB_WIDTH_PX = 420

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onOpenPdf: (uri: String, name: String) -> Unit,
    onOpenSettings: () -> Unit,
    viewModel: HomeViewModel = viewModel(factory = AppViewModelFactory),
) {
    val context = LocalContext.current
    val state by viewModel.state.collectAsStateWithLifecycle()
    val thumbnailer = viewModel.thumbnailer

    val openFileLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri: Uri? ->
        if (uri != null) {
            runCatching {
                context.contentResolver.takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION,
                )
            }
            val name = context.queryUriInfo(uri).name
            onOpenPdf(uri.toString(), name)
        }
    }

    val pickFolderLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocumentTree(),
    ) { uri: Uri? ->
        if (uri != null) {
            runCatching {
                context.contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                )
            }
            viewModel.setFolder(uri.toString())
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.app_name)) },
                actions = {
                    IconButton(onClick = { viewModel.refresh() }) {
                        Icon(Icons.Filled.Refresh, contentDescription = null)
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(
                            Icons.Filled.Settings,
                            contentDescription = stringResource(R.string.settings),
                        )
                    }
                },
            )
        },
    ) { padding ->
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 156.dp),
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            fullSpanItem {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Button(
                        onClick = { openFileLauncher.launch(arrayOf("application/pdf")) },
                        modifier = Modifier.weight(1f),
                    ) {
                        Icon(Icons.Filled.FileOpen, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.open_file))
                    }
                    OutlinedButton(
                        onClick = { pickFolderLauncher.launch(null) },
                        modifier = Modifier.weight(1f),
                    ) {
                        Icon(Icons.Filled.CreateNewFolder, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.pick_folder))
                    }
                }
            }

            fullSpanItem { SectionHeader(stringResource(R.string.tab_recent)) }
            if (state.recents.isEmpty()) {
                fullSpanItem {
                    EmptyHint(
                        stringResource(R.string.empty_recent_title),
                        stringResource(R.string.empty_recent_body),
                    )
                }
            } else {
                items(state.recents, key = { "recent:" + it.uri }) { rf ->
                    PdfTile(
                        uriString = rf.uri,
                        name = rf.name,
                        subtitle = DateUtils.getRelativeTimeSpanString(rf.lastOpened).toString(),
                        thumbnailer = thumbnailer,
                        onOpen = { onOpenPdf(rf.uri, rf.name) },
                        onRemove = { viewModel.removeRecent(rf.uri) },
                    )
                }
            }

            fullSpanItem {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = stringResource(R.string.tab_folder),
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.weight(1f),
                    )
                    if (state.folderUri != null) {
                        TextButton(onClick = { viewModel.clearFolder() }) {
                            Text(stringResource(R.string.close))
                        }
                    }
                }
            }

            when {
                state.folderUri == null -> fullSpanItem {
                    EmptyHint(
                        stringResource(R.string.empty_folder_title),
                        stringResource(R.string.empty_folder_body),
                    )
                }
                state.folderLoading -> fullSpanItem { LoadingRow() }
                state.folderFiles.isEmpty() -> fullSpanItem {
                    EmptyHint(stringResource(R.string.folder_no_pdfs), "")
                }
                else -> items(state.folderFiles, key = { "folder:" + it.uri }) { entry ->
                    PdfTile(
                        uriString = entry.uri,
                        name = entry.name,
                        subtitle = tileSubtitle(entry),
                        thumbnailer = thumbnailer,
                        onOpen = { onOpenPdf(entry.uri, entry.name) },
                    )
                }
            }

            if (state.fullScanEnabled) {
                fullSpanItem { SectionHeader(stringResource(R.string.settings_full_scan)) }
                when {
                    state.scanLoading -> fullSpanItem { LoadingRow() }
                    state.scanFiles.isEmpty() -> fullSpanItem {
                        EmptyHint(stringResource(R.string.folder_no_pdfs), "")
                    }
                    else -> items(state.scanFiles, key = { "scan:" + it.uri }) { entry ->
                        PdfTile(
                            uriString = entry.uri,
                            name = entry.name,
                            subtitle = tileSubtitle(entry),
                            thumbnailer = thumbnailer,
                            onOpen = { onOpenPdf(entry.uri, entry.name) },
                        )
                    }
                }
            }
        }
    }
}

private fun tileSubtitle(entry: PdfEntry): String =
    if (entry.sizeBytes > 0) formatSize(entry.sizeBytes) else ""

private fun LazyGridScope.fullSpanItem(content: @Composable () -> Unit) {
    item(span = { GridItemSpan(maxLineSpan) }) { content() }
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PdfTile(
    uriString: String,
    name: String,
    subtitle: String,
    thumbnailer: PdfThumbnailer,
    onOpen: () -> Unit,
    onRemove: (() -> Unit)? = null,
) {
    val thumb by produceState<Bitmap?>(initialValue = null, uriString) {
        value = thumbnailer.get(uriString, THUMB_WIDTH_PX)
    }

    Card(modifier = Modifier.clickable(onClick = onOpen)) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(0.78f)
                .background(Color.White),
            contentAlignment = Alignment.Center,
        ) {
            val bmp = thumb
            if (bmp != null && !bmp.isRecycled) {
                Image(
                    bitmap = bmp.asImageBitmap(),
                    contentDescription = stringResource(R.string.preview_of, name),
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                    alignment = Alignment.TopCenter,
                )
            } else {
                Icon(
                    Icons.Filled.PictureAsPdf,
                    contentDescription = null,
                    modifier = Modifier.size(40.dp),
                    tint = MaterialTheme.colorScheme.outline,
                )
            }
            if (onRemove != null) {
                Surface(
                    onClick = onRemove,
                    shape = RoundedCornerShape(50),
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.9f),
                    contentColor = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(4.dp)
                        .size(28.dp),
                ) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = stringResource(R.string.remove),
                        modifier = Modifier.padding(5.dp),
                    )
                }
            }
        }
        Column(modifier = Modifier.padding(8.dp)) {
            Text(
                text = name,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle.isNotBlank()) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun EmptyHint(title: String, body: String) {
    Column {
        Text(title, style = MaterialTheme.typography.bodyLarge)
        if (body.isNotBlank()) {
            Text(
                body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun LoadingRow() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CircularProgressIndicator(modifier = Modifier.size(20.dp))
        Text(stringResource(R.string.scanning))
    }
}
