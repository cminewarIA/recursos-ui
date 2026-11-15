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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cminewar.recursoscockpit.data.ConnectionMode
import com.cminewar.recursoscockpit.data.SecurityData
import com.cminewar.recursoscockpit.data.SystemData
import com.cminewar.recursoscockpit.i18n.I18nDictionary
import com.cminewar.recursoscockpit.theme.*

@Composable
fun SystemCard(
    system: SystemData?,
    security: SecurityData?,
    mode: ConnectionMode,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
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
                        text = I18nDictionary.t(context, "native_android.node_security_title", "ESTADO DEL NODO Y CIBERDEFENSA"),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextSecondary,
                        letterSpacing = 1.sp
                    )
                }

                val (badgeText, badgeColor) = when (mode) {
                    ConnectionMode.CONNECTED_LAN -> I18nDictionary.t(context, "native_android.lan_low_latency", "🟢 LAN (BAJA LATENCIA)") to NeonGreen
                    ConnectionMode.CONNECTED_WAN -> I18nDictionary.t(context, "native_android.wan_ddns", "🌐 WAN (DDNS)") to NeonBlue
                    ConnectionMode.SCANNING_LAN -> I18nDictionary.t(context, "native_android.scanning_net", "📡 ESCANEANDO RED...") to NeonOrange
                    ConnectionMode.CONNECTING -> I18nDictionary.t(context, "native_android.linking", "🔍 ENLAZANDO...") to NeonOrange
                    ConnectionMode.REVOKED -> I18nDictionary.t(context, "native_android.cert_revoked", "🔒 CERTIFICADO REVOCADO") to NeonRed
                    ConnectionMode.ERROR -> I18nDictionary.t(context, "native_android.no_node", "🔴 SIN NODO") to NeonRed
                    ConnectionMode.DISCONNECTED -> I18nDictionary.t(context, "native_android.disconnected", "⚪ DESCONECTADO") to TextSecondary
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
                        text = system?.hostname ?: I18nDictionary.t(context, "native_android.server_fallback", "Servidor"),
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
                        text = I18nDictionary.t(context, "native_android.uptime_label", "Tiempo Activo"),
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
                        text = I18nDictionary.t(context, "native_android.f2b_ips_label", "Fail2ban IPS:"),
                        fontSize = 12.sp,
                        color = TextSecondary
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    val f2b = security?.fail2ban
                    val isF2bActive = f2b?.get("available") == true || f2b?.get("active") == true
                    Text(
                        text = if (isF2bActive) {
                            I18nDictionary.t(context, "native_android.f2b_operational", "Activo (IPS Operativo)")
                        } else {
                            I18nDictionary.t(context, "native_android.monitoring", "Monitorizando")
                        },
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
