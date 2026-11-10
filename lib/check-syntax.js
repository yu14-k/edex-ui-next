#!/usr/bin/env node
// Static checks that run everywhere (no display, no network):
//   * `node --check` on every hand-written JS file in src/
//   * every JSON manifest parses
//   * generated vendor bundles exist (or are buildable)
//
// Used by `npm test` and by CI.
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "src");

let failures = 0;
const pass = (msg) => console.log("PASS  " + msg);
const fail = (msg) => { failures++; console.log("FAIL  " + msg); };

// --- 1. JS syntax --------------------------------------------------------
function walk(dir, out, skipDirs) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (skipDirs.indexOf(entry.name) !== -1) continue;
            walk(path.join(dir, entry.name), out, skipDirs);
        } else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
            out.push(path.join(dir, entry.name));
        }
    }
    return out;
}

const jsFiles = walk(srcDir, [], ["node_modules", "vendor"]);
let jsFailures = [];
for (const file of jsFiles) {
    const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (res.status !== 0) {
        jsFailures.push(path.relative(root, file) + ": " + String(res.stderr).split("\n")[0]);
    }
}
if (jsFailures.length === 0) {
    pass(`js syntax (${jsFiles.length} files)`);
} else {
    fail("js syntax: " + jsFailures.join("; "));
}

// --- 2. Build-script syntax ---------------------------------------------
const buildScripts = ["prebuild.js", "prebuild-minify.js", "vendor.js", "lib/fsutil.js", "lib/probe.js", "lib/check-syntax.js"];
let scriptFailures = [];
for (const rel of buildScripts) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) { scriptFailures.push(rel + " missing"); continue; }
    const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (res.status !== 0) scriptFailures.push(rel + ": " + String(res.stderr).split("\n")[0]);
}
if (scriptFailures.length === 0) pass(`build scripts syntax (${buildScripts.length} files)`);
else fail("build scripts: " + scriptFailures.join("; "));

// --- 3. Manifests -------------------------------------------------------
const manifests = ["package.json", "src/package.json", "package-lock.json", "src/package-lock.json"];
let manifestFailures = [];
for (const rel of manifests) {
    try {
        const json = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
        if (rel === "package.json" || rel === "src/package.json") {
            if (!json.version) manifestFailures.push(rel + ": missing version");
        }
    } catch (e) {
        manifestFailures.push(rel + ": " + e.message);
    }
}
if (manifestFailures.length === 0) pass(`manifests (${manifests.length})`);
else fail("manifests: " + manifestFailures.join("; "));

// --- 4. Version consistency --------------------------------------------
try {
    const a = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
    const b = JSON.parse(fs.readFileSync(path.join(root, "src/package.json"), "utf8")).version;
    if (a === b) pass(`version consistency (${a})`);
    else fail(`version mismatch: package.json ${a} vs src/package.json ${b}`);
} catch (e) {
    fail("version check: " + e.message);
}

// --- 5. Vendor bundles --------------------------------------------------
const vendorBundle = path.join(srcDir, "assets", "vendor", "pdfjs", "pdf.bundle.js");
const vendorWorker = path.join(srcDir, "assets", "vendor", "pdfjs", "pdf.worker.mjs");
if (fs.existsSync(vendorBundle) && fs.existsSync(vendorWorker)) {
    pass("pdfjs vendor bundles present");
} else {
    console.log("WARN  pdfjs vendor bundles missing (run `npm run vendor`) — probe will fail without them");
}

console.log(failures === 0 ? "\nAll static checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

