# Vencord AppleMusicWindowsRichPresence - Windows media session (SMTC) helper.
#
# Long-lived request/response host. Reads one JSON request line from stdin and
# writes exactly one compact JSON line to stdout per request.
#
#   {"op":"get","pattern":"<regex>"}                    -> session snapshot
#   {"op":"sources"}                                    -> all session app ids
#   {"op":"cmd","pattern":"<regex>","command":"next"}   -> transport command
#
#   response: {"ok":true,...} or {"ok":false,"error":"..."}
#   "quit" or EOF (parent died) terminates the loop.
#
# Requires Windows PowerShell 5.1 (powershell.exe). PowerShell 7 (pwsh) cannot
# resolve [Windows.*] WinRT types without extra SDK assemblies.

$ErrorActionPreference = "Stop"

# Emit UTF-8 without a BOM; -Compress escapes non-ASCII as \uXXXX anyway.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

function Write-Line([string] $s) {
    [Console]::Out.WriteLine($s)
    [Console]::Out.Flush()
}

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

    # WinRT IAsyncOperation<T> -> Task<T> bridge, needed to await from PS 5.1.
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and
        $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]

    if ($null -eq $asTaskGeneric) { throw "WinRT AsTask bridge unavailable" }

    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null

    $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
    $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
    $boolType = [bool]
} catch {
    Write-Line (@{ ok = $false; fatal = $true; error = "init: $($_.Exception.Message)" } | ConvertTo-Json -Compress)
    exit 1
}

function Await($op, $type) {
    $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
    if (-not $task.Wait(4000)) { throw "WinRT call timed out" }
    return $task.Result
}

$mgr = $null
function Get-Manager {
    if ($null -eq $script:mgr) {
        $script:mgr = Await ($mgrType::RequestAsync()) ($mgrType)
    }
    return $script:mgr
}

function Get-MatchingSession([string] $pattern) {
    $sessions = @((Get-Manager).GetSessions())
    $matched = @($sessions | Where-Object { $_.SourceAppUserModelId -match $pattern })
    if ($matched.Count -eq 0) { return $null }

    # Prefer a session that is actually playing over one that is merely present,
    # so a paused Apple Music window doesn't mask an actively playing one.
    $playing = $matched | Where-Object { "$($_.GetPlaybackInfo().PlaybackStatus)" -eq 'Playing' } | Select-Object -First 1
    if ($playing) { return $playing }
    return $matched[0]
}

function Get-Snapshot([string] $pattern) {
    $session = Get-MatchingSession $pattern
    if ($null -eq $session) {
        return @{ ok = $true; found = $false }
    }

    $info = $session.GetPlaybackInfo()
    $status = "$($info.PlaybackStatus)"
    $props = Await ($session.TryGetMediaPropertiesAsync()) ($propsType)
    $tl = $session.GetTimelineProperties()

    $startSec = $tl.StartTime.TotalSeconds
    $endSec = $tl.EndTime.TotalSeconds
    $posSec = $tl.Position.TotalSeconds

    # SMTC position is a snapshot taken at LastUpdatedTime. While playing, the
    # real position has advanced since then, so extrapolate. Guard against a
    # zero/absent timestamp and against absurd drift from a stale session.
    if ($status -eq 'Playing') {
        $lu = $tl.LastUpdatedTime
        if ($lu.Ticks -gt 0) {
            $drift = ([DateTimeOffset]::Now - $lu).TotalSeconds
            if ($drift -gt 0 -and $drift -lt 30) { $posSec += $drift }
        }
    }

    $duration = $endSec - $startSec
    $position = $posSec - $startSec
    if ($duration -gt 0 -and $position -gt $duration) { $position = $duration }
    if ($position -lt 0) { $position = 0 }

    # Apple Music reports these honestly: it advertises seek as unavailable and
    # in fact ignores TryChangePlaybackPositionAsync, so the UI trusts them.
    $c = $info.Controls

    return @{
        ok          = $true
        found       = $true
        sourceAppId = $session.SourceAppUserModelId
        status      = $status
        title       = [string] $props.Title
        artist      = [string] $props.Artist
        albumTitle  = [string] $props.AlbumTitle
        albumArtist = [string] $props.AlbumArtist
        trackNumber = [int] $props.TrackNumber
        position    = [math]::Round($position, 3)
        duration    = [math]::Round($duration, 3)
        controls    = @{
            play      = [bool] $c.IsPlayEnabled
            pause     = [bool] $c.IsPauseEnabled
            playPause = [bool] $c.IsPlayPauseToggleEnabled
            next      = [bool] $c.IsNextEnabled
            previous  = [bool] $c.IsPreviousEnabled
        }
    }
}

function Invoke-Transport([string] $pattern, [string] $command) {
    $session = Get-MatchingSession $pattern
    if ($null -eq $session) { return @{ ok = $true; found = $false } }

    # NOTE: these return $true merely for "delivered", not "honoured" - Apple
    # Music returns $true for seek and shuffle while ignoring both.
    switch ($command) {
        'playpause' { $r = Await ($session.TryTogglePlayPauseAsync()) ($boolType) }
        'play'      { $r = Await ($session.TryPlayAsync()) ($boolType) }
        'pause'     { $r = Await ($session.TryPauseAsync()) ($boolType) }
        'next'      { $r = Await ($session.TrySkipNextAsync()) ($boolType) }
        'previous'  { $r = Await ($session.TrySkipPreviousAsync()) ($boolType) }
        default     { throw "unknown command: $command" }
    }

    return @{ ok = $true; found = $true; command = $command; delivered = [bool] $r }
}

Write-Line (@{ ok = $true; ready = $true } | ConvertTo-Json -Compress)

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }           # stdin closed: parent is gone
    $line = $line.Trim()
    if ($line -eq 'quit') { break }
    if ($line -eq '') { continue }

    try {
        $req = $line | ConvertFrom-Json
        switch ($req.op) {
            'get'     { $payload = Get-Snapshot $req.pattern }
            'cmd'     { $payload = Invoke-Transport $req.pattern $req.command }
            'sources' {
                $ids = @((Get-Manager).GetSessions() | ForEach-Object { $_.SourceAppUserModelId })
                $payload = @{ ok = $true; sources = $ids }
            }
            default   { throw "unknown op: $($req.op)" }
        }
        Write-Line ($payload | ConvertTo-Json -Compress -Depth 4)
    } catch {
        # Drop the cached manager so the next request rebuilds it.
        $script:mgr = $null
        Write-Line (@{ ok = $false; error = "$($_.Exception.Message)" } | ConvertTo-Json -Compress)
    }
}
