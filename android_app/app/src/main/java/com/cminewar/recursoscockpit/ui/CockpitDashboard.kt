package com.cminewar.recursoscockpit.ui

import android.annotation.SuppressLint
import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.isSystemInDarkTheme
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.cminewar.recursoscockpit.i18n.I18nDictionary
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
    private val onTriggerRescan: () -> Unit,
    private val isTvProvider: () -> Boolean = { false }
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
    fun isTelevision(): Boolean {
        return isTvProvider()
    }

    @JavascriptInterface
    fun triggerNodeRescan() {
        onTriggerRescan()
    }
}

private fun detectTelevisionMode(context: Context): Boolean {
    val uiModeManager = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
    val isTvMode = uiModeManager?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
    val pm = context.packageManager
    val hasLeanback = pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
    @Suppress("DEPRECATION")
    val hasTelevisionFeature = pm.hasSystemFeature(PackageManager.FEATURE_TELEVISION)
    return isTvMode || hasLeanback || hasTelevisionFeature
}

private fun formatDisplayVersion(): String {
    val raw = BuildConfig.VERSION_NAME
    return "v$raw"
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun CockpitDashboard(
    securePreferences: SecurePreferences,
    connectionMode: ConnectionMode,
    activeUrl: String,
    scanningMessage: String,
    deviceTelemetryProvider: () -> String,
    webViewHeadersProvider: () -> Map<String, String> = { emptyMap() },
    onRefresh: () -> Unit
) {
    val context = LocalContext.current
    val dictRevision = I18nDictionary.catalogRevision
    val isTvDevice = remember(context, dictRevision) { detectTelevisionMode(context) }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    var canGoBack by remember { mutableStateOf(false) }
    var isPageLoading by remember { mutableStateOf(true) }
    var lastLoadedBaseUrl by remember { mutableStateOf("") }
    var lastLoadedToken by remember { mutableStateOf("") }
    var refreshFocused by remember { mutableStateOf(false) }
    var revokedBtnFocused by remember { mutableStateOf(false) }
    val isDark = isSystemInDarkTheme()
    val paletteBg = MaterialTheme.colorScheme.background
    val paletteCard = MaterialTheme.colorScheme.surface
    val paletteBorder = MaterialTheme.colorScheme.outline
    val paletteTextPrimary = MaterialTheme.colorScheme.onSurface
    val paletteTextSecondary = MaterialTheme.colorScheme.onSurfaceVariant

    val infiniteTransition = rememberInfiniteTransition(label = "cockpitPulse")
    val sonarScale by infiniteTransition.animateFloat(
        initialValue = 1.0f,
        targetValue = 2.15f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1600, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "sonarScale"
    )
    val sonarAlpha by infiniteTransition.animateFloat(
        initialValue = 0.55f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1600, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "sonarAlpha"
    )

    BackHandler(enabled = canGoBack) {
        webViewRef?.goBack()
    }

    fun injectNativeContext(webView: WebView?) {
        val wv = webView ?: return
        val tokenEscaped = securePreferences.deviceToken.replace("'", "\\'")
        val telemetryJson = deviceTelemetryProvider().ifBlank { "{}" }
        val tvFlag = if (isTvDevice) "true" else "false"

        val modeFlag = when (connectionMode) {
            ConnectionMode.CONNECTED_WAN -> "WAN"
            ConnectionMode.CONNECTED_LAN -> "LAN"
            else -> "UNKNOWN"
        }
        val activeUrlEscaped = activeUrl.replace("'", "\\'")
        val wanDomainEscaped = securePreferences.wanDomain.replace("'", "\\'")

        val jsPayload = """
            (function() {
                window.__RECURSOS_ANDROID_NATIVE__ = true;
                window.__RECURSOS_ANDROID_TV__ = $tvFlag;
                window.__RECURSOS_NATIVE__ = true;
                window.__RECURSOS_NATIVE_PLATFORM__ = 'android';
                if (document && document.documentElement) {
                    if ($tvFlag) {
                        document.documentElement.setAttribute('data-tv', 'true');
                    } else {
                        document.documentElement.removeAttribute('data-tv');
                    }
                }
                try {
                    window.__RECURSOS_NATIVE_DEVICE_INFO__ = $telemetryJson;
                    window.__RECURSOS_DEVICE_TELEMETRY__ = window.__RECURSOS_NATIVE_DEVICE_INFO__;
                } catch(e) {}
                try {
                    if ('$tokenEscaped') {
                        localStorage.setItem('recursos_device_token', '$tokenEscaped');
                        localStorage.setItem('sysmon_device_token', '$tokenEscaped');
                    }
                    var _prev = {};
                    try { _prev = JSON.parse(localStorage.getItem('recursos_auth_persistence_config') || '{}') || {}; } catch(_) {}
                    var _merged = Object.assign({}, _prev, {
                        token: '$tokenEscaped' || _prev.token || '',
                        wanDomain: '$wanDomainEscaped' || _prev.wanDomain || '',
                        origin: '$activeUrlEscaped' || _prev.origin || '',
                        mode: '$modeFlag',
                        updatedAt: new Date().toISOString()
                    });
                    localStorage.setItem('recursos_auth_persistence_config', JSON.stringify(_merged));
                } catch(e) {}
                if (typeof window.injectNativeSession === 'function') {
                    window.injectNativeSession('$tokenEscaped', window.__RECURSOS_DEVICE_TELEMETRY__);
                }
            })();
        """.trimIndent()

        wv.post {
            wv.evaluateJavascript(jsPayload, null)
        }
    }

    fun syncWebViewAuthCookie(targetUrl: String, wv: WebView? = webViewRef) {
        val token = securePreferences.deviceToken.trim()
        if (targetUrl.isEmpty() || token.isEmpty()) return
        try {
            val cookieManager = CookieManager.getInstance()
            cookieManager.setAcceptCookie(true)
            if (wv != null) {
                cookieManager.setAcceptThirdPartyCookies(wv, true)
            }
            val isHttps = targetUrl.startsWith("https://", ignoreCase = true)
            val secureAttr = if (isHttps) "; Secure" else ""
            cookieManager.setCookie(
                targetUrl,
                "_sysmon_trust=$token; Path=/; Max-Age=31536000; SameSite=Lax$secureAttr"
            )
            cookieManager.flush()
        } catch (_: Exception) {}
    }

    fun reloadWithAuthHeaders(wv: WebView?) {
        val targetWv = wv ?: return
        if (activeUrl.isNotEmpty()) {
            syncWebViewAuthCookie(activeUrl, targetWv)
            lastLoadedBaseUrl = activeUrl
            lastLoadedToken = securePreferences.deviceToken.trim()
            isPageLoading = true
            targetWv.loadUrl(activeUrl, webViewHeadersProvider())
        } else {
            targetWv.reload()
        }
    }

    LaunchedEffect(activeUrl, connectionMode, securePreferences.deviceToken) {
        val wv = webViewRef ?: return@LaunchedEffect
        val currentToken = securePreferences.deviceToken.trim()
        if (activeUrl.isNotEmpty()) {
            syncWebViewAuthCookie(activeUrl, wv)
            val needsReloadWithToken = lastLoadedToken.isEmpty() && currentToken.isNotEmpty()
            if (activeUrl != lastLoadedBaseUrl || needsReloadWithToken) {
                lastLoadedBaseUrl = activeUrl
                lastLoadedToken = currentToken
                isPageLoading = true
                wv.loadUrl(activeUrl, webViewHeadersProvider())
            } else {
                injectNativeContext(wv)
            }
        }
    }

    Scaffold(
        containerColor = paletteBg,
        topBar = {
            Surface(
                color = paletteCard,
                tonalElevation = 0.dp,
                shadowElevation = 2.dp,
                shape = RoundedCornerShape(bottomStart = 18.dp, bottomEnd = 18.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .border(width = 1.dp, color = paletteBorder, shape = RoundedCornerShape(bottomStart = 18.dp, bottomEnd = 18.dp))
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .statusBarsPadding()
                        .padding(
                            horizontal = if (isTvDevice) 28.dp else 14.dp,
                            vertical = if (isTvDevice) 12.dp else 9.dp
                        ),
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
                        }
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier.size(16.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .scale(sonarScale)
                                    .alpha(sonarAlpha)
                                    .clip(CircleShape)
                                    .background(statusColor)
                            )
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(statusColor)
                            )
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = when (connectionMode) {
                                ConnectionMode.CONNECTED_LAN -> I18nDictionary.t(context, "native_android.red_local", "Red local")
                                ConnectionMode.CONNECTED_WAN -> I18nDictionary.t(context, "native_android.wan_secure", "Externa segura")
                                ConnectionMode.REVOKED -> I18nDictionary.t(context, "native_android.access_blocked", "Acceso bloqueado")
                                ConnectionMode.SCANNING_LAN -> I18nDictionary.t(context, "native_android.searching", "Buscando...")
                                ConnectionMode.CONNECTING -> I18nDictionary.t(context, "native_android.connecting", "Conectando...")
                                ConnectionMode.DISCONNECTED -> I18nDictionary.t(context, "native_android.disconnected", "Desconectado")
                                ConnectionMode.ERROR -> I18nDictionary.t(context, "native_android.no_connection", "Sin conexión")
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
                            color = paletteTextSecondary,
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .background(if (isDark) Color(0xFF082F49) else Color(0xFFE0F2FE))
                                .border(1.dp, if (isDark) Color(0xFF0284C7) else Color(0xFF7DD3FC), RoundedCornerShape(10.dp))
                                .padding(horizontal = 8.dp, vertical = 3.dp)
                        ) {
                            Text(
                                text = formatDisplayVersion(),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = if (isDark) Color(0xFF38BDF8) else NeonBlue,
                                fontFamily = FontFamily.Monospace
                            )
                        }

                        IconButton(
                            onClick = {
                                onRefresh()
                                reloadWithAuthHeaders(webViewRef)
                            },
                            modifier = Modifier
                                .size(if (isTvDevice) 38.dp else 34.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .border(
                                    width = if (refreshFocused) 2.dp else 0.dp,
                                    color = if (refreshFocused) (if (isDark) NeonSky else NeonBlue) else Color.Transparent,
                                    shape = RoundedCornerShape(10.dp)
                                )
                                .background(
                                    if (refreshFocused) (if (isDark) NeonSky.copy(alpha = 0.16f) else NeonBlue.copy(alpha = 0.12f))
                                    else Color.Transparent
                                )
                                .onFocusChanged { refreshFocused = it.isFocused }
                                .focusable()
                        ) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = I18nDictionary.t(context, "native_android.reconnect_aria", "Volver a conectar"),
                                tint = if (isDark) NeonSky else NeonBlue,
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
                .background(paletteBg)
        ) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { wvContext ->
                    WebView(wvContext).apply {
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                        isFocusable = true
                        isFocusableInTouchMode = true
                        setBackgroundColor(android.graphics.Color.parseColor(if (isDark) "#0A140B" else "#F5F4F2"))
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
                            if (isTvDevice) {
                                textZoom = 110
                            }
                            val tvSuffix = if (isTvDevice) "; AndroidTV" else ""
                            userAgentString = "$userAgentString RecursosCockpit-Android/${BuildConfig.VERSION_NAME} (NativeHTML; FullAccess$tvSuffix)"
                        }

                        addJavascriptInterface(
                            RecursosAndroidBridge(
                                securePreferences = securePreferences,
                                currentModeProvider = { connectionMode },
                                activeUrlProvider = { activeUrl },
                                deviceTelemetryProvider = deviceTelemetryProvider,
                                onTriggerRescan = onRefresh,
                                isTvProvider = { isTvDevice }
                            ),
                            "RecursosAndroidBridge"
                        )

                        setOnKeyListener { view, keyCode, event ->
                            if (event.action == KeyEvent.ACTION_DOWN) {
                                if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
                                    onRefresh()
                                    reloadWithAuthHeaders(view as? WebView)
                                    return@setOnKeyListener true
                                }
                            }
                            false
                        }

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
                                if (isTvDevice) {
                                    view?.requestFocus()
                                }
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
                            syncWebViewAuthCookie(activeUrl, this)
                            lastLoadedBaseUrl = activeUrl
                            lastLoadedToken = securePreferences.deviceToken.trim()
                            loadUrl(activeUrl, webViewHeadersProvider())
                        }
                    }
                },
                update = { view ->
                    canGoBack = view.canGoBack()
                }
            )

            AnimatedVisibility(
                visible = connectionMode == ConnectionMode.SCANNING_LAN || (isPageLoading && activeUrl.isEmpty()),
                enter = fadeIn(tween(240)) + scaleIn(initialScale = 0.96f, animationSpec = tween(260)),
                exit = fadeOut(tween(220)) + scaleOut(targetScale = 0.97f, animationSpec = tween(220))
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(paletteBg),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier
                            .padding(28.dp)
                            .clip(RoundedCornerShape(18.dp))
                            .background(paletteCard)
                            .border(1.dp, paletteBorder, RoundedCornerShape(18.dp))
                            .padding(horizontal = 32.dp, vertical = 28.dp)
                    ) {
                        Image(
                            painter = painterResource(id = R.drawable.app_logo),
                            contentDescription = "CMineWar",
                            modifier = Modifier.size(104.dp)
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        CircularProgressIndicator(color = if (isDark) NeonSky else NeonBlue, strokeWidth = 3.dp)
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = I18nDictionary.t(context, "native_android.server_panel", "Panel del Servidor"),
                            color = paletteTextPrimary,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = scanningMessage,
                            color = paletteTextSecondary,
                            fontSize = 13.sp
                        )
                    }
                }
            }

            AnimatedVisibility(
                visible = connectionMode == ConnectionMode.REVOKED,
                enter = fadeIn(tween(240)) + slideInVertically(initialOffsetY = { -40 }),
                exit = fadeOut(tween(200)) + slideOutVertically(targetOffsetY = { -40 })
            ) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .fillMaxWidth()
                        .padding(16.dp)
                        .clip(RoundedCornerShape(18.dp))
                        .background(if (isDark) Color(0xFF450A0A) else Color(0xFFFEF2F2))
                        .border(1.dp, NeonRed.copy(alpha = 0.45f), RoundedCornerShape(18.dp))
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
                                text = I18nDictionary.t(context, "native_android.revoked_title", "Acceso desautorizado"),
                                color = NeonRed,
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp
                            )
                            Text(
                                text = I18nDictionary.t(
                                    context,
                                    "native_android.revoked_desc",
                                    "Este dispositivo fue desconectado desde el servidor. Conéctate a tu red Wi-Fi de casa y pulsa Reconectar."
                                ),
                                color = paletteTextPrimary,
                                fontSize = 12.sp
                            )
                        }
                        Spacer(modifier = Modifier.width(10.dp))
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .background(NeonRed)
                                .border(
                                    width = if (revokedBtnFocused) 2.dp else 0.dp,
                                    color = if (revokedBtnFocused) Color.White else Color.Transparent,
                                    shape = RoundedCornerShape(10.dp)
                                )
                                .onFocusChanged { revokedBtnFocused = it.isFocused }
                                .focusable()
                                .clickable { onRefresh() }
                                .padding(horizontal = 12.dp, vertical = 8.dp)
                        ) {
                            Text(
                                text = I18nDictionary.t(context, "native_android.reconnect", "Reconectar"),
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
