package com.cminewar.recursoscockpit

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
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
    private var pendingApkUpdateAfterPermission: GithubAndroidReleaseInfo? = null
    private var onResumePendingApkUpdate: ((GithubAndroidReleaseInfo) -> Unit)? = null
    private var onApkInstallStatusFeedback: ((String) -> Unit)? = null

    private val localNetworkPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                Log.i("RecursosCockpit", "Permiso ACCESS_LOCAL_NETWORK concedido; relanzando descubrimiento LAN")
                onLocalNetworkPermissionGranted?.invoke()
            } else {
                Log.w("RecursosCockpit", "Permiso ACCESS_LOCAL_NETWORK denegado en Android 16/17; el tráfico LAN puede quedar bloqueado")
            }
        }

    private val unknownSourcesPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            val pending = pendingApkUpdateAfterPermission
            pendingApkUpdateAfterPermission = null
            if (pending != null && canAutoInstallPackages()) {
                Log.i("RecursosCockpit", "Permiso de instalación concedido; reanudando actualización v${pending.latestVersion}")
                onResumePendingApkUpdate?.invoke(pending)
            } else if (pending != null) {
                onApkInstallStatusFeedback?.invoke(
                    I18nDictionary.t(
                        this,
                        "native_android.apk_perm_needed",
                        "Activa 'Instalar apps desconocidas' para actualizar desde la app."
                    )
                )
            }
        }

    private val apkInstallStatusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != ApkSessionInstaller.ACTION_INSTALL_STATUS) return
            val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
            val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: ""
            when (status) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    val confirmIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(Intent.EXTRA_INTENT)
                    }
                    if (confirmIntent != null) {
                        confirmIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        try {
                            startActivity(confirmIntent)
                        } catch (e: Exception) {
                            Log.e("RecursosCockpit", "No se pudo abrir confirmación del instalador: ${e.message}")
                            onApkInstallStatusFeedback?.invoke(
                                I18nDictionary.t(
                                    this@MainActivity,
                                    "native_android.apk_install_error",
                                    "No se pudo abrir el instalador del sistema."
                                )
                            )
                        }
                    }
                }
                PackageInstaller.STATUS_SUCCESS -> {
                    onApkInstallStatusFeedback?.invoke("")
                }
                PackageInstaller.STATUS_FAILURE_ABORTED -> {
                    onApkInstallStatusFeedback?.invoke("")
                }
                PackageInstaller.STATUS_FAILURE_CONFLICT,
                PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> {
                    Log.w("RecursosCockpit", "Conflicto de firma/versión al instalar APK: $message")
                    onApkInstallStatusFeedback?.invoke(
                        I18nDictionary.t(
                            this@MainActivity,
                            "native_android.apk_signature_conflict",
                            "Conflicto de firma con la versión instalada. Reinstala el APK oficial."
                        )
                    )
                }
                else -> {
                    Log.w("RecursosCockpit", "Error de PackageInstaller (status=$status): $message")
                    onApkInstallStatusFeedback?.invoke(
                        I18nDictionary.t(
                            this@MainActivity,
                            "native_android.apk_install_error",
                            "Error al instalar la actualización."
                        )
                    )
                }
            }
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

    private fun requestUnknownAppSourcesPermission(release: GithubAndroidReleaseInfo): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        return try {
            pendingApkUpdateAfterPermission = release
            val intent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${BuildConfig.APPLICATION_ID}")
            )
            unknownSourcesPermissionLauncher.launch(intent)
            true
        } catch (e: Exception) {
            pendingApkUpdateAfterPermission = null
            Log.w("RecursosCockpit", "No se pudo abrir el ajuste de orígenes desconocidos: ${e.message}")
            false
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

        ContextCompat.registerReceiver(
            this,
            apkInstallStatusReceiver,
            IntentFilter(ApkSessionInstaller.ACTION_INSTALL_STATUS),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )

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
                var masterPasswordPromptUrl by remember { mutableStateOf("") }
                var masterPasswordError by remember { mutableStateOf("") }
                var isUnlockingMasterPassword by remember { mutableStateOf(false) }
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
                        discovererError = ""
                        if (isRevoked || securePreferences.isCertRevoked) {
                            masterPasswordPromptUrl = endpoint.url
                            masterPasswordError = ""
                            showServerDiscoverer = true
                            connectionMode = ConnectionMode.REVOKED
                        } else {
                            masterPasswordPromptUrl = ""
                            masterPasswordError = ""
                            showServerDiscoverer = false
                            connectionMode = endpoint.mode
                            lifecycleScope.launch {
                                I18nDictionary.syncRemoteDictionary(applicationContext, endpoint.url)
                            }
                        }
                    } else if (endpoint.mode == ConnectionMode.REVOKED) {
                        activeUrl = endpoint.url
                        masterPasswordPromptUrl = endpoint.url
                        masterPasswordError = ""
                        showServerDiscoverer = true
                        connectionMode = ConnectionMode.REVOKED
                    } else {
                        activeUrl = endpoint.url
                        connectionMode = endpoint.mode
                    }
                }

                fun pairWithServer(targetUrlOrHost: String) {
                    lifecycleScope.launch {
                        discovererError = ""
                        masterPasswordError = ""
                        masterPasswordPromptUrl = ""
                        connectionMode = ConnectionMode.CONNECTING
                        scanningMessage = I18nDictionary.t(
                            this@MainActivity,
                            "native_android.pairing_server",
                            "Emparejando con $targetUrlOrHost..."
                        )
                        val endpoint = discoveryManager.selectAndPersistNode(targetUrlOrHost)
                        if (endpoint.mode == ConnectionMode.REVOKED) {
                            activeUrl = endpoint.url
                            masterPasswordPromptUrl = endpoint.url
                            masterPasswordError = ""
                            showServerDiscoverer = true
                            connectionMode = ConnectionMode.REVOKED
                        } else if (endpoint.mode == ConnectionMode.CONNECTED_LAN || endpoint.mode == ConnectionMode.CONNECTED_WAN) {
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

                fun submitMasterPassword(targetUrl: String, password: String) {
                    if (isUnlockingMasterPassword || targetUrl.isBlank() || password.isBlank()) return
                    lifecycleScope.launch {
                        isUnlockingMasterPassword = true
                        masterPasswordError = ""
                        val result = apiService.unlockWithMasterPassword(targetUrl, password)
                        isUnlockingMasterPassword = false
                        if (result.success) {
                            discoveryManager.persistEndpointAfterUnlock(targetUrl)
                            val cleanHost = targetUrl
                                .removePrefix("http://")
                                .removePrefix("https://")
                                .substringBefore("/")
                                .substringBefore(":")
                            val resolvedMode = if (targetUrl.startsWith("https://", ignoreCase = true) || !isPrivateRfc1918Ipv4(cleanHost)) {
                                ConnectionMode.CONNECTED_WAN
                            } else {
                                ConnectionMode.CONNECTED_LAN
                            }
                            masterPasswordPromptUrl = ""
                            masterPasswordError = ""
                            finalizeConnectedEndpoint(ResolvedEndpoint(targetUrl, resolvedMode))
                        } else if (result.lockedOut) {
                            masterPasswordError = I18nDictionary.t(
                                this@MainActivity,
                                "native_android.master_pwd_locked",
                                "Demasiados intentos fallidos. Espera unos minutos antes de volver a intentarlo."
                            )
                        } else {
                            masterPasswordError = I18nDictionary.t(
                                this@MainActivity,
                                "native_android.master_pwd_invalid",
                                "Contraseña maestra incorrecta. Inténtalo de nuevo."
                            )
                        }
                    }
                }

                fun startLocalServerDiscoverer(
                    requestPermission: Boolean = false,
                    autoConnectIfDisconnected: Boolean = false
                ) {
                    if (requestPermission) {
                        ensureLocalNetworkPermissionIfNeeded()
                    }
                    lifecycleScope.launch {
                        showServerDiscoverer = true
                        isDiscoveringServers = true
                        discovererError = ""
                        discoveredServers = emptyList()
                        connectionMode = ConnectionMode.SCANNING_LAN
                        var autoConnected = false

                        suspend fun tryAutoConnectNode(candidate: DiscoveredServerNode) {
                            if (!autoConnectIfDisconnected || activeUrl.isNotBlank() || autoConnected || candidate.isRevoked) return
                            autoConnected = true
                            val endpoint = discoveryManager.selectAndPersistNode(candidate.url)
                            if (endpoint.mode == ConnectionMode.CONNECTED_LAN || endpoint.mode == ConnectionMode.CONNECTED_WAN || endpoint.mode == ConnectionMode.REVOKED) {
                                finalizeConnectedEndpoint(endpoint)
                            } else {
                                autoConnected = false
                            }
                        }

                        val found = discoveryManager.discoverLocalServers(
                            onProgress = { msg -> scanningMessage = msg },
                            onNodeFound = { node ->
                                lifecycleScope.launch(Dispatchers.Main) {
                                    if (discoveredServers.none { it.url == node.url }) {
                                        discoveredServers = discoveredServers + node
                                    }
                                    if (autoConnectIfDisconnected && activeUrl.isBlank() && !node.isRevoked && !autoConnected) {
                                        tryAutoConnectNode(node)
                                    }
                                }
                            }
                        )
                        discoveredServers = found
                        isDiscoveringServers = false
                        if (autoConnectIfDisconnected && activeUrl.isBlank() && !autoConnected && found.isNotEmpty()) {
                            val preferred = found.firstOrNull { !it.isRevoked && isPrivateRfc1918Ipv4(it.host) }
                                ?: found.firstOrNull { !it.isRevoked }
                                ?: found.first()
                            tryAutoConnectNode(preferred)
                            if (activeUrl.isNotBlank()) return@launch
                        }
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

                suspend fun autoConnectLocalNode(): Boolean {
                    showServerDiscoverer = false
                    discovererError = ""
                    connectionMode = ConnectionMode.SCANNING_LAN
                    val resolved = discoveryManager.resolveActiveNode { msg -> scanningMessage = msg }
                    return if (
                        resolved.mode == ConnectionMode.CONNECTED_LAN ||
                        resolved.mode == ConnectionMode.CONNECTED_WAN ||
                        resolved.mode == ConnectionMode.REVOKED
                    ) {
                        finalizeConnectedEndpoint(resolved)
                        true
                    } else {
                        false
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
                        } else if (!autoConnectLocalNode()) {
                            startLocalServerDiscoverer(
                                requestPermission = false,
                                autoConnectIfDisconnected = activeUrl.isBlank()
                            )
                        }
                    }
                }

                fun handleApkUpdateClick(release: GithubAndroidReleaseInfo) {
                    if (apkUpdateProgress != null) return
                    lifecycleScope.launch {
                        val hasRoot = RootManager.hasRootAccess
                        if (!hasRoot && !canAutoInstallPackages()) {
                            apkUpdateStatus = I18nDictionary.t(
                                this@MainActivity,
                                "native_android.apk_perm_guide",
                                "Concede el permiso de instalación para actualizar..."
                            )
                            val openedSettings = withContext(Dispatchers.Main) {
                                requestUnknownAppSourcesPermission(release)
                            }
                            if (!openedSettings) {
                                apkUpdateStatus = ""
                                openDirectDownloadInBrowser(release.apkUrl)
                            }
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

                        apkUpdateStatus = I18nDictionary.t(
                            this@MainActivity,
                            "native_android.apk_installing",
                            "Instalando actualización..."
                        )

                        if (hasRoot) {
                            val silentOk = RootManager.installApkSilently(downloadedFile, File(cacheDir, "updates"))
                            if (silentOk) {
                                apkUpdateProgress = null
                                apkUpdateStatus = ""
                                return@launch
                            }
                        }

                        // Instalador oficial in-app de Android (PackageInstaller.Session) sin root
                        val sessionRes = ApkSessionInstaller.installApkInPlace(applicationContext, downloadedFile)
                        if (sessionRes.isSuccess) {
                            apkUpdateProgress = null
                            apkUpdateStatus = I18nDictionary.t(
                                this@MainActivity,
                                "native_android.apk_confirm_system",
                                "Confirma la actualización en el diálogo del sistema..."
                            )
                            return@launch
                        }

                        // Respaldo FileProvider y navegador solo si PackageInstaller no está disponible
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
                    onResumePendingApkUpdate = { rel -> handleApkUpdateClick(rel) }
                    onApkInstallStatusFeedback = { msg ->
                        lifecycleScope.launch(Dispatchers.Main) {
                            apkUpdateProgress = null
                            apkUpdateStatus = msg
                        }
                    }
                    onDispose {
                        onLocalNetworkPermissionGranted = null
                        onResumePendingApkUpdate = null
                        onApkInstallStatusFeedback = null
                    }
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

                    // 4. Inicio inteligente: si ya está emparejado usa su nodo; si no o falla, conecta automáticamente con el nodo local detectado
                    val isPaired = securePreferences.savedHost.isNotBlank() && securePreferences.deviceToken.isNotBlank()
                    if (!isPaired) {
                        if (!autoConnectLocalNode()) {
                            startLocalServerDiscoverer(
                                requestPermission = false,
                                autoConnectIfDisconnected = true
                            )
                        }
                    } else {
                        connectionMode = ConnectionMode.CONNECTING
                        val savedEndpoint = discoveryManager.trySavedNodeOnly()
                        if (savedEndpoint != null) {
                            finalizeConnectedEndpoint(savedEndpoint)
                        } else if (!autoConnectLocalNode()) {
                            startLocalServerDiscoverer(
                                requestPermission = false,
                                autoConnectIfDisconnected = true
                            )
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
                                    if (!autoConnectLocalNode()) {
                                        startLocalServerDiscoverer(
                                            requestPermission = false,
                                            autoConnectIfDisconnected = true
                                        )
                                    }
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
                    masterPasswordPromptUrl = masterPasswordPromptUrl,
                    masterPasswordError = masterPasswordError,
                    isUnlockingMasterPassword = isUnlockingMasterPassword,
                    onSubmitMasterPassword = { url, pwd -> submitMasterPassword(url, pwd) },
                    onDismissMasterPasswordPrompt = {
                        masterPasswordPromptUrl = ""
                        masterPasswordError = ""
                        showServerDiscoverer = true
                    },
                    onRequestMasterPasswordUnlock = {
                        if (activeUrl.isNotBlank()) {
                            masterPasswordPromptUrl = activeUrl
                            masterPasswordError = ""
                            showServerDiscoverer = true
                        }
                    },
                    onSelectDiscoveredServer = { urlOrHost -> pairWithServer(urlOrHost) },
                    onRescanLocalServers = {
                        masterPasswordPromptUrl = ""
                        masterPasswordError = ""
                        startLocalServerDiscoverer(
                            requestPermission = true,
                            autoConnectIfDisconnected = activeUrl.isBlank()
                        )
                    },
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

    override fun onDestroy() {
        try {
            unregisterReceiver(apkInstallStatusReceiver)
        } catch (_: Exception) {
            // Receiver already unregistered or never registered
        }
        super.onDestroy()
    }
}


