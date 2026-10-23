package com.cminewar.recursoscockpit.data

import android.util.Log
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

data class HealthCheckResult(
    val isOnline: Boolean,
    val isRevoked: Boolean = false,
    val isRecursosServer: Boolean = false
)

class ApiService(private val securePreferences: SecurePreferences) {

    private val gson = Gson()

    private val client = OkHttpClient.Builder()
        .connectTimeout(2000, TimeUnit.MILLISECONDS)
        .readTimeout(3000, TimeUnit.MILLISECONDS)
        .build()

    // Cliente ultrarrápido para escaneo concurrente de puertos y mDNS en LAN
    private val scanClient = OkHttpClient.Builder()
        .connectTimeout(350, TimeUnit.MILLISECONDS)
        .readTimeout(500, TimeUnit.MILLISECONDS)
        .build()

    suspend fun probeNode(baseUrl: String, isQuickScan: Boolean = false): HealthCheckResult = withContext(Dispatchers.IO) {
        try {
            val url = "$baseUrl/api/version"
            val reqBuilder = Request.Builder()
                .url(url)
                .header("User-Agent", "RecursosCockpit-Android/8.5.0")

            val token = securePreferences.deviceToken
            if (token.isNotEmpty()) {
                reqBuilder.header("X-Device-Token", token)
                reqBuilder.header("Authorization", "Bearer $token")
            }

            val httpClient = if (isQuickScan) scanClient else client
            httpClient.newCall(reqBuilder.build()).execute().use { response ->
                if (response.isSuccessful) {
                    val body = response.body?.string() ?: ""
                    val isRecursos = body.contains("Recursos") || body.contains("version")
                    HealthCheckResult(isOnline = true, isRevoked = false, isRecursosServer = isRecursos)
                } else if (response.code == 403) {
                    val body = response.body?.string() ?: ""
                    val isLocked = body.contains("locked") || body.contains("denegado")
                    HealthCheckResult(isOnline = true, isRevoked = isLocked, isRecursosServer = true)
                } else {
                    HealthCheckResult(isOnline = false)
                }
            }
        } catch (e: Exception) {
            HealthCheckResult(isOnline = false)
        }
    }

    suspend fun fetchMetrics(baseUrl: String): Pair<MetricsResponse?, Boolean> = withContext(Dispatchers.IO) {
        try {
            val url = "$baseUrl/api/metrics"
            val reqBuilder = Request.Builder()
                .url(url)
                .header("User-Agent", "RecursosCockpit-Android/8.5.0")

            val token = securePreferences.deviceToken
            if (token.isNotEmpty()) {
                reqBuilder.header("X-Device-Token", token)
                reqBuilder.header("Authorization", "Bearer $token")
            }

            client.newCall(reqBuilder.build()).execute().use { response ->
                if (response.isSuccessful) {
                    val body = response.body?.string() ?: return@withContext Pair(null, false)
                    val metrics = gson.fromJson(body, MetricsResponse::class.java)

                    // Autoguardado persistente del certificado / token recibido
                    val receivedToken = metrics.authStatus?.token
                    if (!receivedToken.isNullOrEmpty() && receivedToken != securePreferences.deviceToken) {
                        Log.i("RecursosCockpit", "Nuevo token certificado recibido y persistido en KeyStore: $receivedToken")
                        securePreferences.deviceToken = receivedToken
                    }
                    Pair(metrics, false)
                } else if (response.code == 403) {
                    Log.w("RecursosCockpit", "Acceso denegado (HTTP 403): Certificado de dispositivo revocado en el servidor.")
                    Pair(null, true) // True = Revocado
                } else {
                    Pair(null, false)
                }
            }
        } catch (e: Exception) {
            Log.e("RecursosCockpit", "Error consultando /api/metrics en $baseUrl: ${e.message}")
            Pair(null, false)
        }
    }
}
