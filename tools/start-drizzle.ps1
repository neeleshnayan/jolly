# Bring the whole drizzle rig up after a reboot — one command, four services.
#   powershell -File tools\start-drizzle.ps1
# Idempotent: anything already running is left alone.

function Test-Port($port) {
  (Test-NetConnection 127.0.0.1 -Port $port -WarningAction SilentlyContinue).TcpTestSucceeded
}

# 1. Ollama rc (voice + extraction brain) on :11500 — temporary until the
#    gemma4 CUDA fix ships in a stable Ollama; then delete ~/.drizzle/ollama-rc
#    and revert OLLAMA_BASE_URL to 11434.
if (-not (Test-Port 11500)) {
  Start-Process -FilePath "$env:USERPROFILE\.drizzle\ollama-rc\ollama.exe" -ArgumentList "serve" -WindowStyle Hidden -Environment @{ OLLAMA_HOST = "127.0.0.1:11500" }
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
