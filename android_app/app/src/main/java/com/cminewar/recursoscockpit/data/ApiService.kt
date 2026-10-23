package com.cminewar.recursoscockpit.data

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.Settings
import android.util.Base64
import android.util.Log
import com.cminewar.recursoscockpit.BuildConfig
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.net.Inet4Address
import java.net.NetworkInterface
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

data class HealthCheckResult(
    val isOnline: Boolean,
    val isRevoked: Boolean = false,
    val isRecursosServer: Boolean = false
)

class ApiService(
    private val context: Context,
    private val securePreferences: SecurePreferences
) {

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

    @SuppressLint("HardwareIds")
    fun collectDeviceTelemetry(): NativeDeviceTelemetry {
        val manufacturer = (Build.MANUFACTURER ?: "Android").replaceFirstChar {
            if (it.isLowerCase()) it.titlecase(Locale.getDefault()) else it.toString()
        }
        val brand = (Build.BRAND ?: manufacturer).replaceFirstChar {
            if (it.isLowerCase()) it.titlecase(Locale.getDefault()) else it.toString()
        }
        val model = Build.MODEL ?: "Android Device"
        val deviceCodename = Build.DEVICE ?: ""
        val product = Build.PRODUCT ?: ""
        val board = Build.BOARD ?: ""
        val hardwareSoc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            listOfNotNull(Build.SOC_MANUFACTURER, Build.SOC_MODEL)
                .filter { it.isNotBlank() && it != Build.UNKNOWN }
                .joinToString(" ")
                .ifBlank { Build.HARDWARE ?: "" }
        } else {
            Build.HARDWARE ?: ""
        }
        val bootloader = Build.BOOTLOADER ?: ""
        val buildDisplay = Build.DISPLAY ?: ""

        val osDistro = "Android ${Build.VERSION.RELEASE ?: ""} (API ${Build.VERSION.SDK_INT})"
        val securityPatch = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Build.VERSION.SECURITY_PATCH ?: ""
        } else {
            ""
        }
        val kernelVer = System.getProperty("os.version") ?: ""
        val kernel = if (kernelVer.isNotBlank()) "Linux $kernelVer" else "Linux Android Kernel"
        val abis = Build.SUPPORTED_ABIS ?: emptyArray()
        val arch = abis.firstOrNull() ?: (System.getProperty("os.arch") ?: "arm64-v8a")
        val supportedAbis = abis.joinToString(", ")

        // CPU Model & Cores
        val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
        var cpuModel = hardwareSoc
        try {
            val cpuInfoFile = File("/proc/cpuinfo")
            if (cpuInfoFile.exists() && cpuInfoFile.canRead()) {
                cpuInfoFile.forEachLine { line ->
                    val parts = line.split(":", limit = 2)
                    if (parts.size == 2) {
                        val k = parts[0].trim().lowercase(Locale.ROOT)
                        val v = parts[1].trim()
                        if ((k == "hardware" || k == "model name" || k == "processor") && v.isNotBlank() && v.toIntOrNull() == null) {
                            if (cpuModel.isBlank()) cpuModel = v
                        }
                    }
                }
            }
        } catch (_: Exception) {}
        if (cpuModel.isBlank()) {
            cpuModel = "$brand SoC ($arch)"
        }

        // RAM Total
        var ramTotalBytes = 0L
        try {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            if (am != null) {
                val memInfo = ActivityManager.MemoryInfo()
                am.getMemoryInfo(memInfo)
                ramTotalBytes = memInfo.totalMem
            }
        } catch (_: Exception) {}
        val ramTotalGb = if (ramTotalBytes > 0) {
            ((ramTotalBytes.toDouble() / (1024.0 * 1024.0 * 1024.0)) * 10.0).roundToInt() / 10.0
        } else 0.0

        // Almacenamiento Interno
        var storageTotalBytes = 0L
        var storageFreeBytes = 0L
        try {
            val stat = StatFs(Environment.getDataDirectory().path)
            storageTotalBytes = stat.blockCountLong * stat.blockSizeLong
            storageFreeBytes = stat.availableBlocksLong * stat.blockSizeLong
        } catch (_: Exception) {}
        val storageTotalGb = if (storageTotalBytes > 0) {
            ((storageTotalBytes.toDouble() / (1024.0 * 1024.0 * 1024.0)) * 10.0).roundToInt() / 10.0
        } else 0.0
        val storageFreeGb = if (storageFreeBytes > 0) {
            ((storageFreeBytes.toDouble() / (1024.0 * 1024.0 * 1024.0)) * 10.0).roundToInt() / 10.0
        } else 0.0

        // Batería
        var batteryPercent: Int? = null
        var batteryCharging: Boolean? = null
        try {
            val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
            if (bm != null) {
                val cap = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
                if (cap in 0..100) batteryPercent = cap
                batteryCharging = bm.isCharging
            }
        } catch (_: Exception) {}

        // Pantalla
        var screenRes = ""
        try {
            val dm = context.resources.displayMetrics
            if (dm != null && dm.widthPixels > 0 && dm.heightPixels > 0) {
                screenRes = "${dm.widthPixels}x${dm.heightPixels} (${dm.densityDpi} dpi)"
            }
        } catch (_: Exception) {}

        // Red Local (IP, Interfaz, MAC si disponible)
        var localIp = ""
        var ifaceName = ""
        var macAddr = ""
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces != null && interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                if (!iface.isUp || iface.isLoopback) continue
                val addrs = iface.inetAddresses
                while (addrs.hasMoreElements()) {
                    val addr = addrs.nextElement()
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        val ip = addr.hostAddress ?: continue
                        localIp = ip
                        ifaceName = iface.name ?: "wlan0"
                        try {
                            val hw = iface.hardwareAddress
                            if (hw != null && hw.isNotEmpty()) {
                                macAddr = hw.joinToString(":") { String.format("%02X", it) }
                            }
                        } catch (_: Exception) {}
                        break
                    }
                }
                if (localIp.isNotEmpty()) break
            }
        } catch (_: Exception) {}

        // Android ID & Huella Criptográfica Única
        val androidId = try {
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: ""
        } catch (_: Exception) {
            ""
        }
        val seed = "android_native:${androidId.ifBlank { Build.FINGERPRINT ?: model }}:$model:$board"
        val digest = MessageDigest.getInstance("SHA-256").digest(seed.toByteArray(Charsets.UTF_8))
        val hexFp = digest.joinToString("") { "%02x".format(it) }.take(16)
        val hardwareId = "and_$hexFp"

        val displayModel = if (model.lowercase(Locale.ROOT).startsWith(manufacturer.lowercase(Locale.ROOT))) {
            model
        } else {
            "$manufacturer $model"
        }
        val cleanHost = "${brand}-${model}".replace(Regex("[^a-zA-Z0-9_-]"), "-")

        return NativeDeviceTelemetry(
            clientType = "android_native",
            clientLabel = "App Nativa Android (.apk)",
            accessLevel = "FULL_NATIVE_ACCESS",
            fullAccess = true,
            dexCapable = false,
            appVersion = BuildConfig.VERSION_NAME,
            hardwareId = hardwareId,
            name = if (deviceCodename.isNotBlank()) "$displayModel ($deviceCodename)" else displayModel,
            hostname = cleanHost,
            manufacturer = manufacturer,
            brand = brand,
            model = model,
            deviceCodename = deviceCodename,
            product = product,
            board = board,
            hardwareSoc = hardwareSoc,
            bootloader = bootloader,
            buildDisplay = buildDisplay,
            chassisType = "Android Mobile / Tablet",
            osDistro = osDistro,
            securityPatch = securityPatch,
            kernel = kernel,
            arch = arch,
            supportedAbis = supportedAbis,
            cpuModel = cpuModel,
            cpuCoresPhysical = cores,
            cpuCoresLogical = cores,
            ramTotalBytes = ramTotalBytes,
            ramTotalGb = ramTotalGb,
            storageTotalBytes = storageTotalBytes,
            storageTotalGb = storageTotalGb,
            storageFreeGb = storageFreeGb,
            batteryPercent = batteryPercent,
            batteryCharging = batteryCharging,
            screenResolution = screenRes,
            localIp = localIp,
            interfaceName = ifaceName,
            macAddress = macAddr
        )
    }

    fun getDeviceTelemetryJson(): String {
        return try {
            gson.toJson(collectDeviceTelemetry())
        } catch (e: Exception) {
            "{}"
        }
    }

    private fun getEncodedTelemetryHeader(): String {
        return try {
            val jsonBytes = getDeviceTelemetryJson().toByteArray(Charsets.UTF_8)
            Base64.encodeToString(jsonBytes, Base64.NO_WRAP)
        } catch (e: Exception) {
            ""
        }
    }

    private fun applyAuthAndTelemetryHeaders(reqBuilder: Request.Builder) {
        reqBuilder.header("User-Agent", "RecursosCockpit-Android/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE}; ${Build.MANUFACTURER} ${Build.MODEL}; NativeHTML; FullAccess)")
        reqBuilder.header("X-Recursos-Client", "android_native")
        val telemetryB64 = getEncodedTelemetryHeader()
        if (telemetryB64.isNotEmpty()) {
            reqBuilder.header("X-Device-Telemetry", telemetryB64)
        }
        val token = securePreferences.deviceToken
        if (token.isNotEmpty()) {
            reqBuilder.header("X-Device-Token", token)
            reqBuilder.header("Authorization", "Bearer $token")
        }
    }

    suspend fun probeNode(baseUrl: String, isQuickScan: Boolean = false): HealthCheckResult = withContext(Dispatchers.IO) {
        try {
            val url = "$baseUrl/api/version"
            val reqBuilder = Request.Builder().url(url)
            applyAuthAndTelemetryHeaders(reqBuilder)

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

    suspend fun registerDeviceWithServer(baseUrl: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val url = "${baseUrl.trimEnd('/')}/api/auth/register-device"
            val payload = mapOf("device_telemetry" to collectDeviceTelemetry())
            val jsonBody = gson.toJson(payload).toRequestBody("application/json; charset=utf-8".toMediaType())
            val reqBuilder = Request.Builder().url(url).post(jsonBody)
            applyAuthAndTelemetryHeaders(reqBuilder)

            client.newCall(reqBuilder.build()).execute().use { response ->
                if (response.isSuccessful) {
                    true
                } else {
                    false
                }
            }
        } catch (e: Exception) {
            false
        }
    }

    suspend fun fetchMetrics(baseUrl: String): Pair<MetricsResponse?, Boolean> = withContext(Dispatchers.IO) {
        try {
            val url = "$baseUrl/api/metrics"
            val reqBuilder = Request.Builder().url(url)
            applyAuthAndTelemetryHeaders(reqBuilder)

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

