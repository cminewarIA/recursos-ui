package com.cminewar.recursoscockpit.data

import com.google.gson.annotations.SerializedName

enum class ConnectionMode {
    DISCONNECTED,
    CONNECTING,
    SCANNING_LAN,
    CONNECTED_LAN,
    CONNECTED_WAN,
    REVOKED,
    ERROR
}

data class VersionInfo(
    @SerializedName("version") val version: String = "8.5.0",
    @SerializedName("repo") val repo: String? = null,
    @SerializedName("local_hash") val localHash: String? = null,
    @SerializedName("public_domain") val publicDomain: String? = null,
    @SerializedName("local_ip") val localIp: String? = null,
    @SerializedName("app") val app: String? = null
)

data class MetricsResponse(
    @SerializedName("system") val system: SystemData? = null,
    @SerializedName("cpu") val cpu: CpuData? = null,
    @SerializedName("ram") val ram: RamData? = null,
    @SerializedName("gpu") val gpu: GpuData? = null,
    @SerializedName("disks") val disks: List<DiskData>? = null,
    @SerializedName("net") val net: NetData? = null,
    @SerializedName("security") val security: SecurityData? = null,
    @SerializedName("docker_activities") val dockerActivities: List<Map<String, Any>>? = null,
    @SerializedName("system_processes") val systemProcesses: List<Map<String, Any>>? = null,
    @SerializedName("auth_status") val authStatus: AuthStatusData? = null
)

data class AuthStatusData(
    @SerializedName("is_local") val isLocal: Boolean? = true,
    @SerializedName("is_trusted") val isTrusted: Boolean? = true,
    @SerializedName("client_ip") val clientIp: String? = null,
    @SerializedName("public_domain") val publicDomain: String? = null,
    @SerializedName("local_ip") val localIp: String? = null,
    @SerializedName("token") val token: String? = null,
    @SerializedName("device_name") val deviceName: String? = null
)

data class SystemData(
    @SerializedName("hostname") val hostname: String? = "Servidor",
    @SerializedName("os") val os: String? = "Linux",
    @SerializedName("kernel") val kernel: String? = "",
    @SerializedName("uptime_str") val uptimeStr: String? = "",
    @SerializedName("uptime_seconds") val uptimeSeconds: Long? = 0L,
    @SerializedName("local_ip") val localIp: String? = null,
    @SerializedName("public_domain") val publicDomain: String? = null
)

data class CpuData(
    @SerializedName("model") val model: String? = "CPU",
    @SerializedName("usage_percent") val usagePercent: Float? = 0f,
    @SerializedName("temp_c") val tempC: Float? = null,
    @SerializedName("logical_cores") val logicalCores: Int? = 1,
    @SerializedName("physical_cores") val physicalCores: Int? = 1,
    @SerializedName("freq_mhz") val freqMhz: Float? = null,
    @SerializedName("load_1m") val load1m: Float? = null,
    @SerializedName("per_core_percent") val perCorePercent: List<Float>? = null
)

data class RamData(
    @SerializedName("total_bytes") val totalBytes: Long? = 0L,
    @SerializedName("used_bytes") val usedBytes: Long? = 0L,
    @SerializedName("free_bytes") val freeBytes: Long? = 0L,
    @SerializedName("percent") val percent: Float? = 0f,
    @SerializedName("swap_percent") val swapPercent: Float? = 0f,
    @SerializedName("swap_total_bytes") val swapTotalBytes: Long? = 0L,
    @SerializedName("swap_used_bytes") val swapUsedBytes: Long? = 0L,
    @SerializedName("zram_active") val zramActive: Boolean? = false,
    @SerializedName("cached_bytes") val cachedBytes: Long? = 0L,
    @SerializedName("buffers_bytes") val buffersBytes: Long? = 0L
)

data class GpuData(
    @SerializedName("active") val active: Boolean? = false,
    @SerializedName("name") val name: String? = null,
    @SerializedName("usage_percent") val usagePercent: Float? = null,
    @SerializedName("temperature") val temperature: Float? = null,
    @SerializedName("memory_used") val memoryUsed: Long? = null,
    @SerializedName("memory_total") val memoryTotal: Long? = null
)

data class DiskData(
    @SerializedName("mountpoint") val mountpoint: String? = "/",
    @SerializedName("label") val label: String? = "Disco",
    @SerializedName("device") val device: String? = "",
    @SerializedName("total_bytes") val totalBytes: Long? = 0L,
    @SerializedName("used_bytes") val usedBytes: Long? = 0L,
    @SerializedName("free_bytes") val freeBytes: Long? = 0L,
    @SerializedName("percent") val percent: Float? = 0f,
    @SerializedName("temp_c") val tempC: Float? = null
)

data class NetData(
    @SerializedName("rx_bytes_sec") val rxBytesSec: Double? = 0.0,
    @SerializedName("tx_bytes_sec") val txBytesSec: Double? = 0.0,
    @SerializedName("rx_total_bytes") val rxTotalBytes: Double? = 0.0,
    @SerializedName("tx_total_bytes") val txTotalBytes: Double? = 0.0,
    @SerializedName("local_ip") val localIp: String? = null,
    @SerializedName("interfaces_list") val interfacesList: List<Map<String, Any>>? = null
)

data class SecurityData(
    @SerializedName("available") val available: Boolean? = false,
    @SerializedName("fail2ban") val fail2ban: Map<String, Any>? = null
)
