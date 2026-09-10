// End-to-end: pull the embedded PowerShell back OUT of Vencord's built bundle,
// confirm esbuild preserved it byte-for-byte, and run that extracted copy.
//   node dev/test-bundle.mjs <path-to-vencord>

import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENCORD = process.argv[2] || join(ROOT, "..", "Vencord");
const BUNDLE = join(VENCORD, "dist", "vencordDesktopMain.js");

const original = readFileSync(join(ROOT, "dev", "smtc.ps1"), "utf8").replace(/\r\n/g, "\n");
const bundle = readFileSync(BUNDLE, "utf8");

// Find the string literal esbuild emitted for SMTC_SCRIPT. Anchor on the
// script's own first line, which sits immediately after the opening quote --
// searching backwards from anywhere else just finds a quote *inside* the
// script, since the PowerShell source is full of them.
const firstLine = original.split("\n")[0];
const anchor = bundle.indexOf(firstLine);
if (anchor === -1) throw new Error("embedded script not found in bundle");

const start = anchor - 1;
const quote = bundle[start];
if (quote !== '"' && quote !== "'" && quote !== "`") {
    throw new Error(`expected a quote before the script, got ${JSON.stringify(quote)}`);
}

let end = -1;
for (let i = start + 1; i < bundle.length; i++) {
    if (bundle[i] === "\\") { i++; continue; }
    if (bundle[i] === quote) { end = i; break; }
}
if (end === -1) throw new Error("could not find closing quote");

const literal = bundle.slice(start, end + 1);
// eslint-disable-next-line no-new-func
const extracted = new Function(`return ${literal};`)();

console.log("bundle           :", BUNDLE);
console.log("literal quote    :", quote === "`" ? "template" : quote);
console.log("extracted length :", extracted.length);
console.log("original length  :", original.length);
console.log("byte-identical   :", extracted === original);

if (extracted !== original) {
    for (let i = 0; i < Math.max(extracted.length, original.length); i++) {
        if (extracted[i] !== original[i]) {
            console.error(`first diff at ${i}:\n  bundle  =${JSON.stringify(extracted.slice(i, i + 60))}\n  original=${JSON.stringify(original.slice(i, i + 60))}`);
            break;
        }
    }
    process.exit(1);
}

// Run the copy that came out of the shipped bundle.
const dir = mkdtempSync(join(tmpdir(), "vc-am-bundle-"));
const scriptPath = join(dir, "smtc.ps1");
writeFileSync(scriptPath, extracted, "utf8");

const PS_EXE = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const proc = spawn(PS_EXE, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath], { windowsHide: true });

let buf = "";
const waiters = [];
proc.stdout.setEncoding("utf8");
proc.stdout.on("data", d => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) waiters.shift()?.(line);
    }
});
proc.stderr.setEncoding("utf8");
proc.stderr.on("data", d => console.error("[ps stderr]", String(d).trim()));

const next = () => new Promise(res => waiters.push(res));
await next(); // ready banner

proc.stdin.write(JSON.stringify({ op: "get", pattern: "AppleInc\\.AppleMusicWin|^iTunes\\.exe$" }) + "\n");
const payload = JSON.parse(await next());
proc.stdin.write("quit\n");

console.log("\nbundled script ran:", payload.ok === true);
if (payload.found) {
    console.log(`  ${payload.sourceAppId}`);
    console.log(`  "${payload.title}" | ${payload.artist} | ${payload.status} | ${payload.position}s / ${payload.duration}s`);
} else {
    console.log("  (no Apple Music session playing right now)");
}
process.exit(payload.ok ? 0 : 1);
