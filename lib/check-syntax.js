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

// --- 6. Theme / keyboard-layout / layout schemas -------------------------
// These files are user-editable and were previously unvalidated: a malformed
// theme (or a truncated layout JSON) only failed at runtime. Validate every
// shipped asset plus the layout contract shared with the renderer.
(function validateThemes() {
    let Ajv;
    try {
        Ajv = require("ajv");
    } catch (e) {
        console.log("WARN  ajv not installed; skipping theme schema validation");
        return;
    }
    const ajv = new Ajv({ allErrors: true, strict: false });

    const suites = [
        { label: "themes", schema: path.join(root, "schemas", "theme.schema.json"), dir: path.join(srcDir, "assets", "themes") },
        { label: "keyboard layouts", schema: path.join(root, "schemas", "kb_layout.schema.json"), dir: path.join(srcDir, "assets", "kb_layouts") }
    ];

    let total = 0;
    let bad = 0;
    for (const suite of suites) {
        if (!fs.existsSync(suite.schema)) {
            console.log(`WARN  missing schema ${path.relative(root, suite.schema)}`);
            continue;
        }
        const validate = ajv.compile(JSON.parse(fs.readFileSync(suite.schema, "utf8")));
        const files = fs.readdirSync(suite.dir).filter((f) => f.endsWith(".json"));
        let suiteBad = 0;
        for (const f of files) {
            total++;
            let data;
            try {
                data = JSON.parse(fs.readFileSync(path.join(suite.dir, f), "utf8"));
            } catch (e) {
                console.log(`FAIL  ${suite.label}: ${f} is not valid JSON (${e.message.split("\n")[0]})`);
                suiteBad++;
                continue;
            }
            if (!validate(data)) {
                const err = validate.errors[0];
                console.log(`FAIL  ${suite.label}: ${f} — ${err.instancePath || "/"} ${err.message}`);
                suiteBad++;
            }
        }
        if (suiteBad === 0) {
            pass(`${suite.label} schema (${files.length} files)`);
        } else {
            fail(`${suite.label}: ${suiteBad}/${files.length} invalid`);
        }
        bad += suiteBad;
    }
    if (bad === 0 && total > 0) {
        pass(`assets validated against schemas (${total} files)`);
    }
}());

// --- 7. Declarative layout contract -------------------------------------
(function validateLayout() {
    try {
        const L = require(path.join(srcDir, "shared", "layout.js"));
        const def = L.normalize(undefined);
        if (!def.layout.columns.left.modules.length || !def.layout.columns.right.modules.length) {
            fail("layout defaults place no modules");
            return;
        }
        // Hidden-module handling and clamping are the two behaviours the UI relies
        // on, so assert them here rather than trusting the renderer.
        const bad = L.normalize({
            columns: { left: { width: 999, modules: ["clock", "does-not-exist"] }, right: { modules: ["globe"] } },
            terminal: { width: 5 }
        });
        const clamped = bad.layout.columns.left.width === 30 && bad.layout.terminal.width === 40;
        const unknownDropped = bad.layout.columns.left.modules.indexOf("does-not-exist") === -1;
        const allHidden = L.normalize({ columns: { left: { modules: [] }, right: { modules: [] } } });
        const restored = allHidden.layout.columns.left.modules.length > 0;
        if (clamped && unknownDropped && restored) {
            pass("layout normaliser (clamp / drop unknown / restore defaults)");
        } else {
            fail(`layout normaliser misbehaved: clamped=${clamped} unknownDropped=${unknownDropped} restored=${restored}`);
        }
    } catch (e) {
        fail("layout contract: " + (e && e.message ? e.message : e));
    }
}());


console.log(failures === 0 ? "\nAll static checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

