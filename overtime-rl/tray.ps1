Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Ensure port 49200 has OvertimeRL running
$serverRunning = $false
try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:49200/api/status" -TimeoutSec 1 -UseBasicParsing -ErrorAction SilentlyContinue
    if ($resp.StatusCode -eq 200) { $serverRunning = $true }
} catch {}

$nodeProcess = $null
if (-not $serverRunning) {
    # Check if dist folder exists; if not build it
    if (-not (Test-Path (Join-Path $scriptDir "dist\index.html"))) {
        Start-Process -FilePath "npm.cmd" -ArgumentList "run build" -WorkingDirectory $scriptDir -Wait -WindowStyle Hidden
    }

    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    $nodeExe = if ($nodeCmd) { $nodeCmd.Source } else { "C:\Program Files\nodejs\node.exe" }

    $pinfo = New-Object System.Diagnostics.ProcessStartInfo
    $pinfo.FileName = $nodeExe
    $pinfo.Arguments = "--experimental-strip-types src/server/main.ts"
    $pinfo.WorkingDirectory = $scriptDir
    $pinfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $pinfo.CreateNoWindow = $true
    $pinfo.UseShellExecute = $false
    $nodeProcess = [System.Diagnostics.Process]::Start($pinfo)
}

# Load Icon
$iconPath = Join-Path $scriptDir "overtime.ico"
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
if (Test-Path $iconPath) {
    $notifyIcon.Icon = New-Object System.Drawing.Icon($iconPath)
} else {
    $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
}
$notifyIcon.Text = "OvertimeRL — Rocket League Analytics"
$notifyIcon.Visible = $true

# Function to open browser
function Open-OvertimeUrl([string]$path = "") {
    $url = "http://localhost:49200" + $path
    Start-Process $url
}

# Left Click & Double Click behavior
$notifyIcon.add_Click({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        Open-OvertimeUrl
    }
})
$notifyIcon.add_DoubleClick({
    Open-OvertimeUrl
})

# Context Menu (Right Click)
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

$menuOpen = $contextMenu.Items.Add("Open OvertimeRL")
$menuOpen.Font = New-Object System.Drawing.Font($menuOpen.Font, [System.Drawing.FontStyle]::Bold)
$menuOpen.add_Click({ Open-OvertimeUrl })

$menuMatch = $contextMenu.Items.Add("Match Center")
$menuMatch.add_Click({ Open-OvertimeUrl })

$menuSquad = $contextMenu.Items.Add("Squad Hub & Chemistry")
$menuSquad.add_Click({ Open-OvertimeUrl })

$contextMenu.Items.Add("-") | Out-Null

$menuRestart = $contextMenu.Items.Add("Restart Server")
$menuRestart.add_Click({
    try {
        if ($script:nodeProcess -and -not $script:nodeProcess.HasExited) { 
            $script:nodeProcess.Kill() 
        }
    } catch {}
    Start-Sleep -Milliseconds 600
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    $nodeExe = if ($nodeCmd) { $nodeCmd.Source } else { "C:\Program Files\nodejs\node.exe" }

    $pinfo = New-Object System.Diagnostics.ProcessStartInfo
    $pinfo.FileName = $nodeExe
    $pinfo.Arguments = "--experimental-strip-types src/server/main.ts"
    $pinfo.WorkingDirectory = $scriptDir
    $pinfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $pinfo.CreateNoWindow = $true
    $pinfo.UseShellExecute = $false
    $script:nodeProcess = [System.Diagnostics.Process]::Start($pinfo)
    $notifyIcon.ShowBalloonTip(2000, "OvertimeRL", "Analytics server restarted.", [System.Windows.Forms.ToolTipIcon]::Info)
})

$menuExit = $contextMenu.Items.Add("Exit OvertimeRL")
$menuExit.add_Click({
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    try {
        if ($script:nodeProcess -and -not $script:nodeProcess.HasExited) { 
            $script:nodeProcess.Kill() 
        }
    } catch {}
    [System.Windows.Forms.Application]::Exit()
    Stop-Process -Id $PID -Force
})

$notifyIcon.ContextMenuStrip = $contextMenu

# Show notification on launch
$notifyIcon.ShowBalloonTip(3000, "OvertimeRL is running", "Click this icon anytime to view Rocket League match analytics.", [System.Windows.Forms.ToolTipIcon]::Info)

# Run Windows message loop
[System.Windows.Forms.Application]::Run()
