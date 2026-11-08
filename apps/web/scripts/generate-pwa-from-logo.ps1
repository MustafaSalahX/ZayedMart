Add-Type -AssemblyName System.Drawing

$sourcePath = (Resolve-Path "$PSScriptRoot/../public/logo.jpeg").Path
if (-not (Test-Path $sourcePath)) {
  Write-Error "Source logo file not found: $sourcePath"
  exit 1
}

$src = [System.Drawing.Bitmap]::FromFile($sourcePath)

function Save-Resized([int]$width, [int]$height, [string]$relPath, [double]$scaleFactor = 1.0) {
  $outPath = Join-Path "$PSScriptRoot/../public" $relPath
  $bmp = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

  # Logo background color (#F7F7F7)
  $bgColor = [System.Drawing.Color]::FromArgb(255, 247, 247, 247)
  $brush = New-Object System.Drawing.SolidBrush($bgColor)
  $g.FillRectangle($brush, 0, 0, $width, $height)
  $brush.Dispose()

  $targetW = [int]($width * $scaleFactor)
  $targetH = [int]($height * $scaleFactor)
  $targetX = [int](($width - $targetW) / 2)
  $targetY = [int](($height - $targetH) / 2)

  $g.DrawImage($src, $targetX, $targetY, $targetW, $targetH)
  $g.Dispose()

  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "Generated: $relPath ($width x $height, scale: $scaleFactor)"
}

Save-Resized 512 512 "Logo.png" 1.0
Save-Resized 512 512 "logo.png" 1.0
Save-Resized 512 512 "pwa-512.png" 1.0
Save-Resized 192 192 "pwa-192.png" 1.0
Save-Resized 180 180 "apple-touch-icon.png" 1.0
Save-Resized 512 512 "pwa-maskable-512.png" 0.80

$androidResDir = Join-Path "$PSScriptRoot/.." "android/app/src/main/res"
if (Test-Path $androidResDir) {
  function Save-AndroidIcon([string]$folder, [string]$fileName, [int]$size, [double]$scaleFactor) {
    $targetDir = Join-Path $androidResDir $folder
    if (-not (Test-Path $targetDir)) {
      New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }
    $outPath = Join-Path $targetDir $fileName
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    $bgColor = [System.Drawing.Color]::FromArgb(255, 247, 247, 247)
    $brush = New-Object System.Drawing.SolidBrush($bgColor)
    $g.FillRectangle($brush, 0, 0, $size, $size)
    $brush.Dispose()

    $targetW = [int]($size * $scaleFactor)
    $targetH = [int]($size * $scaleFactor)
    $targetX = [int](($size - $targetW) / 2)
    $targetY = [int](($size - $targetH) / 2)

    $g.DrawImage($src, $targetX, $targetY, $targetW, $targetH)
    $g.Dispose()

    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  }

  $densities = @(
    @{ Folder = "mipmap-mdpi"; Legacy = 48;Fg = 108 },
    @{ Folder = "mipmap-hdpi"; Legacy = 72; Fg = 162 },
    @{ Folder = "mipmap-xhdpi"; Legacy = 96; Fg = 216 },
    @{ Folder = "mipmap-xxhdpi"; Legacy = 144; Fg = 324 },
    @{ Folder = "mipmap-xxxhdpi"; Legacy = 192; Fg = 432 }
  )

  foreach ($d in $densities) {
    Save-AndroidIcon $d.Folder "ic_launcher.png" $d.Legacy 0.90
    Save-AndroidIcon $d.Folder "ic_launcher_round.png" $d.Legacy 0.85
    Save-AndroidIcon $d.Folder "ic_launcher_foreground.png" $d.Fg 0.66
  }
  Write-Host "Generated Android launcher icons in $androidResDir"
}

$src.Dispose()
Write-Host "All PWA logo PNG icons generated successfully!"
