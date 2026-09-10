// Dev harness: drives dev/smtc.ps1 the same way native.ts does, so the helper
// and the metadata parsing can be verified outside of Discord.
//   node dev/harness.mjs [pollCount] [intervalMs]

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PS_EXE = join(process.env.SystemRoot || "C:\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const SOURCE_PATTERN = "AppleInc\\.AppleMusicWin|^iTunes\\.exe$";

const EM_DASH_SEP = " \u2014 ";

/** Apple Music for Windows reports "Artist — Album" in the artist field and
 *  leaves albumTitle empty. Recover both fields. */
export function parseMetadata(raw) {
    let artist = (raw.artist || "").trim();
    let album = (raw.albumTitle || "").trim();
    const name = (raw.title || "").trim();

    if (artist.includes(EM_DASH_SEP)) {
        const idx = artist.indexOf(EM_DASH_SEP);
        const left = artist.slice(0, idx).trim();
        const right = artist.slice(idx + EM_DASH_SEP.length).trim();
        if (left) {
            artist = left;
            if (!album && right) album = right;
        }
    }

    if (!album) {
        const albumArtist = (raw.albumArtist || "").trim();
        if (albumArtist && albumArtist !== artist && albumArtist.includes(EM_DASH_SEP)) {
            album = albumArtist.slice(albumArtist.indexOf(EM_DASH_SEP) + EM_DASH_SEP.length).trim();
        }
    }

    const duration = raw.duration > 0 ? raw.duration : undefined;
    return { name, artist: artist || undefined, album: album || undefined, duration, playerPosition: raw.position, status: raw.status };
}

class Helper {
    proc = null; queue = []; buf = "";

    start() {
        const proc = spawn(PS_EXE, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(HERE, "smtc.ps1")], { windowsHide: true });
        this.proc = proc;
        proc.stdout.setEncoding("utf8");
        proc.stdout.on("data", d => {
            this.buf += d;
            let i;
            while ((i = this.buf.indexOf("\n")) !== -1) {
                const line = this.buf.slice(0, i).trim();
                this.buf = this.buf.slice(i + 1);
                if (line) this.queue.shift()?.(line);
            }
        });
        proc.stderr.setEncoding("utf8");
        proc.stderr.on("data", d => console.error("[ps stderr]", d.trim()));
        proc.on("exit", c => console.log("[ps exit]", c));
        return new Promise(res => this.queue.push(res)); // ready line
    }

    request(pattern) {
        return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error("timeout")), 5000);
            this.queue.push(l => { clearTimeout(timer); res(JSON.parse(l)); });
            this.proc.stdin.write(JSON.stringify({ op: "get", pattern }) + "\n");
        });
    }

    stop() { try { this.proc.stdin.write("quit\n"); } catch {} }
}

const polls = Number(process.argv[2] ?? 3);
const interval = Number(process.argv[3] ?? 2000);

const h = new Helper();
const t0 = Date.now();
console.log("ready:", await h.start(), `(${Date.now() - t0}ms startup)`);

for (let i = 0; i < polls; i++) {
    const t = Date.now();
    const raw = await h.request(SOURCE_PATTERN);
    const ms = Date.now() - t;
    if (!raw.ok) { console.log(`#${i} ERROR`, raw); }
    else if (!raw.found) { console.log(`#${i} no Apple session (${ms}ms)`); }
    else {
        console.log(`#${i} (${ms}ms) raw:`, JSON.stringify({ artist: raw.artist, albumTitle: raw.albumTitle, status: raw.status, position: raw.position, duration: raw.duration }));
        console.log(`   parsed:`, parseMetadata(raw));
    }
    if (i < polls - 1) await new Promise(r => setTimeout(r, interval));
}
h.stop();
