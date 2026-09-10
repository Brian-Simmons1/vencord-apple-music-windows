// Prints iTunes Search results in API order, which is the order the macOS
// plugin's .find() walks. Reads either a saved response or a live query.
//
//   node dev/itunes-results.mjs "%USERPROFILE%\Downloads\1.txt"
//   node dev/itunes-results.mjs "Stay" "Mac Miller" "The Divine Feminine (10th Anniversary)"
//
// The API sends content-disposition: attachment, so a browser saves the JSON
// as 1.txt instead of rendering it - hence the file mode.

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";

const args = process.argv.slice(2);
if (!args.length) {
    console.error('usage: node dev/itunes-results.mjs <file.txt> | "<track>" "<artist>" "<album>"');
    process.exit(2);
}

// PowerShell passes a bare ~ through literally, so expand it here.
const expand = p => p.replace(/^~(?=[/\\]|$)/, homedir());

// A single argument that looks like a path is always meant as one. Without
// this check a typo'd path silently became a search term for that path.
const looksLikePath = arg => /[/\\]/.test(arg) || /\.(txt|json)$/i.test(arg);

let json, album;

if (args.length === 1 && looksLikePath(args[0])) {
    const path = expand(args[0]);
    if (!existsSync(path)) {
        console.error(`no such file: ${path}`);
        if (path !== args[0]) console.error(`(expanded from ${args[0]})`);
        process.exit(1);
    }
    json = JSON.parse(readFileSync(path, "utf8"));
    console.log(`read ${path}\n`);
} else if (args.length === 1) {
    console.error(`"${args[0]}" is not a file, and a search needs a track, artist and album.`);
    process.exit(2);
} else {
    const [name, artist, albumArg] = args;
    album = albumArg;
    const url = new URL("https://itunes.apple.com/search");
    url.searchParams.set("term", [name, artist, album].filter(Boolean).join(" "));
    url.searchParams.set("media", "music");
    url.searchParams.set("entity", "song");
    console.log(`${url}\n`);
    json = await fetch(url).then(r => r.json());
}

const results = json.results ?? [];
console.log(`${results.length} results, in the order the API returned them:\n`);

const width = Math.min(46, Math.max(...results.map(r => (r.trackName || "").length)));
results.forEach((r, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${(r.trackName || "").slice(0, width).padEnd(width)}  ${r.collectionName}`);
});

if (album) {
    const picked = results.find(r => r.collectionName === album);
    console.log(`\nthe plugin's .find(collectionName === album) returns:`);
    console.log(`  #${results.indexOf(picked) + 1}  "${picked?.trackName}"  --  ${picked?.collectionName}`);
}
