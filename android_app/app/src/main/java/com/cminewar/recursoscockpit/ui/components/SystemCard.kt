package com.cminewar.recursoscockpit.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cminewar.recursoscockpit.data.ConnectionMode
import com.cminewar.recursoscockpit.data.SecurityData
import com.cminewar.recursoscockpit.data.SystemData
import com.cminewar.recursoscockpit.theme.*

@Composable
fun SystemCard(
    system: SystemData?,
    security: SecurityData?,
    mode: ConnectionMode,
    modifier: Modifier = Modifier
) {
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
                    Text(text = "🛡️", fontSize = 18.sp)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "ESTADO DEL NODO Y CIBERDEFENSA",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextSecondary,
                        letterSpacing = 1.sp
                    )
                }

                val (badgeText, badgeColor) = when (mode) {
                    ConnectionMode.CONNECTED_LAN -> "🟢 LAN (BAJA LATENCIA)" to NeonGreen
                    ConnectionMode.CONNECTED_WAN -> "🌐 WAN (DDNS)" to NeonBlue
                    ConnectionMode.SCANNING_LAN -> "📡 ESCANEANDO RED..." to NeonOrange
                    ConnectionMode.CONNECTING -> "🔍 ENLAZANDO..." to NeonOrange
                    ConnectionMode.REVOKED -> "🔒 CERTIFICADO REVOCADO" to NeonRed
                    ConnectionMode.ERROR -> "🔴 SIN NODO" to NeonRed
                    ConnectionMode.DISCONNECTED -> "⚪ DESCONECTADO" to TextSecondary
                }

                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(CockpitCardElevated)
                        .border(1.dp, CockpitBorder, RoundedCornerShape(8.dp))
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Text(
                        text = badgeText,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = badgeColor
                    )
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column {
                    Text(
                        text = system?.hostname ?: "Servidor",
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                    Text(
                        text = "${system?.os ?: "Linux"} • ${system?.kernel ?: ""}",
                        fontSize = 12.sp,
                        color = TextSecondary,
                        fontFamily = FontFamily.Monospace
                    )
                }

                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        text = "Tiempo Activo",
                        fontSize = 11.sp,
                        color = TextSecondary
                    )
                    Text(
                        text = system?.uptimeStr ?: "0d 0h",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = NeonCyan,
                        fontFamily = FontFamily.Monospace
                    )
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "Fail2ban IPS:",
                        fontSize = 12.sp,
                        color = TextSecondary
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    val f2b = security?.fail2ban
                    val isF2bActive = f2b?.get("available") == true || f2b?.get("active") == true
                    Text(
                        text = if (isF2bActive) "Activo (IPS Operativo)" else "Monitorizando",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (isF2bActive) NeonGreen else NeonOrange
                    )
                }

                system?.publicDomain?.let { domain ->
                    Text(
                        text = domain,
                        fontSize = 11.sp,
                        color = NeonBlue,
                        fontFamily = FontFamily.Monospace
                    )
                }
            }
        }
    }
}
