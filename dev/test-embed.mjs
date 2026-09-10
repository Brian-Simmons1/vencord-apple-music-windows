// Verifies the embedded SMTC_SCRIPT is byte-identical to dev/smtc.ps1, by
// evaluating the generated template literal the same way esbuild will, then
// runs the *embedded* copy end-to-end to prove it survives the round trip.

import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const tsSource = readFileSync(join(ROOT, "appleMusicWindows.desktop", "smtcScript.ts"), "utf8");
const original = readFileSync(join(ROOT, "dev", "smtc.ps1"), "utf8").replace(/\r\n/g, "\n");

// Strip the TS-only `export` keyword and evaluate as plain JS.
const asJs = tsSource.replace("export const SMTC_SCRIPT", "const SMTC_SCRIPT") + "\nreturn SMTC_SCRIPT;";
// eslint-disable-next-line no-new-func
const embedded = new Function(asJs)();

console.log("embedded length :", embedded.length);
console.log("original length :", original.length);
console.log("byte-identical  :", embedded === original);

if (embedded !== original) {
    for (let i = 0; i < Math.max(embedded.length, original.length); i++) {
        if (embedded[i] !== original[i]) {
            console.error(`first diff at ${i}: embedded=${JSON.stringify(embedded.slice(i, i + 40))} original=${JSON.stringify(original.slice(i, i + 40))}`);
            break;
        }
    }
    process.exit(1);
}

// Now actually run the embedded copy, exactly as native.ts will.
const dir = mkdtempSync(join(tmpdir(), "vc-am-embed-"));
const scriptPath = join(dir, "smtc.ps1");
writeFileSync(scriptPath, embedded, "utf8");

const PS_EXE = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const proc = spawn(PS_EXE, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath], { windowsHide: true });

let buf = "";
const lines = [];
proc.stdout.setEncoding("utf8");
proc.stdout.on("data", d => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) lines.push(line);
    }
});
proc.stderr.setEncoding("utf8");
proc.stderr.on("data", d => console.error("[ps stderr]", d.trim()));

setTimeout(() => {
    proc.stdin.write("AppleInc\\.AppleMusicWin|^iTunes\\.exe$\n");
    setTimeout(() => {
        proc.stdin.write("quit\n");
        console.log("\nembedded script output:");
        for (const l of lines) console.log("  " + l.slice(0, 220));
        const payload = lines.map(l => JSON.parse(l)).find(o => "found" in o);
        console.log("\nembedded script functional:", !!payload && payload.ok === true);
        process.exit(payload && payload.ok ? 0 : 1);
    }, 1500);
}, 800);
