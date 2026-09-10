/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Brian Simmons
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { IS_WINDOWS } from "@utils/constants";
import definePlugin, { OptionType, PluginNative, ReporterTestable } from "@utils/types";
import { Activity, ActivityAssets, ActivityButton } from "@vencord/discord-types";
import { ActivityFlags, ActivityStatusDisplayType, ActivityType } from "@vencord/discord-types/enums";
import { ApplicationAssetUtils, FluxDispatcher, useState } from "@webpack/common";

const Native = VencordNative.pluginHelpers.AppleMusicWindowsRichPresence as PluginNative<typeof import("./native")>;

export interface TrackData {
    name: string;
    album?: string;
    artist?: string;

    appleMusicLink?: string;
    appleMusicArtistLink?: string;
    songLink?: string;

    albumArtwork?: string;
    artistArtwork?: string;

    playerPosition?: number;
    duration?: number;

    isPlaying?: boolean;
    sourceAppId?: string;
}

const enum AssetImageType {
    Album = "Album",
    Artist = "Artist",
    Disabled = "Disabled"
}

const enum LinkType {
    Album = "Album",
    Artist = "Artist",
    Disabled = "Disabled"
}

// Same Discord application as the macOS AppleMusicRichPresence plugin, so the
// activity is labelled "Apple Music" and external artwork URLs can be proxied.
const applicationId = "1239490006054207550";

// SourceAppUserModelId patterns for the Windows media session (SMTC).
const APPLE_MUSIC_APP_PATTERN = "AppleInc\\.AppleMusicWin";
const ITUNES_PATTERN = "^iTunes\\.exe$";
const MATCH_NOTHING_PATTERN = "(?!)";

function setActivity(activity: Activity | null) {
    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        activity,
        socketId: "AppleMusicWindows",
    });
}

const settings = definePluginSettings({
    matchAppleMusicApp: {
        type: OptionType.BOOLEAN,
        description: "Track the Apple Music app from the Microsoft Store",
        default: true,
    },
    matchITunes: {
        type: OptionType.BOOLEAN,
        description: "Track iTunes for Windows",
        default: true,
    },
    customSourcePattern: {
        type: OptionType.STRING,
        description: "Advanced: extra media sources to track, as a regex matched against the Windows media session app id (e.g. msedge\\.exe). Leave empty unless you know what you're doing - a browser matches ANY media it plays, including YouTube.",
        default: "",
    },
    showWhenPaused: {
        type: OptionType.BOOLEAN,
        description: "Keep showing the activity while playback is paused",
        default: false,
    },
    activityType: {
        type: OptionType.SELECT,
        description: "Which type of activity. \"Listening\" gets the green music note in the member list; \"Playing\" gets the game controller.",
        options: [
            { label: "Listening", value: ActivityType.LISTENING, default: true },
            { label: "Playing", value: ActivityType.PLAYING }
        ],
    },
    statusDisplayType: {
        description: "What to show on the one-line activity in the member list. \"Show artist name\" uses the state format string, so keep that short if you pick it.",
        type: OptionType.SELECT,
        options: [
            { label: "Show track name", value: "track", default: true },
            { label: "Show artist name", value: "artist" },
            { label: "Don't show (shows generic listening message)", value: "off" }
        ]
    },
    refreshInterval: {
        type: OptionType.SLIDER,
        description: "The interval between activity refreshes (seconds)",
        markers: [1, 2, 2.5, 3, 5, 10, 15],
        default: 5,
        restartNeeded: true,
    },
    enableTimestamps: {
        type: OptionType.BOOLEAN,
        description: "Whether or not to enable timestamps",
        default: true,
    },
    enableButtons: {
        type: OptionType.BOOLEAN,
        description: "Whether or not to enable buttons",
        default: true,
    },
    nameString: {
        type: OptionType.STRING,
        description: "Activity name format string",
        default: "Apple Music"
    },
    detailsString: {
        type: OptionType.STRING,
        description: "Activity details format string",
        default: "{name}"
    },
    stateString: {
        type: OptionType.STRING,
        description: "Activity state format string. Kept to just the artist because the album already shows as its own line via the large image text.",
        default: "{artist}"
    },
    detailsLink: {
        type: OptionType.SELECT,
        description: "Activity details link",
        options: [
            { label: "Album", value: LinkType.Album, default: true },
            { label: "Artist", value: LinkType.Artist },
            { label: "Disabled", value: LinkType.Disabled }
        ],
    },
    stateLink: {
        type: OptionType.SELECT,
        description: "Activity state link",
        options: [
            { label: "Album", value: LinkType.Album },
            { label: "Artist", value: LinkType.Artist, default: true },
            { label: "Disabled", value: LinkType.Disabled }
        ],
    },
    largeImageType: {
        type: OptionType.SELECT,
        description: "Activity assets large image type",
        options: [
            { label: "Album artwork", value: AssetImageType.Album, default: true },
            { label: "Artist artwork", value: AssetImageType.Artist },
            { label: "Disabled", value: AssetImageType.Disabled }
        ],
    },
    largeTextString: {
        type: OptionType.STRING,
        description: "Activity assets large text format string",
        default: "{album}"
    },
    largeImageLink: {
        type: OptionType.SELECT,
        description: "Activity assets large image link",
        options: [
            { label: "Album", value: LinkType.Album, default: true },
            { label: "Artist", value: LinkType.Artist },
            { label: "Disabled", value: LinkType.Disabled }
        ],
    },
    smallImageType: {
        type: OptionType.SELECT,
        description: "Activity assets small image type",
        options: [
            { label: "Album artwork", value: AssetImageType.Album },
            { label: "Artist artwork", value: AssetImageType.Artist, default: true },
            { label: "Disabled", value: AssetImageType.Disabled }
        ],
    },
    smallTextString: {
        type: OptionType.STRING,
        description: "Activity assets small text format string",
        default: "{artist}"
    },
    smallImageLink: {
        type: OptionType.SELECT,
        description: "Activity assets small image link",
        options: [
            { label: "Album", value: LinkType.Album },
            { label: "Artist", value: LinkType.Artist, default: true },
            { label: "Disabled", value: LinkType.Disabled }
        ],
    },
});

function buildSourcePattern() {
    const parts: string[] = [];
    if (settings.store.matchAppleMusicApp) parts.push(APPLE_MUSIC_APP_PATTERN);
    if (settings.store.matchITunes) parts.push(ITUNES_PATTERN);

    const custom = settings.store.customSourcePattern?.trim();
    if (custom) parts.push(custom);

    return parts.length ? parts.join("|") : MATCH_NOTHING_PATTERN;
}

function customFormat(formatStr: string, data: TrackData) {
    return formatStr
        .replaceAll("{name}", data.name)
        .replaceAll("{album}", data.album ?? "")
        .replaceAll("{artist}", data.artist ?? "");
}

function getLink(type: LinkType, data: TrackData) {
    return type === LinkType.Album
        ? data.appleMusicLink
        : type === LinkType.Artist
            ? data.appleMusicArtistLink
            : undefined;
}

function getImageAsset(type: AssetImageType, data: TrackData) {
    const source = type === AssetImageType.Album
        ? data.albumArtwork
        : data.artistArtwork;

    if (!source) return undefined;

    return ApplicationAssetUtils.fetchAssetIds(applicationId, [source]).then(ids => ids[0]);
}

function DetectedSources() {
    const [sources, setSources] = useState<string[] | null>(null);
    const [loading, setLoading] = useState(false);

    return <>
        <Button
            size="small"
            disabled={loading}
            onClick={async () => {
                setLoading(true);
                try {
                    setSources(await Native.listMediaSources() ?? []);
                } finally {
                    setLoading(false);
                }
            }}
        >
            {loading ? "Checking…" : "Show detected media sources"}
        </Button>
        {sources && <Paragraph>
            {sources.length
                ? <>
                    Windows currently reports these media sources:{" "}
                    {sources.map((source, i) => <span key={source}>
                        {i > 0 && ", "}
                        <code>{source}</code>
                    </span>)}
                </>
                : "Windows reports no media sources right now. Start playback in Apple Music and try again."}
        </Paragraph>}
    </>;
}

export default definePlugin({
    name: "AppleMusicWindowsRichPresence",
    description: "Discord rich presence for Apple Music on Windows, via the Windows media session.",
    tags: ["Activity", "Media"],
    authors: [{ name: "Brian Simmons", id: 0n }],
    hidden: !IS_WINDOWS,
    reporterTestable: ReporterTestable.None,

    settingsAboutComponent() {
        return <>
            <Paragraph>
                Reads whatever the Apple Music app (or iTunes) reports to the Windows media session, then looks the
                track up on the iTunes Search API to get artwork and links. Nothing is sent anywhere except that
                public search request.
            </Paragraph>
            <Paragraph>
                For the customizable activity format strings, you can use several special strings to include track data in activities!{" "}
                <code>{"{name}"}</code> is replaced with the track name; <code>{"{artist}"}</code> is replaced with the artist(s)' name(s); and <code>{"{album}"}</code> is replaced with the album name.
            </Paragraph>
            <Paragraph>
                Not showing up? Make sure Apple Music is actually playing, and that its media controls appear in the
                Windows volume flyout. This checks which sources Windows can see:
            </Paragraph>
            <DetectedSources />
        </>;
    },

    settings,

    start() {
        this.updatePresence();
        this.updateInterval = setInterval(() => { this.updatePresence(); }, settings.store.refreshInterval * 1000);
    },

    stop() {
        clearInterval(this.updateInterval);
        FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity: null });
        Native.stopHelper();
    },

    updatePresence() {
        this.getActivity().then(activity => { setActivity(activity); });
    },

    async getActivity(): Promise<Activity | null> {
        const trackData = await Native.fetchTrackData(buildSourcePattern(), settings.store.showWhenPaused);
        if (!trackData) return null;

        const [largeImageAsset, smallImageAsset] = await Promise.all([
            getImageAsset(settings.store.largeImageType, trackData),
            getImageAsset(settings.store.smallImageType, trackData)
        ]);

        const assets: ActivityAssets = {};

        // Live radio and streams report no usable duration.
        const isRadio = trackData.duration === undefined;

        if (settings.store.largeImageType !== AssetImageType.Disabled) {
            assets.large_image = largeImageAsset;
            if (!isRadio) assets.large_text = customFormat(settings.store.largeTextString, trackData);
            assets.large_url = getLink(settings.store.largeImageLink, trackData);
        }

        if (settings.store.smallImageType !== AssetImageType.Disabled) {
            assets.small_image = smallImageAsset;
            if (!isRadio) assets.small_text = customFormat(settings.store.smallTextString, trackData);
            assets.small_url = getLink(settings.store.smallImageLink, trackData);
        }

        const buttons: ActivityButton[] = [];

        if (settings.store.enableButtons) {
            if (trackData.appleMusicLink)
                buttons.push({
                    label: "Listen on Apple Music",
                    url: trackData.appleMusicLink,
                });

            if (trackData.songLink)
                buttons.push({
                    label: "View on SongLink",
                    url: trackData.songLink,
                });
        }

        // A paused track has a frozen position, so a running timestamp would lie.
        const showTimestamps = settings.store.enableTimestamps
            && trackData.isPlaying
            && trackData.playerPosition !== undefined
            && trackData.duration !== undefined;

        return {
            application_id: applicationId,

            name: customFormat(settings.store.nameString, trackData),
            details: customFormat(settings.store.detailsString, trackData),
            state: isRadio ? undefined : customFormat(settings.store.stateString, trackData),
            details_url: getLink(settings.store.detailsLink, trackData),
            state_url: getLink(settings.store.stateLink, trackData),

            timestamps: showTimestamps ? {
                start: Date.now() - (trackData.playerPosition! * 1000),
                end: Date.now() - (trackData.playerPosition! * 1000) + (trackData.duration! * 1000),
            } : undefined,

            assets,

            buttons: !isRadio && buttons.length ? buttons.map(v => v.label) : undefined,
            metadata: !isRadio && buttons.length ? { button_urls: buttons.map(v => v.url) } : undefined,

            type: settings.store.activityType,
            status_display_type: {
                "off": ActivityStatusDisplayType.NAME,
                "artist": ActivityStatusDisplayType.STATE,
                "track": ActivityStatusDisplayType.DETAILS
            }[settings.store.statusDisplayType],
            flags: ActivityFlags.INSTANCE,
        };
    }
});
