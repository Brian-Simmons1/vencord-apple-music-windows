# Read-only probe: which transport controls does the Apple Music session advertise?
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, $type) {
    $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(4000) | Out-Null; $t.Result
}
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$mgr = Await ($mgrType::RequestAsync()) ($mgrType)

foreach ($s in $mgr.GetSessions()) {
    if ($s.SourceAppUserModelId -notmatch 'AppleInc') { continue }
    $info = $s.GetPlaybackInfo()
    $c = $info.Controls
    Write-Output "source : $($s.SourceAppUserModelId)"
    Write-Output "status : $($info.PlaybackStatus)"
    Write-Output "--- advertised controls ---"
    foreach ($p in $c.GetType().GetProperties() | Sort-Object Name) {
        Write-Output ("  {0,-32} {1}" -f $p.Name, $p.GetValue($c))
    }
    Write-Output "--- session methods available ---"
    ($s.GetType().GetMethods() | Where-Object { $_.Name -like 'Try*' } | ForEach-Object { $_.Name } | Sort-Object -Unique) -join ", "
}
