package com.cminewar.recursoscockpit.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColorScheme = lightColorScheme(
    primary = NeonBlue,
    secondary = NeonGreen,
    tertiary = NeonPurple,
    background = CockpitBgLight,
    surface = CockpitCardLight,
    surfaceVariant = CockpitCardElevatedLight,
    outline = CockpitBorderLight,
    onPrimary = Color.White,
    onSecondary = Color.White,
    onTertiary = Color.White,
    onBackground = TextPrimary,
    onSurface = TextPrimary,
    onSurfaceVariant = TextSecondary
)

private val DarkColorScheme = darkColorScheme(
    primary = NeonSky,
    secondary = NeonGreen,
    tertiary = NeonPurple,
    background = CockpitBgDark,
    surface = CockpitCardDark,
    surfaceVariant = CockpitCardElevatedDark,
    outline = CockpitBorderDark,
    onPrimary = Color(0xFF020617),
    onSecondary = Color(0xFF020617),
    onTertiary = Color.White,
    onBackground = TextPrimaryDark,
    onSurface = TextPrimaryDark,
    onSurfaceVariant = TextSecondaryDark
)

@Composable
fun RecursosCockpitTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme,
        content = content
    )
}
