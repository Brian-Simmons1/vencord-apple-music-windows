// Prints every media source Windows currently sees, and the Apple Music
// snapshot if there is one. Useful for "why isn't the player showing?".

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

const next = () => new Promise(res => waiters.push(res));
const send = req => { const w = next(); proc.stdin.write(JSON.stringify(req) + "\n"); return w.then(JSON.parse); };

await next();

const { sources } = await send({ op: "sources" });
console.log("media sources Windows sees:", sources?.length ? sources : "(none)");

const apple = await send({ op: "get", pattern: "AppleInc\\.AppleMusicWin|^iTunes\\.exe$" });
if (apple.found) {
    console.log(`apple session: "${apple.title}" | ${apple.status} | ${apple.position}s/${apple.duration}s`);
    console.log("controls:", JSON.stringify(apple.controls));
} else {
    console.log("apple session: NONE - the player will be hidden");
}

proc.stdin.write("quit\n");
