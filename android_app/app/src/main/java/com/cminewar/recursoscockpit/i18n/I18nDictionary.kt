package com.cminewar.recursoscockpit.i18n

import android.content.Context
import java.util.Locale

/**
 * Lee directamente el diccionario tabular compartido en formato hoja de cálculo
 * (`assets/i18n/dictionary.csv`, copiado por Gradle desde `../../i18n/dictionary.csv`).
 * Autodetecta cualquier columna de idioma añadida a futuro sin recompilar código Java/Kotlin.
 */
object I18nDictionary {
    private val META_COLUMNS = setOf("key", "clave", "context", "contexto", "notes", "notas", "comment", "comentario")

    private data class Catalog(
        val defaultLocale: String,
        val supportedLocales: List<String>,
        val localeNames: Map<String, String>,
        val flat: Map<String, Map<String, String>>
    )

    @Volatile
    private var cachedCatalog: Catalog? = null

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

    private fun ensureLoaded(context: Context): Catalog {
        cachedCatalog?.let { return it }
        synchronized(this) {
            cachedCatalog?.let { return it }
            val loaded = try {
                val text = context.assets.open("i18n/dictionary.csv").bufferedReader().use { it.readText() }
                parseCatalog(text)
            } catch (_: Exception) {
                Catalog("es", listOf("es"), mapOf("es" to "Español"), mapOf("es" to emptyMap()))
            }
            cachedCatalog = loaded
            return loaded
        }
    }

    fun t(
        context: Context,
        key: String,
        fallback: String? = null,
        params: Map<String, Any?> = emptyMap(),
        langOverride: String? = null
    ): String {
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
