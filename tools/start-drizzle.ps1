# Bring the whole drizzle rig up after a reboot — one command, four services.
#   powershell -File tools\start-drizzle.ps1
# Idempotent: anything already running is left alone.

function Test-Port($port) {
  (Test-NetConnection 127.0.0.1 -Port $port -WarningAction SilentlyContinue).TcpTestSucceeded
}

# 0. Evict the STOCK Ollama if it auto-started (tray autostart / auto-update
#    relaunch). Two servers sharing the GPU = model-reload thrash, and stock
#    0.31.1 still carries the gemma4 CUDA crash. Its autostart shortcut is
#    parked in ~\.drizzle\disabled-autostart — an app update may recreate it.
if (Test-Port 11434) {
  Get-Process "ollama app" -ErrorAction SilentlyContinue | Stop-Process -Force
  $stock = Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($stock) { Stop-Process -Id $stock.OwningProcess -Force -ErrorAction SilentlyContinue }
  Write-Host "evicted stock Ollama from :11434 (drizzle uses the rc build on :11500)"
}
$lnk = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Ollama.lnk"
if (Test-Path $lnk) {
  Move-Item $lnk "$env:USERPROFILE\.drizzle\disabled-autostart\Ollama.lnk" -Force
  Write-Host "re-parked the stock Ollama autostart shortcut"
}

# 1. Ollama rc (voice + extraction brain) on :11500 — temporary until the
#    gemma4 CUDA fix ships in a stable Ollama; then delete ~/.drizzle/ollama-rc
#    and revert OLLAMA_BASE_URL to 11434.
if (-not (Test-Port 11500)) {
  # MAX_LOADED_MODELS=1: this box has ~15GB RAM — two models resident (or one
  # loading beside another) thrashes the pagefile and can crash the system
  Start-Process -FilePath "$env:USERPROFILE\.drizzle\ollama-rc\ollama.exe" -ArgumentList "serve" -WindowStyle Hidden -Environment @{ OLLAMA_HOST = "127.0.0.1:11500"; OLLAMA_MAX_LOADED_MODELS = "1" }
  Write-Host "ollama-rc starting on :11500"
} else { Write-Host "ollama-rc already up" }

# 2. Voicebox (STT + TTS) on :17493
if (-not (Test-Port 17493)) {
  Start-Process -FilePath "C:\Program Files\Voicebox\voicebox.exe"
  Write-Host "voicebox starting on :17493"
} else { Write-Host "voicebox already up" }

# 3. Next dev server on :3000
if (-not (Test-Port 3000)) {
  Start-Process -FilePath "cmd" -ArgumentList "/c", "npm run dev" -WorkingDirectory (Split-Path $PSScriptRoot) -WindowStyle Minimized
  Write-Host "dev server starting on :3000"
} else { Write-Host "dev server already up" }

Start-Sleep -Seconds 10
Write-Host ""
Write-Host ("ollama-rc :11500  " + $(if (Test-Port 11500) { "UP" } else { "still starting..." }))
Write-Host ("voicebox  :17493  " + $(if (Test-Port 17493) { "UP" } else { "still starting..." }))
Write-Host ("drizzle   :3000   " + $(if (Test-Port 3000) { "UP" } else { "still starting..." }))
Write-Host ""
Write-Host "Health check: http://localhost:3000/mentor -> click the wrench icon"
