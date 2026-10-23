package com.cminewar.recursoscockpit.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cminewar.recursoscockpit.data.DiskData
import com.cminewar.recursoscockpit.theme.*

@Composable
fun StorageCard(disks: List<DiskData>?, modifier: Modifier = Modifier) {
    val primaryDisk = disks?.firstOrNull()
    val usage = primaryDisk?.percent ?: 0f
    val animatedProgress by animateFloatAsState(targetValue = usage / 100f, label = "diskProgress")

    val totalGb = (primaryDisk?.totalBytes ?: 0L) / (1024f * 1024f * 1024f)
    val usedGb = (primaryDisk?.usedBytes ?: 0L) / (1024f * 1024f * 1024f)

    Box(
        modifier = modifier
            .clip(RoundedCornerShape(20.dp))
            .background(CockpitCard)
            .border(1.dp, CockpitBorder, RoundedCornerShape(20.dp))
            .padding(18.dp)
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(text = "💿", fontSize = 18.sp)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "ALMACENAMIENTO NVME",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextSecondary,
                        letterSpacing = 1.sp
                    )
                }

                primaryDisk?.tempC?.let { temp ->
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(CockpitCardElevated)
                            .border(1.dp, CockpitBorder, RoundedCornerShape(8.dp))
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Text(
                            text = "${String.format("%.1f", temp)}°C",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = NeonOrange,
                            fontFamily = FontFamily.Monospace
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom
            ) {
                Text(
                    text = "${String.format("%.1f", usage)}%",
                    fontSize = 34.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = TextPrimary,
                    fontFamily = FontFamily.Monospace
                )

                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        text = "${String.format("%.0f", usedGb)} / ${String.format("%.0f", totalGb)} GB",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = NeonPurple,
                        fontFamily = FontFamily.Monospace
                    )
                    Text(
                        text = primaryDisk?.label ?: primaryDisk?.mountpoint ?: "/",
                        fontSize = 11.sp,
                        color = TextSecondary,
                        maxLines = 1
                    )
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            LinearProgressIndicator(
                progress = { animatedProgress },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(8.dp)
                    .clip(RoundedCornerShape(4.dp)),
                color = NeonPurple,
                trackColor = CockpitCardElevated,
                strokeCap = StrokeCap.Round
            )
        }
    }
}
