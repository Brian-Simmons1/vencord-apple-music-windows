/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Brian Simmons
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

import type { TrackData } from ".";

// The plugin already polls the media session to build the Discord activity.
// The panel player subscribes to that same data rather than polling a second
// time, so both always agree and the helper still sees one request per tick.

let current: TrackData | null = null;
let lastUpdatedAt = 0;

const listeners = new Set<() => void>();

export function getTrack() {
    return current;
}

/** When the current snapshot was taken, for extrapolating the progress bar. */
export function getLastUpdatedAt() {
    return lastUpdatedAt;
}

export function setTrack(track: TrackData | null) {
    current = track;
    lastUpdatedAt = Date.now();
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch (error) {
            console.error("[AppleMusicWindowsRichPresence] store listener threw:", error);
        }
    }
}

export function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

// The player asks for an out-of-band poll after sending a transport command.
// index.tsx owns the polling, so it registers the handler here rather than the
// component reaching into the plugin through the Vencord global.
let refreshHandler: (() => void) | null = null;

export function setRefreshHandler(handler: (() => void) | null) {
    refreshHandler = handler;
}

export function requestRefresh() {
    refreshHandler?.();
}

export function useTrack() {
    const [track, setLocal] = useState(current);

    useEffect(() => subscribe(() => setLocal(current)), []);

    return track;
}

/**
 * Playback position in seconds, advanced locally between polls so the bar
 * moves smoothly instead of jumping once per refresh interval.
 */
export function useSmoothPosition(track: TrackData | null) {
    const [, forceTick] = useState(0);

    useEffect(() => {
        if (!track?.isPlaying) return;
        const id = setInterval(() => forceTick(n => n + 1), 1000);
        return () => clearInterval(id);
    }, [track?.isPlaying, track?.name]);

    if (track?.playerPosition === undefined) return undefined;
    if (!track.isPlaying) return track.playerPosition;

    const elapsed = (Date.now() - lastUpdatedAt) / 1000;
    const position = track.playerPosition + elapsed;

    return track.duration !== undefined ? Math.min(position, track.duration) : position;
}
