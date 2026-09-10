/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Brian Simmons
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CspPolicies, ImageSrc } from "@main/csp";
import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { ChildProcess, spawn } from "child_process";
import { IpcMainInvokeEvent } from "electron";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import type { TrackControls, TrackData, TransportCommand } from ".";
import { SMTC_SCRIPT } from "./smtcScript";

// Windows PowerShell 5.1 specifically: PowerShell 7 (pwsh) cannot resolve
// [Windows.*] WinRT types without extra SDK assemblies. Resolved by absolute
// path so a `pwsh` shim earlier on PATH can't hijack it.
const PS_EXE = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

const REQUEST_TIMEOUT_MS = 6000;
const READY_TIMEOUT_MS = 15000;
const MAX_CONSECUTIVE_FAILURES = 3;
const FAILURE_COOLDOWN_MS = 60_000;

const LOG_PREFIX = "[AppleMusicWindowsRichPresence]";

// Apple's artwork CDN. The iTunes lookup itself runs here in the main process
// and so is not subject to the renderer's CSP, but the panel player renders the
// artwork in an <img>, which is - without this the image is silently blocked
// and shows as broken. Rich presence artwork is unaffected either way, since
// that goes through Discord's own asset proxy rather than a direct request.
CspPolicies["*.mzstatic.com"] = ImageSrc;

// ---------------------------------------------------------------------------
// PowerShell helper process
//
// Spawning powershell.exe per poll costs ~260ms; a long-lived request/response
// host answers in single-digit milliseconds. The child exits on its own when
// stdin closes, so it cannot outlive Discord.
// ---------------------------------------------------------------------------

let scriptPath: string | null = null;

function ensureScriptOnDisk() {
    if (scriptPath) return scriptPath;
    // Written to disk (rather than passed via -EncodedCommand) so the script is
    // auditable, and because base64'd PowerShell trips a lot of EDR/AV heuristics.
    const dir = mkdtempSync(join(tmpdir(), "vc-applemusic-"));
    const path = join(dir, "smtc.ps1");
    writeFileSync(path, SMTC_SCRIPT, "utf8");
    scriptPath = path;
    return path;
}

interface Pending {
    resolve(line: string): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
}

let proc: ChildProcess | null = null;
let starting: Promise<void> | null = null;
let stdoutBuffer = "";
let pending: Pending[] = [];

let consecutiveFailures = 0;
let cooldownUntil = 0;

function settleAll(error: Error) {
    const queued = pending;
    pending = [];
    for (const p of queued) {
        clearTimeout(p.timer);
        p.reject(error);
    }
}

function teardown(error: Error) {
    const dying = proc;
    proc = null;
    starting = null;
    stdoutBuffer = "";
    settleAll(error);
    if (dying && !dying.killed) {
        try {
            dying.stdin?.end();
            dying.kill();
        } catch {
            // already gone
        }
    }
}

function handleLine(line: string) {
    const next = pending.shift();
    if (!next) return; // unsolicited output (e.g. the ready banner after a race)
    clearTimeout(next.timer);
    next.resolve(line);
}

function startHelper(): Promise<void> {
    if (starting) return starting;

    starting = new Promise<void>((resolve, reject) => {
        let child: ChildProcess;
        try {
            child = spawn(
                PS_EXE,
                ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ensureScriptOnDisk()],
                { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
            );
        } catch (error) {
            starting = null;
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
        }

        proc = child;

        const readyTimer = setTimeout(() => {
            teardown(new Error("helper did not become ready in time"));
            reject(new Error("helper did not become ready in time"));
        }, READY_TIMEOUT_MS);

        let ready = false;

        child.stdout!.setEncoding("utf8");
        child.stdout!.on("data", chunk => {
            stdoutBuffer += chunk;
            let index: number;
            while ((index = stdoutBuffer.indexOf("\n")) !== -1) {
                const line = stdoutBuffer.slice(0, index).trim();
                stdoutBuffer = stdoutBuffer.slice(index + 1);
                if (!line) continue;

                if (!ready) {
                    // First line is the readiness banner, not a response.
                    ready = true;
                    clearTimeout(readyTimer);
                    let banner: any;
                    try {
                        banner = JSON.parse(line);
                    } catch {
                        banner = null;
                    }
                    if (banner?.ok === false) {
                        const error = new Error(banner.error ?? "helper failed to initialise");
                        teardown(error);
                        reject(error);
                        return;
                    }
                    resolve();
                    continue;
                }

                handleLine(line);
            }
        });

        child.stderr!.setEncoding("utf8");
        child.stderr!.on("data", chunk => {
            const text = String(chunk).trim();
            if (text) console.error(`${LOG_PREFIX} helper stderr:`, text);
        });

        child.on("error", error => {
            clearTimeout(readyTimer);
            teardown(error);
            reject(error);
        });

        child.on("exit", code => {
            clearTimeout(readyTimer);
            const error = new Error(`helper exited (code ${code})`);
            teardown(error);
            if (!ready) reject(error);
        });
    });

    return starting;
}

interface HelperRequest {
    op: "get" | "sources" | "cmd";
    pattern?: string;
    command?: TransportCommand;
}

function requestLine(request: HelperRequest): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const child = proc;
        if (!child?.stdin?.writable) {
            reject(new Error("helper is not running"));
            return;
        }

        const timer = setTimeout(() => {
            // A wedged WinRT call can't be cancelled; recycle the process.
            pending = pending.filter(p => p.timer !== timer);
            teardown(new Error("helper request timed out"));
            reject(new Error("helper request timed out"));
        }, REQUEST_TIMEOUT_MS);

        pending.push({ resolve, reject, timer });
        child.stdin.write(JSON.stringify(request) + "\n", error => {
            if (error) {
                clearTimeout(timer);
                pending = pending.filter(p => p.timer !== timer);
                reject(error);
            }
        });
    });
}

async function sendRequest(request: HelperRequest): Promise<any | null> {
    if (process.platform !== "win32") return null;

    if (Date.now() < cooldownUntil) return null;

    try {
        await startHelper();
        const line = await requestLine(request);
        const payload = JSON.parse(line);
        consecutiveFailures = 0;
        if (payload?.ok === false) {
            console.error(`${LOG_PREFIX} helper error:`, payload.error);
            return null;
        }
        return payload;
    } catch (error) {
        consecutiveFailures++;
        if (consecutiveFailures === 1 || consecutiveFailures === MAX_CONSECUTIVE_FAILURES) {
            console.error(`${LOG_PREFIX} media session query failed:`, error);
        }
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            cooldownUntil = Date.now() + FAILURE_COOLDOWN_MS;
            consecutiveFailures = 0;
            console.error(`${LOG_PREFIX} backing off for ${FAILURE_COOLDOWN_MS / 1000}s after repeated failures`);
        }
        return null;
    }
}

// ---------------------------------------------------------------------------
// Metadata normalisation
// ---------------------------------------------------------------------------

// Apple Music for Windows reports "Artist \u2014 Album" in the artist field and
// leaves albumTitle empty, unlike every other SMTC source. Split it back apart.
const EM_DASH_SEP = " \u2014 ";

function splitArtistAlbum(value: string) {
    const index = value.indexOf(EM_DASH_SEP);
    if (index === -1) return null;
    const artist = value.slice(0, index).trim();
    const album = value.slice(index + EM_DASH_SEP.length).trim();
    return artist ? { artist, album } : null;
}

interface RawSession {
    found: boolean;
    sourceAppId?: string;
    status?: string;
    title?: string;
    artist?: string;
    albumTitle?: string;
    albumArtist?: string;
    position?: number;
    duration?: number;
    sources?: string[];
    controls?: TrackControls;
}

function normaliseSession(raw: RawSession) {
    const name = (raw.title ?? "").trim();
    let artist = (raw.artist ?? "").trim();
    let album = (raw.albumTitle ?? "").trim();

    const split = splitArtistAlbum(artist);
    if (split) {
        artist = split.artist;
        if (!album && split.album) album = split.album;
    }

    if (!album) {
        const albumArtist = (raw.albumArtist ?? "").trim();
        const albumArtistSplit = albumArtist ? splitArtistAlbum(albumArtist) : null;
        if (albumArtistSplit?.album) album = albumArtistSplit.album;
    }

    const duration = typeof raw.duration === "number" && raw.duration > 0 ? raw.duration : undefined;
    const position = typeof raw.position === "number" && raw.position >= 0 ? raw.position : undefined;

    return {
        name,
        artist: artist || undefined,
        album: album || undefined,
        duration,
        playerPosition: position
    };
}

// ---------------------------------------------------------------------------
// iTunes Search API enrichment (artwork + links)
//
// SMTC gives no artwork URL and no catalogue id, so the track is looked up by
// name. Unlike the macOS plugin this scores the track name too - matching on
// album alone returns an arbitrary track from the right album.
// ---------------------------------------------------------------------------

interface RemoteData {
    appleMusicLink?: string;
    appleMusicArtistLink?: string;
    songLink?: string;
    albumArtwork?: string;
    artistArtwork?: string;
}

function normaliseForCompare(value: string | undefined) {
    return (value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function similarity(a: string | undefined, b: string | undefined) {
    const x = normaliseForCompare(a);
    const y = normaliseForCompare(b);
    if (!x || !y) return 0;
    if (x === y) return 2;
    if (x.includes(y) || y.includes(x)) return 1;
    return 0;
}

function pickBestSong(results: any[], track: { name: string; artist?: string; album?: string; }) {
    let best: any = null;
    let bestScore = -1;
    for (const song of results) {
        // Track name dominates, then album, then artist.
        const score = similarity(song.trackName, track.name) * 4
            + similarity(song.collectionName, track.album) * 2
            + similarity(song.artistName, track.artist);
        if (score > bestScore) {
            bestScore = score;
            best = song;
        }
    }
    return bestScore > 0 ? best : results[0] ?? null;
}

type CacheEntry = { data: RemoteData; } | { failures: number; };

const remoteCache = new Map<string, CacheEntry>();
const REMOTE_CACHE_LIMIT = 50;

function cacheKey(track: { name: string; artist?: string; album?: string; }) {
    return [track.name, track.artist ?? "", track.album ?? ""].map(normaliseForCompare).join("|");
}

function rememberRemote(key: string, entry: CacheEntry) {
    // Cheap LRU-ish bound: drop the oldest insertion once over the limit.
    if (remoteCache.size >= REMOTE_CACHE_LIMIT) {
        const oldest = remoteCache.keys().next().value;
        if (oldest !== undefined) remoteCache.delete(oldest);
    }
    remoteCache.set(key, entry);
}

async function fetchRemoteData(track: { name: string; artist?: string; album?: string; }): Promise<RemoteData | null> {
    const key = cacheKey(track);
    const cached = remoteCache.get(key);
    if (cached) {
        if ("data" in cached) return cached.data;
        if (cached.failures >= 5) return null;
    }

    try {
        const dataUrl = new URL("https://itunes.apple.com/search");
        dataUrl.searchParams.set("term", [track.name, track.artist, track.album].filter(Boolean).join(" "));
        dataUrl.searchParams.set("media", "music");
        dataUrl.searchParams.set("entity", "song");
        dataUrl.searchParams.set("limit", "25");

        const response = await fetch(dataUrl, { headers: { "user-agent": VENCORD_USER_AGENT } });
        if (!response.ok) throw new Error(`iTunes search returned ${response.status}`);

        const json = await response.json() as { results?: any[]; };
        const songData = pickBestSong(json.results ?? [], track);
        if (!songData?.trackViewUrl) throw new Error("no matching track");

        const artistArtwork = await fetch(songData.artistViewUrl)
            .then(r => r.text())
            .then(html => {
                const match = html.match(/<meta property="og:image" content="(.+?)">/);
                return match ? match[1].replace(/[0-9]+x.+/, "220x220bb-60.png") : undefined;
            })
            .catch(() => undefined);

        const trackId = new URL(songData.trackViewUrl).searchParams.get("i");

        const data: RemoteData = {
            appleMusicLink: songData.trackViewUrl,
            appleMusicArtistLink: songData.artistViewUrl,
            songLink: trackId ? `https://song.link/i/${trackId}` : undefined,
            albumArtwork: songData.artworkUrl100?.replace("100x100", "512x512"),
            artistArtwork
        };

        rememberRemote(key, { data });
        return data;
    } catch (error) {
        console.error(`${LOG_PREFIX} Failed to fetch remote data:`, error);
        const failures = (cached && "failures" in cached ? cached.failures : 0) + 1;
        rememberRemote(key, { failures });
        return null;
    }
}

// ---------------------------------------------------------------------------
// Exports (called from index.tsx via VencordNative.pluginHelpers)
// ---------------------------------------------------------------------------

export async function fetchTrackData(
    _: IpcMainInvokeEvent,
    sourcePattern: string,
    includePaused: boolean
): Promise<TrackData | null> {
    const payload = await sendRequest({ op: "get", pattern: sourcePattern }) as RawSession | null;
    if (!payload?.found) return null;

    const isPlaying = payload.status === "Playing";
    if (!isPlaying && !includePaused) return null;

    const track = normaliseSession(payload);
    if (!track.name) return null;

    const remoteData = await fetchRemoteData(track);

    return {
        ...track,
        ...remoteData,
        isPlaying,
        sourceAppId: payload.sourceAppId,
        controls: payload.controls
    };
}

/**
 * Send a transport command to the matching session.
 *
 * Returns whether the command was *delivered*, which is not the same as
 * honoured: Apple Music returns true for seek and shuffle while ignoring both.
 * Only the commands it advertises in `controls` actually take effect.
 */
export async function sendCommand(
    _: IpcMainInvokeEvent,
    sourcePattern: string,
    command: TransportCommand
): Promise<boolean> {
    const payload = await sendRequest({ op: "cmd", pattern: sourcePattern, command });
    return payload?.found === true && payload?.delivered === true;
}

/** Diagnostic for the settings panel: what media sources does Windows see? */
export async function listMediaSources(_: IpcMainInvokeEvent): Promise<string[] | null> {
    const payload = await sendRequest({ op: "sources" });
    if (!payload) return null;
    const { sources } = payload;
    if (!sources) return [];
    return Array.isArray(sources) ? sources : [sources];
}

/** Called from the plugin's stop() so the child process doesn't linger. */
export async function stopHelper(_: IpcMainInvokeEvent): Promise<void> {
    if (!proc) return;
    teardown(new Error("helper stopped"));
}
