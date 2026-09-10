// Resolves artwork for every default station through the real native module,
// which doubles as a rot check: if Apple retires or renumbers a station, the
// og:image lookup fails here rather than silently showing a blank tile.
// Also checks that openAppleMusicUrl refuses anything off music.apple.com.
//   node dev/test-stations.mjs [path-to-vencord]

import { createRequire } from "module";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENCORD = process.argv[2] || join(ROOT, "..", "Vencord");

const require = createRequire(join(VENCORD, "package.json"));
const esbuild = require("esbuild");

let opened = [];

const stubs = {
    name: "stubs",
    setup(build) {
        build.onResolve({ filter: /^@shared\/vencordUserAgent$/ }, () => ({ path: "ua", namespace: "stub" }));
        build.onResolve({ filter: /^@main\/csp$/ }, () => ({ path: "csp", namespace: "stub" }));
        build.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
        build.onLoad({ filter: /.*/, namespace: "stub" }, args => {
            if (args.path === "ua") return { contents: 'export const VENCORD_USER_AGENT = "Vencord/dev (test)";', loader: "js" };
            if (args.path === "csp") return { contents: "export const CspPolicies = {}; export const ImageSrc = [];", loader: "js" };
            // Record openExternal instead of actually launching Apple Music.
            return {
                contents: "export const shell = { openExternal: async url => { globalThis.__opened.push(url); } };",
                loader: "js"
            };
        });
    }
};

globalThis.__opened = opened;

const outfile = join(mkdtempSync(join(tmpdir(), "vc-am-stations-")), "native.mjs");
await esbuild.build({
    entryPoints: [join(ROOT, "appleMusicWindows.desktop", "native.ts")],
    outfile, bundle: true, format: "esm", platform: "node", target: "node22",
    plugins: [stubs], logLevel: "warning"
});

const native = await import(pathToFileURL(outfile).href);

// Read the default station list straight out of the source of truth.
const stationsSrc = readFileSync(join(ROOT, "appleMusicWindows.desktop", "stations.ts"), "utf8");
const stations = [...stationsSrc.matchAll(/\{ name: "([^"]+)", url: "([^"]+)" \}/g)]
    .map(([, name, url]) => ({ name, url }));

let failed = 0;
const check = (label, ok, detail = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
    if (!ok) failed++;
};

console.log(`resolving artwork for ${stations.length} stations\n`);
for (const { name, url } of stations) {
    const art = await native.fetchStationArtwork(null, url);
    let reachable = false;
    if (art) {
        const res = await fetch(art, { method: "GET" });
        reachable = res.ok && (res.headers.get("content-type") || "").startsWith("image/");
    }
    check(name.padEnd(15), !!art && reachable, art ? art.slice(0, 96) : "no og:image - station id may have rotted");
}

console.log("\ncache");
const t = Date.now();
await native.fetchStationArtwork(null, stations[0].url);
check("second lookup is cached", Date.now() - t < 50, `${Date.now() - t}ms`);

console.log("\nopenAppleMusicUrl validation");
check("allows music: on music.apple.com", await native.openAppleMusicUrl(null, "music://music.apple.com/us/radio") === true);
check("allows https: on music.apple.com", await native.openAppleMusicUrl(null, "https://music.apple.com/us/radio") === true);
check("refuses another host", await native.openAppleMusicUrl(null, "music://evil.example.com/x") === false);
check("refuses another scheme", await native.openAppleMusicUrl(null, "file:///C:/Windows/System32/calc.exe") === false);
check("refuses malformed input", await native.openAppleMusicUrl(null, "not a url") === false);
check("only the allowed urls were opened", opened.length === 2, JSON.stringify(opened));

await native.stopHelper(null);
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
