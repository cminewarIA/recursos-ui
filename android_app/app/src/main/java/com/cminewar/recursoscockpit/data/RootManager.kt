package com.cminewar.recursoscockpit.data

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Detección silenciosa de acceso root en segundo plano.
 * No expone ningún selector ni ajuste en la interfaz: se activa automáticamente
 * cuando el dispositivo cuenta con privilegios su/uid=0 y únicamente informa
 * el estado dentro de la telemetría de credencial del dispositivo.
 */
object RootManager {

    @Volatile
    var hasRootAccess: Boolean = false
        private set

    @Volatile
    var rootMethod: String = "none"
        private set

    @Volatile
    private var checked: Boolean = false

    private val suBinaryCandidates = listOf(
        "/system/bin/su",
        "/system/xbin/su",
        "/sbin/su",
        "/su/bin/su",
        "/vendor/bin/su",
        "/data/local/xbin/su",
        "/data/local/bin/su",
        "/magisk/.core/bin/su"
    )

    suspend fun detectSilently(force: Boolean = false): Boolean = withContext(Dispatchers.IO) {
        if (checked && !force) return@withContext hasRootAccess
        val binaryFound = suBinaryCandidates.any { path ->
            try {
                File(path).exists()
            } catch (_: Exception) {
                false
            }
        }
        var verified = false
        if (binaryFound) {
            try {
                val proc = ProcessBuilder("su", "-c", "id")
                    .redirectErrorStream(true)
                    .start()
                val finished = proc.waitFor(2200L, TimeUnit.MILLISECONDS)
                if (finished) {
                    val output = proc.inputStream.bufferedReader().use { it.readText() }
                    verified = proc.exitValue() == 0 && output.contains("uid=0")
                } else {
                    proc.destroyForcibly()
                }
            } catch (e: Exception) {
                Log.d("RecursosCockpit", "Comprobación silenciosa de root no disponible: ${e.message}")
            }
        }
        hasRootAccess = verified
        rootMethod = if (verified) "su" else "none"
        checked = true
        verified
    }

    /**
     * Instala silenciosamente una APK verificada ubicada en el directorio de caché privada
     * cuando el dispositivo dispone de root activo.
     */
    suspend fun installApkSilently(apkFile: File, expectedCacheDir: File): Boolean = withContext(Dispatchers.IO) {
        if (!hasRootAccess) return@withContext false
        val canonicalApk = try { apkFile.canonicalFile } catch (_: Exception) { return@withContext false }
        val canonicalCache = try { expectedCacheDir.canonicalFile } catch (_: Exception) { return@withContext false }
        if (!canonicalApk.exists() || !canonicalApk.isFile) return@withContext false
        if (!canonicalApk.path.startsWith(canonicalCache.path + File.separator)) return@withContext false
        if (!canonicalApk.name.matches(Regex("^[A-Za-z0-9._-]+\\.apk$"))) return@withContext false

        try {
            val safePath = canonicalApk.absolutePath
            val proc = ProcessBuilder("su", "-c", "pm install -r $safePath")
                .redirectErrorStream(true)
                .start()
            val finished = proc.waitFor(60L, TimeUnit.SECONDS)
            if (!finished) {
                proc.destroyForcibly()
                return@withContext false
            }
            val output = proc.inputStream.bufferedReader().use { it.readText() }
            proc.exitValue() == 0 && output.contains("Success", ignoreCase = true)
        } catch (e: Exception) {
            Log.w("RecursosCockpit", "Instalación silenciosa con root falló: ${e.message}")
            false
        }
    }
}
