# Wind the drizzle rig down — free the GPU on demand.
#   powershell -File tools\stop-drizzle.ps1          # offload models NOW (servers stay up)
#   powershell -File tools\stop-drizzle.ps1 -Full    # also stop ollama-rc + the dev server
#
# Note the defaults already protect you: extraction calls run keep_alive:0
# (VRAM freed per call) and the live voice model expires after 5 idle minutes.
# This script is for "I want the GPU back right now" and for full teardown.
param([switch]$Full)

# 1. Offload every model Ollama has resident (keep_alive: 0 evicts immediately)
try {
  $ps = Invoke-RestMethod "http://127.0.0.1:11500/api/ps" -TimeoutSec 5
  if ($ps.models) {
    foreach ($m in $ps.models) {
      Invoke-RestMethod -Method Post "http://127.0.0.1:11500/api/generate" -ContentType "application/json" `
        -Body (@{ model = $m.name; keep_alive = 0 } | ConvertTo-Json) -TimeoutSec 30 | Out-Null
      Write-Host ("offloaded {0} (was holding {1:N1} GB VRAM)" -f $m.name, ($m.size_vram / 1GB))
    }
  } else {
    Write-Host "no models resident - GPU already free"
  }
} catch {
  Write-Host "ollama-rc not reachable on :11500 - nothing to offload"
}

if ($Full) {
  # 2. Stop ollama-rc + the dev server (voicebox is left alone — stop it from its tray)
  foreach ($port in 11500, 3000) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction Stop; Write-Host "stopped listener on :$port" } catch {} }
  }
}
