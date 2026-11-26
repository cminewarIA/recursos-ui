package com.cminewar.recursoscockpit.data

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import com.cminewar.recursoscockpit.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream

/**
 * Instalador oficial in-app de Android mediante PackageInstaller.Session.
 * Permite actualizar la aplicación in-place encima de la versión instalada sin root
 * ni depuración USB, manteniendo datos y emparejamiento cuando el APK comparte firma.
 */
object ApkSessionInstaller {

    const val ACTION_INSTALL_STATUS = "${BuildConfig.APPLICATION_ID}.ACTION_APK_INSTALL_STATUS"

    suspend fun installApkInPlace(context: Context, apkFile: File): Result<Int> = withContext(Dispatchers.IO) {
        if (!apkFile.exists() || !apkFile.isFile || apkFile.length() <= 0L) {
            return@withContext Result.failure(IllegalArgumentException("Archivo APK inválido o inexistente"))
        }

        val packageInstaller = context.packageManager.packageInstaller
        var session: PackageInstaller.Session? = null
        var sessionId = -1
        try {
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(context.packageName)
                setSize(apkFile.length())
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
                }
            }
            sessionId = packageInstaller.createSession(params)
            session = packageInstaller.openSession(sessionId)

            FileInputStream(apkFile).use { input ->
                session.openWrite("recursos_cockpit_update.apk", 0, apkFile.length()).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var read: Int
                    while (input.read(buffer).also { read = it } != -1) {
                        output.write(buffer, 0, read)
                    }
                    session.fsync(output)
                }
            }

            // Intent explícito restringido al propio paquete para recibir el estado del instalador
            val callbackIntent = Intent(ACTION_INSTALL_STATUS).apply {
                setPackage(context.packageName)
            }
            val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                sessionId,
                callbackIntent,
                piFlags
            )

            session.commit(pendingIntent.intentSender)
            session.close()
            session = null
            Result.success(sessionId)
        } catch (e: Exception) {
            Log.e("RecursosCockpit", "Error en PackageInstaller.Session: ${e.message}", e)
            try {
                session?.abandon()
                session?.close()
            } catch (_: Exception) {}
            if (sessionId >= 0) {
                try {
                    packageInstaller.abandonSession(sessionId)
                } catch (_: Exception) {}
            }
            Result.failure(e)
        }
    }
}
