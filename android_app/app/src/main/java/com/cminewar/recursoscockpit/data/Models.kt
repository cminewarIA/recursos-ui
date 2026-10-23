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
    @SerializedName("version") val version: String = "",
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

data class NativeDeviceTelemetry(
    @SerializedName("client_type") val clientType: String = "android_native",
    @SerializedName("client_label") val clientLabel: String = "App Nativa Android (.apk)",
    @SerializedName("access_level") val accessLevel: String = "FULL_NATIVE_ACCESS",
    @SerializedName("full_access") val fullAccess: Boolean = true,
    @SerializedName("dex_capable") val dexCapable: Boolean = false,
    @SerializedName("app_version") val appVersion: String = "",
    @SerializedName("hardware_id") val hardwareId: String = "",
    @SerializedName("name") val name: String = "",
    @SerializedName("hostname") val hostname: String = "",
    @SerializedName("manufacturer") val manufacturer: String = "",
    @SerializedName("brand") val brand: String = "",
    @SerializedName("model") val model: String = "",
    @SerializedName("device_codename") val deviceCodename: String = "",
    @SerializedName("product") val product: String = "",
    @SerializedName("board") val board: String = "",
    @SerializedName("hardware_soc") val hardwareSoc: String = "",
    @SerializedName("bootloader") val bootloader: String = "",
    @SerializedName("build_display") val buildDisplay: String = "",
    @SerializedName("chassis_type") val chassisType: String = "Android Mobile / Tablet",
    @SerializedName("os_distro") val osDistro: String = "",
    @SerializedName("security_patch") val securityPatch: String = "",
    @SerializedName("kernel") val kernel: String = "",
    @SerializedName("arch") val arch: String = "",
    @SerializedName("supported_abis") val supportedAbis: String = "",
    @SerializedName("cpu_model") val cpuModel: String = "",
    @SerializedName("cpu_cores_physical") val cpuCoresPhysical: Int = 1,
    @SerializedName("cpu_cores_logical") val cpuCoresLogical: Int = 1,
    @SerializedName("ram_total_bytes") val ramTotalBytes: Long = 0L,
    @SerializedName("ram_total_gb") val ramTotalGb: Double = 0.0,
    @SerializedName("storage_total_bytes") val storageTotalBytes: Long = 0L,
    @SerializedName("storage_total_gb") val storageTotalGb: Double = 0.0,
    @SerializedName("storage_free_gb") val storageFreeGb: Double = 0.0,
    @SerializedName("battery_percent") val batteryPercent: Int? = null,
    @SerializedName("battery_charging") val batteryCharging: Boolean? = null,
    @SerializedName("screen_resolution") val screenResolution: String = "",
    @SerializedName("local_ip") val localIp: String = "",
    @SerializedName("interface_name") val interfaceName: String = "",
    @SerializedName("mac_address") val macAddress: String = ""
)

