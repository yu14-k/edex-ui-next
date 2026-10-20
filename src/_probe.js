// eDEX-UI renderer smoke-test probe (opt-in via EDEX_PROBE=1).
// Extracted from _boot.js so the production boot path stays free of test code.
// Drives the real UI through several paths that a plain boot does not cover:
//   1. base initialization (terminal / filesystem / keyboard / modules)
//   2. opening the settings modal (catches escaping/templating errors)
//   3. spawning a new terminal tab (catches IPC reply-signature errors)
// Exits the process when the checks are done, or on timeout.
module.exports = function attachProbe(win) {
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
                theme: window.theme ? "loaded" : "missing",
                audio: !!window.audioManager,
                si: !!window.si,
                term: window.term ? Object.keys(window.term).length : 0,
                fsDisp: !!window.fsDisp,
                keyboard: !!window.keyboard,
                mods: window.mods ? Object.keys(window.mods).length : 0,
                currentTerm: window.currentTerm
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
                ready = state.term > 0 && state.fsDisp && state.keyboard && state.mods >= 7;
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

            finish();
        };

        setTimeout(poll, 5000);
    });
};
