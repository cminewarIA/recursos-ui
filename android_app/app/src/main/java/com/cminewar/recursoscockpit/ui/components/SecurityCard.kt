package com.cminewar.recursoscockpit.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.Icon
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
import com.cminewar.recursoscockpit.data.SecurityData
import com.cminewar.recursoscockpit.i18n.I18nDictionary
import com.cminewar.recursoscockpit.theme.*

@Composable
fun SecurityCard(
    securityData: SecurityData?,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val isRunning = securityData?.available == true || securityData?.fail2ban != null
    val fail2ban = securityData?.fail2ban
    val totalBanned = (fail2ban?.get("total_banned") as? Number)?.toInt() ?: 0
    val jails = (fail2ban?.get("jails") as? List<*>)?.mapNotNull { it?.toString() } ?: emptyList()

    Box(
        modifier = modifier
            .clip(RoundedCornerShape(20.dp))
            .background(CockpitCard)
            .border(1.dp, CockpitBorder, RoundedCornerShape(20.dp))
            .padding(18.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
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
                        imageVector = Icons.Default.Shield,
                        contentDescription = I18nDictionary.t(context, "native_android.tab_shield", "Ciberdefensa"),
                        tint = NeonRed,
                        modifier = Modifier.size(20.dp)
                    )
                    Text(
                        text = I18nDictionary.t(context, "native_android.card_security", "CIBERDEFENSA & IPS"),
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
                        text = if (isRunning) {
                            I18nDictionary.t(context, "native_android.f2b_active", "FAIL2BAN ACTIVO")
                        } else {
                            I18nDictionary.t(context, "native_android.f2b_stopped", "DETENIDO")
                        },
                        color = if (isRunning) NeonGreen else NeonRed,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom
            ) {
                Column {
                    Text(
                        text = I18nDictionary.t(context, "native_android.blocked_ips", "IPs Bloqueadas"),
                        color = TextSecondary,
                        fontSize = 12.sp
                    )
                    Text(
                        text = "$totalBanned",
                        color = if (totalBanned > 0) NeonRed else NeonGreen,
                        fontSize = 28.sp,
                        fontWeight = FontWeight.ExtraBold,
                        fontFamily = FontFamily.Monospace
                    )
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        text = I18nDictionary.t(context, "native_android.active_jails", "Jails Activas"),
                        color = TextSecondary,
                        fontSize = 12.sp
                    )
                    Text(
                        text = if (jails.isNotEmpty()) {
                            I18nDictionary.t(context, "native_android.jails_count", "{count} activas", mapOf("count" to jails.size))
                        } else {
                            I18nDictionary.t(context, "native_android.monitoring", "Monitorizando")
                        },
                        color = TextPrimary,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }

            if (jails.isNotEmpty()) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    jails.take(4).forEach { jail ->
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(CockpitCardElevated)
                                .border(1.dp, CockpitBorder, RoundedCornerShape(6.dp))
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        ) {
                            Text(text = jail, color = NeonPurple, fontSize = 11.sp)
                        }
                    }
                }
            }
        }
    }
}
