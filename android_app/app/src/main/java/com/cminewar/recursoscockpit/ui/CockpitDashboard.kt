package com.cminewar.recursoscockpit.ui

import android.annotation.SuppressLint
import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.cminewar.recursoscockpit.BuildConfig
import com.cminewar.recursoscockpit.R
import com.cminewar.recursoscockpit.data.ConnectionMode
import com.cminewar.recursoscockpit.data.SecurePreferences
import com.cminewar.recursoscockpit.i18n.I18nDictionary
import com.cminewar.recursoscockpit.theme.*

/**
 * Puente Nativo JavascriptInterface (Android OS <-> Interfaz Web Canónica Unificada)
 * Sincroniza almacenamiento cifrado, descubrimiento automático LAN/WAN y tema claro/oscuro
 * en tiempo real para mantener una única estética Alethia × Zeus Vision sin marcos duplicados.
 */
class RecursosAndroidBridge(
    private val securePreferences: SecurePreferences,
    private val currentModeProvider: () -> ConnectionMode,
    private val activeUrlProvider: () -> String,
    private val deviceTelemetryProvider: () -> String,
    private val preferredThemeProvider: () -> String,
    private val onThemeChangedCallback: (String) -> Unit,
    private val onTriggerRescan: () -> Unit,
    private val isTvProvider: () -> Boolean = { false }
) {
    private val mainHandler = Handler(Looper.getMainLooper())

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
    fun onThemeChanged(theme: String) {
        val normalized = theme.trim().lowercase()
        if (normalized == "dark" || normalized == "light") {
            mainHandler.post {
                onThemeChangedCallback(normalized)
            }
        }
    }

    @JavascriptInterface
    fun getPreferredTheme(): String {
        return preferredThemeProvider()
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
        mainHandler.post {
            onTriggerRescan()
        }
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
    isDarkTheme: Boolean,
    onThemeChanged: (String) -> Unit,
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
    var retryBtnFocused by remember { mutableStateOf(false) }
    var revokedBtnFocused by remember { mutableStateOf(false) }

    val latestMode by rememberUpdatedState(connectionMode)
    val latestUrl by rememberUpdatedState(activeUrl)
    val latestIsDark by rememberUpdatedState(isDarkTheme)
    val latestOnThemeChanged by rememberUpdatedState(onThemeChanged)
    val latestOnRefresh by rememberUpdatedState(onRefresh)

    // Alethia × Zeus Vision tokens synced 1:1 with src/index.css
    val paletteBg = MaterialTheme.colorScheme.background
    val paletteCard = MaterialTheme.colorScheme.surface
    val paletteSubtle = MaterialTheme.colorScheme.surfaceVariant
    val paletteBorder = MaterialTheme.colorScheme.outline
    val paletteTextPrimary = MaterialTheme.colorScheme.onSurface
    val paletteTextSecondary = MaterialTheme.colorScheme.onSurfaceVariant
    val accentPrimary = if (isDarkTheme) AlethiaLime else AlethiaForest
    val accentPillBg = if (isDarkTheme) CockpitCardElevatedDark else AlethiaLimeSoft
    val accentPillBorder = if (isDarkTheme) CockpitBorderStrongDark else AlethiaLimeBorder
    val accentPillText = if (isDarkTheme) AlethiaLime else AlethiaForestInk
    val dangerColor = if (isDarkTheme) StatusDangerDark else StatusDangerLight
    val dangerSurface = if (isDarkTheme) StatusDangerSurfaceDark else StatusDangerSurfaceLight
    val warnColor = if (isDarkTheme) StatusWarnDark else StatusWarnLight
    val okColor = if (isDarkTheme) StatusOkDark else StatusOkLight

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
        val themeStr = if (latestIsDark) "dark" else "light"

        val modeFlag = when (latestMode) {
            ConnectionMode.CONNECTED_WAN -> "WAN"
            ConnectionMode.CONNECTED_LAN -> "LAN"
            else -> "UNKNOWN"
        }
        val activeUrlEscaped = latestUrl.replace("'", "\\'")
        val wanDomainEscaped = securePreferences.wanDomain.replace("'", "\\'")

        val jsPayload = """
            (function() {
                window.__RECURSOS_ANDROID_NATIVE__ = true;
                window.__RECURSOS_ANDROID_TV__ = $tvFlag;
                window.__RECURSOS_NATIVE__ = true;
                window.__RECURSOS_NATIVE_PLATFORM__ = 'android';
                window.__RECURSOS_CONN_MODE__ = '$modeFlag';
                window.__RECURSOS_NODE_URL__ = '$activeUrlEscaped';
                window.__RECURSOS_INITIAL_THEME__ = '$themeStr';
                if (document && document.documentElement) {
                    if ($tvFlag) {
                        document.documentElement.setAttribute('data-tv', 'true');
                    } else {
                        document.documentElement.removeAttribute('data-tv');
                    }
                    try {
                        var currentTheme = localStorage.getItem('recursos_theme');
                        if ((currentTheme === 'dark' || currentTheme === 'light') && window.RecursosAndroidBridge && window.RecursosAndroidBridge.onThemeChanged) {
                            window.RecursosAndroidBridge.onThemeChanged(currentTheme);
                        }
                    } catch(e) {}
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

    val isSearching = connectionMode == ConnectionMode.SCANNING_LAN || connectionMode == ConnectionMode.CONNECTING
    val isOfflineFallback =
        (connectionMode == ConnectionMode.DISCONNECTED || connectionMode == ConnectionMode.ERROR) && activeUrl.isEmpty()
    val showConnectionOverlay = isSearching || isOfflineFallback || (isPageLoading && activeUrl.isEmpty())

    // Interfaz única de borde a borde: sin cabecera nativa duplicada compitiendo con la barra web Alethia
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(paletteBg)
            .systemBarsPadding()
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
                    setBackgroundColor(android.graphics.Color.parseColor(if (isDarkTheme) "#0A140B" else "#F5F4F2"))
                    setLayerType(View.LAYER_TYPE_HARDWARE, null)

                    settings.apply {
                        javaScriptEnabled = true
                        javaScriptCanOpenWindowsAutomatically = true
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
                        val cleanBaseUa = userAgentString.replace("; wv", "").replace("Version/4.0 ", "")
                        userAgentString = "$cleanBaseUa RecursosCockpit-Android/${BuildConfig.VERSION_NAME} (NativeHTML; FullAccess$tvSuffix)"
                    }

                    addJavascriptInterface(
                        RecursosAndroidBridge(
                            securePreferences = securePreferences,
                            currentModeProvider = { latestMode },
                            activeUrlProvider = { latestUrl },
                            deviceTelemetryProvider = deviceTelemetryProvider,
                            preferredThemeProvider = { if (latestIsDark) "dark" else "light" },
                            onThemeChangedCallback = { nextTheme -> latestOnThemeChanged(nextTheme) },
                            onTriggerRescan = { latestOnRefresh() },
                            isTvProvider = { isTvDevice }
                        ),
                        "RecursosAndroidBridge"
                    )

                    setOnKeyListener { view, keyCode, event ->
                        if (event.action == KeyEvent.ACTION_DOWN) {
                            if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
                                latestOnRefresh()
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
                view.setBackgroundColor(android.graphics.Color.parseColor(if (isDarkTheme) "#0A140B" else "#F5F4F2"))
                canGoBack = view.canGoBack()
            }
        )

        // Pantalla auxiliar Alethia solo durante descubrimiento inicial o sin conexión al servidor
        AnimatedVisibility(
            visible = showConnectionOverlay,
            enter = fadeIn(tween(240)) + scaleIn(initialScale = 0.96f, animationSpec = tween(260)),
            exit = fadeOut(tween(220)) + scaleOut(targetScale = 0.97f, animationSpec = tween(220))
        ) {
            val dotColor = if (isOfflineFallback) dangerColor else if (isSearching) warnColor else okColor
            val statusLabel = when (connectionMode) {
                ConnectionMode.SCANNING_LAN -> I18nDictionary.t(context, "native_android.searching", "Buscando...")
                ConnectionMode.CONNECTING -> I18nDictionary.t(context, "native_android.connecting", "Conectando...")
                ConnectionMode.DISCONNECTED -> I18nDictionary.t(context, "native_android.disconnected", "Desconectado")
                ConnectionMode.ERROR -> I18nDictionary.t(context, "native_android.no_connection", "Sin conexión")
                else -> I18nDictionary.t(context, "native_android.connecting", "Conectando...")
            }

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(paletteBg),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier
                        .widthIn(max = 420.dp)
                        .padding(24.dp)
                        .clip(RoundedCornerShape(22.dp))
                        .background(paletteCard)
                        .border(1.dp, paletteBorder, RoundedCornerShape(22.dp))
                        .padding(horizontal = 30.dp, vertical = 28.dp)
                ) {
                    Image(
                        painter = painterResource(id = R.drawable.app_logo),
                        contentDescription = I18nDictionary.t(context, "app.brand", "Recursos"),
                        modifier = Modifier.size(92.dp)
                    )
                    Spacer(modifier = Modifier.height(14.dp))

                    // Píldora de estado y versión en estética Alethia exacta
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(accentPillBg)
                            .border(1.dp, accentPillBorder, RoundedCornerShape(999.dp))
                            .padding(horizontal = 12.dp, vertical = 5.dp)
                    ) {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier.size(12.dp)
                        ) {
                            if (isSearching) {
                                Box(
                                    modifier = Modifier
                                        .size(7.dp)
                                        .scale(sonarScale)
                                        .alpha(sonarAlpha)
                                        .clip(CircleShape)
                                        .background(dotColor)
                                )
                            }
                            Box(
                                modifier = Modifier
                                    .size(7.dp)
                                    .clip(CircleShape)
                                    .background(dotColor)
                            )
                        }
                        Text(
                            text = statusLabel,
                            color = accentPillText,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "· ${formatDisplayVersion()}",
                            color = accentPillText.copy(alpha = 0.85f),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = FontFamily.Monospace
                        )
                    }

                    Spacer(modifier = Modifier.height(16.dp))
                    if (isSearching) {
                        CircularProgressIndicator(
                            color = accentPrimary,
                            trackColor = paletteSubtle,
                            strokeWidth = 3.dp,
                            modifier = Modifier.size(34.dp)
                        )
                        Spacer(modifier = Modifier.height(14.dp))
                    }

                    Text(
                        text = I18nDictionary.t(context, "native_android.server_panel", "Panel del Servidor"),
                        color = paletteTextPrimary,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = scanningMessage,
                        color = paletteTextSecondary,
                        fontSize = 13.sp,
                        textAlign = TextAlign.Center,
                        lineHeight = 19.sp
                    )

                    if (isOfflineFallback) {
                        Spacer(modifier = Modifier.height(18.dp))
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier
                                .clip(RoundedCornerShape(12.dp))
                                .background(if (isDarkTheme) AlethiaLime else AlethiaObsidian)
                                .border(
                                    width = if (retryBtnFocused) 2.dp else 1.dp,
                                    color = if (retryBtnFocused) accentPrimary else paletteBorder,
                                    shape = RoundedCornerShape(12.dp)
                                )
                                .onFocusChanged { retryBtnFocused = it.isFocused }
                                .focusable()
                                .clickable {
                                    onRefresh()
                                    reloadWithAuthHeaders(webViewRef)
                                }
                                .padding(horizontal = 18.dp, vertical = 10.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = null,
                                tint = if (isDarkTheme) AlethiaObsidian else AlethiaLime,
                                modifier = Modifier.size(16.dp)
                            )
                            Text(
                                text = I18nDictionary.t(context, "native_android.reconnect", "Reconectar"),
                                color = if (isDarkTheme) AlethiaObsidian else AlethiaLime,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }
        }

        // Aviso flotante de acceso revocado en estética Alethia semántica
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
                    .background(dangerSurface)
                    .border(1.dp, dangerColor.copy(alpha = 0.45f), RoundedCornerShape(18.dp))
                    .padding(16.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.Lock,
                        contentDescription = null,
                        tint = dangerColor,
                        modifier = Modifier.size(22.dp)
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = I18nDictionary.t(context, "native_android.revoked_title", "Acceso desautorizado"),
                            color = dangerColor,
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
                            .background(dangerColor)
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
