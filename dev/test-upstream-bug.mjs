// Reproduces the iTunes lookup bug using Vencord's macOS appleMusic.desktop
// selection logic verbatim, with its exact query parameters (no `limit`, so the
// API default applies). The bug is platform independent: it lives in the shared
// artwork/link lookup, not in anything AppleScript specific.
//
// Upstream, src/plugins/appleMusic.desktop/native.ts:
//   .then(data => data.results.find(song => song.collectionName === album) || data.results[0])
//
// Matching on the album alone returns whichever track from that album the API
// happened to rank first, which is often not the track being played.

const upstreamSelect = (results, album) =>
    results.find(song => song.collectionName === album) || results[0];

// The fix this plugin uses: score the track name highest, then album, artist.
const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const sim = (a, b) => {
    const x = norm(a), y = norm(b);
    if (!x || !y) return 0;
    if (x === y) return 2;
    return x.includes(y) || y.includes(x) ? 1 : 0;
};

const fixedSelect = (results, { name, artist, album }) => {
    let best = null, score = -1;
    for (const s of results) {
        const v = sim(s.trackName, name) * 4 + sim(s.collectionName, album) * 2 + sim(s.artistName, artist);
        if (v > score) { score = v; best = s; }
    }
    return score > 0 ? best : results[0] ?? null;
};

// The bug needs several tracks from the *same* album in the results: .find()
// then returns whichever of them the API ranked first. Where only one track of
// an album comes back, upstream is accidentally correct, which is why it is not
// noticed more often - so the set below deliberately mixes both situations.
const cases = [
    { name: "Stay", artist: "Mac Miller", album: "The Divine Feminine (10th Anniversary)" },
    { name: "Skin", artist: "Mac Miller", album: "The Divine Feminine (10th Anniversary)" },
    { name: "Soulmate", artist: "Mac Miller", album: "The Divine Feminine (10th Anniversary)" },
    { name: "Stay", artist: "Mac Miller", album: "The Divine Feminine" },
    { name: "No Scrubs", artist: "TLC", album: "FanMail" },
    { name: "Karma Police", artist: "Radiohead", album: "OK Computer" },
    { name: "Let Down", artist: "Radiohead", album: "OK Computer" },
];

let broken = 0, fixedOk = 0;

for (const c of cases) {
    // Upstream's exact request.
    const url = new URL("https://itunes.apple.com/search");
    url.searchParams.set("term", `${c.name} ${c.artist} ${c.album}`);
    url.searchParams.set("media", "music");
    url.searchParams.set("entity", "song");

    const { results = [] } = await fetch(url).then(r => r.json());

    const up = upstreamSelect(results, c.album);
    const fx = fixedSelect(results, c);

    // "Cinderella (feat. ...)" is still the right track, so prefix-match.
    const matches = t => norm(t).startsWith(norm(c.name));
    const upOk = matches(up?.trackName);
    const fxOk = matches(fx?.trackName);
    if (!upOk) broken++;
    if (fxOk) fixedOk++;

    console.log(`want "${c.name}" (${c.artist})  [${results.length} results]`);
    console.log(`  upstream -> "${up?.trackName}"  ${upOk ? "ok" : "*** WRONG ***"}`);
    console.log(`  fixed    -> "${fx?.trackName}"  ${fxOk ? "ok" : "*** WRONG ***"}`);
}

console.log(`\nupstream logic picked the wrong track in ${broken}/${cases.length} cases`);
console.log(`scored matching was correct in       ${fixedOk}/${cases.length} cases`);
