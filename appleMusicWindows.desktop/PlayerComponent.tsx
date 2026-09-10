/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Brian Simmons
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { Link } from "@components/Link";
import { useState } from "@webpack/common";
import type { ReactNode } from "react";

import { buildSourcePattern, Native, settings, type TransportCommand } from ".";
import { requestRefresh, useSmoothPosition, useTrack } from "./store";

function formatTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds);
    return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

const PreviousIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
    </svg>
);

const NextIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M16 6h2v12h-2zm-2.5 6L5 6v12z" />
    </svg>
);

const PlayIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5v14l11-7z" />
    </svg>
);

const PauseIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
    </svg>
);

interface ControlButtonProps {
    label: string;
    /** Busy sending a command - momentary, so it keeps the plain label. */
    disabled?: boolean;
    /** The session says it does not accept this command at all. */
    unavailable?: boolean;
    onClick(): void;
    children: ReactNode;
}

function ControlButton({ label, disabled, unavailable, onClick, children }: ControlButtonProps) {
    // Apple Music radio stations refuse skipping outright, so say why rather
    // than leaving a dead button with a "no entry" cursor.
    const title = unavailable ? `${label} is not available for this station` : label;

    return (
        <button
            className="vc-amw-button"
            aria-label={title}
            title={title}
            disabled={disabled || unavailable}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

export function Player() {
    const track = useTrack();
    const position = useSmoothPosition(track);
    const [busy, setBusy] = useState(false);

    if (!settings.store.showPlayerControls) return null;
    if (!track) return null;

    const { controls } = track;

    async function run(command: TransportCommand) {
        if (busy) return;
        setBusy(true);
        try {
            await Native.sendCommand(buildSourcePattern(), command);
            // Apple Music takes a moment to settle, so refresh sooner than the
            // next scheduled poll rather than leaving the button state stale.
            setTimeout(requestRefresh, 350);
        } catch (error) {
            console.error("[AppleMusicWindowsRichPresence] command failed:", error);
        } finally {
            setBusy(false);
        }
    }

    const showProgress = settings.store.showProgressBar
        && position !== undefined
        && track.duration !== undefined
        && track.duration > 0;

    return (
        <div className="vc-amw-player">
            <div className="vc-amw-info">
                {settings.store.showAlbumArt && track.albumArtwork && (
                    <img className="vc-amw-art" src={track.albumArtwork} alt={track.album ?? track.name} />
                )}

                <div className="vc-amw-text">
                    {track.appleMusicLink
                        ? <Link className="vc-amw-title" href={track.appleMusicLink}>{track.name}</Link>
                        : <span className="vc-amw-title">{track.name}</span>}

                    {track.artist && (track.appleMusicArtistLink
                        ? <Link className="vc-amw-subtitle" href={track.appleMusicArtistLink}>{track.artist}</Link>
                        : <span className="vc-amw-subtitle">{track.artist}</span>)}
                </div>
            </div>

            {showProgress && (
                <div className="vc-amw-progress">
                    <span className="vc-amw-time">{formatTime(position!)}</span>
                    {/* Read-only: Apple Music ignores TryChangePlaybackPositionAsync. */}
                    <div className="vc-amw-bar" role="presentation">
                        <div
                            className="vc-amw-bar-fill"
                            style={{ width: `${Math.min(100, (position! / track.duration!) * 100)}%` }}
                        />
                    </div>
                    <span className="vc-amw-time">{formatTime(track.duration!)}</span>
                </div>
            )}

            <div className="vc-amw-controls">
                <ControlButton label="Previous" disabled={busy} unavailable={controls?.previous === false} onClick={() => run("previous")}>
                    <PreviousIcon />
                </ControlButton>

                <ControlButton
                    label={track.isPlaying ? "Pause" : "Play"}
                    disabled={busy}
                    unavailable={controls?.playPause === false}
                    onClick={() => run("playpause")}
                >
                    {track.isPlaying ? <PauseIcon /> : <PlayIcon />}
                </ControlButton>

                <ControlButton label="Next" disabled={busy} unavailable={controls?.next === false} onClick={() => run("next")}>
                    <NextIcon />
                </ControlButton>
            </div>
        </div>
    );
}
