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
import com.cminewar.recursoscockpit.data.CpuData
import com.cminewar.recursoscockpit.theme.*

@Composable
fun CpuCard(cpu: CpuData?, modifier: Modifier = Modifier) {
    val usage = cpu?.usagePercent ?: 0f
    val animatedProgress by animateFloatAsState(targetValue = usage / 100f, label = "cpuProgress")

    val progressColor = when {
        usage > 85f -> NeonRed
        usage > 65f -> NeonOrange
        else -> NeonCyan
    }

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
                    Text(text = "🧠", fontSize = 18.sp)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "CPU TELEMETRÍA",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextSecondary,
                        letterSpacing = 1.sp
                    )
                }

                cpu?.tempC?.let { temp ->
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
                            color = if (temp > 75) NeonRed else NeonOrange,
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
                        text = "${cpu?.logicalCores ?: 0} Núcleos",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = TextSecondary
                    )
                    cpu?.freqMhz?.let { freq ->
                        val ghz = freq / 1000f
                        Text(
                            text = "${String.format("%.2f", ghz)} GHz",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = NeonBlue,
                            fontFamily = FontFamily.Monospace
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            LinearProgressIndicator(
                progress = { animatedProgress },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(8.dp)
                    .clip(RoundedCornerShape(4.dp)),
                color = progressColor,
                trackColor = CockpitCardElevated,
                strokeCap = StrokeCap.Round
            )
        }
    }
}
