package com.cminewar.recursoscockpit.data

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.Settings
import android.util.Base64
import android.util.Log
import com.cminewar.recursoscockpit.BuildConfig
import com.cminewar.recursoscockpit.i18n.I18nDictionary
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Dispatcher
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.FileOutputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URI
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.SocketFactory
import kotlin.math.roundToInt

data class HealthCheckResult(
    val isOnline: Boolean,
    val isRevoked: Boolean = false,
    val isRecursosServer: Boolean = false,
    val serverVersion: String = ""
)

class ApiService(
    private val context: Context,
    private val securePreferences: SecurePreferences
) {
    val appContext: Context
        get() = context

    private val gson = Gson()

    private val client = OkHttpClient.Builder()
        .connectTimeout(3500, TimeUnit.MILLISECONDS)
        .readTimeout(4500, TimeUnit.MILLISECONDS)
        .build()

    // Cliente ultrarrápido de alta concurrencia para escaneo /24 en LAN
    private val scanDispatcher = Dispatcher().apply {
        maxRequests = 128
        maxRequestsPerHost = 16
    }

    private val scanClient = OkHttpClient.Builder()
        .dispatcher(scanDispatcher)
        .connectTimeout(700, TimeUnit.MILLISECONDS)
        .readTimeout(900, TimeUnit.MILLISECONDS)
        .build()

    // Caché de clientes HTTP ligados a la SocketFactory de Wi-Fi/Ethernet para sortear VPN/5G
    private val boundNormalClients = ConcurrentHashMap<SocketFactory, OkHttpClient>()
    private val boundScanClients = ConcurrentHashMap<SocketFactory, OkHttpClient>()

    @Volatile
    private var cachedTelemetryB64: String = ""

    @Volatile
    private var cachedTelemetryTsMs: Long = 0L

    fun invalidateTelemetryCache() {
        cachedTelemetryB64 = ""
        cachedTelemetryTsMs = 0L
    }

    private val allowedGithubHosts = setOf(
        "github.com",
        "api.github.com",
        "raw.githubusercontent.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com"
    )

    fun isAllowedGithubUrl(url: String): Boolean {
        return try {
            val uri = URI(url.trim())
            uri.scheme.equals("https", ignoreCase = true) &&
                (uri.host?.lowercase(Locale.ROOT) in allowedGithubHosts)
        } catch (_: Exception) {
            false
        }
    }

    private fun getHttpClient(isQuickScan: Boolean, socketFactory: SocketFactory?): OkHttpClient {
        val base = if (isQuickScan) scanClient else client
        if (socketFactory == null) return base
        val cache = if (isQuickScan) boundScanClients else boundNormalClients
        if (cache.size > 8) cache.clear()
        return cache.getOrPut(socketFactory) {
            base.newBuilder().socketFactory(socketFactory).build()
        }
    }

    fun isTelevisionDevice(): Boolean {
        return try {
            val uiModeMgr = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
            val isTvUiMode = uiModeMgr?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
            val pm = context.packageManager
            val hasLeanback = pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
                pm.hasSystemFeature("android.hardware.type.television")
            isTvUiMode || hasLeanback
        } catch (_: Exception) {
            false
        }
    }

    @Suppress("DEPRECATION")
    private fun resolveActiveLanIpInfo(): Triple<String, String, String> {
        // 1. Priorizar red Wi-Fi / Ethernet real vía ConnectivityManager (sin VPN ni celular)
        try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            if (cm != null) {
                val candidates = (listOfNotNull(cm.activeNetwork) + cm.allNetworks.toList()).distinct()
                for (network in candidates) {
                    val caps = cm.getNetworkCapabilities(network) ?: continue
                    val isLan = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                    if (!isLan || caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) || caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                        continue
                    }
                    val lp = cm.getLinkProperties(network) ?: continue
                    val ifName = lp.interfaceName ?: "wlan0"
                    for (la in lp.linkAddresses) {
                        val addr = la.address
                        if (addr is Inet4Address && !addr.isLoopbackAddress) {
                            val ip = addr.hostAddress ?: continue
                            if (isPrivateRfc1918Ipv4(ip)) {
                                var mac = ""
                                try {
                                    val hw = NetworkInterface.getByName(ifName)?.hardwareAddress
                                    if (hw != null && hw.isNotEmpty()) {
                                        mac = hw.joinToString(":") { String.format("%02X", it) }
                                    }
                                } catch (_: Exception) {}
                                return Triple(ip, ifName, mac)
                            }
                        }
                    }
                }
            }
        } catch (_: Exception) {}

        // 2. Fallback por NetworkInterface excluyendo interfaces celulares, VPN y virtuales
        var fallbackCandidate: Triple<String, String, String>? = null
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces != null && interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                if (!iface.isUp || iface.isLoopback) continue
                val name = iface.name ?: ""
                if (isExcludedNonLanInterfaceName(name)) continue
                val addrs = iface.inetAddresses
                while (addrs.hasMoreElements()) {
                    val addr = addrs.nextElement()
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        val ip = addr.hostAddress ?: continue
                        if (!isPrivateRfc1918Ipv4(ip)) continue
                        var mac = ""
                        try {
                            val hw = iface.hardwareAddress
                            if (hw != null && hw.isNotEmpty()) {
                                mac = hw.joinToString(":") { String.format("%02X", it) }
                            }
                        } catch (_: Exception) {}
                        val item = Triple(ip, name.ifBlank { "wlan0" }, mac)
                        if (isPreferredLanInterfaceName(name)) {
                            return item
                        }
                        if (fallbackCandidate == null) {
                            fallbackCandidate = item
                        }
                    }
                }
            }
        } catch (_: Exception) {}
        return fallbackCandidate ?: Triple("", "", "")
    }

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
        val securityPatch = Build.VERSION.SECURITY_PATCH ?: ""
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

        // Red Local Wi-Fi / Ethernet prioritaria
        val (localIp, ifaceName, macAddr) = resolveActiveLanIpInfo()

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

        val isTvDevice = isTelevisionDevice()
        return NativeDeviceTelemetry(
            clientType = "android_native",
            clientLabel = if (isTvDevice) {
                I18nDictionary.t(context, "native_android.client_label_tv", "App Nativa Android TV (.apk)")
            } else {
                I18nDictionary.t(context, "native_android.client_label_mobile", "App Nativa Android (.apk)")
            },
            accessLevel = "FULL_NATIVE_ACCESS",
            fullAccess = true,
            dexCapable = false,
            appVersion = BuildConfig.VERSION_NAME,
            clientVersion = BuildConfig.VERSION_NAME,
            rootAccess = RootManager.hasRootAccess,
            rootMethod = RootManager.rootMethod,
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
            chassisType = if (isTvDevice) {
                I18nDictionary.t(context, "native_android.chassis_tv", "Android TV / Smart TV")
            } else {
                I18nDictionary.t(context, "native_android.chassis_mobile", "Android Mobile / Tablet")
            },
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
        val now = System.currentTimeMillis()
        val existing = cachedTelemetryB64
        if (existing.isNotEmpty() && (now - cachedTelemetryTsMs) < 30_000L) {
            return existing
        }
        return try {
            val jsonBytes = getDeviceTelemetryJson().toByteArray(Charsets.UTF_8)
            val encoded = Base64.encodeToString(jsonBytes, Base64.NO_WRAP)
            cachedTelemetryB64 = encoded
            cachedTelemetryTsMs = now
            encoded
        } catch (e: Exception) {
            ""
        }
    }

    fun isValidWanDomain(raw: String): Boolean {
        val clean = raw.trim()
        if (clean.isEmpty()) return false
        val host = clean.removePrefix("https://").removePrefix("http://")
            .substringBefore("/")
            .substringBefore(":")
            .trim()
            .lowercase(Locale.ROOT)
        if (host.isEmpty() || host == "localhost" || host == "127.0.0.1" || host == "::1" || host.endsWith(".local")) {
            return false
        }
        if (host.matches(Regex("""^\d{1,3}(\.\d{1,3}){3}$""")) || host.contains(":")) {
            return false
        }
        return host.contains(".")
    }

    private fun learnWanDomain(raw: String) {
        val clean = raw.trim()
        if (isValidWanDomain(clean) && clean != securePreferences.wanDomain) {
            securePreferences.wanDomain = clean
        }
    }

    fun isRemoteVersionNewer(remoteVer: String, localVer: String): Boolean {
        fun parseParts(raw: String): List<Int> {
            return raw.trim().removePrefix("v").removePrefix("V")
                .split(".")
                .map { it.takeWhile { ch -> ch.isDigit() }.toIntOrNull() ?: 0 }
        }
        val r = parseParts(remoteVer)
        val l = parseParts(localVer)
        val maxLen = maxOf(r.size, l.size, 3)
        for (i in 0 until maxLen) {
            val rv = r.getOrElse(i) { 0 }
            val lv = l.getOrElse(i) { 0 }
            if (rv != lv) return rv > lv
        }
        return false
    }

    fun buildWebViewAuthHeaders(): Map<String, String> {
        val headers = mutableMapOf(
            "X-Recursos-Client" to "android_native",
            "Cache-Control" to "no-cache",
            "Pragma" to "no-cache"
        )
        val telemetryB64 = getEncodedTelemetryHeader()
        if (telemetryB64.isNotEmpty()) {
            headers["X-Device-Telemetry"] = telemetryB64
        }
        val token = securePreferences.deviceToken.trim()
        if (token.isNotEmpty()) {
            headers["X-Device-Token"] = token
            headers["Authorization"] = "Bearer $token"
        }
        return headers
    }

    private fun applyAuthAndTelemetryHeaders(reqBuilder: Request.Builder, includeTelemetry: Boolean = true) {
        val tvFlag = if (isTelevisionDevice()) "; AndroidTV" else ""
        reqBuilder.header("User-Agent", "RecursosCockpit-Android/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE}; ${Build.MANUFACTURER} ${Build.MODEL}$tvFlag; NativeHTML; FullAccess)")
        reqBuilder.header("X-Recursos-Client", "android_native")
        if (includeTelemetry) {
            val telemetryB64 = getEncodedTelemetryHeader()
            if (telemetryB64.isNotEmpty()) {
                reqBuilder.header("X-Device-Telemetry", telemetryB64)
            }
        }
        val token = securePreferences.deviceToken.trim()
        if (token.isNotEmpty()) {
            reqBuilder.header("X-Device-Token", token)
            reqBuilder.header("Authorization", "Bearer $token")
        }
    }

    suspend fun probeNode(
        baseUrl: String,
        isQuickScan: Boolean = false,
        socketFactory: SocketFactory? = null
    ): HealthCheckResult = withContext(Dispatchers.IO) {
        try {
            val url = "${baseUrl.trimEnd('/')}/api/version"
            val reqBuilder = Request.Builder().url(url)
            applyAuthAndTelemetryHeaders(reqBuilder, includeTelemetry = !isQuickScan)

            val httpClient = getHttpClient(isQuickScan, socketFactory)
            httpClient.newCall(reqBuilder.build()).execute().use { response ->
                if (response.isSuccessful) {
                    val body = response.body?.string() ?: ""
                    var detectedVer = ""
                    try {
                        val jsonObj = org.json.JSONObject(body)
                        learnWanDomain(jsonObj.optString("public_domain", ""))
                        detectedVer = jsonObj.optString("current_version", "")
                            .ifBlank { jsonObj.optString("local_version", "") }
                            .ifBlank { jsonObj.optString("version", "") }
                            .trim()
                    } catch (_: Exception) {}
                    val isRecursos = body.contains("Recursos") || body.contains("version") || body.contains("current_version")
                    HealthCheckResult(isOnline = true, isRevoked = false, isRecursosServer = isRecursos, serverVersion = detectedVer)
                } else if (response.code == 403) {
                    val body = response.body?.string() ?: ""
                    val isLocked = body.contains("locked") || body.contains("denegado") || body.isEmpty()
                    HealthCheckResult(isOnline = true, isRevoked = isLocked, isRecursosServer = true)
                } else {
                    if (!isQuickScan) {
                        Log.w("RecursosCockpit", "Sonda $url devolvió HTTP ${response.code}")
                    }
                    HealthCheckResult(isOnline = false)
                }
            }
        } catch (e: Exception) {
            if (!isQuickScan) {
                Log.w("RecursosCockpit", "Fallo sondeando $baseUrl: ${e.javaClass.simpleName}: ${e.message}")
            }
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
                    val body = response.body?.string() ?: ""
                    try {
                        val jsonObj = org.json.JSONObject(body)
                        val returnedToken = jsonObj.optString("token", "").trim()
                        if (returnedToken.isNotEmpty() && returnedToken != securePreferences.deviceToken) {
                            securePreferences.deviceToken = returnedToken
                        }
                        securePreferences.isCertRevoked = false
                    } catch (_: Exception) {}
                    true
                } else {
                    if (response.code == 403) {
                        securePreferences.isCertRevoked = true
                    }
                    false
                }
            }
        } catch (e: Exception) {
            false
        }
    }

    suspend fun fetchMetrics(baseUrl: String): Pair<MetricsResponse?, Boolean> = withContext(Dispatchers.IO) {
        try {
            val url = "${baseUrl.trimEnd('/')}/api/metrics"
            val reqBuilder = Request.Builder().url(url)
            applyAuthAndTelemetryHeaders(reqBuilder)

            client.newCall(reqBuilder.build()).execute().use { response ->
                if (response.isSuccessful) {
                    val body = response.body?.string() ?: return@withContext Pair(null, false)
                    val metrics = gson.fromJson(body, MetricsResponse::class.java)

                    // Autoguardado persistente del certificado / token recibido
                    val receivedToken = metrics.authStatus?.token?.trim()
                    if (!receivedToken.isNullOrEmpty() && receivedToken != securePreferences.deviceToken) {
                        Log.i("RecursosCockpit", "Nuevo token certificado recibido y persistido en KeyStore")
                        securePreferences.deviceToken = receivedToken
                    }
                    securePreferences.isCertRevoked = false

                    // Autoguardado dinámico del dominio WAN público para uso exterior
                    val learnedDomain = (metrics.versionInfo?.publicDomain ?: metrics.system?.publicDomain ?: "").trim()
                    learnWanDomain(learnedDomain)
                    Pair(metrics, false)
                } else if (response.code == 403) {
                    Log.w("RecursosCockpit", "Acceso denegado (HTTP 403): Certificado de dispositivo revocado en el servidor.")
                    securePreferences.isCertRevoked = true
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

    suspend fun checkGithubAndroidRelease(): GithubAndroidReleaseInfo? = withContext(Dispatchers.IO) {
        val repo = "cminewarIA/recursos-ui"
        val ua = "RecursosCockpit-Android/${BuildConfig.VERSION_NAME}"
        var remoteVer = ""
        var apkUrl = ""
        var assetName = ""
        var sizeBytes = 0L
        var releaseUrl = "https://github.com/$repo/releases"

        // 1. Leer ANDROID_VERSION independiente desde main
        val rawVerUrl = "https://raw.githubusercontent.com/$repo/main/ANDROID_VERSION"
        if (isAllowedGithubUrl(rawVerUrl)) {
            try {
                val req = Request.Builder().url(rawVerUrl).header("User-Agent", ua).build()
                client.newCall(req).execute().use { resp ->
                    if (resp.isSuccessful) {
                        val txt = (resp.body?.string() ?: "").trim().removePrefix("v").removePrefix("V")
                        if (Regex("""^\d+\.\d+\.\d+$""").matches(txt)) {
                            remoteVer = txt
                        }
                    }
                }
            } catch (_: Exception) {}
        }

        // 2. Consultar GitHub Releases buscando el artefacto .apk más reciente
        val relApiUrl = "https://api.github.com/repos/$repo/releases?per_page=8"
        if (isAllowedGithubUrl(relApiUrl)) {
            try {
                val req = Request.Builder()
                    .url(relApiUrl)
                    .header("User-Agent", ua)
                    .header("Accept", "application/vnd.github+json")
                    .build()
                client.newCall(req).execute().use { resp ->
                    if (resp.isSuccessful) {
                        val body = resp.body?.string() ?: "[]"
                        val arr = org.json.JSONArray(body)
                        for (i in 0 until arr.length()) {
                            val rel = arr.optJSONObject(i) ?: continue
                            if (rel.optBoolean("draft", false)) continue
                            val htmlUrl = rel.optString("html_url", "").trim()
                            if (htmlUrl.isNotEmpty() && isAllowedGithubUrl(htmlUrl)) {
                                releaseUrl = htmlUrl
                            }
                            val assets = rel.optJSONArray("assets") ?: continue
                            for (j in 0 until assets.length()) {
                                val a = assets.optJSONObject(j) ?: continue
                                val name = a.optString("name", "").trim()
                                val dlUrl = a.optString("browser_download_url", "").trim()
                                if (!name.lowercase(Locale.ROOT).endsWith(".apk")) continue
                                if (!isAllowedGithubUrl(dlUrl)) continue
                                val mVer = Regex("""(\d+\.\d+\.\d+)""").find(name)?.groupValues?.getOrNull(1)
                                if (apkUrl.isEmpty() || (name.contains("_") && !assetName.contains("_"))) {
                                    apkUrl = dlUrl
                                    assetName = name
                                    sizeBytes = a.optLong("size", 0L)
                                    if (!mVer.isNullOrBlank()) {
                                        remoteVer = mVer
                                    }
                                }
                            }
                            if (apkUrl.isNotEmpty()) break
                        }
                    }
                }
            } catch (e: Exception) {
                Log.w("RecursosCockpit", "No se pudo consultar releases Android en GitHub: ${e.message}")
            }
        }

        if (remoteVer.isBlank()) return@withContext null
        val finalApkUrl = apkUrl.ifBlank {
            "https://github.com/$repo/releases/latest/download/recursos-cockpit.apk"
        }
        val finalAssetName = assetName.ifBlank { "recursos-cockpit_$remoteVer.apk" }
        val updateAvailable = isRemoteVersionNewer(remoteVer, BuildConfig.VERSION_NAME)
        GithubAndroidReleaseInfo(
            latestVersion = remoteVer,
            apkUrl = finalApkUrl,
            assetName = finalAssetName,
            sizeBytes = sizeBytes,
            releaseUrl = releaseUrl,
            updateAvailable = updateAvailable
        )
    }

    suspend fun downloadApkToCache(
        apkUrl: String,
        assetName: String,
        onProgress: (Int) -> Unit = {}
    ): File? = withContext(Dispatchers.IO) {
        if (!isAllowedGithubUrl(apkUrl)) return@withContext null
        val updatesDir = File(context.cacheDir, "updates").apply { mkdirs() }
        val safeName = assetName
            .substringAfterLast('/')
            .replace(Regex("[^A-Za-z0-9._-]"), "_")
            .let { if (it.lowercase(Locale.ROOT).endsWith(".apk")) it else "$it.apk" }
        val outFile = File(updatesDir, safeName)
        val tmpFile = File(updatesDir, "$safeName.part")
        try {
            val dlClient = OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .followRedirects(true)
                .build()
            val req = Request.Builder()
                .url(apkUrl)
                .header("User-Agent", "RecursosCockpit-Android/${BuildConfig.VERSION_NAME}")
                .build()
            dlClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext null
                val finalHost = resp.request.url.host.lowercase(Locale.ROOT)
                if (!resp.request.url.isHttps || finalHost !in allowedGithubHosts) {
                    return@withContext null
                }
                val body = resp.body ?: return@withContext null
                val totalLen = body.contentLength()
                var downloaded = 0L
                val buf = ByteArray(16384)
                val magic = ByteArray(4)
                var magicLen = 0
                FileOutputStream(tmpFile).use { fos ->
                    body.byteStream().use { ins ->
                        while (true) {
                            val read = ins.read(buf)
                            if (read <= 0) break
                            if (magicLen < 4) {
                                val take = minOf(4 - magicLen, read)
                                System.arraycopy(buf, 0, magic, magicLen, take)
                                magicLen += take
                            }
                            fos.write(buf, 0, read)
                            downloaded += read
                            if (totalLen > 0L) {
                                onProgress(((downloaded * 100L) / totalLen).toInt().coerceIn(0, 100))
                            }
                        }
                    }
                }
                // Verificar cabecera mágica ZIP/APK (PK\x03\x04)
                val isZip = magicLen == 4 &&
                    magic[0] == 0x50.toByte() &&
                    magic[1] == 0x4B.toByte() &&
                    magic[2] == 0x03.toByte() &&
                    magic[3] == 0x04.toByte()
                if (!isZip || downloaded < 50_000L) {
                    tmpFile.delete()
                    return@withContext null
                }
                if (outFile.exists()) outFile.delete()
                if (!tmpFile.renameTo(outFile)) {
                    tmpFile.copyTo(outFile, overwrite = true)
                    tmpFile.delete()
                }
                onProgress(100)
                outFile
            }
        } catch (e: Exception) {
            Log.e("RecursosCockpit", "Error descargando APK en caché: ${e.message}")
            tmpFile.delete()
            null
        }
    }
}
