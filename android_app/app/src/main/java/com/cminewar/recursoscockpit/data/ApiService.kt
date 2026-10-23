package com.cminewar.recursoscockpit.data

import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

class ApiService(private val securePreferences: SecurePreferences) {

    private val gson = Gson()

    private val client = OkHttpClient.Builder()
        .connectTimeout(2500, TimeUnit.MILLISECONDS)
        .readTimeout(3500, TimeUnit.MILLISECONDS)
        .build()

    suspend fun checkHealth(baseUrl: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val url = "$baseUrl/api/version"
            val request = Request.Builder()
                .url(url)
                .header("User-Agent", "RecursosCockpit-Android/8.4.0")
                .apply {
                    val token = securePreferences.deviceToken
                    if (token.isNotEmpty()) {
                        header("X-Device-Token", token)
                    }
                }
                .build()

            client.newCall(request).execute().use { response ->
                response.isSuccessful
            }
        } catch (e: Exception) {
            false
        }
    }

    suspend fun fetchVersion(baseUrl: String): VersionInfo? = withContext(Dispatchers.IO) {
        try {
            val url = "$baseUrl/api/version"
            val request = Request.Builder()
                .url(url)
                .header("User-Agent", "RecursosCockpit-Android/8.4.0")
                .apply {
                    val token = securePreferences.deviceToken
                    if (token.isNotEmpty()) {
                        header("X-Device-Token", token)
                    }
                }
                .build()

            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val body = response.body?.string() ?: return@withContext null
                    gson.fromJson(body, VersionInfo::class.java)
                } else {
                    null
                }
            }
        } catch (e: Exception) {
            null
        }
    }

    suspend fun fetchMetrics(baseUrl: String): MetricsResponse? = withContext(Dispatchers.IO) {
        try {
            val url = "$baseUrl/api/metrics"
            val request = Request.Builder()
                .url(url)
                .header("User-Agent", "RecursosCockpit-Android/8.4.0")
                .apply {
                    val token = securePreferences.deviceToken
                    if (token.isNotEmpty()) {
                        header("X-Device-Token", token)
                    }
                }
                .build()

            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val body = response.body?.string() ?: return@withContext null
                    gson.fromJson(body, MetricsResponse::class.java)
                } else {
                    null
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("RecursosCockpit", "fetchMetrics error: ${e.message}", e)
            null
        }
    }
}
