$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$css = Get-Content -Raw (Join-Path $root 'src/popup/popup.css')
$accent = [regex]::Match($css, '--accent:\s*(#[0-9a-fA-F]{6})\b').Groups[1].Value
if (!$accent) { throw 'Could not read the accent color from src/popup/popup.css' }
$icons = New-Item -ItemType Directory -Force (Join-Path $root 'icons')

$background = [System.Drawing.Drawing2D.GraphicsPath]::new()
$background.AddArc(0, 0, 6, 6, 180, 90)
$background.AddArc(10, 0, 6, 6, 270, 90)
$background.AddArc(10, 10, 6, 6, 0, 90)
$background.AddArc(0, 10, 6, 6, 90, 90)
$background.CloseFigure()
$brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($accent))

$speaker = [System.Drawing.Drawing2D.GraphicsPath]::new()
$speaker.AddPolygon([System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(2.5, 6)
    [System.Drawing.PointF]::new(2.5, 10)
    [System.Drawing.PointF]::new(5, 10)
    [System.Drawing.PointF]::new(8.5, 13)
    [System.Drawing.PointF]::new(8.5, 3)
    [System.Drawing.PointF]::new(5, 6)
))
# Convert the SVG arcs' endpoints and radii to GDI+ bounds and angles.
foreach ($arc in @(@{ X = 11; Rise = 2.5; Radius = 3.5 }, @{ X = 12.8; Rise = 4.2; Radius = 6 })) {
    $centerX = $arc.X - [Math]::Sqrt($arc.Radius * $arc.Radius - $arc.Rise * $arc.Rise)
    $angle = [Math]::Asin($arc.Rise / $arc.Radius) * 180 / [Math]::PI
    $diameter = 2 * $arc.Radius
    $speaker.StartFigure()
    $speaker.AddArc(($centerX - $arc.Radius), (8 - $arc.Radius), $diameter, $diameter, (-$angle), (2 * $angle))
}

try {
    foreach ($size in 16, 48, 128) {
        $bitmap = [System.Drawing.Bitmap]::new($size, $size)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, $(if ($size -eq 16) { 1.8 } else { 1.6 }))
        try {
            $pen.StartCap = $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
            $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.ScaleTransform(($size / 16), ($size / 16))
            $graphics.FillPath($brush, $background)
            $graphics.TranslateTransform(8, 8)
            $graphics.ScaleTransform(0.8, 0.8)
            $graphics.TranslateTransform(-8.5, -8)
            $graphics.DrawPath($pen, $speaker)
            $bitmap.Save((Join-Path $icons.FullName "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $pen.Dispose()
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
} finally {
    $speaker.Dispose()
    $brush.Dispose()
    $background.Dispose()
}
