# AppleMusicWindowsRichPresence

Discord rich presence for **Apple Music on Windows**.

The official [`appleMusic.desktop`](https://github.com/Vendicated/Vencord/tree/main/src/plugins/appleMusic.desktop)
plugin drives AppleScript against the macOS Music app, so it is macOS-only. This plugin gets the same
information on Windows from the **System Media Transport Controls** (SMTC) — the same source that powers
the media popup on the volume flyout — and then enriches it with artwork and links from the public
iTunes Search API.

## What it shows

- Track name, artist and album
- Album artwork and artist artwork
- A seek bar (elapsed / remaining), driven by the real playback position
- "Listen on Apple Music" and "View on SongLink" buttons
- Everything is customisable with the same format strings as the macOS plugin:
  `{name}`, `{artist}`, `{album}`

## Supported players

| Source | Media session id | Default |
| --- | --- | --- |
| Apple Music (Microsoft Store app) | `AppleInc.AppleMusicWin_…!App` | on |
| iTunes for Windows | `iTunes.exe` | on |
| Anything else (advanced) | your own regex | off |

The **Advanced** source setting takes a regex matched against the media session's app id. It is off by
default on purpose: pointing it at a browser (`msedge.exe`, `chrome.exe`) will pick up *any* media that
browser plays, so a YouTube video would get reported as Apple Music.

The plugin's settings panel has a **Show detected media sources** button that lists what Windows can
currently see — start here if nothing is showing up.

## How it works

`native.ts` runs in Discord's main process and keeps a single long-lived `powershell.exe` child alive.
The child ([`dev/smtc.ps1`](../dev/smtc.ps1), embedded into the bundle as `smtcScript.ts`) reads one
request line per poll and answers with one line of JSON.

A few things worth knowing:

- **Windows PowerShell 5.1 is required**, not PowerShell 7. `pwsh` cannot resolve the `[Windows.*]`
  WinRT types without extra SDK assemblies, so the plugin invokes `powershell.exe` by absolute path.
- **The process is long-lived on purpose.** Spawning PowerShell per poll costs ~260 ms; the persistent
  host answers in 2–60 ms. It exits by itself when its stdin closes, so it cannot outlive Discord.
- **The script is written to a temp file rather than passed as `-EncodedCommand`**, so that it stays
  auditable and doesn't look like the base64-blob pattern that antivirus and EDR tools flag.

### Two quirks this plugin works around

**Apple Music packs two fields into one.** Unlike every other media source, Apple Music for Windows
reports the artist as `Artist — Album` (with an em dash, U+2014) and leaves the album field *empty*:

```
title       : "Dang! (feat. Anderson .Paak)"
artist      : "Mac Miller — The Divine Feminine (10th Anniversary)"
albumTitle  : ""
```

The plugin splits that back into an artist and an album.

**Matching on album alone picks the wrong song.** The macOS plugin resolves artwork by taking the first
iTunes result whose `collectionName` matches the album. Since SMTC gives no catalogue id, that turns out
to select an arbitrary track from the right album — looking up *Stay* by Mac Miller returns the artwork
and links for *Butterflies*. This plugin scores candidates on track name (weighted highest), then album,
then artist, comparing case- and punctuation-insensitively.

## Privacy

The only outbound request is a search against `itunes.apple.com` containing the track, artist and album
name, in order to resolve artwork and links. Results are cached, so a repeated track is not re-requested.
