const fs = require("fs");
const path = require("path");
const stdout = process.stdout;
const UglifyJS = require("terser");
const CleanCSS = require("clean-css");
JSON.minify = require("node-json-minify");

function writeMinified(path, data) {
    return new Promise((res, rej) => {
        fs.writeFile(path, data, (err) => {
            if (err) {
                stdout.write(" -  ❌\n\n\n", () => {
                    rej(err);
                });
                return;
            }
            stdout.write(" -  ✓\n", () => {
                res();
            });
        });
    });
}

async function recursiveMinify(dirPath) {
    // Never descend into installed dependencies: they are third-party, already
    // minified where it matters, and some of them use syntax terser cannot parse.
    if (path.basename(dirPath) === "node_modules") return;
    try { var files = fs.readdirSync(dirPath); }
    catch(e) { return; }
    if (files.length > 0) {
        for (let i = 0; i < files.length; i++) {
            let filePath = dirPath + '/' + files[i];
            if (fs.statSync(filePath).isFile()) {

                // Skip the heavy pre-minified grid.json and keep themes/keyboards
                // human-readable, but ONLY skip this file - do not abort the rest
                // of the directory (bugfix: previously used `return` which stopped
                // minifying every sibling file after the first skipped .json).
                if (filePath.endsWith(".json") && !filePath.endsWith("icons.json")) continue;
                // See #446
                if (filePath.endsWith("file-icons-match.js")) continue;
                // Vendor bundles are produced by vendor.js already; re-minifying
                // ~1 MB of pdfjs on every build is pure build-time cost.
                if (filePath.indexOf(path.join("assets", "vendor", "pdfjs")) !== -1) continue;
                await stdout.write(filePath.slice(filePath.indexOf('prebuild-src/')+13)+'...');

                switch (filePath.split(".").pop()) {
                    case "js":
                        let minified = await UglifyJS.minify(fs.readFileSync(filePath, {encoding: "utf-8"}), {
                            compress: {
                                dead_code: false,
                                unused: false,
                                warnings: true
                            },
                            output: {
                                beautify: false,
                                ecma: 6
                            }
                        });
                        if (!minified.error) {
                            await writeMinified(filePath, minified.code).catch(e => {
                                throw e;
                            });
                        } else {
                            stdout.write(" -  ❌\n\n\n");
                            throw minified.error;
                        }
                        break;
                    case "css":
                        let output = new CleanCSS({level:2}).minify(fs.readFileSync(filePath, {encoding:"utf-8"}));
                        if (output.errors.length >= 1) {
                            stdout.write(" -  ❌\n\n\n");
                            throw output.errors;
                        } else {
                            await writeMinified(filePath, output.styles).catch(e => {
                                throw e;
                            });
                        }
                        break;
                    case "json":
                        let out;
                        try {
                            out = JSON.minify(fs.readFileSync(filePath, {encoding:"utf-8"}));
                        } catch(err) {
                            stdout.write(" -  ❌\n\n\n");
                            throw err;
                        }
                        await writeMinified(filePath, out).catch(e => {
                            throw e;
                        });
                        break;
                    default:
                        stdout.write("\n");
                }
            } else {
                await recursiveMinify(filePath);
            }
        }
    }
}

// Exported so prebuild.js can await the whole minification pass instead of
// relying on the module-level side effect (which could let the process exit
// before the last write finished).
module.exports = function minifyDirectory(dirPath) {
    return recursiveMinify(dirPath);
};

if (require.main === module) {
    recursiveMinify(path.join(__dirname, "prebuild-src")).catch(e => {
        console.error(e);
        process.exit(1);
    });
}
