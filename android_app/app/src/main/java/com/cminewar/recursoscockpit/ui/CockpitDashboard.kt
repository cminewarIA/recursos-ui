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
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.cminewar.recursoscockpit.BuildConfig
import com.cminewar.recursoscockpit.R
import com.cminewar.recursoscockpit.data.ConnectionMode
import com.cminewar.recursoscockpit.data.SecurePreferences
import com.cminewar.recursoscockpit.theme.*

/**
 * Puente Nativo JavascriptInterface (Android OS <-> Motor React/HTML5 Unificado)
 * Sincroniza el almacenamiento cifrado (EncryptedSharedPreferences) y el estado
 * automático LAN/DNS con la interfaz web sin permitir selección manual en Android.
 */
class RecursosAndroidBridge(
    private val securePreferences: SecurePreferences,
    private val currentModeProvider: () -> ConnectionMode,
    private val activeUrlProvider: () -> String,
    private val deviceTelemetryProvider: () -> String,
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
    fun triggerNodeRescan() {
        onTriggerRescan()
    }
}

private fun formatDisplayVersion(): String {
    val raw = BuildConfig.VERSION_NAME
    return if (raw.startsWith("12.")) "v2B.${raw.removePrefix("12.")}" else "v$raw"
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun CockpitDashboard(
    securePreferences: SecurePreferences,
    connectionMode: ConnectionMode,
    activeUrl: String,
    scanningMessage: String,
    deviceTelemetryProvider: () -> String,
    onRefresh: () -> Unit
) {
    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    var canGoBack by remember { mutableStateOf(false) }
    var isPageLoading by remember { mutableStateOf(true) }
    var lastLoadedBaseUrl by remember { mutableStateOf("") }

    BackHandler(enabled = canGoBack) {
        webViewRef?.goBack()
    }

    fun injectNativeContext(webView: WebView?) {
        val wv = webView ?: return
        val tokenEscaped = securePreferences.deviceToken.replace("'", "\\'")
        val telemetryJson = deviceTelemetryProvider().ifBlank { "{}" }

        val jsPayload = """
            (function() {
                window.__RECURSOS_ANDROID_NATIVE__ = true;
                window.__RECURSOS_NATIVE__ = true;
                window.__RECURSOS_NATIVE_PLATFORM__ = 'android';
                try {
                    window.__RECURSOS_NATIVE_DEVICE_INFO__ = $telemetryJson;
                    window.__RECURSOS_DEVICE_TELEMETRY__ = window.__RECURSOS_NATIVE_DEVICE_INFO__;
                } catch(e) {}
                if ('$tokenEscaped') {
                    try {
                        localStorage.setItem('recursos_device_token', '$tokenEscaped');
                        localStorage.setItem('sysmon_device_token', '$tokenEscaped');
                    } catch(e) {}
                }
                if (typeof window.injectNativeSession === 'function') {
                    window.injectNativeSession('$tokenEscaped', window.__RECURSOS_DEVICE_TELEMETRY__);
                }
            })();
        """.trimIndent()

        wv.post {
            wv.evaluateJavascript(jsPayload, null)
        }
    }

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
            Surface(
                color = CockpitCard,
                tonalElevation = 0.dp,
                shadowElevation = 0.dp,
                modifier = Modifier
                    .fillMaxWidth()
                    .border(width = 1.dp, color = CockpitBorder)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .statusBarsPadding()
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.weight(1f)
                    ) {
                        val statusColor = when (connectionMode) {
                            ConnectionMode.CONNECTED_LAN -> NeonGreen
                            ConnectionMode.CONNECTED_WAN -> NeonBlue
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
                                ConnectionMode.CONNECTED_LAN -> "Red local"
                                ConnectionMode.CONNECTED_WAN -> "Externa segura"
                                ConnectionMode.REVOKED -> "Acceso bloqueado"
                                ConnectionMode.SCANNING_LAN -> "Buscando..."
                                ConnectionMode.CONNECTING -> "Conectando..."
                                ConnectionMode.DISCONNECTED -> "Desconectado"
                                ConnectionMode.ERROR -> "Sin conexión"
                                else -> "Conectando..."
                            },
                            color = statusColor,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = if (activeUrl.isNotEmpty()) {
                                activeUrl.removePrefix("https://").removePrefix("http://")
                            } else {
                                scanningMessage
                            },
                            color = TextSecondary,
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Text(
                            text = formatDisplayVersion(),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = TextSecondary,
                            fontFamily = FontFamily.Monospace
                        )

                        IconButton(
                            onClick = {
                                onRefresh()
                                webViewRef?.reload()
                            },
                            modifier = Modifier.size(34.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = "Volver a conectar",
                                tint = NeonBlue,
                                modifier = Modifier.size(18.dp)
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
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    WebView(context).apply {
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                        setBackgroundColor(android.graphics.Color.parseColor("#F6F7F9"))
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

            if (connectionMode == ConnectionMode.SCANNING_LAN || (isPageLoading && activeUrl.isEmpty())) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(CockpitBg),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(28.dp)
                    ) {
                        Image(
                            painter = painterResource(id = R.mipmap.ic_launcher),
                            contentDescription = "CMineWar",
                            modifier = Modifier
                                .size(64.dp)
                                .clip(RoundedCornerShape(14.dp))
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        CircularProgressIndicator(color = NeonBlue, strokeWidth = 3.dp)
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = "Panel del Servidor",
                            color = TextPrimary,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = scanningMessage,
                            color = TextSecondary,
                            fontSize = 13.sp
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
                        .background(Color(0xFFFEF2F2))
                        .border(1.dp, NeonRed.copy(alpha = 0.4f), RoundedCornerShape(14.dp))
                        .padding(16.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.Lock,
                            contentDescription = null,
                            tint = NeonRed,
                            modifier = Modifier.size(22.dp)
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Acceso desautorizado",
                                color = NeonRed,
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp
                            )
                            Text(
                                text = "Este dispositivo fue desconectado desde el servidor. Conéctate a tu red Wi-Fi de casa y pulsa Reconectar.",
                                color = TextPrimary,
                                fontSize = 12.sp
                            )
                        }
                        Spacer(modifier = Modifier.width(10.dp))
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(NeonRed)
                                .clickable { onRefresh() }
                                .padding(horizontal = 12.dp, vertical = 8.dp)
                        ) {
                            Text(
                                text = "Reconectar",
                                color = Color.White,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }
                }
            }
        }
    }
}
