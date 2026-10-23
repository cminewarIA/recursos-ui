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
        apiService = ApiService(securePreferences)
        discoveryManager = DiscoveryManager(apiService, securePreferences)

        setContent {
            RecursosCockpitTheme {
                var metrics by remember { mutableStateOf<MetricsResponse?>(null) }
                var connectionMode by remember { mutableStateOf(ConnectionMode.CONNECTING) }
                var activeUrl by remember { mutableStateOf("") }
                var showSettings by remember { mutableStateOf(false) }

                fun triggerDiscoveryAndRefresh() {
                    lifecycleScope.launch {
                        connectionMode = ConnectionMode.CONNECTING
                        val endpoint = discoveryManager.resolveActiveNode()
                        activeUrl = endpoint.url
                        connectionMode = endpoint.mode
                        if (endpoint.mode != ConnectionMode.ERROR) {
                            metrics = apiService.fetchMetrics(endpoint.url)
                        }
                    }
                }

                // Ciclo continuo de telemetría a 60 FPS / polling cada 2.5s
                LaunchedEffect(Unit) {
                    val endpoint = discoveryManager.resolveActiveNode()
                    activeUrl = endpoint.url
                    connectionMode = endpoint.mode

                    while (isActive) {
                        if (activeUrl.isNotEmpty()) {
                            val data = apiService.fetchMetrics(activeUrl)
                            if (data != null) {
                                metrics = data
                            } else {
                                // Reconexión / Conmutación LAN ↔ WAN transparente
                                val newEndpoint = discoveryManager.resolveActiveNode()
                                activeUrl = newEndpoint.url
                                connectionMode = newEndpoint.mode
                                if (newEndpoint.mode != ConnectionMode.ERROR) {
                                    metrics = apiService.fetchMetrics(newEndpoint.url)
                                }
                            }
                        }
                        delay(2500)
                    }
                }

                CockpitDashboard(
                    metrics = metrics,
                    connectionMode = connectionMode,
                    activeUrl = activeUrl,
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
