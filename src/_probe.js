// eDEX-UI renderer smoke-test probe (opt-in via EDEX_PROBE=1).
// Extracted from _boot.js so the production boot path stays free of test code.
// Drives the real UI through several paths that a plain boot does not cover:
//   1. base initialization (terminal / filesystem / keyboard / modules)
//   2. opening the settings modal (catches escaping/templating errors)
//   3. spawning a new terminal tab (catches IPC reply-signature errors)
// Exits the process when the checks are done, or on timeout.
module.exports = function attachProbe(win) {
    // Surface renderer-side errors in the CI log: without this, a failed module
    // init only shows up as a silent "FAIL fsEntries" assertion.
    win.webContents.on("console-message", (event, level, message) => {
        const text = String(message || (event && event.message) || "");
        if (!text) return;
        if (level === 3 || /error|failed|EPERM|EACCES|ENOENT|TypeError/i.test(text)) {
            console.log("EDEX_PROBE_CONSOLE " + text);
        }
    });

    win.webContents.on("render-process-gone", (e, details) => {
        console.log("EDEX_PROBE render-process-gone: " + JSON.stringify(details));
    });

    win.webContents.on("did-finish-load", () => {
        let tries = 0;
        const BASE_CHECK = `
            (() => ({
                hasBridge: !!window.__edex,
                hasTerminal: typeof window.Terminal,
                hasSmoothie: typeof window.SmoothieChart,
                hasHowl: typeof window.Howl,
                hasEncom: typeof window.ENCOM,
                settings: window.settings ? "loaded" : "missing",
                shortcuts: (window.shortcuts && window.shortcuts.length) || 0,
                theme: window.theme ? "loaded" : "missing",
                audio: !!window.audioManager,
                si: !!window.si,
                term: window.term ? Object.keys(window.term).length : 0,
                fsDisp: !!window.fsDisp,
                fsFailed: !!(window.fsDisp && window.fsDisp.failed),
                fsCwd: (window.fsDisp && window.fsDisp.cwd)
                    ? (window.fsDisp.cwd.length + " entries, first=" + ((window.fsDisp.cwd[0] && window.fsDisp.cwd[0].name) || "-"))
                    : null,
                fsContainer: !!document.getElementById("fs_disp_container"),
                fsEntries: (function () {
                    const c = document.getElementById("fs_disp_container");
                    return c ? c.children.length : 0;
                })(),
                fsSpaceBar: !!document.getElementById("fs_space_bar"),
                keyboard: !!window.keyboard,
                mods: window.mods ? Object.keys(window.mods).length : 0,
                currentTerm: window.currentTerm,
                // Terminal typography metrics — font size/family regressions are
                // invisible to the other assertions but obvious to users.
                termMetrics: (function () {
                    try {
                        const t = window.term[window.currentTerm];
                        const el = document.querySelector(".xterm");
                        if (!t || !t.term || !el) return null;
                        const cs = getComputedStyle(el);
                        const screen = el.querySelector(".xterm-screen");
                        const measure = el.querySelector(".xterm-char-measure-element");
                        const mcs = measure ? getComputedStyle(measure) : null;
                        const rect = screen ? screen.getBoundingClientRect() : null;
                        return {
                            options: { fontSize: t.term.options.fontSize, fontFamily: t.term.options.fontFamily },
                            elFont: cs.fontSize + " / " + String(cs.fontFamily).slice(0, 24),
                            measureFont: mcs ? (mcs.fontSize + " / " + String(mcs.fontFamily).slice(0, 24)) : null,
                            cols: t.term.cols,
                            rows: t.term.rows,
                            screenPx: rect ? (Math.round(rect.width) + "x" + Math.round(rect.height)) : null
                        };
                    } catch (e) {
                        return { error: e && e.message ? e.message : String(e) };
                    }
                })()
            }))()
        `;

        // 2. Settings modal: must open without throwing and render the editor table.
        //    Also asserts the title keeps its <i> markup (not over-escaped) and that
        //    no <select> contains stray text nodes (the literal "undefined" prefix bug).
        const SETTINGS_CHECK = `
            (async () => {
                try {
                    await window.openSettings();
                    const table = document.getElementById("settingsEditor");
                    const open = !!table;
                    let titleHasItalic = false;
                    let straySelectText = false;
                    if (table) {
                        const modal = table.closest(".modal_popup");
                        if (modal) {
                            const h1 = modal.querySelector("h1");
                            titleHasItalic = !!(h1 && h1.querySelector("i"));
                            modal.querySelectorAll("select").forEach(sel => {
                                Array.prototype.forEach.call(sel.childNodes, n => {
                                    if (n.nodeType === 3 && n.textContent.trim() !== "") straySelectText = true;
                                });
                            });
                            // Close it via its "Close" button so the keyboard re-attaches
                            const btns = modal.querySelectorAll("button");
                            if (btns.length) btns[btns.length - 1].click();
                        }
                    }
                    return { opened: open, titleHasItalic, straySelectText, error: null };
                } catch (e) {
                    return { opened: false, error: (e && e.message) ? e.message : String(e) };
                }
            })()
        `;

        // 3. New terminal tab: exercises the ttyspawn / ttyspawn-reply round-trip
        const TAB_CHECK = `
            (async () => {
                try {
                    window.focusShellTab(1);
                    await new Promise(r => setTimeout(r, 4000));
                    return {
                        spawned: !!(window.term && window.term[1] && typeof window.term[1] === "object"),
                        currentTerm: window.currentTerm
                    };
                } catch (e) {
                    return { spawned: false, error: (e && e.message) ? e.message : String(e) };
                }
            })()
        `;

        // 4. Clipboard paste: exercises the preload bridge end-to-end
        //    (renderer -> preload -> IPC -> main clipboard.readText -> back).
        //    The main process seeds a known token first, so the check does not
        //    depend on whatever the host clipboard happens to contain.
        const PASTE_TOKEN = "EDEX_PROBE_PASTE_TOKEN";
        const PASTE_CHECK = `
            (async () => {
                try {
                    const t = window.term[window.currentTerm];
                    if (!t || !t.clipboard || typeof t.clipboard.paste !== "function") {
                        return { ok: false, error: "clipboard bridge missing" };
                    }
                    let captured = null;
                    const original = t.write;
                    t.write = d => { captured = d; };
                    let returned;
                    try {
                        returned = await t.clipboard.paste();
                    } finally {
                        t.write = original;
                    }
                    return { ok: returned === true && captured !== null, captured, returned };
                } catch (e) {
                    return { ok: false, error: (e && e.message) ? e.message : String(e) };
                }
            })()
        `;

        // 5. Clipboard copy: renderer writes through the preload bridge, main reads
        //    it back (validates the Electron 44+ clipboard rearchitecture path).
        const COPY_CHECK = `
            (async () => {
                try {
                    const t = window.term[window.currentTerm];
                    if (!t || !t.term || !t.clipboard) return { ok: false, error: "no terminal" };
                    t.term.write("COPYTEST123\\r\\n");
                    await new Promise(r => setTimeout(r, 300));
                    t.term.select(0, 0, 11);
                    const selected = t.term.getSelection();
                    t.clipboard.copy();
                    await new Promise(r => setTimeout(r, 200));
                    return { ok: true, selected };
                } catch (e) {
                    return { ok: false, error: (e && e.message) ? e.message : String(e) };
                }
            })()
        `;

        // 6. pdfjs: parse a minimal in-memory PDF through the real module worker.
        //    Guards the ESM-only pdfjs 6 + file:// module-worker arrangement.
        const PDF_B64 = "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0MSA+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDIwIDEwMCBUZCAoSGVsbG8gZURFWCkgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAzMzIgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MDIKJSVFT0YK";
        const PDF_CHECK = "(async () => {"
            + "try {"
            + "  if (typeof pdfjsLib === 'undefined') return { ok: false, error: 'pdfjsLib missing' };"
            + "  const dir = './assets/vendor/pdfjs/';"
            + "  pdfjsLib.GlobalWorkerOptions.workerSrc = dir + 'pdf.worker.mjs';"
            + "  const bin = atob('" + PDF_B64 + "');"
            + "  const bytes = new Uint8Array(bin.length);"
            + "  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);"
            + "  const doc = await pdfjsLib.getDocument({ data: bytes, cMapUrl: dir + 'cmaps/', standardFontDataUrl: dir + 'standard_fonts/', wasmUrl: dir + 'wasm/' }).promise;"
            + "  const page = await doc.getPage(1);"
            + "  const vp = page.getViewport({ scale: 1 });"
            + "  const op = await page.getOperatorList();"
            + "  return { ok: true, version: pdfjsLib.version, pages: doc.numPages, w: Math.round(vp.width), h: Math.round(vp.height), ops: op.fnArray.length };"
            + "} catch (e) { return { ok: false, error: (e && e.message) ? e.message : String(e) }; }"
            + "})()";

        // Quit gracefully (like a user closing the window) instead of an abrupt
        // process.exit: this also exercises the real shutdown path.
        const finish = () => {
            try {
                require("electron").app.quit();
            } catch (e) {
                process.exit(0);
            }
            // Hard fallback if graceful shutdown does not complete
            setTimeout(() => process.exit(0), 8000).unref();
        };

        const poll = async () => {
            tries++;
            let ready = false;
            try {
                const state = await win.webContents.executeJavaScript(BASE_CHECK);
                console.log("EDEX_PROBE_RESULT " + JSON.stringify(state));
                ready = state.term > 0 && state.fsDisp && state.fsEntries > 0 && state.keyboard && state.mods >= 7;
            } catch (e) {
                console.log("EDEX_PROBE_ERROR " + (e && e.message ? e.message : String(e)));
            }

            if (!ready) {
                if (tries >= 25) { // give up after ~50s
                    finish();
                    return;
                }
                setTimeout(poll, 2000);
                return;
            }

            // Base UI is up: run the deeper interaction checks once
            try {
                const settings = await win.webContents.executeJavaScript(SETTINGS_CHECK);
                console.log("EDEX_PROBE_SETTINGS " + JSON.stringify(settings));
            } catch (e) {
                console.log("EDEX_PROBE_SETTINGS_ERROR " + (e && e.message ? e.message : String(e)));
            }

            try {
                const tab = await win.webContents.executeJavaScript(TAB_CHECK);
                console.log("EDEX_PROBE_TAB " + JSON.stringify(tab));
            } catch (e) {
                console.log("EDEX_PROBE_TAB_ERROR " + (e && e.message ? e.message : String(e)));
            }

            try {
                // Deterministic input for the paste check (Electron 44+ clipboard
                // methods return Promises, so await them).
                await require("electron").clipboard.writeText(PASTE_TOKEN);
                const paste = await win.webContents.executeJavaScript(PASTE_CHECK);
                const pasteOk = !!paste && paste.ok === true && paste.captured === PASTE_TOKEN;
                console.log("EDEX_PROBE_PASTE " + JSON.stringify(Object.assign({}, paste, { expected: PASTE_TOKEN, ok: pasteOk })));
            } catch (e) {
                console.log("EDEX_PROBE_PASTE_ERROR " + (e && e.message ? e.message : String(e)));
            }

            try {
                const copy = await win.webContents.executeJavaScript(COPY_CHECK);
                let clip = "";
                // Electron 44+ clipboard methods return Promises
                try { clip = await require("electron").clipboard.readText(); } catch (err) { clip = "<read failed>"; }
                console.log("EDEX_PROBE_COPY " + JSON.stringify(Object.assign({}, copy, { clipboard: String(clip).slice(0, 40) })));
            } catch (e) {
                console.log("EDEX_PROBE_COPY_ERROR " + (e && e.message ? e.message : String(e)));
            }

            try {
                const pdf = await win.webContents.executeJavaScript(PDF_CHECK);
                console.log("EDEX_PROBE_PDF " + JSON.stringify(pdf));
            } catch (e) {
                console.log("EDEX_PROBE_PDF_ERROR " + (e && e.message ? e.message : String(e)));
            }

            // Optional terminal layout diagnosis: EDEX_DEBUG_TERM=1
            if (process.env.EDEX_DEBUG_TERM) {
                try {
                    const diag = await win.webContents.executeJavaScript(`(async () => {
                        const t = window.term[window.currentTerm];
                        const parent = document.getElementById("terminal" + window.currentTerm);
                        const screen = parent && parent.querySelector(".xterm-screen");
                        const before = {
                            parent: parent ? Math.round(parent.getBoundingClientRect().width) + "x" + Math.round(parent.getBoundingClientRect().height) : null,
                            screen: screen ? Math.round(screen.getBoundingClientRect().width) + "x" + Math.round(screen.getBoundingClientRect().height) : null,
                            cols: t.term.cols, rows: t.term.rows,
                            proposed: JSON.stringify((function () { try { return t.term._core._renderService.dimensions.css.cell; } catch (e) { return null; } })())
                        };
                        t.fit();
                        await new Promise(r => setTimeout(r, 500));
                        const s2 = parent && parent.querySelector(".xterm-screen");
                        return { before, after: { screen: s2 ? Math.round(s2.getBoundingClientRect().width) + "x" + Math.round(s2.getBoundingClientRect().height) : null, cols: t.term.cols, rows: t.term.rows } };
                    })()`);
                    console.log("EDEX_PROBE_TERM " + JSON.stringify(diag));
                } catch (e) {
                    console.log("EDEX_PROBE_TERM_ERROR " + (e && e.message ? e.message : String(e)));
                }
            }

            // Optional ad-hoc evaluation in the renderer (debugging aid):
            // EDEX_EVAL_FILE=<path to a .js file whose value is returned>
            if (process.env.EDEX_EVAL_FILE) {
                try {
                    const source = require("fs").readFileSync(process.env.EDEX_EVAL_FILE, "utf8");
                    const result = await win.webContents.executeJavaScript(source);
                    console.log("EDEX_PROBE_EVAL " + JSON.stringify(result));
                } catch (e) {
                    console.log("EDEX_PROBE_EVAL_ERROR " + (e && e.message ? e.message : String(e)));
                }
            }

            // Built-in screenshot path (the fallback when OS snipping tools show
            // a black surface over the fullscreen GPU-composited window).
            try {
                const shot = await win.webContents.executeJavaScript("window.__edex.services.app.screenshot()");
                const fsMod = require("fs");
                const exists = typeof shot === "string" && fsMod.existsSync(shot);
                const size = exists ? fsMod.statSync(shot).size : 0;
                console.log("EDEX_PROBE_SCREENSHOT " + JSON.stringify({ ok: exists && size > 1000, path: shot, size }));
                if (exists) { try { fsMod.unlinkSync(shot); } catch (e) { /* keep */ } }
            } catch (e) {
                console.log("EDEX_PROBE_SCREENSHOT_ERROR " + (e && e.message ? e.message : String(e)));
            }

            // Optional visual snapshot for manual review: EDEX_SHOT=<file.png>
            if (process.env.EDEX_SHOT) {
                try {
                    const image = await win.webContents.capturePage();
                    require("fs").writeFileSync(process.env.EDEX_SHOT, image.toPNG());
                    console.log("EDEX_PROBE_SHOT " + process.env.EDEX_SHOT);
                } catch (e) {
                    console.log("EDEX_PROBE_SHOT_ERROR " + (e && e.message ? e.message : String(e)));
                }
            }

            finish();
        };

        setTimeout(poll, 5000);
    });
};
