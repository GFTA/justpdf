package de.artur.justpdf.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

data class RecentFile(
    val uri: String,
    val name: String,
    val lastOpened: Long,
    val lastPage: Int = 0,
)

private val Context.recentsDataStore: DataStore<Preferences> by preferencesDataStore(name = "recents")

/**
 * Stores the recent list as one string. Records are separated by '\n', fields by
 * the unit-separator char '' (never appears in a URI or a file name).
 */
class RecentsRepository(private val context: Context) {

    private val key = stringPreferencesKey("recent_list")
    private val maxEntries = 40

    val recents: Flow<List<RecentFile>> = context.recentsDataStore.data.map { p ->
        decode(p[key].orEmpty())
    }

    suspend fun touch(uri: String, name: String, lastPage: Int) {
        context.recentsDataStore.edit { p ->
            val current = decode(p[key].orEmpty()).filterNot { it.uri == uri }
            val updated = buildList {
                add(RecentFile(uri, name, System.currentTimeMillis(), lastPage))
                addAll(current)
            }.take(maxEntries)
            p[key] = encode(updated)
        }
    }

    suspend fun updateLastPage(uri: String, lastPage: Int) {
        context.recentsDataStore.edit { p ->
            val updated = decode(p[key].orEmpty()).map {
                if (it.uri == uri) it.copy(lastPage = lastPage) else it
            }
            p[key] = encode(updated)
        }
    }

    suspend fun remove(uri: String) {
        context.recentsDataStore.edit { p ->
            p[key] = encode(decode(p[key].orEmpty()).filterNot { it.uri == uri })
        }
    }

    suspend fun clear() {
        context.recentsDataStore.edit { it.remove(key) }
    }

    private fun encode(list: List<RecentFile>): String =
        list.joinToString("\n") { "${it.uri}${it.name}${it.lastOpened}${it.lastPage}" }

    private fun decode(raw: String): List<RecentFile> {
        if (raw.isBlank()) return emptyList()
        return raw.split("\n").mapNotNull { line ->
            val parts = line.split("")
            if (parts.size < 4) return@mapNotNull null
            RecentFile(
                uri = parts[0],
                name = parts[1],
                lastOpened = parts[2].toLongOrNull() ?: 0L,
                lastPage = parts[3].toIntOrNull() ?: 0,
            )
        }
    }
}
