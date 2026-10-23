package com.cminewar.recursoscockpit.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cminewar.recursoscockpit.BuildConfig
import com.cminewar.recursoscockpit.data.ConnectionMode
import com.cminewar.recursoscockpit.data.MetricsResponse
import com.cminewar.recursoscockpit.theme.*
import com.cminewar.recursoscockpit.ui.components.*

enum class DashboardTab(val label: String, val icon: String) {
    COCKPIT("Cockpit", "🏠"),
    CPU("CPU", "🧠"),
    RAM("Memoria", "💾"),
    DISKS("Discos", "💿"),
    NET("Red", "🌐"),
    SECURITY("Seguridad", "🛡️"),
    DOCKER("Docker", "🐳"),
    PROCESSES("Procesos", "⚙️")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CockpitDashboard(
    metrics: MetricsResponse?,
    connectionMode: ConnectionMode,
    activeUrl: String,
    onRefresh: () -> Unit,
    onOpenSettings: () -> Unit
) {
    var selectedTab by remember { mutableStateOf(DashboardTab.COCKPIT) }

    Scaffold(
        containerColor = CockpitBg,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = CockpitBg,
                    titleContentColor = TextPrimary
                ),
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(36.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(Color.Black)
                                .border(1.dp, CockpitBorder, RoundedCornerShape(10.dp)),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(text = "🛸", fontSize = 20.sp)
                        }

                        Spacer(modifier = Modifier.width(12.dp))

                        Column {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = "RECURSOS COCKPIT",
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    letterSpacing = 1.sp,
                                    color = TextPrimary
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(NeonCyan.copy(alpha = 0.15f))
                                        .padding(horizontal = 6.dp, vertical = 2.dp)
                                ) {
                                    Text(
                                        text = "v${BuildConfig.VERSION_NAME}",
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = NeonCyan
                                    )
                                }
                            }
                            Text(
                                text = if (activeUrl.isNotEmpty()) activeUrl else "Autodescubriendo nodo...",
                                fontSize = 11.sp,
                                color = TextSecondary,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = onRefresh) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "Actualizar",
                            tint = NeonCyan
                        )
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(
                            imageVector = Icons.Default.Settings,
                            contentDescription = "Ajustes",
                            tint = TextSecondary
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            // Banner de revocación de certificado si el servidor revocó el acceso
            if (connectionMode == ConnectionMode.REVOKED) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(NeonRed.copy(alpha = 0.2f))
                        .border(1.dp, NeonRed, RoundedCornerShape(12.dp))
                        .padding(14.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(text = "🔒", fontSize = 24.sp)
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(
                                text = "ACCESO DENEGADO · CERTIFICADO REVOCADO",
                                color = NeonRed,
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp
                            )
                            Text(
                                text = "El certificado criptográfico de este dispositivo ha sido revocado en el servidor. Para volver a conectarse, enlace nuevamente desde la red Wi-Fi local.",
                                color = TextPrimary,
                                fontSize = 12.sp
                            )
                        }
                    }
                }
            }

            // Barra de pestañas responsiva con paridad total con el servidor (Apple Liquid Glass)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                DashboardTab.values().forEach { tab ->
                    val isSelected = selectedTab == tab
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (isSelected) NeonCyan.copy(alpha = 0.2f) else CockpitCard)
                            .border(
                                1.dp,
                                if (isSelected) NeonCyan else CockpitBorder,
                                RoundedCornerShape(10.dp)
                            )
                            .clickable { selectedTab = tab }
                            .padding(horizontal = 14.dp, vertical = 8.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(text = tab.icon, fontSize = 14.sp)
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = tab.label,
                                color = if (isSelected) NeonCyan else TextSecondary,
                                fontSize = 13.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium
                            )
                        }
                    }
                }
            }

            // Contenido dinámico según la pestaña activa
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 340.dp),
                contentPadding = PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                when (selectedTab) {
                    DashboardTab.COCKPIT -> {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            SystemCard(system = metrics?.system, security = metrics?.security, mode = connectionMode)
                        }
                        item { CpuCard(cpu = metrics?.cpu) }
                        item { MemoryCard(ram = metrics?.ram) }
                        item { StorageCard(disks = metrics?.disks) }
                        item { NetworkCard(net = metrics?.net) }
                        item { SecurityCard(securityData = metrics?.security) }
                        item { DockerCard(dockerActivities = metrics?.dockerActivities) }
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            ProcessesCard(processes = metrics?.systemProcesses)
                        }
                    }

                    DashboardTab.CPU -> {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            CpuCard(cpu = metrics?.cpu)
                        }
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            SystemCard(system = metrics?.system, security = metrics?.security, mode = connectionMode)
                        }
                    }

                    DashboardTab.RAM -> {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            MemoryCard(ram = metrics?.ram)
                        }
                    }

                    DashboardTab.DISKS -> {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            StorageCard(disks = metrics?.disks)
                        }
                    }

                    DashboardTab.NET -> {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            NetworkCard(net = metrics?.net)
                        }
                    }

                    DashboardTab.SECURITY -> {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            SecurityCard(securityData = metrics?.security)
                        }
                    }

                    DashboardTab.DOCKER -> {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            DockerCard(dockerActivities = metrics?.dockerActivities)
                        }
                    }

                    DashboardTab.PROCESSES -> {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            ProcessesCard(processes = metrics?.systemProcesses)
                        }
                    }
                }
            }
        }
    }
}
