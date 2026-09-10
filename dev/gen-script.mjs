// Embeds dev/smtc.ps1 into the plugin as a TS constant.
// dev/smtc.ps1 is the single source of truth; run this after editing it.
//   node dev/gen-script.mjs           regenerate
//   node dev/gen-script.mjs --check   verify in sync (for CI / pre-commit)

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "dev", "smtc.ps1");
const OUT = join(ROOT, "appleMusicWindows.desktop", "smtcScript.ts");

const ps = readFileSync(SRC, "utf8").replace(/\r\n/g, "\n");

// Only three sequences are special inside a TS template literal.
const escaped = ps
    .split("\\").join("\\\\")
    .split("`").join("\\`")
    .split("${").join("\\${");

const out = `/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Brian Simmons
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// GENERATED FILE - do not edit by hand.
// Source: dev/smtc.ps1 | Regenerate: node dev/gen-script.mjs
//
// The Windows media-session (SMTC) helper, embedded so native.ts can write it
// to a temp file at runtime. Vencord bundles native.ts with esbuild and does
// not copy loose assets, so the script cannot just be read from the plugin dir.

export const SMTC_SCRIPT = \`${escaped}\`;
`;

if (process.argv.includes("--check")) {
    let cur = "";
    try {
        cur = readFileSync(OUT, "utf8");
    } catch {
        // fall through to the mismatch branch
    }
    if (cur !== out) {
        console.error("OUT OF DATE: run `node dev/gen-script.mjs`");
        process.exit(1);
    }
    console.log("smtcScript.ts is up to date");
} else {
    writeFileSync(OUT, out);
    console.log(`wrote ${OUT} (${ps.length} chars of PowerShell)`);
}
