package com.cminewar.recursoscockpit.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class ResolvedEndpoint(
    val url: String,
    val mode: ConnectionMode
)

class DiscoveryManager(
    private val apiService: ApiService,
    private val securePreferences: SecurePreferences
) {

    suspend fun resolveActiveNode(): ResolvedEndpoint = withContext(Dispatchers.IO) {
        val candidatesLan = listOf(
            "http://${securePreferences.manualHost}:${securePreferences.manualPort}",
            "http://192.168.50.2:8085"
        ).distinct()

        for (url in candidatesLan) {
            if (apiService.checkHealth(url)) {
                return@withContext ResolvedEndpoint(url, ConnectionMode.CONNECTED_LAN)
            }
        }

        val wanCandidate = "https://${securePreferences.wanDomain.trimEnd('/')}"
        if (apiService.checkHealth(wanCandidate)) {
            return@withContext ResolvedEndpoint(wanCandidate, ConnectionMode.CONNECTED_WAN)
        }

        ResolvedEndpoint(candidatesLan.first(), ConnectionMode.ERROR)
    }
}
