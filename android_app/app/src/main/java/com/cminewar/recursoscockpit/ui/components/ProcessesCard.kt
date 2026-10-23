package com.cminewar.recursoscockpit.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cminewar.recursoscockpit.theme.*

@Composable
fun ProcessesCard(
    processes: List<Map<String, Any>>?,
    modifier: Modifier = Modifier
) {
    val procList = processes ?: emptyList()

    Box(
        modifier = modifier
            .clip(RoundedCornerShape(20.dp))
            .background(CockpitCard)
            .border(1.dp, CockpitBorder, RoundedCornerShape(20.dp))
            .padding(18.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Terminal,
                        contentDescription = "Procesos",
                        tint = NeonOrange,
                        modifier = Modifier.size(20.dp)
                    )
                    Text(
                        text = "PROCESOS PRINCIPALES",
                        color = TextSecondary,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp
                    )
                }

                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(CockpitCardElevated)
                        .border(1.dp, CockpitBorder, RoundedCornerShape(8.dp))
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Text(
                        text = "${procList.size} PROCESOS",
                        color = NeonOrange,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            if (procList.isEmpty()) {
                Text(
                    text = "No hay datos de procesos disponibles",
                    color = TextSecondary,
                    fontSize = 13.sp
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    // Cabecera tabla
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(text = "PID / NOMBRE", color = TextSecondary, fontSize = 11.sp)
                        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            Text(text = "% CPU", color = TextSecondary, fontSize = 11.sp)
                            Text(text = "% MEM", color = TextSecondary, fontSize = 11.sp)
                        }
                    }

                    procList.take(6).forEach { proc ->
                        val pid = (proc["pid"] as? Number)?.toInt() ?: 0
                        val name = (proc["name"] as? String) ?: "proceso"
                        val cpuPct = (proc["cpu_percent"] as? Number)?.toFloat() ?: 0f
                        val memPct = (proc["memory_percent"] as? Number)?.toFloat() ?: 0f

                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(CockpitCardElevated)
                                .border(1.dp, CockpitBorder.copy(alpha = 0.4f), RoundedCornerShape(8.dp))
                                .padding(horizontal = 8.dp, vertical = 5.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "$pid  $name",
                                color = TextPrimary,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                                fontFamily = FontFamily.Monospace
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                                Text(
                                    text = String.format("%.1f%%", cpuPct),
                                    color = if (cpuPct > 20f) NeonRed else NeonGreen,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    fontFamily = FontFamily.Monospace
                                )
                                Text(
                                    text = String.format("%.1f%%", memPct),
                                    color = NeonBlue,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Normal,
                                    fontFamily = FontFamily.Monospace
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
