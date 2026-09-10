// Edge cases for the SMTC helper: the never-matching diagnostic pattern, an
// invalid user regex, single-element array serialisation, and clean shutdown.

import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PS_EXE = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

const proc = spawn(PS_EXE, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(HERE, "smtc.ps1")], { windowsHide: true });

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
const ask = p => { const w = next(); proc.stdin.write(p + "\n"); return w; };

console.log("ready:", await next());

const cases = [
    ["never-matching diagnostic pattern", "(?!)"],
    ["apple music", "AppleInc\\.AppleMusicWin|^iTunes\\.exe$"],
    ["invalid user regex", "[unclosed"],
    ["matches everything (single-elem array check)", ".*"],
    ["only spotify", "^Spotify\\.exe$"],
];

for (const [label, pattern] of cases) {
    const raw = await ask(pattern);
    const o = JSON.parse(raw);
    const srcType = "sources" in o ? (Array.isArray(o.sources) ? `array(${o.sources.length})` : `NOT-ARRAY(${typeof o.sources})`) : "-";
    console.log(`\n${label}`);
    console.log(`  pattern: ${pattern}`);
    console.log(`  ok=${o.ok} found=${o.found ?? "-"} sources=${srcType}${o.error ? " error=" + o.error : ""}`);
    if (o.found) console.log(`  -> ${o.sourceAppId} | ${o.title} | ${o.status}`);
    if (o.sources) console.log(`  -> ${JSON.stringify(o.sources)}`);
}

// Verify the helper still answers after an invalid-regex error (must not wedge).
const after = JSON.parse(await ask("AppleInc\\.AppleMusicWin"));
console.log(`\nstill responsive after error: ok=${after.ok} found=${after.found}`);

proc.stdin.write("quit\n");
proc.on("exit", c => { console.log("clean exit code:", c); process.exit(c === 0 ? 0 : 1); });
