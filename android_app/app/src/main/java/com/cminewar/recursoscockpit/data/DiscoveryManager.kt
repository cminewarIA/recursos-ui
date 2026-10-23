package com.cminewar.recursoscockpit.data

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.withContext
import java.net.Inet4Address
import java.net.NetworkInterface

data class ResolvedEndpoint(
    val url: String,
    val mode: ConnectionMode
)

class DiscoveryManager(
    private val apiService: ApiService,
    private val securePreferences: SecurePreferences
) {

    suspend fun resolveActiveNode(onScanningProgress: ((String) -> Unit)? = null): ResolvedEndpoint = withContext(Dispatchers.IO) {
        // 1. Probar el último host guardado para conexión instantánea si está disponible
        val savedHost = securePreferences.savedHost
        if (savedHost.isNotEmpty()) {
            val candidateUrl = "http://$savedHost:${securePreferences.manualPort}"
            val res = apiService.probeNode(candidateUrl, isQuickScan = false)
            if (res.isRevoked) {
                securePreferences.isCertRevoked = true
                return@withContext ResolvedEndpoint(candidateUrl, ConnectionMode.REVOKED)
            }
            if (res.isOnline && res.isRecursosServer) {
                return@withContext ResolvedEndpoint(candidateUrl, ConnectionMode.CONNECTED_LAN)
            }
        }

        // 2. Obtener la subred local activa del dispositivo dinámicamente (Zero-Hardcoding)
        val localSubnetBase = getLocalSubnetBase()
        Log.i("RecursosCockpit", "Subred local detectada para autodescubrimiento: ${localSubnetBase ?: "ninguna"}")

        if (localSubnetBase != null) {
            onScanningProgress?.invoke("Escaneando red local ($localSubnetBase.0/24)...")

            // Prioridad a direcciones comunes (Gateway .1, .2, .254)
            val priorityCandidates = listOf(
                "http://$localSubnetBase.2:${securePreferences.manualPort}",
                "http://$localSubnetBase.1:${securePreferences.manualPort}",
                "http://recursos.local:${securePreferences.manualPort}",
                "http://$localSubnetBase.254:${securePreferences.manualPort}"
            ).distinct()

            for (url in priorityCandidates) {
                val res = apiService.probeNode(url, isQuickScan = true)
                if (res.isRevoked) {
                    securePreferences.isCertRevoked = true
                    return@withContext ResolvedEndpoint(url, ConnectionMode.REVOKED)
                }
                if (res.isOnline && res.isRecursosServer) {
                    securePreferences.savedHost = extractHostFromUrl(url)
                    return@withContext ResolvedEndpoint(url, ConnectionMode.CONNECTED_LAN)
                }
            }

            // Escaneo paralelo en bloques del rango /24 completo
            val port = securePreferences.manualPort
            val allIps = (1..254).map { "$localSubnetBase.$it" }
            val chunkSize = 25

            for (chunk in allIps.chunked(chunkSize)) {
                val found = chunk.map { ip ->
                    async {
                        val url = "http://$ip:$port"
                        val r = apiService.probeNode(url, isQuickScan = true)
                        if (r.isOnline && r.isRecursosServer) url to r else null
                    }
                }.awaitAll().filterNotNull().firstOrNull()

                if (found != null) {
                    val (foundUrl, result) = found
                    if (result.isRevoked) {
                        securePreferences.isCertRevoked = true
                        return@withContext ResolvedEndpoint(foundUrl, ConnectionMode.REVOKED)
                    }
                    securePreferences.savedHost = extractHostFromUrl(foundUrl)
                    return@withContext ResolvedEndpoint(foundUrl, ConnectionMode.CONNECTED_LAN)
                }
            }
        }

        // 3. Conmutación a WAN exterior (Caddy proxy / DDNS) con token firmado
        val wanCandidate = "https://${securePreferences.wanDomain.trimEnd('/')}"
        onScanningProgress?.invoke("Conectando con nodo remoto seguro WAN...")
        val wanRes = apiService.probeNode(wanCandidate, isQuickScan = false)
        if (wanRes.isRevoked) {
            securePreferences.isCertRevoked = true
            return@withContext ResolvedEndpoint(wanCandidate, ConnectionMode.REVOKED)
        }
        if (wanRes.isOnline) {
            return@withContext ResolvedEndpoint(wanCandidate, ConnectionMode.CONNECTED_WAN)
        }

        // 4. Fallback de error
        val fallback = if (savedHost.isNotEmpty()) "http://$savedHost:${securePreferences.manualPort}" else wanCandidate
        ResolvedEndpoint(fallback, ConnectionMode.ERROR)
    }

    private fun getLocalSubnetBase(): String? {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                if (!iface.isUp || iface.isLoopback) continue

                val addrs = iface.inetAddresses
                while (addrs.hasMoreElements()) {
                    val addr = addrs.nextElement()
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        val hostAddr = addr.hostAddress ?: continue
                        if (hostAddr.startsWith("192.168.") || hostAddr.startsWith("10.") || hostAddr.startsWith("172.")) {
                            val parts = hostAddr.split(".")
                            if (parts.size == 4) {
                                return "${parts[0]}.${parts[1]}.${parts[2]}"
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("RecursosCockpit", "Error detectando interfaces locales: ${e.message}")
        }
        return null
    }

    private fun extractHostFromUrl(url: String): String {
        return url.removePrefix("http://").removePrefix("https://").substringBefore(":")
    }
}
