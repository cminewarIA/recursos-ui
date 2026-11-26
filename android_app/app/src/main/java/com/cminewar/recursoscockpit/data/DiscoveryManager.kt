package com.cminewar.recursoscockpit.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import com.cminewar.recursoscockpit.i18n.I18nDictionary
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Collections
import java.util.Locale
import javax.net.SocketFactory

data class ResolvedEndpoint(
    val url: String,
    val mode: ConnectionMode
)

private data class LanSubnetContext(
    val subnetBase: String,
    val ownIp: String,
    val gatewayIp: String?,
    val interfaceName: String,
    val socketFactory: SocketFactory?
)

internal fun isPrivateRfc1918Ipv4(hostAddr: String): Boolean {
    val parts = hostAddr.split(".")
    if (parts.size != 4) return false
    val o0 = parts[0].toIntOrNull() ?: return false
    val o1 = parts[1].toIntOrNull() ?: return false
    val o2 = parts[2].toIntOrNull() ?: return false
    val o3 = parts[3].toIntOrNull() ?: return false
    if (o0 !in 0..255 || o1 !in 0..255 || o2 !in 0..255 || o3 !in 0..255) return false
    if (o0 == 10) return true
    if (o0 == 192 && o1 == 168) return true
    if (o0 == 172 && o1 in 16..31) return true
    return false
}

internal fun isExcludedNonLanInterfaceName(rawName: String): Boolean {
    val name = rawName.lowercase(Locale.ROOT)
    if (name.isEmpty()) return false
    val blockedPrefixes = listOf(
        "lo", "rmnet", "ccmni", "pdp", "tun", "tap", "ppp", "dummy",
        "v4-", "ipsec", "docker", "br-", "virbr", "tailscale", "wg", "sit", "gre", "clat"
    )
    return blockedPrefixes.any { name.startsWith(it) }
}

internal fun isPreferredLanInterfaceName(rawName: String): Boolean {
    val name = rawName.lowercase(Locale.ROOT)
    return name.startsWith("wlan") || name.startsWith("eth") || name.startsWith("en")
}

class DiscoveryManager(
    private val apiService: ApiService,
    private val securePreferences: SecurePreferences
) {

    suspend fun trySavedNodeOnly(): ResolvedEndpoint? = withContext(Dispatchers.IO) {
        val defaultPort = securePreferences.manualPort
        val savedHost = securePreferences.savedHost.trim()
        val lanContexts = discoverLocalLanContexts()
        val primarySocketFactory = lanContexts.firstOrNull { it.socketFactory != null }?.socketFactory

        if (savedHost.isNotEmpty()) {
            val candidateUrl = if (savedHost.startsWith("http://") || savedHost.startsWith("https://")) {
                savedHost.trimEnd('/')
            } else {
                "http://$savedHost:$defaultPort"
            }
            var res = apiService.probeNode(candidateUrl, isQuickScan = false)
            if (!res.isOnline && primarySocketFactory != null) {
                res = apiService.probeNode(candidateUrl, isQuickScan = false, socketFactory = primarySocketFactory)
            }
            if (res.isRevoked) {
                securePreferences.isCertRevoked = true
                return@withContext ResolvedEndpoint(candidateUrl, ConnectionMode.REVOKED)
            }
            if (res.isOnline && res.isRecursosServer) {
                securePreferences.isCertRevoked = false
                return@withContext ResolvedEndpoint(candidateUrl, ConnectionMode.CONNECTED_LAN)
            }
        }

        val wanDomain = securePreferences.wanDomain.trim().trimEnd('/')
        if (apiService.isValidWanDomain(wanDomain)) {
            val wanCandidate = if (wanDomain.startsWith("http://") || wanDomain.startsWith("https://")) wanDomain else "https://$wanDomain"
            val wanRes = apiService.probeNode(wanCandidate, isQuickScan = false)
            if (wanRes.isRevoked) {
                securePreferences.isCertRevoked = true
                return@withContext ResolvedEndpoint(wanCandidate, ConnectionMode.REVOKED)
            }
            if (wanRes.isOnline && wanRes.isRecursosServer) {
                securePreferences.isCertRevoked = false
                return@withContext ResolvedEndpoint(wanCandidate, ConnectionMode.CONNECTED_WAN)
            }
        }
        null
    }

    suspend fun selectAndPersistNode(rawHostOrUrl: String): ResolvedEndpoint = withContext(Dispatchers.IO) {
        val trimmed = rawHostOrUrl.trim().trimEnd('/')
        if (trimmed.isEmpty()) return@withContext ResolvedEndpoint("", ConnectionMode.ERROR)
        val defaultPort = securePreferences.manualPort
        val looksLikeIp = trimmed.all { it.isDigit() || it == '.' } && trimmed.count { it == '.' } == 3
        val candidateUrls = when {
            trimmed.startsWith("http://") || trimmed.startsWith("https://") -> listOf(trimmed)
            trimmed.contains(":") -> listOf("http://$trimmed", "https://$trimmed")
            looksLikeIp || isPrivateRfc1918Ipv4(trimmed) -> listOf("http://$trimmed:$defaultPort")
            else -> listOf("https://$trimmed", "http://$trimmed:$defaultPort", "http://$trimmed")
        }
        val lanContexts = discoverLocalLanContexts()
        val primarySocketFactory = lanContexts.firstOrNull { it.socketFactory != null }?.socketFactory

        for (candidateUrl in candidateUrls) {
            var res = apiService.probeNode(candidateUrl, isQuickScan = false)
            if (!res.isOnline && primarySocketFactory != null && !candidateUrl.startsWith("https://")) {
                res = apiService.probeNode(candidateUrl, isQuickScan = false, socketFactory = primarySocketFactory)
            }
            if (res.isRevoked) {
                securePreferences.isCertRevoked = true
                persistDiscoveredHostAndPort(candidateUrl, clearRevoked = false)
                return@withContext ResolvedEndpoint(candidateUrl, ConnectionMode.REVOKED)
            }
            if (res.isOnline && res.isRecursosServer) {
                persistDiscoveredHostAndPort(candidateUrl, clearRevoked = true)
                val cleanHost = candidateUrl.removePrefix("http://").removePrefix("https://").substringBefore("/").substringBefore(":")
                val mode = if (candidateUrl.startsWith("https://") || !isPrivateRfc1918Ipv4(cleanHost)) {
                    ConnectionMode.CONNECTED_WAN
                } else {
                    ConnectionMode.CONNECTED_LAN
                }
                return@withContext ResolvedEndpoint(candidateUrl, mode)
            }
        }
        ResolvedEndpoint(candidateUrls.first(), ConnectionMode.ERROR)
    }

    fun persistEndpointAfterUnlock(url: String) {
        persistDiscoveredHostAndPort(url, clearRevoked = true)
    }

    suspend fun discoverLocalServers(
        onProgress: ((String) -> Unit)? = null,
        onNodeFound: ((DiscoveredServerNode) -> Unit)? = null
    ): List<DiscoveredServerNode> = withContext(Dispatchers.IO) {
        val defaultPort = securePreferences.manualPort
        val lanContexts = discoverLocalLanContexts()
        val primarySocketFactory = lanContexts.firstOrNull { it.socketFactory != null }?.socketFactory
        val foundMap = linkedMapOf<String, DiscoveredServerNode>()

        fun registerFound(url: String, res: HealthCheckResult) {
            val clean = url.removePrefix("http://").removePrefix("https://").substringBefore("/")
            val host = clean.substringBefore(":")
            val port = clean.substringAfter(":", "").toIntOrNull() ?: defaultPort
            val node = DiscoveredServerNode(
                url = url,
                host = host,
                port = port,
                serverVersion = res.serverVersion,
                isRevoked = res.isRevoked
            )
            val isNew = synchronized(foundMap) {
                if (foundMap.containsKey(url)) false else {
                    foundMap[url] = node
                    true
                }
            }
            if (isNew) {
                onNodeFound?.invoke(node)
            }
        }

        onProgress?.invoke(
            I18nDictionary.t(apiService.appContext, "native_android.searching_wifi", "Buscando instalaciones locales en la red Wi-Fi...")
        )

        val nsdCandidates = discoverViaNsd(timeoutMs = 1600L)
        val priorityUrls = linkedSetOf<Pair<String, SocketFactory?>>()
        val savedHost = securePreferences.savedHost.trim()
        if (savedHost.isNotEmpty()) {
            priorityUrls.add("http://$savedHost:$defaultPort" to primarySocketFactory)
        }
        for (u in nsdCandidates) {
            priorityUrls.add(u to primarySocketFactory)
            if (primarySocketFactory != null) priorityUrls.add(u to null)
        }
        for (ctx in lanContexts) {
            val hosts = listOfNotNull(
                "${ctx.subnetBase}.2",
                ctx.gatewayIp,
                "${ctx.subnetBase}.1",
                "${ctx.subnetBase}.10",
                "${ctx.subnetBase}.100",
                "${ctx.subnetBase}.254"
            ).filter { it != ctx.ownIp }.distinct()
            for (h in hosts) {
                val u = "http://$h:$defaultPort"
                if (ctx.socketFactory != null) priorityUrls.add(u to ctx.socketFactory)
                priorityUrls.add(u to null)
            }
        }
        priorityUrls.add("http://recursos.local:$defaultPort" to primarySocketFactory)
        priorityUrls.add("http://servidor.local:$defaultPort" to primarySocketFactory)

        coroutineScope {
            priorityUrls.map { (url, sf) ->
                async {
                    val r = apiService.probeNode(url, isQuickScan = true, socketFactory = sf)
                    if (r.isOnline && r.isRecursosServer) {
                        registerFound(url, r)
                    }
                }
            }.awaitAll()
        }

        for (ctx in lanContexts) {
            val alreadyTestedHosts = setOfNotNull(
                ctx.ownIp,
                ctx.gatewayIp,
                "${ctx.subnetBase}.1",
                "${ctx.subnetBase}.2",
                "${ctx.subnetBase}.10",
                "${ctx.subnetBase}.100",
                "${ctx.subnetBase}.254"
            )
            val allIps = (1..254)
                .map { "${ctx.subnetBase}.$it" }
                .filter { it !in alreadyTestedHosts }
            val activeSocketFactories = listOfNotNull(ctx.socketFactory, null).distinct()
            for (chunk in allIps.chunked(32)) {
                coroutineScope {
                    chunk.flatMap { ip ->
                        val url = "http://$ip:$defaultPort"
                        activeSocketFactories.map { sf ->
                            async {
                                val r = apiService.probeNode(url, isQuickScan = true, socketFactory = sf)
                                if (r.isOnline && r.isRecursosServer) {
                                    registerFound(url, r)
                                }
                            }
                        }
                    }.awaitAll()
                }
            }
        }

        synchronized(foundMap) { foundMap.values.toList() }
    }

    suspend fun resolveActiveNode(onScanningProgress: ((String) -> Unit)? = null): ResolvedEndpoint = withContext(Dispatchers.IO) {
        val startMs = System.currentTimeMillis()
        val defaultPort = securePreferences.manualPort
        val lanContexts = discoverLocalLanContexts()
        val hasVpn = isVpnActive()
        val primarySocketFactory = lanContexts.firstOrNull { it.socketFactory != null }?.socketFactory

        Log.i(
            "RecursosCockpit",
            "Autodescubrimiento iniciado: subredes=[${lanContexts.joinToString { "${it.subnetBase}.0/24(${it.interfaceName},gw=${it.gatewayIp ?: "-"})" }}], vpn=$hasVpn, port=$defaultPort"
        )

        // 1. Probar el último host guardado para conexión instantánea si está disponible
        val savedHost = securePreferences.savedHost.trim()
        if (savedHost.isNotEmpty()) {
            val candidateUrl = "http://$savedHost:$defaultPort"
            var res = apiService.probeNode(candidateUrl, isQuickScan = false)
            if (!res.isOnline && primarySocketFactory != null) {
                res = apiService.probeNode(candidateUrl, isQuickScan = false, socketFactory = primarySocketFactory)
            }
            if (res.isRevoked) {
                securePreferences.isCertRevoked = true
                return@withContext ResolvedEndpoint(candidateUrl, ConnectionMode.REVOKED)
            }
            if (res.isOnline && res.isRecursosServer) {
                securePreferences.isCertRevoked = false
                return@withContext ResolvedEndpoint(candidateUrl, ConnectionMode.CONNECTED_LAN)
            }
        }

        // 2. Descubrimiento paralelo: mDNS/NSD (_recursos._tcp) + candidatos prioritarios en cada subred Wi-Fi/Ethernet
        onScanningProgress?.invoke(
            I18nDictionary.t(apiService.appContext, "native_android.searching_wifi", "Buscando tu servidor en la red Wi-Fi...")
        )

        val nsdCandidates = discoverViaNsd(timeoutMs = 1800L)
        if (nsdCandidates.isNotEmpty()) {
            Log.i("RecursosCockpit", "mDNS/NSD detectó candidatos _recursos._tcp: $nsdCandidates")
        }

        val priorityResults = coroutineScope {
            val priorityUrls = linkedSetOf<Pair<String, SocketFactory?>>()
            for (u in nsdCandidates) {
                priorityUrls.add(u to primarySocketFactory)
                if (primarySocketFactory != null) priorityUrls.add(u to null)
            }
            for (ctx in lanContexts) {
                val hosts = listOfNotNull(
                    "${ctx.subnetBase}.2",
                    ctx.gatewayIp,
                    "${ctx.subnetBase}.1",
                    "${ctx.subnetBase}.10",
                    "${ctx.subnetBase}.100",
                    "${ctx.subnetBase}.254"
                ).filter { it != ctx.ownIp }.distinct()
                for (h in hosts) {
                    val u = "http://$h:$defaultPort"
                    if (ctx.socketFactory != null) priorityUrls.add(u to ctx.socketFactory)
                    priorityUrls.add(u to null)
                }
            }
            priorityUrls.add("http://recursos.local:$defaultPort" to primarySocketFactory)
            priorityUrls.add("http://servidor.local:$defaultPort" to primarySocketFactory)

            priorityUrls.map { (url, sf) ->
                async {
                    val r = apiService.probeNode(url, isQuickScan = true, socketFactory = sf)
                    if (r.isOnline && r.isRecursosServer) url to r else null
                }
            }.awaitAll().filterNotNull()
        }

        val priorityMatch = priorityResults.firstOrNull { (url, res) ->
            !res.isRevoked && isPrivateRfc1918Ipv4(url.removePrefix("http://").removePrefix("https://").substringBefore("/").substringBefore(":"))
        } ?: priorityResults.firstOrNull { !it.second.isRevoked } ?: priorityResults.firstOrNull()
        if (priorityMatch != null) {
            val (foundUrl, res) = priorityMatch
            if (res.isRevoked) {
                securePreferences.isCertRevoked = true
                return@withContext ResolvedEndpoint(foundUrl, ConnectionMode.REVOKED)
            }
            persistDiscoveredHostAndPort(foundUrl)
            Log.i("RecursosCockpit", "Servidor encontrado vía rápida/NSD en ${System.currentTimeMillis() - startMs}ms -> $foundUrl")
            return@withContext ResolvedEndpoint(foundUrl, ConnectionMode.CONNECTED_LAN)
        }

        // 3. Escaneo paralelo en bloques del rango /24 completo usando las subredes Wi-Fi/Ethernet reales
        for (ctx in lanContexts) {
            val alreadyTestedHosts = setOfNotNull(
                ctx.ownIp,
                ctx.gatewayIp,
                "${ctx.subnetBase}.1",
                "${ctx.subnetBase}.2",
                "${ctx.subnetBase}.10",
                "${ctx.subnetBase}.100",
                "${ctx.subnetBase}.254"
            )
            val allIps = (1..254)
                .map { "${ctx.subnetBase}.$it" }
                .filter { it !in alreadyTestedHosts }
            val chunkSize = 32
            val activeSocketFactories = listOfNotNull(ctx.socketFactory, null).distinct()

            for (chunk in allIps.chunked(chunkSize)) {
                val found = coroutineScope {
                    chunk.flatMap { ip ->
                        val url = "http://$ip:$defaultPort"
                        activeSocketFactories.map { sf ->
                            async {
                                val r = apiService.probeNode(url, isQuickScan = true, socketFactory = sf)
                                if (r.isOnline && r.isRecursosServer) url to r else null
                            }
                        }
                    }.awaitAll().filterNotNull().firstOrNull()
                }

                if (found != null) {
                    val (foundUrl, result) = found
                    if (result.isRevoked) {
                        securePreferences.isCertRevoked = true
                        return@withContext ResolvedEndpoint(foundUrl, ConnectionMode.REVOKED)
                    }
                    persistDiscoveredHostAndPort(foundUrl)
                    Log.i("RecursosCockpit", "Servidor encontrado por escaneo /24 (${ctx.interfaceName}) en ${System.currentTimeMillis() - startMs}ms -> $foundUrl")
                    return@withContext ResolvedEndpoint(foundUrl, ConnectionMode.CONNECTED_LAN)
                }
            }
        }

        // 4. Conmutación a WAN exterior (Caddy proxy / DDNS detectado) con token firmado
        val wanDomain = securePreferences.wanDomain.trim().trimEnd('/')
        if (apiService.isValidWanDomain(wanDomain)) {
            val wanCandidate = if (wanDomain.startsWith("http://") || wanDomain.startsWith("https://")) wanDomain else "https://$wanDomain"
            onScanningProgress?.invoke(
                I18nDictionary.t(apiService.appContext, "native_android.connecting_wan", "Conectando desde fuera de casa de forma segura...")
            )
            val wanRes = apiService.probeNode(wanCandidate, isQuickScan = false)
            if (wanRes.isRevoked) {
                securePreferences.isCertRevoked = true
                return@withContext ResolvedEndpoint(wanCandidate, ConnectionMode.REVOKED)
            }
            if (wanRes.isOnline && wanRes.isRecursosServer) {
                securePreferences.isCertRevoked = false
                Log.i("RecursosCockpit", "Conectado por WAN exterior en ${System.currentTimeMillis() - startMs}ms -> $wanCandidate")
                return@withContext ResolvedEndpoint(wanCandidate, ConnectionMode.CONNECTED_WAN)
            }
            val fallback = if (savedHost.isNotEmpty()) "http://$savedHost:$defaultPort" else wanCandidate
            return@withContext ResolvedEndpoint(fallback, ConnectionMode.ERROR)
        }

        Log.w("RecursosCockpit", "No se encontró servidor local ni dominio WAN tras ${System.currentTimeMillis() - startMs}ms")
        val fallback = if (savedHost.isNotEmpty()) "http://$savedHost:$defaultPort" else ""
        ResolvedEndpoint(fallback, ConnectionMode.ERROR)
    }

    private fun isVpnActive(): Boolean {
        return try {
            val cm = apiService.appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return false
            val activeCaps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }
            activeCaps?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
        } catch (_: Exception) {
            false
        }
    }

    @Suppress("DEPRECATION")
    private fun discoverLocalLanContexts(): List<LanSubnetContext> {
        val seenSubnets = linkedMapOf<String, LanSubnetContext>()

        // Prioridad 1: ConnectivityManager (solo TRANSPORT_WIFI o TRANSPORT_ETHERNET, excluyendo VPN y datos móviles)
        try {
            val cm = apiService.appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            if (cm != null) {
                val networks = (listOfNotNull(cm.activeNetwork) + cm.allNetworks.toList()).distinct()
                for (network in networks) {
                    val caps = cm.getNetworkCapabilities(network) ?: continue
                    val isLanTransport = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                    if (!isLanTransport || caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) || caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                        continue
                    }
                    val lp = cm.getLinkProperties(network) ?: continue
                    val ifName = lp.interfaceName ?: "wlan0"
                    val gatewayIp = lp.routes
                        .mapNotNull { it.gateway as? Inet4Address }
                        .firstOrNull { !it.isLoopbackAddress && isPrivateRfc1918Ipv4(it.hostAddress ?: "") }
                        ?.hostAddress

                    for (la in lp.linkAddresses) {
                        val addr = la.address
                        if (addr is Inet4Address && !addr.isLoopbackAddress) {
                            val ip = addr.hostAddress ?: continue
                            if (!isPrivateRfc1918Ipv4(ip)) continue
                            val base = ip.substringBeforeLast(".")
                            if (!seenSubnets.containsKey(base)) {
                                seenSubnets[base] = LanSubnetContext(
                                    subnetBase = base,
                                    ownIp = ip,
                                    gatewayIp = gatewayIp,
                                    interfaceName = ifName,
                                    socketFactory = network.socketFactory
                                )
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.w("RecursosCockpit", "No se pudo consultar ConnectivityManager para subred LAN: ${e.message}")
        }

        // Prioridad 2: Fallback NetworkInterface filtrado (excluyendo rmnet/tun/docker/tailscale)
        if (seenSubnets.isEmpty()) {
            try {
                val allIfaces = Collections.list(NetworkInterface.getNetworkInterfaces())
                    .sortedByDescending { if (isPreferredLanInterfaceName(it.name ?: "")) 1 else 0 }
                for (iface in allIfaces) {
                    if (!iface.isUp || iface.isLoopback) continue
                    val ifName = iface.name ?: ""
                    if (isExcludedNonLanInterfaceName(ifName)) continue
                    for (addr in Collections.list(iface.inetAddresses)) {
                        if (addr is Inet4Address && !addr.isLoopbackAddress) {
                            val ip = addr.hostAddress ?: continue
                            if (!isPrivateRfc1918Ipv4(ip)) continue
                            val base = ip.substringBeforeLast(".")
                            if (!seenSubnets.containsKey(base)) {
                                seenSubnets[base] = LanSubnetContext(
                                    subnetBase = base,
                                    ownIp = ip,
                                    gatewayIp = null,
                                    interfaceName = ifName.ifBlank { "wlan0" },
                                    socketFactory = null
                                )
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e("RecursosCockpit", "Error detectando interfaces locales: ${e.message}")
            }
        }

        return seenSubnets.values.toList()
    }

    @Suppress("DEPRECATION")
    private suspend fun discoverViaNsd(timeoutMs: Long): List<String> {
        val ctx = apiService.appContext
        val nsdManager = ctx.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return emptyList()
        val wifiManager = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val multicastLock = try {
            wifiManager?.createMulticastLock("recursos_mdns_lock")?.apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (e: Exception) {
            Log.w("RecursosCockpit", "Sin MulticastLock para NSD: ${e.message}")
            null
        }

        val discoveredUrls = Collections.synchronizedList(mutableListOf<String>())
        val discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(regType: String) {}

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (!serviceInfo.serviceType.contains("_recursos._tcp")) return
                try {
                    if (Build.VERSION.SDK_INT >= 34) {
                        NsdApi34Helper.resolve(nsdManager, serviceInfo) { resolvedInfo ->
                            collectResolvedNsdUrls(resolvedInfo, discoveredUrls)
                        }
                    } else {
                        nsdManager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                            override fun onResolveFailed(si: NsdServiceInfo, errorCode: Int) {}
                            override fun onServiceResolved(resolvedInfo: NsdServiceInfo) {
                                collectResolvedNsdUrls(resolvedInfo, discoveredUrls)
                            }
                        })
                    }
                } catch (e: Exception) {
                    Log.w("RecursosCockpit", "Error resolviendo servicio NSD ${serviceInfo.serviceName}: ${e.message}")
                }
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.w("RecursosCockpit", "onStartDiscoveryFailed NSD: $errorCode")
            }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
        }

        var started = false
        return try {
            nsdManager.discoverServices("_recursos._tcp.", NsdManager.PROTOCOL_DNS_SD, discoveryListener)
            started = true
            val deadline = System.currentTimeMillis() + timeoutMs
            while (System.currentTimeMillis() < deadline && discoveredUrls.isEmpty()) {
                delay(120)
            }
            // Pequeño margen extra por si llegan direcciones IPv4 adicionales tras la primera
            if (discoveredUrls.isNotEmpty()) delay(150)
            synchronized(discoveredUrls) { discoveredUrls.distinct() }
        } catch (e: Exception) {
            Log.w("RecursosCockpit", "Excepción en descubrimiento mDNS/NSD: ${e.message}")
            emptyList()
        } finally {
            if (started) {
                try {
                    nsdManager.stopServiceDiscovery(discoveryListener)
                } catch (_: Exception) {}
            }
            try {
                if (multicastLock?.isHeld == true) {
                    multicastLock.release()
                }
            } catch (_: Exception) {}
        }
    }

    @Suppress("DEPRECATION")
    private fun collectResolvedNsdUrls(info: NsdServiceInfo, out: MutableList<String>) {
        val port = if (info.port > 0) info.port else securePreferences.manualPort
        val hosts = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= 34) {
            hosts.addAll(NsdApi34Helper.extractIpv4Hosts(info))
        }
        val legacyHost = info.host
        if (legacyHost is Inet4Address && !legacyHost.isLoopbackAddress) {
            legacyHost.hostAddress?.let { hosts.add(it) }
        }
        for (h in hosts.distinct()) {
            out.add("http://$h:$port")
        }
    }

    @RequiresApi(34)
    private object NsdApi34Helper {
        fun resolve(
            nsdManager: NsdManager,
            serviceInfo: NsdServiceInfo,
            onResolved: (NsdServiceInfo) -> Unit
        ) {
            val callback = object : NsdManager.ServiceInfoCallback {
                override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) {}
                override fun onServiceUpdated(resolvedInfo: NsdServiceInfo) {
                    onResolved(resolvedInfo)
                    try {
                        nsdManager.unregisterServiceInfoCallback(this)
                    } catch (_: Exception) {}
                }
                override fun onServiceLost() {}
                override fun onServiceInfoCallbackUnregistered() {}
            }
            nsdManager.registerServiceInfoCallback(serviceInfo, { r -> r.run() }, callback)
        }

        fun extractIpv4Hosts(info: NsdServiceInfo): List<String> {
            return info.hostAddresses
                .filterIsInstance<Inet4Address>()
                .filter { !it.isLoopbackAddress }
                .mapNotNull { it.hostAddress }
        }
    }

    private fun persistDiscoveredHostAndPort(url: String, clearRevoked: Boolean = true) {
        val normalizedUrl = url.trim().trimEnd('/')
        val clean = normalizedUrl.removePrefix("http://").removePrefix("https://").substringBefore("/")
        val host = clean.substringBefore(":")
        val port = clean.substringAfter(":", "").toIntOrNull()
        if (clearRevoked) {
            securePreferences.isCertRevoked = false
        }
        val isWanEndpoint = normalizedUrl.startsWith("https://", ignoreCase = true) ||
            (host.isNotEmpty() && !isPrivateRfc1918Ipv4(host))
        if (isWanEndpoint) {
            apiService.learnWanDomain(normalizedUrl)
            if (securePreferences.savedHost.isBlank()) {
                securePreferences.savedHost = normalizedUrl
            }
        } else {
            if (host.isNotEmpty()) {
                securePreferences.savedHost = host
            }
            if (port != null && port in 1..65535 && port != securePreferences.manualPort) {
                securePreferences.manualPort = port
            }
        }
    }
}
