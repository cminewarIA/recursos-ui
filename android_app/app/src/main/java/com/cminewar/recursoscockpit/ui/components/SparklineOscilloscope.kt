package com.cminewar.recursoscockpit.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

@Composable
fun SparklineOscilloscope(
    history: List<Float>,
    lineColor: Color,
    modifier: Modifier = Modifier,
    height: Dp = 48.dp
) {
    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .height(height)
    ) {
        val width = size.width
        val canvasHeight = size.height
        if (width <= 0f || canvasHeight <= 0f) return@Canvas

        val data = if (history.size < 2) {
            val base = history.firstOrNull() ?: 20f
            listOf(base, base, base, base)
        } else {
            history
        }

        val stepX = width / (data.size - 1).coerceAtLeast(1)
        val paddingY = 4.dp.toPx()
        val usableHeight = canvasHeight - (paddingY * 2)

        fun getY(value: Float): Float {
            val norm = (value / 100f).coerceIn(0f, 1f)
            return canvasHeight - paddingY - (norm * usableHeight)
        }

        val linePath = Path()
        val fillPath = Path()

        val startX = 0f
        val startY = getY(data[0])

        linePath.moveTo(startX, startY)
        fillPath.moveTo(startX, canvasHeight)
        fillPath.lineTo(startX, startY)

        for (i in 1 until data.size) {
            val prevX = (i - 1) * stepX
            val prevY = getY(data[i - 1])
            val curX = i * stepX
            val curY = getY(data[i])

            val midX = (prevX + curX) / 2f
            linePath.cubicTo(midX, prevY, midX, curY, curX, curY)
            fillPath.cubicTo(midX, prevY, midX, curY, curX, curY)
        }

        val lastX = (data.size - 1) * stepX
        val lastY = getY(data.last())

        fillPath.lineTo(lastX, canvasHeight)
        fillPath.close()

        // 1. Fill with Vertical Gradient Fade
        drawPath(
            path = fillPath,
            brush = Brush.verticalGradient(
                colors = listOf(
                    lineColor.copy(alpha = 0.32f),
                    lineColor.copy(alpha = 0.05f),
                    Color.Transparent
                ),
                startY = 0f,
                endY = canvasHeight
            )
        )

        // 2. Draw Stroke Line with Round Caps
        drawPath(
            path = linePath,
            color = lineColor,
            style = Stroke(
                width = 2.dp.toPx(),
                cap = StrokeCap.Round,
                join = StrokeJoin.Round
            )
        )

        // 3. Highlight End Point
        drawCircle(
            color = lineColor,
            radius = 3.2.dp.toPx(),
            center = Offset(lastX, lastY)
        )
        drawCircle(
            color = Color.White,
            radius = 1.6.dp.toPx(),
            center = Offset(lastX, lastY)
        )
    }
}
