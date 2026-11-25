package com.cminewar.recursoscockpit

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.*
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import com.cminewar.recursoscockpit.data.*
import com.cminewar.recursoscockpit.i18n.I18nDictionary
import com.cminewar.recursoscockpit.theme.RecursosCockpitTheme
import com.cminewar.recursoscockpit.ui.CockpitDashboard
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class MainActivity : ComponentActivity() {

    private lateinit var securePreferences: SecurePreferences
    private lateinit var apiService: ApiService
    private lateinit var discoveryManager: DiscoveryManager

    private var onLocalNetworkPermissionGranted: (() -> Unit)? = null

    private val localNetworkPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                Log.i("RecursosCockpit", "Permiso ACCESS_LOCAL_NETWORK concedido; relanzando descubrimiento LAN")
                onLocalNetworkPermissionGranted?.invoke()
            } else {
                Log.w("RecursosCockpit", "Permiso ACCESS_LOCAL_NETWORK denegado en Android 16/17; el tráfico LAN puede quedar bloqueado")
            }
        }

    private fun ensureLocalNetworkPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < 36) return
        val localNetPerm = "android.permission.ACCESS_LOCAL_NETWORK"
        val permExists = try {
            packageManager.getPermissionInfo(localNetPerm, 0)
            true
        } catch (_: Exception) {
            false
        }
        if (!permExists) return
        if (ContextCompat.checkSelfPermission(this, localNetPerm) != PackageManager.PERMISSION_GRANTED) {
            Log.i("RecursosCockpit", "Solicitando permiso en tiempo de ejecución: $localNetPerm")
            localNetworkPermissionLauncher.launch(localNetPerm)
        }
    }

    private fun openDirectDownloadInBrowser(url: String) {
        if (!apiService.isAllowedGithubUrl(url)) return
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        } catch (e: Exception) {
            Log.w("RecursosCockpit", "No se pudo abrir el navegador para descargar APK: ${e.message}")
        }
    }

    private fun canAutoInstallPackages(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls()
    }

    private fun launchFileProviderApkInstaller(apkFile: File): Boolean {
        return try {
            val contentUri = FileProvider.getUriForFile(
                this,
                "${BuildConfig.APPLICATION_ID}.fileprovider",
                apkFile
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(contentUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
            true
        } catch (e: Exception) {
            Log.w("RecursosCockpit", "Error abriendo instalador APK FileProvider: ${e.message}")
            false
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        securePreferences = SecurePreferences(this)
        apiService = ApiService(applicationContext, securePreferences)
        discoveryManager = DiscoveryManager(apiService, securePreferences)

        setContent {
            val dictRevision = I18nDictionary.catalogRevision
            val systemDark = isSystemInDarkTheme()
            var uiThemePref by remember { mutableStateOf(securePreferences.uiTheme) }
            val isDarkTheme = when (uiThemePref) {
                "dark" -> true
                "light" -> false
                else -> systemDark
            }

            RecursosCockpitTheme(darkTheme = isDarkTheme) {
                var connectionMode by remember { mutableStateOf(ConnectionMode.CONNECTING) }
                var activeUrl by remember { mutableStateOf("") }
                var serverVersion by remember { mutableStateOf(securePreferences.lastServerVersion) }
                var showServerDiscoverer by remember { mutableStateOf(false) }
                var isDiscoveringServers by remember { mutableStateOf(false) }
                var discoveredServers by remember { mutableStateOf<List<DiscoveredServerNode>>(emptyList()) }
                var discovererError by remember { mutableStateOf("") }
                var githubAndroidRelease by remember { mutableStateOf<GithubAndroidReleaseInfo?>(null) }
                var apkUpdateProgress by remember { mutableStateOf<Int?>(null) }
                var apkUpdateStatus by remember { mutableStateOf("") }
                var scanningMessage by remember(dictRevision) {
                    mutableStateOf(
                        I18nDictionary.t(
                            this@MainActivity,
                            "native_android.searching_wifi",
                            "Buscando tu servidor en la red Wi-Fi..."
                        )
                    )
                }

                fun updateDetectedServerVersion(candidate: String?) {
                    val clean = candidate?.trim()?.removePrefix("v")?.removePrefix("V") ?: ""
                    if (clean.isNotEmpty() && clean != serverVersion) {
                        serverVersion = clean
                    }
                }

                suspend fun finalizeConnectedEndpoint(endpoint: ResolvedEndpoint) {
                    if (endpoint.mode == ConnectionMode.CONNECTED_LAN || endpoint.mode == ConnectionMode.CONNECTED_WAN) {
                        apiService.registerDeviceWithServer(endpoint.url)
                        val (metricsData, isRevoked) = apiService.fetchMetrics(endpoint.url)
                        val vInfo = metricsData?.versionInfo
                        updateDetectedServerVersion(vInfo?.currentVersion ?: vInfo?.localVersion ?: vInfo?.version)
                        activeUrl = endpoint.url
                        showServerDiscoverer = false
                        discovererError = ""
                        connectionMode = if (isRevoked || securePreferences.isCertRevoked) {
                            ConnectionMode.REVOKED
                        } else {
                            endpoint.mode
                        }
                        lifecycleScope.launch {
                            I18nDictionary.syncRemoteDictionary(applicationContext, endpoint.url)
                        }
                    } else {
                        activeUrl = endpoint.url
                        connectionMode = endpoint.mode
                    }
                }

                fun startLocalServerDiscoverer(requestPermission: Boolean = false) {
                    if (requestPermission) {
                        ensureLocalNetworkPermissionIfNeeded()
                    }
                    lifecycleScope.launch {
                        showServerDiscoverer = true
                        isDiscoveringServers = true
                        discovererError = ""
                        discoveredServers = emptyList()
                        connectionMode = ConnectionMode.SCANNING_LAN
                        val found = discoveryManager.discoverLocalServers(
                            onProgress = { msg -> scanningMessage = msg },
                            onNodeFound = { node ->
                                lifecycleScope.launch(Dispatchers.Main) {
                                    if (discoveredServers.none { it.url == node.url }) {
                                        discoveredServers = discoveredServers + node
                                    }
                                }
                            }
                        )
                        discoveredServers = found
                        isDiscoveringServers = false
                        if (found.isEmpty()) {
                            connectionMode = ConnectionMode.DISCONNECTED
                            scanningMessage = I18nDictionary.t(
                                this@MainActivity,
                                "native_android.discoverer_empty",
                                "No se encontraron servidores locales en tu red Wi-Fi. Comprueba que Recursos esté encendido o introduce la IP manualmente."
                            )
                        }
                    }
                }

                fun pairWithServer(targetUrlOrHost: String) {
                    lifecycleScope.launch {
                        discovererError = ""
                        connectionMode = ConnectionMode.CONNECTING
                        scanningMessage = I18nDictionary.t(
                            this@MainActivity,
                            "native_android.pairing_server",
                            "Emparejando con $targetUrlOrHost..."
                        )
                        val endpoint = discoveryManager.selectAndPersistNode(targetUrlOrHost)
                        if (endpoint.mode == ConnectionMode.CONNECTED_LAN || endpoint.mode == ConnectionMode.CONNECTED_WAN || endpoint.mode == ConnectionMode.REVOKED) {
                            finalizeConnectedEndpoint(endpoint)
                        } else {
                            connectionMode = ConnectionMode.ERROR
                            discovererError = I18nDictionary.t(
                                this@MainActivity,
                                "native_android.pair_failed",
                                "No se pudo conectar con $targetUrlOrHost"
                            )
                            showServerDiscoverer = true
                        }
                    }
                }

                fun triggerDiscoveryAndRefresh(requestPermission: Boolean = false) {
                    if (requestPermission) {
                        ensureLocalNetworkPermissionIfNeeded()
                    }
                    lifecycleScope.launch {
                        connectionMode = ConnectionMode.SCANNING_LAN
                        val saved = discoveryManager.trySavedNodeOnly()
                        if (saved != null) {
                            finalizeConnectedEndpoint(saved)
                        } else {
                            startLocalServerDiscoverer(requestPermission = false)
                        }
                    }
                }

                fun handleApkUpdateClick(release: GithubAndroidReleaseInfo) {
                    if (apkUpdateProgress != null) return
                    lifecycleScope.launch {
                        val hasRoot = RootManager.hasRootAccess
                        val canInstall = hasRoot || canAutoInstallPackages()
                        if (!canInstall) {
                            openDirectDownloadInBrowser(release.apkUrl)
                            return@launch
                        }
                        apkUpdateProgress = 1
                        apkUpdateStatus = I18nDictionary.t(
                            this@MainActivity,
                            "native_android.apk_downloading",
                            "Descargando v${release.latestVersion}..."
                        )
                        val downloadedFile = apiService.downloadApkToCache(
                            apkUrl = release.apkUrl,
                            assetName = release.assetName,
                            onProgress = { pct ->
                                lifecycleScope.launch(Dispatchers.Main) {
                                    apkUpdateProgress = pct
                                }
                            }
                        )
                        if (downloadedFile == null) {
                            apkUpdateProgress = null
                            apkUpdateStatus = ""
                            openDirectDownloadInBrowser(release.apkUrl)
                            return@launch
                        }

                        if (hasRoot) {
                            apkUpdateStatus = I18nDictionary.t(
                                this@MainActivity,
                                "native_android.apk_installing",
                                "Instalando actualización..."
                            )
                            val silentOk = RootManager.installApkSilently(downloadedFile, File(cacheDir, "updates"))
                            if (silentOk) {
                                apkUpdateProgress = null
                                apkUpdateStatus = ""
                                return@launch
                            }
                        }

                        val launched = withContext(Dispatchers.Main) {
                            launchFileProviderApkInstaller(downloadedFile)
                        }
                        apkUpdateProgress = null
                        apkUpdateStatus = ""
                        if (!launched) {
                            openDirectDownloadInBrowser(release.apkUrl)
                        }
                    }
                }

                DisposableEffect(Unit) {
                    onLocalNetworkPermissionGranted = { triggerDiscoveryAndRefresh(requestPermission = false) }
                    onDispose { onLocalNetworkPermissionGranted = null }
                }

                LaunchedEffect(Unit) {
                    ensureLocalNetworkPermissionIfNeeded()

                    // 1. Detección de root silenciosa en segundo plano (sin mostrar opciones al usuario)
                    launch {
                        RootManager.detectSilently()
                        apiService.invalidateTelemetryCache()
                    }

                    // 2. Comprobación en segundo plano de la versión local Android frente a GitHub
                    launch {
                        githubAndroidRelease = apiService.checkGithubAndroidRelease()
                    }

                    // 3. Diccionario OTA en segundo plano
                    launch {
                        I18nDictionary.syncRemoteDictionary(applicationContext, null)
                    }

                    // 4. Inicio inteligente: si no está emparejado o falla el nodo guardado, abrir buscador de servidores
                    val isPaired = securePreferences.savedHost.isNotBlank() && securePreferences.deviceToken.isNotBlank()
                    if (!isPaired) {
                        startLocalServerDiscoverer(requestPermission = false)
                    } else {
                        connectionMode = ConnectionMode.CONNECTING
                        val savedEndpoint = discoveryManager.trySavedNodeOnly()
                        if (savedEndpoint != null) {
                            finalizeConnectedEndpoint(savedEndpoint)
                        } else {
                            startLocalServerDiscoverer(requestPermission = false)
                        }
                    }

                    while (isActive) {
                        delay(5000)
                        if (showServerDiscoverer || connectionMode == ConnectionMode.REVOKED) {
                            continue
                        }
                        if (activeUrl.isNotEmpty()) {
                            val (data, isRevoked) = apiService.fetchMetrics(activeUrl)
                            if (isRevoked) {
                                connectionMode = ConnectionMode.REVOKED
                            } else if (data == null) {
                                val recovered = discoveryManager.trySavedNodeOnly()
                                if (recovered != null) {
                                    finalizeConnectedEndpoint(recovered)
                                } else {
                                    activeUrl = ""
                                    startLocalServerDiscoverer(requestPermission = false)
                                }
                            } else {
                                val vInfo = data.versionInfo
                                updateDetectedServerVersion(vInfo?.currentVersion ?: vInfo?.localVersion ?: vInfo?.version)
                            }
                        }
                    }
                }

                CockpitDashboard(
                    securePreferences = securePreferences,
                    connectionMode = connectionMode,
                    activeUrl = activeUrl,
                    scanningMessage = scanningMessage,
                    isDarkTheme = isDarkTheme,
                    serverVersion = serverVersion,
                    githubAndroidRelease = githubAndroidRelease,
                    apkUpdateProgress = apkUpdateProgress,
                    apkUpdateStatus = apkUpdateStatus,
                    showServerDiscoverer = showServerDiscoverer,
                    isDiscoveringServers = isDiscoveringServers,
                    discoveredServers = discoveredServers,
                    discovererError = discovererError,
                    onSelectDiscoveredServer = { urlOrHost -> pairWithServer(urlOrHost) },
                    onRescanLocalServers = { startLocalServerDiscoverer(requestPermission = true) },
                    onTriggerApkUpdate = { rel -> handleApkUpdateClick(rel) },
                    onThemeChanged = { nextTheme ->
                        if (nextTheme == "dark" || nextTheme == "light") {
                            securePreferences.uiTheme = nextTheme
                            uiThemePref = nextTheme
                        }
                    },
                    deviceTelemetryProvider = { apiService.getDeviceTelemetryJson() },
                    webViewHeadersProvider = { apiService.buildWebViewAuthHeaders() },
                    onRefresh = { triggerDiscoveryAndRefresh(requestPermission = true) }
                )
            }
        }
    }
}

