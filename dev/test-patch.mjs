// Verifies the account-panel patch against both the unpatched Discord code and
// the code as SpotifyControls leaves it, since that plugin targets the same
// call and is patched first (src/plugins runs before src/userplugins).

// Mirrors Vencord's canonicalizeMatch: \i -> a bare JS identifier.
const canonicalize = re =>
    new RegExp(re.source.replaceAll(/(\\*)\\i/g, (m, esc) =>
        esc.length % 2 === 0 ? `${esc}(?:[A-Za-z_$][\\w$]*)` : m.slice(1)), re.flags);

const SELF = 'Vencord.Plugins.plugins["AppleMusicWindowsRichPresence"]';
const SPOTIFY = 'Vencord.Plugins.plugins["SpotifyControls"]';

const match = canonicalize(/(?<=\i\.jsxs?\)\()([^,{}]+),{(?=[^}]*?userTag:\i,occluded:)/);
const replace = `${SELF}.PanelWrapper,{AmwOriginal:$1,`;

// Roughly what Discord's minified account panel call looks like.
const UNPATCHED = 'return(0,n.jsx)(AccountPanel,{userTag:e,occluded:t,className:r})';
const SPOTIFY_PATCHED = UNPATCHED.replace(
    canonicalize(/(?<=\i\.jsxs?\)\()(\i),{(?=[^}]*?userTag:\i,occluded:)/),
    `${SPOTIFY}.PanelWrapper,{VencordOriginal:$1,`
);

let failed = 0;
const check = (label, ok, detail = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "\n        " + detail : ""}`);
    if (!ok) failed++;
};

console.log("case 1: no SpotifyControls");
{
    const out = UNPATCHED.replace(match, replace);
    check("patch applied", out !== UNPATCHED);
    check("wraps AccountPanel", out.includes("AmwOriginal:AccountPanel,"), out);
    check("only one AmwOriginal", (out.match(/AmwOriginal:/g) || []).length === 1);
}

console.log("\ncase 2: SpotifyControls patched first");
{
    check("spotify patch itself applied", SPOTIFY_PATCHED !== UNPATCHED, SPOTIFY_PATCHED);
    const out = SPOTIFY_PATCHED.replace(match, replace);
    check("our patch applied on top", out !== SPOTIFY_PATCHED);
    check("hands Spotify's wrapper over as AmwOriginal",
        out.includes(`AmwOriginal:${SPOTIFY}.PanelWrapper,`), out);
    check("Spotify's VencordOriginal survives untouched",
        (out.match(/VencordOriginal:/g) || []).length === 1 && out.includes("VencordOriginal:AccountPanel,"));
    check("our wrapper is outermost", out.includes(`(${SELF}.PanelWrapper,{`));
}

console.log("\ncase 3: the old buggy pattern, for the record");
{
    const old = canonicalize(/(?<=\i\.jsxs?\)\()(\i),{(?=[^}]*?userTag:\i,occluded:)/);
    check("old pattern did NOT match Spotify-patched code (the bug)",
        !old.test(SPOTIFY_PATCHED));
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
