package com.cminewar.recursoscockpit.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SecurePreferences(context: Context) {

    private val prefs: SharedPreferences = try {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context,
            "recursos_cockpit_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (e: Exception) {
        // Fallback para entornos donde KeyStore falle
        context.getSharedPreferences("recursos_cockpit_prefs", Context.MODE_PRIVATE)
    }

    var deviceToken: String
        get() = prefs.getString(KEY_DEVICE_TOKEN, "") ?: ""
        set(value) = prefs.edit().putString(KEY_DEVICE_TOKEN, value).apply()

    var manualHost: String
        get() = prefs.getString(KEY_MANUAL_HOST, "192.168.50.2") ?: "192.168.50.2"
        set(value) = prefs.edit().putString(KEY_MANUAL_HOST, value).apply()

    var manualPort: Int
        get() = prefs.getInt(KEY_MANUAL_PORT, 8085)
        set(value) = prefs.edit().putInt(KEY_MANUAL_PORT, value).apply()

    var wanDomain: String
        get() = prefs.getString(KEY_WAN_DOMAIN, "recursos.cminewar.duckdns.org") ?: "recursos.cminewar.duckdns.org"
        set(value) = prefs.edit().putString(KEY_WAN_DOMAIN, value).apply()

    companion object {
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_MANUAL_HOST = "manual_host"
        private const val KEY_MANUAL_PORT = "manual_port"
        private const val KEY_WAN_DOMAIN = "wan_domain"
    }
}
