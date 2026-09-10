// Exercises the REAL native.ts against whatever is playing right now: bundles
// it with esbuild (stubbing the two Vencord/Electron imports) and calls the
// exported functions the same way Vencord's IPC layer does.
//   node dev/test-native.mjs [path-to-vencord]

import { createRequire } from "module";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { pathToFileURL } from "url";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENCORD = process.argv[2] || join(ROOT, "..", "Vencord");

// esbuild comes from the Vencord install rather than being a dependency here.
const require = createRequire(join(VENCORD, "package.json"));
const esbuild = require("esbuild");

const stubs = {
    name: "stubs",
    setup(build) {
        build.onResolve({ filter: /^@shared\/vencordUserAgent$/ }, () => ({ path: "vencord-ua", namespace: "stub" }));
        build.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
        build.onLoad({ filter: /.*/, namespace: "stub" }, args => ({
            contents: args.path === "vencord-ua"
                ? 'export const VENCORD_USER_AGENT = "Vencord/dev (test-native.mjs)";'
                : "export default {};",
            loader: "js"
        }));
    }
};

const outdir = mkdtempSync(join(tmpdir(), "vc-am-native-"));
const outfile = join(outdir, "native.mjs");

await esbuild.build({
    entryPoints: [join(ROOT, "appleMusicWindows.desktop", "native.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    plugins: [stubs],
    logLevel: "warning"
});

const native = await import(pathToFileURL(outfile).href);
console.log("exports:", Object.keys(native).sort().join(", "));

const PATTERN = "AppleInc\\.AppleMusicWin|^iTunes\\.exe$";

console.log("\n--- listMediaSources() ---");
console.log(await native.listMediaSources(null));

console.log("\n--- fetchTrackData(pattern, includePaused=true) ---");
const t0 = Date.now();
const track = await native.fetchTrackData(null, PATTERN, true);
console.log(`(${Date.now() - t0}ms, includes iTunes lookup)`);
console.log(track);

if (track) {
    const checks = [
        ["name is set", !!track.name],
        ["artist has no em dash", !track.artist?.includes("—")],
        ["album recovered", !!track.album],
        ["album is not the artist", track.album !== track.artist],
        ["album artwork resolved", !!track.albumArtwork],
        ["apple music link resolved", !!track.appleMusicLink],
        ["songlink resolved", !!track.songLink],
        ["duration is a positive number", typeof track.duration === "number" && track.duration > 0],
        ["position within duration", track.playerPosition <= track.duration],
    ];
    console.log("\n--- checks ---");
    let failed = 0;
    for (const [label, ok] of checks) {
        console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
        if (!ok) failed++;
    }

    // Second call must hit the in-memory iTunes cache.
    const t1 = Date.now();
    await native.fetchTrackData(null, PATTERN, true);
    const cachedMs = Date.now() - t1;
    console.log(`\n  cached refetch: ${cachedMs}ms ${cachedMs < 200 ? "(PASS - cache hit)" : "(FAIL - no cache?)"}`);
    if (cachedMs >= 200) failed++;

    await native.stopHelper(null);
    console.log("  stopHelper() returned cleanly");
    process.exit(failed ? 1 : 0);
} else {
    console.log("\nNo track playing - start Apple Music and re-run for the full check.");
    await native.stopHelper(null);
}
