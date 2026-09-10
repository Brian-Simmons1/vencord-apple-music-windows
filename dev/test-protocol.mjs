// Exercises the JSON request protocol: get / sources / cmd, plus malformed
// input. The play/pause command is issued twice so playback ends as it began.

import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PS_EXE = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const PATTERN = "AppleInc\\.AppleMusicWin|^iTunes\\.exe$";

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
const send = req => { const w = next(); proc.stdin.write(JSON.stringify(req) + "\n"); return w.then(JSON.parse); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failed = 0;
const check = (label, ok, extra = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
    if (!ok) failed++;
};

console.log("ready:", await next());

console.log("\n--- op: sources ---");
const sources = await send({ op: "sources" });
check("returns an array", Array.isArray(sources.sources), JSON.stringify(sources.sources));

console.log("\n--- op: get ---");
const snap = await send({ op: "get", pattern: PATTERN });
check("ok", snap.ok === true);
check("found a session", snap.found === true);
if (snap.found) {
    console.log(`  -> "${snap.title}" | ${snap.artist} | ${snap.status} | ${snap.position}s/${snap.duration}s`);
    console.log(`  -> controls:`, JSON.stringify(snap.controls));
    check("controls object present", !!snap.controls && typeof snap.controls.playPause === "boolean");
    check("advertises next", snap.controls.next === true);
    check("advertises previous", snap.controls.previous === true);
}

console.log("\n--- op: cmd (playpause, twice to restore) ---");
const before = snap.status;
const c1 = await send({ op: "cmd", pattern: PATTERN, command: "playpause" });
check("command accepted", c1.ok === true && c1.delivered === true);
await sleep(1500);
const mid = (await send({ op: "get", pattern: PATTERN })).status;
check("status actually changed", mid !== before, `${before} -> ${mid}`);

await send({ op: "cmd", pattern: PATTERN, command: "playpause" });
await sleep(1500);
const after = (await send({ op: "get", pattern: PATTERN })).status;
check("state restored", after === before, `now ${after}`);

console.log("\n--- error handling ---");
const badOp = await send({ op: "nonsense" });
check("unknown op -> ok:false", badOp.ok === false, badOp.error);
const badCmd = await send({ op: "cmd", pattern: PATTERN, command: "explode" });
check("unknown command -> ok:false", badCmd.ok === false, badCmd.error);
const badRegex = await send({ op: "get", pattern: "[unclosed" });
check("bad regex -> ok:false", badRegex.ok === false, badRegex.error);

const w = next();
proc.stdin.write("not json at all\n");
const badJson = JSON.parse(await w);
check("malformed line -> ok:false", badJson.ok === false, badJson.error);

const stillWorks = await send({ op: "get", pattern: PATTERN });
check("still responsive after errors", stillWorks.ok === true);

proc.stdin.write("quit\n");
proc.on("exit", c => {
    check("clean exit", c === 0, `code ${c}`);
    console.log(failed ? `\n${failed} FAILED` : "\nall passed");
    process.exit(failed ? 1 : 0);
});
