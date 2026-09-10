// Verify the iTunes Search API resolves artwork + links for SMTC-derived metadata.
const cases = [
    { name: "Stay", artist: "Mac Miller", album: "The Divine Feminine (10th Anniversary)" },
    { name: "Dang! (feat. Anderson .Paak)", artist: "Mac Miller", album: "The Divine Feminine (10th Anniversary)" },
    { name: "Friday I'm in Love", artist: "The Cure", album: "Wish" },
];

for (const { name, artist, album } of cases) {
    const url = new URL("https://itunes.apple.com/search");
    url.searchParams.set("term", `${name} ${artist} ${album}`);
    url.searchParams.set("media", "music");
    url.searchParams.set("entity", "song");
    url.searchParams.set("limit", "10");

    const json = await fetch(url).then(r => r.json());
    const exact = json.results.find(s => s.collectionName === album);
    const song = exact || json.results[0];
    console.log(`\n--- query: ${name} / ${artist} / ${album}`);
    console.log(`    results=${json.resultCount} exactAlbumMatch=${!!exact}`);
    if (!song) { console.log("    NO RESULT"); continue; }
    console.log(`    -> ${song.trackName} | ${song.artistName} | ${song.collectionName}`);
    console.log(`    art:  ${(song.artworkUrl100 || "").replace("100x100", "512x512")}`);
    console.log(`    link: ${song.trackViewUrl}`);
    console.log(`    songlink: https://song.link/i/${new URL(song.trackViewUrl).searchParams.get("i")}`);
}
