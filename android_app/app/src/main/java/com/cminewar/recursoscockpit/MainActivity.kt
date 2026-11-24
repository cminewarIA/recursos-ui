package com.cminewar.recursoscockpit

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.*
import androidx.lifecycle.lifecycleScope
import com.cminewar.recursoscockpit.data.*
import com.cminewar.recursoscockpit.i18n.I18nDictionary
import com.cminewar.recursoscockpit.theme.RecursosCockpitTheme
import com.cminewar.recursoscockpit.ui.CockpitDashboard
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private lateinit var securePreferences: SecurePreferences
    private lateinit var apiService: ApiService
    private lateinit var discoveryManager: DiscoveryManager

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

                fun triggerDiscoveryAndRefresh() {
                    lifecycleScope.launch {
                        connectionMode = ConnectionMode.SCANNING_LAN
                        val endpoint = discoveryManager.resolveActiveNode { msg ->
                            scanningMessage = msg
                        }
                        finalizeConnectedEndpoint(endpoint)
                    }
                }

                // Autodescubrimiento LAN/WAN completamente automático sin intervención del usuario
                LaunchedEffect(Unit) {
                    launch {
                        I18nDictionary.syncRemoteDictionary(applicationContext, null)
                    }
                    connectionMode = ConnectionMode.SCANNING_LAN
                    val endpoint = discoveryManager.resolveActiveNode { msg ->
                        scanningMessage = msg
                    }
                    finalizeConnectedEndpoint(endpoint)

                    while (isActive) {
                        if (connectionMode == ConnectionMode.REVOKED) {
                            delay(5000)
                            continue
                        }

                        if (activeUrl.isNotEmpty()) {
                            val (data, isRevoked) = apiService.fetchMetrics(activeUrl)
                            if (isRevoked) {
                                connectionMode = ConnectionMode.REVOKED
                            } else if (data == null) {
                                // Conmutación automática transparente LAN <-> DNS externo
                                val newEndpoint = discoveryManager.resolveActiveNode { msg ->
                                    scanningMessage = msg
                                }
                                finalizeConnectedEndpoint(newEndpoint)
                            } else {
                                val vInfo = data.versionInfo
                                updateDetectedServerVersion(vInfo?.currentVersion ?: vInfo?.localVersion ?: vInfo?.version)
                            }
                        } else {
                            val newEndpoint = discoveryManager.resolveActiveNode { msg ->
                                scanningMessage = msg
                            }
                            finalizeConnectedEndpoint(newEndpoint)
                        }
                        delay(5000)
                    }
                }

                val availableApkUpdateVersion = remember(serverVersion) {
                    if (serverVersion.isNotBlank() && apiService.isRemoteVersionNewer(serverVersion, BuildConfig.VERSION_NAME)) {
                        serverVersion
                    } else {
                        ""
                    }
                }

                CockpitDashboard(
                    securePreferences = securePreferences,
                    connectionMode = connectionMode,
                    activeUrl = activeUrl,
                    scanningMessage = scanningMessage,
                    isDarkTheme = isDarkTheme,
                    serverVersion = serverVersion,
                    availableApkUpdateVersion = availableApkUpdateVersion,
                    onThemeChanged = { nextTheme ->
                        if (nextTheme == "dark" || nextTheme == "light") {
                            securePreferences.uiTheme = nextTheme
                            uiThemePref = nextTheme
                        }
                    },
                    deviceTelemetryProvider = { apiService.getDeviceTelemetryJson() },
                    webViewHeadersProvider = { apiService.buildWebViewAuthHeaders() },
                    onRefresh = { triggerDiscoveryAndRefresh() }
                )
            }
        }
    }
}
