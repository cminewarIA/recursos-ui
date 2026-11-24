package com.cminewar.recursoscockpit.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val LightColorScheme = lightColorScheme(
    primary = AlethiaForest,
    secondary = StatusOkLight,
    tertiary = AlethiaLime,
    background = CockpitBgLight,
    surface = CockpitCardLight,
    surfaceVariant = CockpitCardElevatedLight,
    outline = CockpitBorderLight,
    onPrimary = Color.White,
    onSecondary = Color.White,
    onTertiary = AlethiaObsidian,
    onBackground = TextPrimaryLight,
    onSurface = TextPrimaryLight,
    onSurfaceVariant = TextSecondaryLight
)

private val DarkColorScheme = darkColorScheme(
    primary = AlethiaLime,
    secondary = StatusOkDark,
    tertiary = AlethiaForest,
    background = CockpitBgDark,
    surface = CockpitCardDark,
    surfaceVariant = CockpitCardElevatedDark,
    outline = CockpitBorderDark,
    onPrimary = AlethiaObsidian,
    onSecondary = AlethiaObsidian,
    onTertiary = TextPrimaryDark,
    onBackground = TextPrimaryDark,
    onSurface = TextPrimaryDark,
    onSurfaceVariant = TextSecondaryDark
)

@Composable
fun RecursosCockpitTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window
            if (window != null) {
                val barColor = colorScheme.background.toArgb()
                window.statusBarColor = barColor
                window.navigationBarColor = barColor
                val controller = WindowCompat.getInsetsController(window, view)
                controller.isAppearanceLightStatusBars = !darkTheme
                controller.isAppearanceLightNavigationBars = !darkTheme
            }
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        content = content
    )
}
