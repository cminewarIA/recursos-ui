package com.cminewar.recursoscockpit.ui

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.cminewar.recursoscockpit.BuildConfig
import com.cminewar.recursoscockpit.data.ConnectionMode
import com.cminewar.recursoscockpit.data.SecurePreferences
import com.cminewar.recursoscockpit.theme.*

/**
 * Puente Nativo JavascriptInterface (Android OS <-> Motor HTML5 Unificado)
 * Expone el almacenamiento seguro (EncryptedSharedPreferences) y el estado
 * de red LAN/WAN directamente al runtime de index.html.
 */
class RecursosAndroidBridge(
    private val securePreferences: SecurePreferences,
    private val currentModeProvider: () -> ConnectionMode,
    private val activeUrlProvider: () -> String,
    private val deviceTelemetryProvider: () -> String,
    private val onOpenSettings: () -> Unit,
    private val onTriggerRescan: () -> Unit
) {
    @JavascriptInterface
    fun getDeviceToken(): String {
        return securePreferences.deviceToken
    }

    @JavascriptInterface
    fun onTokenUpdated(token: String) {
        if (token.isNotBlank() && token != securePreferences.deviceToken) {
            securePreferences.deviceToken = token
            securePreferences.isCertRevoked = false
        }
    }

    @JavascriptInterface
    fun getConnectionMode(): String {
        return currentModeProvider().name
    }

    @JavascriptInterface
    fun getActiveNodeUrl(): String {
        return activeUrlProvider()
    }

    @JavascriptInterface
    fun getDeviceTelemetryJson(): String {
        return deviceTelemetryProvider()
    }

    @JavascriptInterface
    fun openNativeSettings() {
        onOpenSettings()
    }

    @JavascriptInterface
    fun triggerNodeRescan() {
        onTriggerRescan()
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun CockpitDashboard(
    securePreferences: SecurePreferences,
    connectionMode: ConnectionMode,
    activeUrl: String,
    scanningMessage: String,
    deviceTelemetryProvider: () -> String,
    onRefresh: () -> Unit,
    onOpenSettings: () -> Unit
) {
    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    var canGoBack by remember { mutableStateOf(false) }
    var isPageLoading by remember { mutableStateOf(true) }
    var lastLoadedBaseUrl by remember { mutableStateOf("") }

    BackHandler(enabled = canGoBack) {
        webViewRef?.goBack()
    }

    // Inyectar sesión criptográfica, telemetría de dispositivo y banderas nativas en el DOM HTML5
    fun injectNativeContext(webView: WebView?) {
        val wv = webView ?: return
        val tokenEscaped = securePreferences.deviceToken.replace("'", "\\'")
        val modeEscaped = connectionMode.name.replace("'", "\\'")
        val urlEscaped = activeUrl.replace("'", "\\'")
        val telemetryJson = deviceTelemetryProvider().ifBlank { "{}" }

        val jsPayload = """
            (function() {
                window.__RECURSOS_ANDROID_NATIVE__ = true;
                window.__RECURSOS_NATIVE__ = true;
                window.__RECURSOS_NATIVE_PLATFORM__ = 'android';
                try { window.__RECURSOS_NATIVE_DEVICE_INFO__ = $telemetryJson; } catch(e) {}
                if ('$tokenEscaped') {
                    try { localStorage.setItem('sysmon_device_token', '$tokenEscaped'); } catch(e) {}
                }
                if (typeof window.injectNativeSession === 'function') {
                    window.injectNativeSession('$tokenEscaped', '$modeEscaped', '$urlEscaped', window.__RECURSOS_NATIVE_DEVICE_INFO__);
                }
                if (typeof EnvironmentDetector !== 'undefined' && typeof EnvironmentDetector.applyStrictLayout === 'function') {
                    EnvironmentDetector.applyStrictLayout();
                }
            })();
        """.trimIndent()

        wv.post {
            wv.evaluateJavascript(jsPayload, null)
        }
    }

    // Re-inyectar contexto cuando cambie el modo o el nodo activo
    LaunchedEffect(activeUrl, connectionMode, securePreferences.deviceToken) {
        val wv = webViewRef ?: return@LaunchedEffect
        if (activeUrl.isNotEmpty() && activeUrl != lastLoadedBaseUrl) {
            lastLoadedBaseUrl = activeUrl
            isPageLoading = true
            wv.loadUrl(activeUrl)
        } else {
            injectNativeContext(wv)
        }
    }

    Scaffold(
        containerColor = CockpitBg,
        topBar = {
            // Barra de Estado Nativa Compacta (Zero-Trust + Conmutador LAN/WAN + Ajustes Nativos)
            Surface(
                color = Color(0xFF070B14),
                tonalElevation = 4.dp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .statusBarsPadding()
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.weight(1f)
                    ) {
                        val statusColor = when (connectionMode) {
                            ConnectionMode.CONNECTED_LAN -> NeonGreen
                            ConnectionMode.CONNECTED_WAN -> NeonCyan
                            ConnectionMode.REVOKED -> NeonRed
                            ConnectionMode.SCANNING_LAN, ConnectionMode.CONNECTING -> NeonOrange
                            ConnectionMode.DISCONNECTED, ConnectionMode.ERROR -> NeonRed
                            else -> NeonOrange
                        }
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(statusColor)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = when (connectionMode) {
                                ConnectionMode.CONNECTED_LAN -> "LAN DIRECTA"
                                ConnectionMode.CONNECTED_WAN -> "WAN TLS"
                                ConnectionMode.REVOKED -> "CERT REVOCADO"
                                ConnectionMode.SCANNING_LAN -> "AUTODESCUBRIENDO..."
                                ConnectionMode.CONNECTING -> "CONECTANDO..."
                                ConnectionMode.DISCONNECTED -> "DESCONECTADO"
                                ConnectionMode.ERROR -> "SIN CONEXIÓN"
                                else -> "CONECTANDO..."
                            },
                            color = statusColor,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.ExtraBold,
                            fontFamily = FontFamily.Monospace
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = if (activeUrl.isNotEmpty()) activeUrl else scanningMessage,
                            color = TextSecondary,
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace,
                            maxLines = 1
                        )
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(NeonCyan.copy(alpha = 0.15f))
                                .border(1.dp, NeonCyan.copy(alpha = 0.35f), RoundedCornerShape(6.dp))
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        ) {
                            Text(
                                text = "v${BuildConfig.VERSION_NAME}",
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                color = NeonCyan,
                                fontFamily = FontFamily.Monospace
                            )
                        }

                        IconButton(
                            onClick = {
                                onRefresh()
                                webViewRef?.reload()
                            },
                            modifier = Modifier.size(30.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = "Reconectar y Recargar",
                                tint = NeonCyan,
                                modifier = Modifier.size(17.dp)
                            )
                        }

                        IconButton(
                            onClick = onOpenSettings,
                            modifier = Modifier.size(30.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Settings,
                                contentDescription = "Ajustes de Nodo y Token",
                                tint = TextSecondary,
                                modifier = Modifier.size(17.dp)
                            )
                        }
                    }
                }
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .background(CockpitBg)
        ) {
            // Contenedor Nativo Android WebView Acelerado por Hardware (100% HTML5/CSS3/D3.js v7/Leaflet)
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    WebView(context).apply {
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                        setBackgroundColor(android.graphics.Color.parseColor("#050811"))
                        setLayerType(View.LAYER_TYPE_HARDWARE, null)

                        settings.apply {
                            javaScriptEnabled = true
                            domStorageEnabled = true
                            databaseEnabled = true
                            mediaPlaybackRequiresUserGesture = false
                            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                            cacheMode = WebSettings.LOAD_DEFAULT
                            useWideViewPort = true
                            loadWithOverviewMode = true
                            setSupportZoom(false)
                            builtInZoomControls = false
                            displayZoomControls = false
                            userAgentString = "$userAgentString RecursosCockpit-Android/${BuildConfig.VERSION_NAME} (NativeHTML; FullAccess)"
                        }

                        addJavascriptInterface(
                            RecursosAndroidBridge(
                                securePreferences = securePreferences,
                                currentModeProvider = { connectionMode },
                                activeUrlProvider = { activeUrl },
                                deviceTelemetryProvider = deviceTelemetryProvider,
                                onOpenSettings = onOpenSettings,
                                onTriggerRescan = onRefresh
                            ),
                            "RecursosAndroidBridge"
                        )

                        webChromeClient = WebChromeClient()
                        webViewClient = object : WebViewClient() {
                            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                                super.onPageStarted(view, url, favicon)
                                isPageLoading = true
                                injectNativeContext(view)
                            }

                            override fun onPageFinished(view: WebView?, url: String?) {
                                super.onPageFinished(view, url)
                                isPageLoading = false
                                canGoBack = view?.canGoBack() ?: false
                                injectNativeContext(view)
                            }

                            override fun onReceivedError(
                                view: WebView?,
                                request: WebResourceRequest?,
                                error: WebResourceError?
                            ) {
                                super.onReceivedError(view, request, error)
                                if (request?.isForMainFrame == true) {
                                    isPageLoading = false
                                }
                            }
                        }

                        webViewRef = this
                        if (activeUrl.isNotEmpty()) {
                            lastLoadedBaseUrl = activeUrl
                            loadUrl(activeUrl)
                        }
                    }
                },
                update = { view ->
                    canGoBack = view.canGoBack()
                }
            )

            // Overlay durante autodescubrimiento inicial o revocación de certificado
            if (connectionMode == ConnectionMode.SCANNING_LAN || (isPageLoading && activeUrl.isEmpty())) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(CockpitBg.copy(alpha = 0.92f)),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(28.dp)
                    ) {
                        CircularProgressIndicator(color = NeonCyan, strokeWidth = 3.dp)
                        Spacer(modifier = Modifier.height(18.dp))
                        Text(
                            text = "RECURSOS COCKPIT · MOTOR HTML5 NATIVO",
                            color = TextPrimary,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.ExtraBold,
                            letterSpacing = 1.sp
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = scanningMessage,
                            color = NeonCyan,
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace
                        )
                    }
                }
            }

            if (connectionMode == ConnectionMode.REVOKED) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .fillMaxWidth()
                        .padding(16.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(Color(0xEB1A050A))
                        .border(1.dp, NeonRed, RoundedCornerShape(14.dp))
                        .padding(16.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(text = "🔒", fontSize = 24.sp)
                        Spacer(modifier = Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "ACCESO DENEGADO · CERTIFICADO REVOCADO",
                                color = NeonRed,
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp
                            )
                            Text(
                                text = "El certificado criptográfico de este dispositivo fue revocado en el servidor. Conéctese a la Wi-Fi local y pulse Reconectar para renovar el enlace.",
                                color = TextPrimary,
                                fontSize = 12.sp
                            )
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(NeonRed.copy(alpha = 0.2f))
                                .border(1.dp, NeonRed, RoundedCornerShape(8.dp))
                                .clickable { onOpenSettings() }
                                .padding(horizontal = 10.dp, vertical = 6.dp)
                        ) {
                            Text(
                                text = "Ajustes",
                                color = NeonRed,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }
        }
    }
}
