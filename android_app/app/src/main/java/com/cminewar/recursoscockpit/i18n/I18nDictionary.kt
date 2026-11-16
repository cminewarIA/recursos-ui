package com.cminewar.recursoscockpit.i18n

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

/**
 * Lee directamente el diccionario tabular compartido en formato hoja de cálculo
 * (`assets/i18n/dictionary.csv`, copiado por Gradle desde `../../i18n/dictionary.csv`)
 * y lo actualiza OTA desde GitHub / servidor emparejado sin recompilar la APK.
 */
object I18nDictionary {
    private const val GITHUB_DICTIONARY_RAW_URL =
        "https://raw.githubusercontent.com/cminewarIA/recursos-ui/main/i18n/dictionary.csv"
    private val META_COLUMNS = setOf("key", "clave", "context", "contexto", "notes", "notas", "comment", "comentario")

    private data class Catalog(
        val defaultLocale: String,
        val supportedLocales: List<String>,
        val localeNames: Map<String, String>,
        val flat: Map<String, Map<String, String>>
    )

    @Volatile
    private var cachedCatalog: Catalog? = null

    var catalogRevision by mutableStateOf(0)
        private set

    private fun detectDelimiter(headerLine: String): Char {
        var inQuotes = false
        var commas = 0
        var semis = 0
        for (ch in headerLine) {
            if (ch == '"') inQuotes = !inQuotes
            else if (!inQuotes) {
                if (ch == ',') commas++
                else if (ch == ';') semis++
            }
        }
        return if (semis > commas) ';' else ','
    }

    private fun parseCsvRows(text: String, delimiter: Char): List<List<String>> {
        val rows = mutableListOf<List<String>>()
        val currentRow = mutableListOf<String>()
        val field = StringBuilder()
        var inQuotes = false
        var i = 0

        while (i < text.length) {
            val ch = text[i]
            if (inQuotes) {
                if (ch == '"') {
                    if (i + 1 < text.length && text[i + 1] == '"') {
                        field.append('"')
                        i += 2
                        continue
                    }
                    inQuotes = false
                    i++
                    continue
                }
                field.append(ch)
                i++
                continue
            }

            when (ch) {
                '"' -> {
                    inQuotes = true
                    i++
                }
                delimiter -> {
                    currentRow.add(field.toString())
                    field.setLength(0)
                    i++
                }
                '\r', '\n' -> {
                    currentRow.add(field.toString())
                    field.setLength(0)
                    if (currentRow.any { it.isNotEmpty() }) {
                        rows.add(currentRow.toList())
                    }
                    currentRow.clear()
                    if (ch == '\r' && i + 1 < text.length && text[i + 1] == '\n') i += 2 else i++
                }
                else -> {
                    field.append(ch)
                    i++
                }
            }
        }

        if (field.isNotEmpty() || currentRow.isNotEmpty()) {
            currentRow.add(field.toString())
            if (currentRow.any { it.isNotEmpty() }) {
                rows.add(currentRow.toList())
            }
        }
        return rows
    }

    private fun parseCatalog(csvText: String): Catalog {
        val clean = csvText.removePrefix("\uFEFF")
        val firstLine = clean.lineSequence().firstOrNull() ?: ""
        val rows = parseCsvRows(clean, detectDelimiter(firstLine))
        if (rows.isEmpty()) {
            return Catalog("es", listOf("es"), mapOf("es" to "Español"), mapOf("es" to emptyMap()))
        }

        val headers = rows[0].map { it.trim() }
        val keyIdx = headers.indexOfFirst {
            it.equals("key", ignoreCase = true) || it.equals("clave", ignoreCase = true)
        }.let { if (it >= 0) it else 0 }

        val langCols = headers.mapIndexedNotNull { idx, col ->
            if (col.isEmpty() || idx == keyIdx || META_COLUMNS.contains(col.lowercase())) null
            else col to idx
        }.ifEmpty { listOf("es" to minOf(1, headers.size - 1)) }

        val supported = langCols.map { it.first }
        var defLoc = supported.firstOrNull() ?: "es"
        val names = supported.associateWith { it.uppercase() }.toMutableMap()
        val flat = supported.associateWith { mutableMapOf<String, String>() }

        for (r in 1 until rows.size) {
            val row = rows[r]
            val key = row.getOrNull(keyIdx)?.trim().orEmpty()
            if (key.isEmpty() || key.startsWith("#")) continue

            if (key == "__locale_name__") {
                for ((code, idx) in langCols) {
                    val v = row.getOrNull(idx)?.trim().orEmpty()
                    if (v.isNotEmpty()) names[code] = v
                }
                continue
            }
            if (key == "__default_locale__") {
                for ((code, idx) in langCols) {
                    val flag = row.getOrNull(idx)?.trim()?.lowercase().orEmpty()
                    if (flag in setOf("1", "true", "yes", "si", "sí", "default", "*")) {
                        defLoc = code
                        break
                    }
                }
                continue
            }
            for ((code, idx) in langCols) {
                val v = row.getOrNull(idx).orEmpty()
                if (v.isNotEmpty()) flat[code]?.put(key, v)
            }
        }

        return Catalog(defLoc, supported, names, flat)
    }

    private fun mergeCatalogs(base: Catalog, incoming: Catalog): Catalog {
        val inLocales = incoming.supportedLocales
        if (inLocales.isEmpty()) return base
        val validIncoming = inLocales.any { loc -> (incoming.flat[loc]?.size ?: 0) >= 20 }
        if (!validIncoming) return base

        val mergedLocales = (base.supportedLocales + inLocales).distinct()
        val mergedNames = base.localeNames.toMutableMap()
        for ((code, name) in incoming.localeNames) {
            if (name.isNotBlank()) mergedNames[code] = name
        }
        val mergedFlat = mutableMapOf<String, MutableMap<String, String>>()
        for (loc in mergedLocales) {
            val map = (base.flat[loc] ?: emptyMap()).toMutableMap()
            val rem = incoming.flat[loc] ?: emptyMap()
            for ((k, v) in rem) {
                if (v.isNotEmpty()) map[k] = v
            }
            mergedFlat[loc] = map
        }
        val defLoc = if (mergedLocales.contains(incoming.defaultLocale)) incoming.defaultLocale else base.defaultLocale
        return Catalog(defLoc, mergedLocales, mergedNames, mergedFlat)
    }

    private fun readBundledAssetsCatalog(context: Context): Catalog {
        return try {
            val text = context.assets.open("i18n/dictionary.csv").bufferedReader().use { it.readText() }
            parseCatalog(text)
        } catch (_: Exception) {
            Catalog("es", listOf("es"), mapOf("es" to "Español"), mapOf("es" to emptyMap()))
        }
    }

    private fun getOtaFiles(context: Context): Pair<File, File> {
        val dir = File(context.filesDir, "i18n")
        return File(dir, "dictionary_ota.csv") to File(dir, "dictionary_ota.etag")
    }

    private fun ensureLoaded(context: Context): Catalog {
        cachedCatalog?.let { return it }
        synchronized(this) {
            cachedCatalog?.let { return it }
            val base = readBundledAssetsCatalog(context)
            val (otaFile, _) = getOtaFiles(context)
            val loaded = if (otaFile.isFile) {
                try {
                    val otaCat = parseCatalog(otaFile.readText(Charsets.UTF_8))
                    mergeCatalogs(base, otaCat)
                } catch (_: Exception) {
                    base
                }
            } else {
                base
            }
            cachedCatalog = loaded
            return loaded
        }
    }

    /**
     * Descarga OTA `./i18n/dictionary.csv` desde GitHub (ETag) o desde el servidor conectado
     * para incorporar idiomas nuevos sin actualizar la APK.
     */
    suspend fun syncRemoteDictionary(context: Context, serverBaseUrl: String? = null): Boolean = withContext(Dispatchers.IO) {
        val (otaFile, etagFile) = getOtaFiles(context)
        val cachedEtag = if (otaFile.isFile && etagFile.isFile) etagFile.readText(Charsets.UTF_8).trim() else ""

        val urls = buildList {
            add(GITHUB_DICTIONARY_RAW_URL)
            val srv = serverBaseUrl?.trim()?.trimEnd('/')
            if (!srv.isNullOrEmpty() && (srv.startsWith("http://") || srv.startsWith("https://"))) {
                add("$srv/i18n/dictionary.csv")
            }
        }

        for (targetUrl in urls) {
            var conn: HttpURLConnection? = null
            try {
                conn = (URL(targetUrl).openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 4500
                    readTimeout = 5000
                    setRequestProperty("Accept", "text/csv, text/plain")
                    setRequestProperty("User-Agent", "RecursosCockpit-Android-i18n/1.0")
                    if (targetUrl == GITHUB_DICTIONARY_RAW_URL && cachedEtag.isNotEmpty()) {
                        setRequestProperty("If-None-Match", cachedEtag)
                    }
                }
                val code = conn.responseCode
                if (code == HttpURLConnection.HTTP_NOT_MODIFIED) {
                    return@withContext false
                }
                if (code in 200..299) {
                    val csvText = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                    val parsedRemote = parseCatalog(csvText)
                    val defCount = parsedRemote.flat[parsedRemote.defaultLocale]?.size ?: 0
                    if (defCount >= 20) {
                        otaFile.parentFile?.mkdirs()
                        val tmp = File(otaFile.parentFile, "dictionary_ota.csv.tmp")
                        tmp.writeText(csvText, Charsets.UTF_8)
                        tmp.renameTo(otaFile)
                        val newEtag = conn.getHeaderField("ETag")?.trim().orEmpty()
                        if (targetUrl == GITHUB_DICTIONARY_RAW_URL && newEtag.isNotEmpty()) {
                            etagFile.writeText(newEtag, Charsets.UTF_8)
                        }
                        val base = readBundledAssetsCatalog(context)
                        val merged = mergeCatalogs(base, parsedRemote)
                        synchronized(this@I18nDictionary) {
                            cachedCatalog = merged
                        }
                        withContext(Dispatchers.Main) {
                            catalogRevision += 1
                        }
                        return@withContext true
                    }
                }
            } catch (_: Exception) {
                // Continuar al siguiente origen o mantener fallback local offline
            } finally {
                conn?.disconnect()
            }
        }
        false
    }

    fun t(
        context: Context,
        key: String,
        fallback: String? = null,
        params: Map<String, Any?> = emptyMap(),
        langOverride: String? = null
    ): String {
        val snapRevision = catalogRevision
        if (snapRevision < 0) return key
        val cat = ensureLoaded(context)
        val deviceLang = (langOverride ?: Locale.getDefault().language ?: cat.defaultLocale).lowercase()
        val targetLang = if (cat.flat.containsKey(deviceLang)) deviceLang else cat.defaultLocale
        var text = cat.flat[targetLang]?.get(key)
            ?: cat.flat[cat.defaultLocale]?.get(key)
            ?: fallback
            ?: key
        if (params.isNotEmpty()) {
            for ((pk, pv) in params) {
                text = text.replace("{$pk}", pv?.toString().orEmpty())
            }
        }
        return text
    }
}
