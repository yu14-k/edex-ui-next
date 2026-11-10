// Shared filesystem helpers for the build scripts.
"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

// Recursive delete with verification + OS fallback.
// On some hardened Windows setups (antivirus/EDR filter drivers, sandboxed
// shells) Node's own `fs.rmSync` returns success but leaves the tree in place,
// which silently poisons the build. The OS utility uses a different code path,
// so fall back to it and then verify.
function rmrf(target) {
    if (!fs.existsSync(target)) return;

    try {
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (e) {
        // fall through to the OS-level fallback
    }

    if (!fs.existsSync(target)) return;

    const res = process.platform === "win32"
        ? childProcess.spawnSync("cmd", ["/c", "rmdir", "/S", "/Q", target], { stdio: "ignore" })
        : childProcess.spawnSync("rm", ["-rf", target], { stdio: "ignore" });

    if (fs.existsSync(target)) {
        throw new Error(
            `Could not remove ${target} (node fs + ${process.platform === "win32" ? "rmdir" : "rm -rf"} both failed, ` +
            `status=${res && res.status}). Close any program using it and retry.`
        );
    }
}

// Recursive copy.
// NOTE: `fs.cpSync` is unreliable in this environment (it silently copies nothing
// on some hardened Windows setups, like `fs.rmSync` does for deletes), so this is
// implemented with readdirSync + copyFileSync, which do work.
function copyTree(from, to, opts) {
    const skip = (opts && opts.skip) || [];
    if (skip.indexOf(path.basename(from)) !== -1) return;
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (skip.indexOf(entry.name) !== -1) continue;
        const srcPath = path.join(from, entry.name);
        const destPath = path.join(to, entry.name);
        if (entry.isDirectory()) {
            copyTree(srcPath, destPath, opts);
        } else if (entry.isSymbolicLink()) {
            fs.copyFileSync(fs.realpathSync(srcPath), destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

module.exports = { rmrf, copyTree };
