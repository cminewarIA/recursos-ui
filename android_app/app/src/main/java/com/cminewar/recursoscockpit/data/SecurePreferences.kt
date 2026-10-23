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
        context.getSharedPreferences("recursos_cockpit_prefs", Context.MODE_PRIVATE)
    }

    var deviceToken: String
        get() = prefs.getString(KEY_DEVICE_TOKEN, "") ?: ""
        set(value) = prefs.edit().putString(KEY_DEVICE_TOKEN, value).apply()

    var savedHost: String
        get() = prefs.getString(KEY_SAVED_HOST, "") ?: ""
        set(value) = prefs.edit().putString(KEY_SAVED_HOST, value).apply()

    var manualHost: String
        get() = prefs.getString(KEY_MANUAL_HOST, "") ?: ""
        set(value) = prefs.edit().putString(KEY_MANUAL_HOST, value).apply()

    var manualPort: Int
        get() = prefs.getInt(KEY_MANUAL_PORT, 8085)
        set(value) = prefs.edit().putInt(KEY_MANUAL_PORT, value).apply()

    var wanDomain: String
        get() = prefs.getString(KEY_WAN_DOMAIN, "recursos.cminewar.duckdns.org") ?: "recursos.cminewar.duckdns.org"
        set(value) = prefs.edit().putString(KEY_WAN_DOMAIN, value).apply()

    var isCertRevoked: Boolean
        get() = prefs.getBoolean(KEY_CERT_REVOKED, false)
        set(value) = prefs.edit().putBoolean(KEY_CERT_REVOKED, value).apply()

    companion object {
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_SAVED_HOST = "saved_host"
        private const val KEY_MANUAL_HOST = "manual_host"
        private const val KEY_MANUAL_PORT = "manual_port"
        private const val KEY_WAN_DOMAIN = "wan_domain"
        private const val KEY_CERT_REVOKED = "cert_revoked"
    }
}
