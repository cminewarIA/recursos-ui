package com.cminewar.recursoscockpit.ui

import android.annotation.SuppressLint
import android.app.UiModeManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.Uri
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
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import com.cminewar.recursoscockpit.BuildConfig
import com.cminewar.recursoscockpit.R
import com.cminewar.recursoscockpit.data.ConnectionMode
import com.cminewar.recursoscockpit.data.DiscoveredServerNode
import com.cminewar.recursoscockpit.data.GithubAndroidReleaseInfo
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
    fun onThemePaletteChanged(theme: String, themeId: String, canvasHex: String, accentHex: String) {
        onThemeChanged(theme)
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
    serverVersion: String = "",
    githubAndroidRelease: GithubAndroidReleaseInfo? = null,
    apkUpdateProgress: Int? = null,
    apkUpdateStatus: String = "",
    showServerDiscoverer: Boolean = false,
    isDiscoveringServers: Boolean = false,
    discoveredServers: List<DiscoveredServerNode> = emptyList(),
    discovererError: String = "",
    masterPasswordPromptUrl: String = "",
    masterPasswordError: String = "",
    isUnlockingMasterPassword: Boolean = false,
    onSubmitMasterPassword: (String, String) -> Unit = { _, _ -> },
    onDismissMasterPasswordPrompt: () -> Unit = {},
    onRequestMasterPasswordUnlock: () -> Unit = {},
    onSelectDiscoveredServer: (String) -> Unit = {},
    onRescanLocalServers: () -> Unit = {},
    onTriggerApkUpdate: (GithubAndroidReleaseInfo) -> Unit = {},
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
    var updateBtnFocused by remember { mutableStateOf(false) }
    var manualHostInput by remember { mutableStateOf(securePreferences.savedHost) }
    var masterPasswordInput by remember(masterPasswordPromptUrl) { mutableStateOf("") }
    var masterPasswordVisible by remember(masterPasswordPromptUrl) { mutableStateOf(false) }
    val availableApkUpdateVersion = if (githubAndroidRelease?.updateAvailable == true) githubAndroidRelease.latestVersion else ""
    var updateBannerDismissed by remember(availableApkUpdateVersion) { mutableStateOf(false) }

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
        try {
            targetWv.clearCache(true)
        } catch (_: Exception) {}
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

    LaunchedEffect(activeUrl, connectionMode, masterPasswordPromptUrl, securePreferences.deviceToken) {
        val wv = webViewRef ?: return@LaunchedEffect
        val currentToken = securePreferences.deviceToken.trim()
        val isCertifiedConnected =
            masterPasswordPromptUrl.isBlank() &&
                (connectionMode == ConnectionMode.CONNECTED_LAN || connectionMode == ConnectionMode.CONNECTED_WAN)
        if (activeUrl.isNotEmpty() && isCertifiedConnected) {
            syncWebViewAuthCookie(activeUrl, wv)
            val needsReloadWithToken = currentToken.isNotEmpty() && currentToken != lastLoadedToken
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

    // Invalidar caché de WebView automáticamente cuando el servidor cambia de versión
    LaunchedEffect(serverVersion, activeUrl) {
        val wv = webViewRef ?: return@LaunchedEffect
        if (serverVersion.isNotBlank() && serverVersion != securePreferences.lastServerVersion) {
            val hadPrevious = securePreferences.lastServerVersion.isNotBlank()
            securePreferences.lastServerVersion = serverVersion
            try {
                wv.clearCache(true)
            } catch (_: Exception) {}
            if (hadPrevious && activeUrl.isNotEmpty() && masterPasswordPromptUrl.isBlank()) {
                reloadWithAuthHeaders(wv)
            }
        }
    }

    val isMasterPromptVisible = masterPasswordPromptUrl.isNotBlank()
    val isSearching = isDiscoveringServers || isUnlockingMasterPassword || connectionMode == ConnectionMode.SCANNING_LAN || connectionMode == ConnectionMode.CONNECTING
    val isOfflineFallback =
        (connectionMode == ConnectionMode.DISCONNECTED || connectionMode == ConnectionMode.ERROR) && activeUrl.isEmpty()
    val showConnectionOverlay = isMasterPromptVisible || showServerDiscoverer || isSearching || isOfflineFallback || (isPageLoading && activeUrl.isEmpty())

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
                        cacheMode = WebSettings.LOAD_NO_CACHE
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

                    setDownloadListener { downloadUrl, _, _, _, _ ->
                        if (!downloadUrl.isNullOrBlank()) {
                            try {
                                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl)).apply {
                                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                }
                                context.startActivity(intent)
                            } catch (_: Exception) {}
                        }
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
            val dotColor = when {
                isMasterPromptVisible -> warnColor
                isOfflineFallback -> dangerColor
                isSearching -> warnColor
                else -> okColor
            }
            val statusLabel = when {
                isMasterPromptVisible -> I18nDictionary.t(context, "native_android.master_pwd_badge", "Certificación requerida")
                connectionMode == ConnectionMode.SCANNING_LAN -> I18nDictionary.t(context, "native_android.searching", "Buscando...")
                connectionMode == ConnectionMode.CONNECTING -> I18nDictionary.t(context, "native_android.connecting", "Conectando...")
                connectionMode == ConnectionMode.DISCONNECTED -> I18nDictionary.t(context, "native_android.disconnected", "Desconectado")
                connectionMode == ConnectionMode.ERROR -> I18nDictionary.t(context, "native_android.no_connection", "Sin conexión")
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
                        text = when {
                            isMasterPromptVisible -> I18nDictionary.t(
                                context,
                                "native_android.master_pwd_title",
                                "Certificar dispositivo"
                            )
                            showServerDiscoverer -> I18nDictionary.t(
                                context,
                                "native_android.discoverer_title",
                                "Buscador de servidores locales"
                            )
                            else -> I18nDictionary.t(
                                context,
                                "native_android.server_panel",
                                "Panel del Servidor"
                            )
                        },
                        color = paletteTextPrimary,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = when {
                            isMasterPromptVisible -> masterPasswordError.ifBlank {
                                I18nDictionary.t(
                                    context,
                                    "native_android.master_pwd_desc",
                                    "Este dispositivo aún no está certificado. Introduce la contraseña maestra del servidor para emitir su certificado único."
                                )
                            }
                            else -> discovererError.ifBlank { scanningMessage }
                        },
                        color = when {
                            isMasterPromptVisible && masterPasswordError.isNotBlank() -> dangerColor
                            !isMasterPromptVisible && discovererError.isNotBlank() -> dangerColor
                            else -> paletteTextSecondary
                        },
                        fontSize = 13.sp,
                        textAlign = TextAlign.Center,
                        lineHeight = 19.sp
                    )

                    if (isMasterPromptVisible) {
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(paletteSubtle)
                                .border(1.dp, paletteBorder, RoundedCornerShape(12.dp))
                                .padding(horizontal = 12.dp, vertical = 9.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Key,
                                contentDescription = null,
                                tint = accentPrimary,
                                modifier = Modifier.size(16.dp)
                            )
                            Text(
                                text = masterPasswordPromptUrl
                                    .removePrefix("https://")
                                    .removePrefix("http://"),
                                color = paletteTextPrimary,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                        Spacer(modifier = Modifier.height(12.dp))
                        OutlinedTextField(
                            value = masterPasswordInput,
                            onValueChange = { masterPasswordInput = it },
                            singleLine = true,
                            enabled = !isUnlockingMasterPassword,
                            label = {
                                Text(
                                    text = I18nDictionary.t(
                                        context,
                                        "native_android.master_pwd_label",
                                        "Contraseña maestra"
                                    ),
                                    fontSize = 11.sp
                                )
                            },
                            visualTransformation = if (masterPasswordVisible) {
                                VisualTransformation.None
                            } else {
                                PasswordVisualTransformation()
                            },
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Password,
                                imeAction = ImeAction.Done
                            ),
                            keyboardActions = KeyboardActions(
                                onDone = {
                                    if (masterPasswordInput.isNotBlank() && !isUnlockingMasterPassword) {
                                        onSubmitMasterPassword(masterPasswordPromptUrl, masterPasswordInput)
                                    }
                                }
                            ),
                            trailingIcon = {
                                IconButton(onClick = { masterPasswordVisible = !masterPasswordVisible }) {
                                    Icon(
                                        imageVector = if (masterPasswordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                        contentDescription = null,
                                        tint = paletteTextSecondary
                                    )
                                }
                            },
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.Center,
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(paletteSubtle)
                                    .border(1.dp, paletteBorder, RoundedCornerShape(12.dp))
                                    .focusable()
                                    .clickable(enabled = !isUnlockingMasterPassword) {
                                        masterPasswordInput = ""
                                        onDismissMasterPasswordPrompt()
                                    }
                                    .padding(horizontal = 12.dp, vertical = 10.dp)
                            ) {
                                Text(
                                    text = I18nDictionary.t(context, "native_android.back_btn", "Volver"),
                                    color = paletteTextPrimary,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.Center,
                                modifier = Modifier
                                    .weight(1.4f)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(if (isDarkTheme) AlethiaLime else AlethiaObsidian)
                                    .border(
                                        width = if (retryBtnFocused) 2.dp else 1.dp,
                                        color = if (retryBtnFocused) accentPrimary else paletteBorder,
                                        shape = RoundedCornerShape(12.dp)
                                    )
                                    .onFocusChanged { retryBtnFocused = it.isFocused }
                                    .focusable()
                                    .clickable(enabled = !isUnlockingMasterPassword && masterPasswordInput.isNotBlank()) {
                                        onSubmitMasterPassword(masterPasswordPromptUrl, masterPasswordInput)
                                    }
                                    .padding(horizontal = 12.dp, vertical = 10.dp)
                            ) {
                                Text(
                                    text = if (isUnlockingMasterPassword) {
                                        I18nDictionary.t(context, "native_android.master_pwd_verifying", "Verificando...")
                                    } else {
                                        I18nDictionary.t(context, "native_android.master_pwd_btn", "Autorizar")
                                    },
                                    color = if (isDarkTheme) AlethiaObsidian else AlethiaLime,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    } else if (showServerDiscoverer) {
                        Spacer(modifier = Modifier.height(14.dp))
                        Column(
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(max = 210.dp)
                                .verticalScroll(rememberScrollState())
                        ) {
                            discoveredServers.forEach { node ->
                                var itemFocused by remember(node.url) { mutableStateOf(false) }
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(14.dp))
                                        .background(paletteSubtle)
                                        .border(
                                            width = if (itemFocused) 2.dp else 1.dp,
                                            color = if (itemFocused) accentPrimary else paletteBorder,
                                            shape = RoundedCornerShape(14.dp)
                                        )
                                        .onFocusChanged { itemFocused = it.isFocused }
                                        .focusable()
                                        .clickable { onSelectDiscoveredServer(node.url) }
                                        .padding(horizontal = 12.dp, vertical = 10.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Dns,
                                        contentDescription = null,
                                        tint = accentPrimary,
                                        modifier = Modifier.size(18.dp)
                                    )
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = "${node.host}:${node.port}",
                                            color = paletteTextPrimary,
                                            fontSize = 13.sp,
                                            fontWeight = FontWeight.Bold,
                                            fontFamily = FontFamily.Monospace
                                        )
                                        if (node.serverVersion.isNotBlank()) {
                                            Text(
                                                text = "Recursos v${node.serverVersion}",
                                                color = paletteTextSecondary,
                                                fontSize = 11.sp
                                            )
                                        }
                                    }
                                    Text(
                                        text = I18nDictionary.t(context, "native_android.pair_btn", "Emparejar"),
                                        color = accentPrimary,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(12.dp))
                        OutlinedTextField(
                            value = manualHostInput,
                            onValueChange = { manualHostInput = it },
                            singleLine = true,
                            label = {
                                Text(
                                    text = I18nDictionary.t(context, "native_android.manual_ip_label", "IP o dominio del servidor"),
                                    fontSize = 11.sp
                                )
                            },
                            placeholder = { Text("192.168.1.50:8085", fontSize = 12.sp) },
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(modifier = Modifier.height(10.dp))
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.Center,
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(paletteSubtle)
                                    .border(1.dp, paletteBorder, RoundedCornerShape(12.dp))
                                    .focusable()
                                    .clickable { onRescanLocalServers() }
                                    .padding(horizontal = 12.dp, vertical = 10.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Search,
                                    contentDescription = null,
                                    tint = paletteTextPrimary,
                                    modifier = Modifier.size(15.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = I18nDictionary.t(context, "native_android.rescan_btn", "Buscar"),
                                    color = paletteTextPrimary,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.Center,
                                modifier = Modifier
                                    .weight(1f)
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
                                        if (manualHostInput.isNotBlank()) {
                                            onSelectDiscoveredServer(manualHostInput)
                                        } else {
                                            onRescanLocalServers()
                                        }
                                    }
                                    .padding(horizontal = 12.dp, vertical = 10.dp)
                            ) {
                                Text(
                                    text = I18nDictionary.t(context, "native_android.connect_btn", "Conectar"),
                                    color = if (isDarkTheme) AlethiaObsidian else AlethiaLime,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    } else if (isOfflineFallback) {
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
            visible = connectionMode == ConnectionMode.REVOKED && !isMasterPromptVisible,
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
                                "Este dispositivo requiere certificación. Conéctate a tu Wi-Fi o usa la contraseña maestra."
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
                            .clickable { onRequestMasterPasswordUnlock() }
                            .padding(horizontal = 12.dp, vertical = 8.dp)
                    ) {
                        Text(
                            text = I18nDictionary.t(context, "native_android.master_pwd_btn", "Autorizar"),
                            color = Color.White,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }
            }
        }

        // Aviso discreto Alethia cuando existe una APK más reciente en GitHub frente a la instalada (1.1.1)
        val pendingRelease = githubAndroidRelease
        AnimatedVisibility(
            visible = pendingRelease != null &&
                pendingRelease.updateAvailable &&
                !updateBannerDismissed &&
                !showConnectionOverlay &&
                connectionMode != ConnectionMode.REVOKED,
            enter = fadeIn(tween(240)) + slideInVertically(initialOffsetY = { 48 }),
            exit = fadeOut(tween(200)) + slideOutVertically(targetOffsetY = { 48 })
        ) {
            if (pendingRelease != null) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 12.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(paletteCard)
                        .border(1.dp, accentPillBorder, RoundedCornerShape(16.dp))
                        .padding(horizontal = 14.dp, vertical = 10.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Download,
                            contentDescription = null,
                            tint = accentPrimary,
                            modifier = Modifier.size(18.dp)
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = apkUpdateStatus.ifBlank {
                                    I18nDictionary.t(
                                        context,
                                        "native_android.apk_update_title",
                                        "Nueva app Android disponible en GitHub"
                                    )
                                },
                                color = paletteTextPrimary,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = if (apkUpdateProgress != null) {
                                    "${formatDisplayVersion()} → v${pendingRelease.latestVersion} · $apkUpdateProgress%"
                                } else {
                                    "${formatDisplayVersion()} → v${pendingRelease.latestVersion}"
                                },
                                color = paletteTextSecondary,
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .background(if (isDarkTheme) AlethiaLime else AlethiaObsidian)
                                .border(
                                    width = if (updateBtnFocused) 2.dp else 1.dp,
                                    color = if (updateBtnFocused) accentPrimary else Color.Transparent,
                                    shape = RoundedCornerShape(10.dp)
                                )
                                .onFocusChanged { updateBtnFocused = it.isFocused }
                                .focusable()
                                .clickable(enabled = apkUpdateProgress == null) {
                                    onTriggerApkUpdate(pendingRelease)
                                }
                                .padding(horizontal = 12.dp, vertical = 7.dp)
                        ) {
                            Text(
                                text = if (apkUpdateProgress != null) {
                                    "$apkUpdateProgress%"
                                } else {
                                    I18nDictionary.t(context, "native_android.apk_update_action", "Descargar")
                                },
                                color = if (isDarkTheme) AlethiaObsidian else AlethiaLime,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = null,
                            tint = paletteTextSecondary,
                            modifier = Modifier
                                .size(18.dp)
                                .clickable { updateBannerDismissed = true }
                        )
                    }
                }
            }
        }
    }
}
