/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Brian Simmons
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// GENERATED FILE - do not edit by hand.
// Source: dev/smtc.ps1 | Regenerate: node dev/gen-script.mjs
//
// The Windows media-session (SMTC) helper, embedded so native.ts can write it
// to a temp file at runtime. Vencord bundles native.ts with esbuild and does
// not copy loose assets, so the script cannot just be read from the plugin dir.

export const SMTC_SCRIPT = `# Vencord AppleMusicWindowsRichPresence - Windows media session (SMTC) helper.
#
# Long-lived request/response host. Reads one request line from stdin and writes
# exactly one compact JSON line to stdout per request.
#
#   request : a .NET regex matched against each session's SourceAppUserModelId
#   response: {"ok":true,"found":bool,...}  or  {"ok":false,"error":"..."}
#   "quit" or EOF (parent died) terminates the loop.
#
# Requires Windows PowerShell 5.1 (powershell.exe). PowerShell 7 (pwsh) cannot
# resolve [Windows.*] WinRT types without extra SDK assemblies.

$ErrorActionPreference = "Stop"

# Emit UTF-8 without a BOM; -Compress escapes non-ASCII as \\uXXXX anyway.
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
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
    })[0]

    if ($null -eq $asTaskGeneric) { throw "WinRT AsTask bridge unavailable" }

    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null

    $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
    $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
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

function Get-Payload([string] $pattern) {
    $manager = Get-Manager
    $sessions = @($manager.GetSessions())

    # Prefer a session that is actually playing over one that is merely present,
    # so a paused Apple Music window doesn't mask an actively playing one.
    $matched = @($sessions | Where-Object { $_.SourceAppUserModelId -match $pattern })
    if ($matched.Count -eq 0) {
        return @{ ok = $true; found = $false; sources = @($sessions | ForEach-Object { $_.SourceAppUserModelId }) }
    }

    $session = $matched | Where-Object { "$($_.GetPlaybackInfo().PlaybackStatus)" -eq 'Playing' } | Select-Object -First 1
    if ($null -eq $session) { $session = $matched[0] }

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
    }
}

Write-Line (@{ ok = $true; ready = $true } | ConvertTo-Json -Compress)

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }           # stdin closed: parent is gone
    $line = $line.Trim()
    if ($line -eq 'quit') { break }
    if ($line -eq '') { continue }

    try {
        Write-Line ((Get-Payload $line) | ConvertTo-Json -Compress -Depth 4)
    } catch {
        # Drop the cached manager so the next request rebuilds it.
        $script:mgr = $null
        Write-Line (@{ ok = $false; error = "$($_.Exception.Message)" } | ConvertTo-Json -Compress)
    }
}
`;
