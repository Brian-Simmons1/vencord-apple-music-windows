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

## Player controls

Optionally shows a small player above the account panel with **previous / play-pause / next**,
album art, and a progress bar — in the same spot as `SpotifyControls`. Everything about it is a
setting; nothing is forced on:

| Setting | Default | What it does |
| --- | --- | --- |
| Show player controls | on | The player itself. Off = presence only, exactly as before. |
| Only reveal buttons on hover | off | Buttons stay hidden until you hover the player. |
| Show album art | on | 40px artwork thumbnail. |
| Show progress bar | on | Elapsed / total. **Read-only** — see below. |

### Radio stations disable skipping

On an Apple Music **radio station**, the session reports `next` and `previous` as unavailable and
gives no duration. That is Apple's licensing, not a bug — you cannot skip a station from anywhere,
including the Apple Music app itself. The buttons dim and say so on hover, and the progress bar is
omitted since a live stream has no length. Play/pause still works.

### What Apple Music actually supports

Each command was tested against the running app rather than trusted, which matters because
**`Try*Async` returns `true` even when the command is silently ignored**:

| Control | Advertised | Actually works |
| --- | --- | --- |
| Play / pause | yes | yes |
| Next / previous | yes | yes |
| **Seek** | no | **no** — returns `true`, position never moves |
| Shuffle / repeat | no | no — returns `true`, ignored |

So there is no draggable seek bar, unlike `SpotifyControls`. The progress bar is presentational.
The buttons disable themselves from the session's advertised `controls` flags, which did turn out
to be truthful — seek is advertised as unavailable and is genuinely unavailable.

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
JSON request line and answers with one line of JSON:

```
{"op":"get","pattern":"<regex>"}                     -> session snapshot + control flags
{"op":"sources"}                                     -> every media source Windows sees
{"op":"cmd","pattern":"<regex>","command":"next"}    -> transport command
```

The player subscribes to the same polled snapshot the presence uses, so enabling it does not double
the polling. After a button press it requests one extra refresh so the play/pause icon doesn't sit
stale until the next tick.

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
