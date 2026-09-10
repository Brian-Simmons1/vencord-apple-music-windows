/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Brian Simmons
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface StationLink {
    name: string;
    url: string;
}

/**
 * Apple's own flagship stations, taken from music.apple.com/us/radio.
 *
 * These ids are the one part of this plugin that can rot - Apple retires and
 * renumbers stations, and a remembered id is not good enough: an earlier guess
 * at the Hits id 404'd, and the real one below differs from it. Artwork is
 * resolved at runtime rather than hardcoded, so a dead station degrades to a
 * plain text button instead of a broken image. Override the whole list with the
 * "customStationLinks" setting.
 */
export const DEFAULT_STATIONS: StationLink[] = [
    { name: "Apple Music 1", url: "https://music.apple.com/us/station/apple-music-1/ra.978194965" },
    { name: "Hits", url: "https://music.apple.com/us/station/apple-music-hits/ra.1498155548" },
    { name: "Country", url: "https://music.apple.com/us/station/apple-music-country/ra.1498157166" },
    { name: "Club", url: "https://music.apple.com/us/station/apple-music-club/ra.1740613859" },
    { name: "Chill", url: "https://music.apple.com/us/station/apple-music-chill/ra.1740614260" },
];

export const BROWSE_STATIONS: StationLink = {
    name: "Browse stations",
    url: "https://music.apple.com/us/radio"
};

/** The app registers the music: scheme, so an https link opens in it instead. */
export function toAppUrl(url: string) {
    return url.replace(/^https:\/\//, "music://");
}

/** Parses the "Name=URL; Name=URL" setting into usable links. */
export function parseStationLinks(raw: string): StationLink[] {
    return raw
        .split(";")
        .map(entry => entry.trim())
        .filter(Boolean)
        .map(entry => {
            const split = entry.indexOf("=");
            if (split === -1) return null;
            const name = entry.slice(0, split).trim();
            const url = entry.slice(split + 1).trim();
            return name && url ? { name, url } : null;
        })
        .filter((x): x is StationLink => x !== null);
}
