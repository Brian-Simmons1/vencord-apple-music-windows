// Measures how much of this plugin is still shared with Vencord's macOS
// appleMusic.desktop plugin. This is a licensing question, not a style one:
// GPL-3.0-or-later is required only for as long as the work is genuinely
// derivative, so it is worth knowing the real number rather than guessing.
//   node dev/test-derivation.mjs <path-to-upstream-dir>

import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = join(ROOT, "appleMusicWindows.desktop");
const UPSTREAM = process.argv[2];

if (!UPSTREAM) {
    console.error("usage: node dev/test-derivation.mjs <path-to-upstream-dir>");
    process.exit(2);
}

// Comments, blank lines and license headers are not the interesting part.
const meaningful = src => src
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"))
    .map(l => l.replace(/\s+/g, " "));

const upstreamLines = new Set();
for (const f of readdirSync(UPSTREAM)) {
    for (const l of meaningful(readFileSync(join(UPSTREAM, f), "utf8"))) upstreamLines.add(l);
}

// Lines too generic to signal derivation (closing braces, lone keywords).
const trivial = l => l.length < 12 || /^[)}\]};,]+$/.test(l) || /^(return|else|try|\} catch \{|\} else \{)$/.test(l);

console.log(`upstream corpus: ${upstreamLines.size} distinct lines\n`);
console.log("file                     total  shared  shared%");
console.log("-".repeat(52));

let grandTotal = 0, grandShared = 0;
const perFile = [];

for (const f of readdirSync(PLUGIN).sort()) {
    if (!/\.(ts|tsx|css)$/.test(f)) continue;
    if (f === "smtcScript.ts") continue; // generated: embedded PowerShell

    const lines = meaningful(readFileSync(join(PLUGIN, f), "utf8")).filter(l => !trivial(l));
    if (!lines.length) continue;

    const shared = lines.filter(l => upstreamLines.has(l));
    const pct = (shared.length / lines.length) * 100;

    grandTotal += lines.length;
    grandShared += shared.length;
    perFile.push({ f, total: lines.length, shared: shared.length, pct, sharedLines: shared });

    console.log(`${f.padEnd(24)} ${String(lines.length).padStart(5)}  ${String(shared.length).padStart(6)}  ${pct.toFixed(1).padStart(6)}%`);
}

console.log("-".repeat(52));
console.log(`${"TOTAL".padEnd(24)} ${String(grandTotal).padStart(5)}  ${String(grandShared).padStart(6)}  ${((grandShared / grandTotal) * 100).toFixed(1).padStart(6)}%`);

// Also count the PowerShell, which has no upstream counterpart at all.
const ps = meaningful(readFileSync(join(ROOT, "dev", "smtc.ps1"), "utf8")).filter(l => !trivial(l));
console.log(`\n(plus ${ps.length} lines of PowerShell with no upstream equivalent)`);

console.log("\nwhere the shared lines actually are:");
for (const { f, sharedLines } of perFile.filter(x => x.shared > 0)) {
    console.log(`\n  ${f}:`);
    const sample = sharedLines.slice(0, 6);
    for (const l of sample) console.log(`    ${l.slice(0, 88)}`);
    if (sharedLines.length > sample.length) console.log(`    ... and ${sharedLines.length - sample.length} more`);
}
