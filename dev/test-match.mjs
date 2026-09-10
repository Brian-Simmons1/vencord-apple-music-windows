// Verify track selection: the upstream macOS plugin matches on album only,
// which picks the wrong track when several songs share an album.

export function normalize(s) {
    return (s || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function similarity(a, b) {
    const x = normalize(a), y = normalize(b);
    if (!x || !y) return 0;
    if (x === y) return 2;
    if (x.includes(y) || y.includes(x)) return 1;
    return 0;
}

export function pickBestSong(results, { name, artist, album }) {
    let best = null, bestScore = -1;
    for (const song of results) {
        const score = similarity(song.trackName, name) * 4
            + similarity(song.collectionName, album) * 2
            + similarity(song.artistName, artist);
        if (score > bestScore) { bestScore = score; best = song; }
    }
    return bestScore > 0 ? best : results[0] ?? null;
}

const cases = [
    { name: "Stay", artist: "Mac Miller", album: "The Divine Feminine (10th Anniversary)" },
    { name: "Dang! (feat. Anderson .Paak)", artist: "Mac Miller", album: "The Divine Feminine (10th Anniversary)" },
    { name: "Friday I'm in Love", artist: "The Cure", album: "Wish" },
    { name: "Butterflies", artist: "Mac Miller", album: "The Divine Feminine (10th Anniversary)" },
];

for (const c of cases) {
    const url = new URL("https://itunes.apple.com/search");
    url.searchParams.set("term", `${c.name} ${c.artist} ${c.album}`);
    url.searchParams.set("media", "music");
    url.searchParams.set("entity", "song");
    url.searchParams.set("limit", "25");
    const json = await fetch(url).then(r => r.json());

    const oldPick = json.results.find(s => s.collectionName === c.album) || json.results[0];
    const newPick = pickBestSong(json.results, c);
    const ok = normalize(newPick?.trackName) === normalize(c.name);
    console.log(`\nwant: "${c.name}"  (n=${json.resultCount})`);
    console.log(`  upstream logic -> "${oldPick?.trackName}"  ${normalize(oldPick?.trackName) === normalize(c.name) ? "OK" : "*** WRONG ***"}`);
    console.log(`  new matcher    -> "${newPick?.trackName}"  ${ok ? "OK" : "*** WRONG ***"}   album="${newPick?.collectionName}"`);
}
