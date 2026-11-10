#!/usr/bin/env node
// Vendor step: prepare the browser-ready pdfjs bundle.
//
// Why this exists: pdfjs-dist >= 5 ships only ESM builds, but Chromium refuses to
// execute ES *module scripts* on a file:// page (opaque origin -> CORS). Module
// *workers* are fine, which was verified experimentally on Electron 45
// (module import blocked, `new Worker(url, {type:"module"})` works).
//
// So we:
//   1. bundle `pdfjs-dist/build/pdf.mjs` into a classic IIFE exposing `window.pdfjsLib`
//   2. copy the ESM worker + the runtime asset dirs (cmaps / standard_fonts / wasm)
//      next to it, so the app can reference them with relative paths
//
// Output: src/assets/vendor/pdfjs/... (generated, git-ignored)
"use strict";

const fs = require("fs");
const path = require("path");
const { rmrf, copyTree } = require("./lib/fsutil.js");

const root = __dirname;
const srcDir = path.join(root, "src");
const outDir = path.join(srcDir, "assets", "vendor", "pdfjs");
// Normally installed under src/; fall back to the root install so `node vendor.js`
// still works in odd checkouts.
const pdfjsDir = [path.join(srcDir, "node_modules", "pdfjs-dist"), path.join(root, "node_modules", "pdfjs-dist")]
    .find((p) => fs.existsSync(p));

function fail(msg) {
    console.error("vendor: " + msg);
    process.exit(1);
}

if (!fs.existsSync(pdfjsDir)) fail("pdfjs-dist is not installed (run `npm install` inside src/)");

const version = JSON.parse(fs.readFileSync(path.join(pdfjsDir, "package.json"), "utf8")).version;
console.log(`vendor: pdfjs-dist ${version} -> ${path.relative(root, outDir)}`);

fs.rmSync && rmrf(outDir);
fs.mkdirSync(outDir, { recursive: true });

const esbuild = require("esbuild");
esbuild.buildSync({
    entryPoints: [path.join(pdfjsDir, "build", "pdf.mjs")],
    outfile: path.join(outDir, "pdf.bundle.js"),
    bundle: true,
    format: "iife",
    globalName: "pdfjsLib",
    platform: "browser",
    target: "chrome120",
    legalComments: "none",
    logLevel: "warning"
});

// Worker stays ESM (module worker is allowed from file://)
fs.copyFileSync(path.join(pdfjsDir, "build", "pdf.worker.mjs"), path.join(outDir, "pdf.worker.mjs"));

for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
    const from = path.join(pdfjsDir, dir);
    if (!fs.existsSync(from)) continue;
    copyTree(from, path.join(outDir, dir));
}

const countFiles = (dir) => {
    let n = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
    }
    return n;
};
console.log(`vendor: assets copied (${countFiles(outDir)} files total)`);

const size = (f) => (fs.statSync(path.join(outDir, f)).size / 1024).toFixed(0) + " KB";
console.log(`vendor: done (bundle ${size("pdf.bundle.js")}, worker ${size("pdf.worker.mjs")})`);
