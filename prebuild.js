#!/usr/bin/env node
// Cross-platform prebuild helper.
//
// Replaces the platform-specific `rsync`/`xcopy`/`mkdir`/`rmdir` shell snippets
// that previously lived in package.json (they only worked on one OS each and
// were not idempotent: `mkdir prebuild-src` fails when the directory exists).
//
// Steps:
//   1. wipe prebuild-src            (always: stale files must not leak into a build)
//   2. copy src/ -> prebuild-src/   (excluding node_modules)
//   3. minify JS/CSS/JSON in place  (prebuild-minify.js)
//
// The caller is responsible for `npm install` inside prebuild-src afterwards.
//
// Usage:
//   node prebuild.js            full prebuild (wipe + copy + minify)
//   node prebuild.js --clean    remove prebuild-src only
"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { rmrf } = require("./lib/fsutil.js");

const root = __dirname;
const srcDir = path.join(root, "src");
const outDir = path.join(root, "prebuild-src");

function copyRecursive(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        // The installed dependencies are re-installed in prebuild-src; copying
        // them would double the work and break native modules.
        if (entry.name === "node_modules") continue;
        const srcPath = path.join(from, entry.name);
        const destPath = path.join(to, entry.name);
        if (entry.isDirectory()) {
            copyRecursive(srcPath, destPath);
        } else if (entry.isSymbolicLink()) {
            // Materialize symlinked assets (e.g. linked themes/fonts) as real files
            fs.copyFileSync(fs.realpathSync(srcPath), destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

async function main() {
    const cleanOnly = process.argv.includes("--clean");

    if (fs.existsSync(outDir)) {
        console.log("Removing previous prebuild-src ...");
        rmrf(outDir);
    }
    if (cleanOnly) {
        console.log("prebuild-src removed.");
        return;
    }

    if (!fs.existsSync(srcDir)) {
        throw new Error(`Source directory not found: ${srcDir}`);
    }

    // Regenerate the browser-ready vendor bundles (pdfjs) before copying, so the
    // build never ships a stale/missing vendor directory.
    console.log("Vendoring browser bundles (pdfjs) ...");
    const vendorRes = childProcess.spawnSync(process.execPath, [path.join(root, "vendor.js")], { stdio: "inherit" });
    if (vendorRes.status !== 0) {
        throw new Error(`vendor.js failed (status ${vendorRes.status})`);
    }

    console.log("Copying src -> prebuild-src (excluding node_modules) ...");
    copyRecursive(srcDir, outDir);

    console.log("Minifying ...");
    const minify = require("./prebuild-minify.js");
    await minify(outDir);

    console.log("\nPrebuild done. Next: cd prebuild-src && npm install");
}

main().catch(e => {
    console.error("\nPrebuild failed:", e && e.stack ? e.stack : e);
    process.exit(1);
});
