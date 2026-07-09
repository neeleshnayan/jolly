# Expose the rig's drizzle app over Tailscale as HTTPS, so you can present the
# FULL voice demo from a laptop — the browser needs a secure context (https) to
# get the mic, and tailscale serve provides a real TLS cert on your *.ts.net name.
#
#   powershell -File tools\demo-tailscale.ps1          # start serving
#   powershell -File tools\demo-tailscale.ps1 -Stop    # stop serving
#
# ONE-TIME PREREQ (in the Tailscale admin console, https://login.tailscale.com/admin):
#   DNS → enable MagicDNS, and enable HTTPS Certificates. Without HTTPS certs,
#   `tailscale serve --https` can't provision the cert and the mic won't work.
#
# Flow: run tools\start-drizzle.ps1 on the rig first (brings up voicebox +
# ollama + the dev server on :3000), THEN this. The app + voice stack stay on
# the rig at 127.0.0.1; only the browser is remote.
param([switch]$Stop)

$ts = if (Get-Command tailscale -ErrorAction SilentlyContinue) { "tailscale" }
      elseif (Test-Path "C:\Program Files\Tailscale\tailscale.exe") { "C:\Program Files\Tailscale\tailscale.exe" }
      else { $null }
if (-not $ts) { Write-Host "Tailscale CLI not found. Install from https://tailscale.com/download"; exit 1 }

if ($Stop) {
  & $ts serve --https=443 off 2>$null
  & $ts serve reset 2>$null
  Write-Host "Tailscale serve stopped."
  exit 0
}

# the app must be up first — tailscale serve just proxies to it
if (-not (Test-NetConnection 127.0.0.1 -Port 3000 -WarningAction SilentlyContinue).TcpTestSucceeded) {
  Write-Host "Nothing on :3000 — run tools\start-drizzle.ps1 first, then re-run this."
  exit 1
}

& $ts serve --bg --https=443 localhost:3000

# resolve this machine's MagicDNS name for the shareable URL
$dns = $null
try { $dns = ((& $ts status --json | ConvertFrom-Json).Self.DNSName).TrimEnd('.') } catch {}

Write-Host ""
if ($dns) {
  Write-Host "Demo URL (open on any device signed into your tailnet):"
  Write-Host "   https://$dns" -ForegroundColor Green
} else {
  Write-Host "Serving on https://<this-machine>.<your-tailnet>.ts.net  (run '$ts status' for the exact name)"
}
Write-Host ""
Write-Host "Mic works because it's HTTPS. voicebox + ollama stay on this rig at 127.0.0.1."
Write-Host "Stop with:  powershell -File tools\demo-tailscale.ps1 -Stop"
