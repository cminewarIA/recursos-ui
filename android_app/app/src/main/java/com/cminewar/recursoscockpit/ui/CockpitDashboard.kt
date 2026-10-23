package com.cminewar.recursoscockpit.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
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
import com.cminewar.recursoscockpit.data.ConnectionMode
import com.cminewar.recursoscockpit.data.MetricsResponse
import com.cminewar.recursoscockpit.theme.*
import com.cminewar.recursoscockpit.ui.components.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CockpitDashboard(
    metrics: MetricsResponse?,
    connectionMode: ConnectionMode,
    activeUrl: String,
    onRefresh: () -> Unit,
    onOpenSettings: () -> Unit
) {
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
                            Text(
                                text = "RECURSOS COCKPIT",
                                fontSize = 16.sp,
                                fontWeight = FontWeight.ExtraBold,
                                letterSpacing = 1.sp,
                                color = TextPrimary
                            )
                            Text(
                                text = if (activeUrl.isNotEmpty()) activeUrl else "Buscando servidor...",
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
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 340.dp),
            contentPadding = PaddingValues(16.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            // Estado y Ciberdefensa (ancho completo en encabezado)
            item(span = { GridItemSpan(maxLineSpan) }) {
                SystemCard(
                    system = metrics?.system,
                    security = metrics?.security,
                    mode = connectionMode
                )
            }

            // CPU
            item {
                CpuCard(cpu = metrics?.cpu)
            }

            // RAM
            item {
                MemoryCard(ram = metrics?.ram)
            }

            // Almacenamiento NVMe
            item {
                StorageCard(disks = metrics?.disks)
            }

            // Red en Vivo RX/TX
            item {
                NetworkCard(net = metrics?.net)
            }
        }
    }
}
