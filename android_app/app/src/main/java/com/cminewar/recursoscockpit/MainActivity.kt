package com.cminewar.recursoscockpit

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.lifecycle.lifecycleScope
import com.cminewar.recursoscockpit.data.*
import com.cminewar.recursoscockpit.theme.RecursosCockpitTheme
import com.cminewar.recursoscockpit.ui.CockpitDashboard
import com.cminewar.recursoscockpit.ui.SettingsDialog
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
            RecursosCockpitTheme {
                var connectionMode by remember { mutableStateOf(ConnectionMode.CONNECTING) }
                var activeUrl by remember { mutableStateOf("") }
                var scanningMessage by remember { mutableStateOf("Autodescubriendo nodo en red local (LAN)...") }
                var showSettings by remember { mutableStateOf(false) }

                fun triggerDiscoveryAndRefresh() {
                    lifecycleScope.launch {
                        connectionMode = ConnectionMode.SCANNING_LAN
                        val endpoint = discoveryManager.resolveActiveNode { msg ->
                            scanningMessage = msg
                        }
                        activeUrl = endpoint.url
                        connectionMode = endpoint.mode
                        if (endpoint.mode == ConnectionMode.CONNECTED_LAN || endpoint.mode == ConnectionMode.CONNECTED_WAN) {
                            val (_, isRevoked) = apiService.fetchMetrics(endpoint.url)
                            if (isRevoked) {
                                connectionMode = ConnectionMode.REVOKED
                            } else {
                                apiService.registerDeviceWithServer(endpoint.url)
                            }
                        }
                    }
                }

                // Autodescubrimiento LAN/WAN en arranque y supervisión de enlace continuo
                LaunchedEffect(Unit) {
                    connectionMode = ConnectionMode.SCANNING_LAN
                    val endpoint = discoveryManager.resolveActiveNode { msg ->
                        scanningMessage = msg
                    }
                    activeUrl = endpoint.url
                    connectionMode = endpoint.mode
                    if (endpoint.mode == ConnectionMode.CONNECTED_LAN || endpoint.mode == ConnectionMode.CONNECTED_WAN) {
                        apiService.registerDeviceWithServer(endpoint.url)
                    }

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
                                // Conmutación automática transparente LAN <-> WAN si el nodo cambia de red
                                val newEndpoint = discoveryManager.resolveActiveNode { msg ->
                                    scanningMessage = msg
                                }
                                activeUrl = newEndpoint.url
                                connectionMode = newEndpoint.mode
                                if (newEndpoint.mode == ConnectionMode.CONNECTED_LAN || newEndpoint.mode == ConnectionMode.CONNECTED_WAN) {
                                    apiService.registerDeviceWithServer(newEndpoint.url)
                                }
                            }
                        }
                        delay(5000)
                    }
                }

                CockpitDashboard(
                    securePreferences = securePreferences,
                    connectionMode = connectionMode,
                    activeUrl = activeUrl,
                    scanningMessage = scanningMessage,
                    deviceTelemetryProvider = { apiService.getDeviceTelemetryJson() },
                    onRefresh = { triggerDiscoveryAndRefresh() },
                    onOpenSettings = { showSettings = true }
                )

                if (showSettings) {
                    SettingsDialog(
                        securePreferences = securePreferences,
                        onDismiss = { showSettings = false },
                        onSaveAndReconnect = {
                            showSettings = false
                            triggerDiscoveryAndRefresh()
                        }
                    )
                }
            }
        }
    }
}
