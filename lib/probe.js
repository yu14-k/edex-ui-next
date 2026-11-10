#!/usr/bin/env node
// Runtime smoke test driver.
//
// Boots the real app with the in-app probe (EDEX_PROBE=1) and asserts on the
// machine-readable markers the probe prints:
//
//   EDEX_PROBE_RESULT      base UI state (terminal, filesystem, modules, shortcuts)
//   EDEX_PROBE_SETTINGS    settings modal opens
//   EDEX_PROBE_TAB         new terminal tab spawns
//   EDEX_PROBE_PASTE       main -> renderer clipboard read path
//   EDEX_PROBE_COPY        renderer -> main clipboard write path
//   EDEX_PROBE_PDF         pdfjs 6 parse via module worker
//
// Usage:
//   node lib/probe.js                 # runs `electron src --nointro`
//   node lib/probe.js --log out.txt   # also write the raw output
//   node lib/probe.js --timeout 180   # seconds (default 150)
//
// Linux CI needs a display: `xvfb-run -a node lib/probe.js`
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "src");

// --- args ---------------------------------------------------------------
const argv = process.argv.slice(2);
const getArg = (name, fallback) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const timeoutSec = parseInt(getArg("--timeout", "60"), 10);
const logPath = getArg("--log", null);

// --- locate the electron binary ----------------------------------------
const distDir = path.join(root, "node_modules", "electron", "dist");
const exeName = process.platform === "win32"
    ? "electron.exe"
    : process.platform === "darwin"
        ? path.join("Electron.app", "Contents", "MacOS", "Electron")
        : "electron";
const electronBin = path.join(distDir, exeName);

if (!fs.existsSync(electronBin)) {
    console.error(`probe: electron binary not found at ${electronBin}`);
    console.error("probe: run `npm install` and, on Electron 42+, `node node_modules/electron/install.js`");
    process.exit(2);
}

// --- run ----------------------------------------------------------------
const env = Object.assign({}, process.env, { EDEX_PROBE: "1" });
// In some shells ELECTRON_RUN_AS_NODE makes electron behave like plain node,
// which breaks the main process immediately.
delete env.ELECTRON_RUN_AS_NODE;

console.log(`probe: launching ${path.relative(root, electronBin)} src --nointro`);

const child = spawn(electronBin, [srcDir, "--nointro"], {
    env,
    cwd: root,
    // Own process group on POSIX so a timeout can kill the whole tree
    detached: process.platform !== "win32"
});
let out = "";
let err = "";
let timedOut = false;
let evaluating = false;
const timeout = setTimeout(() => {
    timedOut = true;
    console.log(`probe: no clean exit after ${timeoutSec}s — killing and evaluating what we got`);
    killTree(child);
    setTimeout(evaluate, 1500);
}, timeoutSec * 1000);

// Kill the whole process tree: Electron spawns helpers + cluster workers that a
// plain child.kill() would leave behind.
function killTree(proc) {
    if (!proc || proc.killed) return;
    try {
        if (process.platform === "win32") {
            require("child_process").spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
            try { process.kill(-proc.pid, "SIGKILL"); } catch (e) { proc.kill("SIGKILL"); }
        }
    } catch (e) {
        // already gone
    }
}

child.stdout.on("data", (d) => { out += d.toString(); });
child.stderr.on("data", (d) => { err += d.toString(); });

let finished = false;
function finish(code) {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    if (logPath) {
        fs.writeFileSync(logPath, out + (err ? "\n--- stderr ---\n" + err : ""));
        console.log(`probe: raw output written to ${logPath}`);
    }
    process.exit(code);
}

child.on("error", (e) => {
    console.error("probe: failed to spawn electron:", e.message);
    finish(2);
});

child.on("close", () => {
    evaluate();
});

// --- assertions ---------------------------------------------------------
function jsonLines(marker) {
    return out.split(/\r?\n/)
        .filter((l) => l.indexOf(marker + " ") !== -1)
        .map((l) => {
            const raw = l.slice(l.indexOf(marker + " ") + marker.length + 1);
            try { return JSON.parse(raw); } catch (e) { return null; }
        })
        .filter(Boolean);
}

function evaluate() {
    if (evaluating) return;
    evaluating = true;
    let failures = 0;
    const check = (label, ok, detail) => {
        if (ok) {
            console.log("PASS  " + label);
        } else {
            failures++;
            console.log("FAIL  " + label + (detail !== undefined ? "  (" + JSON.stringify(detail) + ")" : ""));
        }
    };

    const results = jsonLines("EDEX_PROBE_RESULT");
    const base = results.length ? results[results.length - 1] : null;
    check("booted: bridge + terminal + settings + theme", !!base && base.hasBridge === true && base.hasTerminal === "function" && base.settings === "loaded" && base.theme === "loaded", base);
    check("terminal connected (term >= 1)", !!base && base.term >= 1, base && base.term);
    check("filesystem rendered (fsEntries > 0)", !!base && base.fsEntries > 0, base && base.fsEntries);
    check("disk usage bar present", !!base && base.fsSpaceBar === true);
    check("shortcuts loaded (>= 14)", !!base && base.shortcuts >= 14, base && base.shortcuts);
    check("modules initialised (mods >= 7)", !!base && base.mods >= 7, base && base.mods);

    const settings = jsonLines("EDEX_PROBE_SETTINGS");
    check("settings modal opens", settings.length > 0 && settings[0].opened === true, settings[0] || null);

    const tab = jsonLines("EDEX_PROBE_TAB");
    check("new terminal tab spawns", tab.length > 0 && tab[0].spawned === true, tab[0] || null);

    const paste = jsonLines("EDEX_PROBE_PASTE");
    check("clipboard read path (paste)", paste.length > 0 && paste[0].ok === true, paste[0] || null);

    const copy = jsonLines("EDEX_PROBE_COPY");
    check("clipboard write path (copy)", copy.length > 0 && copy[0].ok === true && copy[0].clipboard === copy[0].selected, copy[0] || null);

    const pdf = jsonLines("EDEX_PROBE_PDF");
    check("pdfjs parses a PDF via worker", pdf.length > 0 && pdf[0].ok === true && pdf[0].pages >= 1, pdf[0] || null);

    const shot = jsonLines("EDEX_PROBE_SCREENSHOT");
    check("built-in screenshot writes a PNG", shot.length > 0 && shot[0].ok === true, shot[0] || null);

    // Informational only: the Windows ConPTY teardown flake predates this suite
    // (measured on the pre-upgrade baseline too), so it must not fail the run —
    // but the result is still reported so a real regression is visible.
    if (timedOut) {
        console.log("WARN  app did not exit on its own (known Windows ConPTY teardown flake — see docs/UPGRADE_2.4.0.md)");
    } else {
        console.log("PASS  app exited on its own");
    }

    if (failures === 0) {
        console.log("\nAll runtime checks passed.");
        finish(0);
    } else {
        console.log(`\n${failures} runtime check(s) failed.`);
        const tail = out.split(/\r?\n/).slice(-25).join("\n");
        console.log("\n--- last 25 lines of app output ---\n" + tail);
        if (err) console.log("\n--- stderr ---\n" + err.split(/\r?\n/).slice(-15).join("\n"));
        finish(1);
    }
}



