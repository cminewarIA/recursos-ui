package com.cminewar.recursoscockpit.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.DeveloperBoard
import androidx.compose.material.icons.filled.FormatListBulleted
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.Widgets
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cminewar.recursoscockpit.theme.CockpitBorder
import com.cminewar.recursoscockpit.theme.CockpitDockBg
import com.cminewar.recursoscockpit.theme.NeonCyan
import com.cminewar.recursoscockpit.theme.TextMuted
import com.cminewar.recursoscockpit.theme.TextPrimary

enum class CockpitTab(val id: String, val title: String, val icon: ImageVector) {
    OVERVIEW("overview", "Cabina", Icons.Default.Dashboard),
    CPU("processor", "CPU", Icons.Default.Memory),
    MEMORY("memory", "RAM", Icons.Default.DeveloperBoard),
    GPU("gpu", "GPU", Icons.Default.Speed),
    DRIVES("drives", "Discos", Icons.Default.Storage),
    NETWORK("network", "Red", Icons.Default.Wifi),
    DOCKER("apps", "Docker", Icons.Default.Widgets),
    SECURITY("security", "Escudo", Icons.Default.Shield),
    PROCESSES("processes", "Procesos", Icons.Default.FormatListBulleted)
}

@Composable
fun FloatingTouchDock(
    selectedTab: CockpitTab,
    onTabSelected: (CockpitTab) -> Unit,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(bottom = 12.dp, start = 16.dp, end = 16.dp),
        contentAlignment = Alignment.BottomCenter
    ) {
        Surface(
            shape = RoundedCornerShape(26.dp),
            color = CockpitDockBg,
            border = androidx.compose.foundation.BorderStroke(1.dp, CockpitBorder),
            shadowElevation = 18.dp,
            modifier = Modifier.widthIn(max = 840.dp)
        ) {
            Row(
                modifier = Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                CockpitTab.values().forEach { tab ->
                    val isSelected = tab == selectedTab
                    DockItem(
                        tab = tab,
                        isSelected = isSelected,
                        onClick = { onTabSelected(tab) }
                    )
                }
            }
        }
    }
}

@Composable
private fun DockItem(
    tab: CockpitTab,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    val interactionSource = remember { MutableInteractionSource() }
    val contentColor = if (isSelected) NeonCyan else TextMuted

    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(16.dp))
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick
            )
            .padding(horizontal = 14.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = tab.icon,
            contentDescription = tab.title,
            tint = contentColor,
            modifier = Modifier.size(20.dp)
        )
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            text = tab.title,
            color = if (isSelected) TextPrimary else TextMuted,
            fontSize = 11.sp,
            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium
        )
        Spacer(modifier = Modifier.height(2.dp))
        Box(
            modifier = Modifier
                .size(4.dp)
                .clip(CircleShape)
                .background(if (isSelected) NeonCyan else Color.Transparent)
        )
    }
}
