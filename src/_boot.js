const signale = require("signale");
const {app, BrowserWindow, dialog, shell} = require("electron");

// Network resets/refusals are expected in a network-monitoring app (flaky links,
// GeoIP downloads, ping probes) and must not be treated as fatal crashes.
const RECOVERABLE_NET_CODES = ["ECONNRESET", "EPIPE", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH",
    "ECONNREFUSED", "EAI_AGAIN", "ERR_SOCKET_CLOSED"];
function isRecoverableNetError(e) {
    if (!e) return false;
    const code = e.code || "";
    const msg = String(e.message || e);
    return RECOVERABLE_NET_CODES.indexOf(code) !== -1 ||
        /read ECONNRESET|socket hang up|ECONNRESET|EPIPE|ETIMEDOUT|ENETUNREACH/i.test(msg);
}

process.on("uncaughtException", e => {
    if (isRecoverableNetError(e)) {
        signale.warn(`Ignoring recoverable network error: ${e && e.message ? e.message : e}`);
        return;
    }
    signale.fatal(e);
    // The crash dialog is synchronous/blocking; skip it in headless smoke-test
    // runs so an unhandled error cannot hang the process forever.
    if (!process.env.EDEX_PROBE) {
        try {
            dialog.showErrorBox("eDEX-UI crashed", e.message || "Cannot retrieve error message.");
        } catch (err) {
            // no display / dialog unavailable
        }
    }
    if (tty) {
        tty.close();
    }
    if (extraTtys) {
        Object.keys(extraTtys).forEach(key => {
            if (extraTtys[key] !== null) {
                extraTtys[key].close();
            }
        });
    }
    process.exit(1);
});

process.on("unhandledRejection", reason => {
    if (isRecoverableNetError(reason)) {
        signale.warn(`Ignoring recoverable network rejection: ${reason && reason.message ? reason.message : reason}`);
        return;
    }
    signale.error(`Unhandled promise rejection: ${reason && reason.message ? reason.message : reason}`);
});

signale.start(`Starting eDEX-UI v${app.getVersion()}`);
signale.info(`With Node ${process.versions.node} and Electron ${process.versions.electron}`);
signale.info(`Renderer is Chrome ${process.versions.chrome}`);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    signale.fatal("Error: Another instance of eDEX is already running. Cannot proceed.");
    app.exit(1);
}

signale.time("Startup");

const electron = require("electron");
const ipc = electron.ipcMain;
const path = require("path");
const url = require("url");
const fs = require("fs");
const which = require("which");
const { clipboard, globalShortcut, screen } = electron;
const Terminal = require("./classes/terminal.class.js").Terminal;
const NetService = require("./_netService.js");
const netService = new NetService();

ipc.on("log", (e, type, content) => {
    // Guard against an unknown/typo'd log type turning into a fatal crash
    if (typeof signale[type] === "function") {
        signale[type](content);
    } else {
        signale.info(`[${type}] ${content}`);
    }
});

// --- Preload bridge IPC handlers (see preload.js) ---
function registerBridgeIpc() {
    const app = electron.app;

    // Only accept IPC from the app's own main window renderer.
    // Exception-safe: during teardown a queued IPC can reference an already
    // destroyed webContents, where touching `e.sender` / `win.webContents`
    // throws "Object has been destroyed". Treat that as "not from main".
    const fromMain = (e) => {
        try {
            if (!win || win.isDestroyed() || !e || !e.sender) return false;
            return e.sender === win.webContents;
        } catch (err) {
            return false;
        }
    };
    // Small input guards
    const isStr = (v) => typeof v === "string";
    const isFiniteNum = (v) => typeof v === "number" && isFinite(v);

    ipc.handle("edex:app:getVersion", (e) => { if (!fromMain(e)) throw new Error("unauthorized"); return app.getVersion(); });
    ipc.handle("edex:app:getArgv", (e) => { if (!fromMain(e)) throw new Error("unauthorized"); return process.argv; });
    ipc.handle("edex:app:getPath", (e, name) => {
        if (!fromMain(e)) throw new Error("unauthorized");
        const allowed = ["userData", "home", "temp", "appData", "documents", "downloads", "desktop", "cache"];
        if (allowed.indexOf(name) === -1) throw new Error("invalid path name");
        return app.getPath(name);
    });
    ipc.on("edex:app:relaunch", (e) => { if (fromMain(e)) app.relaunch(); });
    ipc.on("edex:app:quit", (e) => { if (fromMain(e)) app.quit(); });
    ipc.on("edex:app:focus", (e) => { if (fromMain(e) && win) win.focus(); });

    ipc.handle("edex:screen:getAllDisplays", (e) => {
        if (!fromMain(e)) throw new Error("unauthorized");
        return screen.getAllDisplays().map(d => ({
            id: d.id,
            bounds: d.bounds,
            workArea: d.workArea,
            internal: d.internal,
            primary: d.id === screen.getPrimaryDisplay().id
        }));
    });

    ipc.handle("edex:shell:openPath", async (e, p) => {
        if (!fromMain(e)) throw new Error("unauthorized");
        if (!isStr(p) || p.length === 0) return null;
        const r = await shell.openPath(p);
        return r || null;
    });
    ipc.handle("edex:shell:openExternal", async (e, u) => {
        if (!fromMain(e)) throw new Error("unauthorized");
        // Only allow opening http(s) URLs to avoid arbitrary protocol abuse
        if (isStr(u) && /^https?:\/\//i.test(u)) {
            await shell.openExternal(u);
            return true;
        }
        return false;
    });

    ipc.handle("edex:clipboard:readText", (e) => { if (!fromMain(e)) throw new Error("unauthorized"); return clipboard.readText(); });

    // Global shortcuts: renderer asks main to (re)register; main forwards
    // triggered triggers back to the renderer.
    ipc.handle("edex:shortcut:register", (e, trigger) => {
        if (!fromMain(e)) throw new Error("unauthorized");
        // Restrict to valid accelerator-like triggers to avoid junk registration
        if (!isStr(trigger) || trigger.length === 0 || trigger.length > 100) return false;
        if (globalShortcut.isRegistered(trigger)) return true;
        return globalShortcut.register(trigger, () => {
            if (win && !win.isDestroyed()) {
                win.webContents.send("edex:shortcut:triggered", trigger);
            }
        });
    });
    ipc.on("edex:shortcut:unregisterAll", (e) => { if (fromMain(e)) globalShortcut.unregisterAll(); });

    ipc.on("edex:win:minimize", (e) => { if (fromMain(e) && win) win.minimize(); });
    ipc.on("edex:win:setFullScreen", (e, v) => { if (fromMain(e) && win) win.setFullScreen(v === true); });
    ipc.handle("edex:win:isFullScreen", (e) => { if (!fromMain(e)) throw new Error("unauthorized"); return (win ? win.isFullScreen() : false); });
    ipc.handle("edex:win:getSize", (e) => { if (!fromMain(e)) throw new Error("unauthorized"); return (win ? win.getSize() : [960, 540]); });
    ipc.on("edex:win:setSize", (e, w, h) => {
        if (!fromMain(e) || !win) return;
        // clamp to sane window sizes to prevent absurd/harmful geometries
        if (!isFiniteNum(w) || !isFiniteNum(h)) return;
        win.setSize(Math.round(Math.min(Math.max(w, 200), 20000)), Math.round(Math.min(Math.max(h, 200), 20000)));
    });
    ipc.handle("edex:win:isMaximized", (e) => { if (!fromMain(e)) throw new Error("unauthorized"); return (win ? win.isMaximized() : false); });
    ipc.on("edex:win:unmaximize", (e) => { if (fromMain(e) && win) win.unmaximize(); });
    ipc.on("edex:win:toggleDevTools", (e) => { if (fromMain(e) && win) win.webContents.toggleDevTools(); });

    ipc.handle("edex:username", async (e) => {
        if (!fromMain(e)) throw new Error("unauthorized");
        try {
            return await require("username")() || null;
        } catch (err) {
            return null;
        }
    });

    // Derive the GitHub "owner/repo" slug from the app's package.json repository
    // field, so forks check their own releases instead of the upstream project's.
    const getRepoSlug = () => {
        const fallback = "GitSquared/edex-ui";
        try {
            const pkg = require("./package.json");
            const url = (pkg && pkg.repository && (pkg.repository.url || pkg.repository)) || "";
            const m = String(url).match(/github\.com[/:]([^/]+)\/([^/#.]+)/i);
            if (m) return `${m[1]}/${m[2]}`;
        } catch (err) {
            // package.json unavailable (unusual packaging), fall back
        }
        return fallback;
    };

    ipc.handle("edex:update:check", async (e) => {
        if (!fromMain(e)) throw new Error("unauthorized");
        const https = require("https");
        const slug = getRepoSlug();
        const releasesUrl = `https://github.com/${slug}/releases/latest`;
        return new Promise((resolve) => {
            https.get({
                protocol: "https:",
                host: "api.github.com",
                path: `/repos/${slug}/releases/latest`,
                headers: { "User-Agent": "eDEX-UI UpdateChecker" }
            }, res => {
                let rawData = "";
                res.on("data", chunk => { rawData += chunk; });
                res.on("end", () => {
                    try {
                        const release = JSON.parse(rawData.toString());
                        resolve({
                            tag_name: release.tag_name || "",
                            html_url: release.html_url || "",
                            // Used by the renderer as the "download" fallback
                            releasesUrl
                        });
                    } catch (err) {
                        resolve(null);
                    }
                });
            }).on("error", () => resolve(null));
        });
    });

    ipc.handle("edex:net:ping", (e, host, port, localAddr) => {
        if (!fromMain(e)) throw new Error("unauthorized");
        if (!isStr(host) || !isFiniteNum(port)) return Promise.reject(new Error("invalid params"));
        return netService.ping(host, port, isStr(localAddr) ? localAddr : undefined);
    });
    ipc.handle("edex:net:externalIp", (e, localAddr) => {
        if (!fromMain(e)) throw new Error("unauthorized");
        return netService.externalIp(isStr(localAddr) ? localAddr : undefined);
    });
    ipc.handle("edex:net:geoLookup", (e, ip) => {
        if (!fromMain(e)) throw new Error("unauthorized");
        if (!isStr(ip)) return null;
        return netService.geoLookup(ip);
    });
    ipc.handle("edex:net:geoReady", (e) => { if (!fromMain(e)) throw new Error("unauthorized"); return netService.geoReady(); });
}

registerBridgeIpc();

var win, tty, extraTtys;
const settingsFile = path.join(electron.app.getPath("userData"), "settings.json");
const shortcutsFile = path.join(electron.app.getPath("userData"), "shortcuts.json");
const lastWindowStateFile = path.join(electron.app.getPath("userData"), "lastWindowState.json");
const themesDir = path.join(electron.app.getPath("userData"), "themes");
const innerThemesDir = path.join(__dirname, "assets/themes");
const kblayoutsDir = path.join(electron.app.getPath("userData"), "keyboards");
const innerKblayoutsDir = path.join(__dirname, "assets/kb_layouts");
const fontsDir = path.join(electron.app.getPath("userData"), "fonts");
const innerFontsDir = path.join(__dirname, "assets/fonts");

// Unset proxy env variables to avoid connection problems on the internal websockets
// See #222
if (process.env.http_proxy) delete process.env.http_proxy;
if (process.env.https_proxy) delete process.env.https_proxy;

// Bypass GPU acceleration blocklist, trading a bit of stability for a great deal of performance, mostly on Linux
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-video-decode");

// Fix userData folder not setup on Windows
try {
    fs.mkdirSync(electron.app.getPath("userData"));
    signale.info(`Created config dir at ${electron.app.getPath("userData")}`);
} catch(e) {
    signale.info(`Base config dir is ${electron.app.getPath("userData")}`);
}
// Create default settings file
if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(settingsFile, JSON.stringify({
        shell: (process.platform === "win32") ? "powershell.exe" : "bash",
        shellArgs: '',
        cwd: electron.app.getPath("userData"),
        keyboard: "en-US",
        theme: "tron",
        termFontSize: 15,
        audio: true,
        audioVolume: 1.0,
        disableFeedbackAudio: false,
        clockHours: 24,
        pingAddr: "1.1.1.1",
        port: 3000,
        nointro: false,
        nocursor: false,
        forceFullscreen: true,
        allowWindowed: false,
        excludeThreadsFromToplist: true,
        hideDotfiles: false,
        fsListView: false,
        experimentalGlobeFeatures: false,
        experimentalFeatures: false
    }, "", 4));
    signale.info(`Default settings written to ${settingsFile}`);
}
// Create default shortcuts file
if (!fs.existsSync(shortcutsFile)) {
    fs.writeFileSync(shortcutsFile, JSON.stringify([
        { type: "app", trigger: "Ctrl+Shift+C", action: "COPY", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+V", action: "PASTE", enabled: true },
        { type: "app", trigger: "Ctrl+Tab", action: "NEXT_TAB", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+Tab", action: "PREVIOUS_TAB", enabled: true },
        { type: "app", trigger: "Ctrl+X", action: "TAB_X", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+S", action: "SETTINGS", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+K", action: "SHORTCUTS", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+F", action: "FUZZY_SEARCH", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+L", action: "FS_LIST_VIEW", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+H", action: "FS_DOTFILES", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+P", action: "KB_PASSMODE", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+I", action: "DEV_DEBUG", enabled: false },
        { type: "app", trigger: "Ctrl+Shift+F5", action: "DEV_RELOAD", enabled: true },
        { type: "shell", trigger: "Ctrl+Shift+Alt+Space", action: "neofetch", linebreak: true, enabled: false }
    ], "", 4));
    signale.info(`Default keymap written to ${shortcutsFile}`);
}
//Create default window state file
if(!fs.existsSync(lastWindowStateFile)) {
    fs.writeFileSync(lastWindowStateFile, JSON.stringify({
        useFullscreen: true
    }, "", 4));
    signale.info(`Default last window state written to ${lastWindowStateFile}`);
}

// Copy default themes & keyboard layouts & fonts
// Only write built-in assets if the target file is absent, so user-local edits
// are never overwritten and startup skips redundant disk I/O (# perf).
signale.pending("Mirroring internal assets...");
function ensureDir(dir) {
    try {
        fs.mkdirSync(dir);
    } catch(e) {
        // Folder already exists
    }
}
function mirrorDir(srcDir, destDir, encoding) {
    ensureDir(destDir);
    fs.readdirSync(srcDir).forEach(e => {
        let dest = path.join(destDir, e);
        if (fs.existsSync(dest)) return;
        fs.writeFileSync(dest, fs.readFileSync(path.join(srcDir, e), encoding ? {encoding} : undefined), encoding ? {encoding} : undefined);
    });
}
mirrorDir(innerThemesDir, themesDir, "utf-8");
mirrorDir(innerKblayoutsDir, kblayoutsDir, "utf-8");
mirrorDir(innerFontsDir, fontsDir);

// Version history logging
const versionHistoryPath = path.join(electron.app.getPath("userData"), "versions_log.json");
var versionHistory = fs.existsSync(versionHistoryPath) ? require(versionHistoryPath) : {};
var version = app.getVersion();
if (typeof versionHistory[version] === "undefined") {
	versionHistory[version] = {
		firstSeen: Date.now(),
		lastSeen: Date.now()
	};
} else {
	versionHistory[version].lastSeen = Date.now();
}
fs.writeFileSync(versionHistoryPath, JSON.stringify(versionHistory, 0, 2), {encoding:"utf-8"});

function createWindow(settings) {
    signale.info("Creating window...");

    let display;
    if (!isNaN(settings.monitor)) {
        display = electron.screen.getAllDisplays()[settings.monitor] || electron.screen.getPrimaryDisplay();
    } else {
        display = electron.screen.getPrimaryDisplay();
    }
    let {x, y, width, height} = display.bounds;
    width++; height++;
    win = new BrowserWindow({
        title: "eDEX-UI",
        x,
        y,
        width,
        height,
        show: false,
        resizable: true,
        movable: settings.allowWindowed || false,
        fullscreen: settings.forceFullscreen || false,
        autoHideMenuBar: true,
        frame: settings.allowWindowed || false,
        backgroundColor: '#000000',
        webPreferences: {
            devTools: true,
            // Modern secure model: renderer is isolated, has no Node access,
            // and only talks to the main process through the curated preload bridge.
            contextIsolation: true,
            sandbox: false,
            nodeIntegration: false,
            nodeIntegrationInSubFrames: false,
            preload: path.join(__dirname, "preload.js"),
            backgroundThrottling: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            experimentalFeatures: settings.experimentalFeatures || false
        }
    });

    win.loadURL(url.format({
        pathname: path.join(__dirname, 'ui.html'),
        protocol: 'file:',
        slashes: true
    }));

    // Optional renderer self-check (used by CI / smoke tests, opt-in via env)
    if (process.env.EDEX_PROBE) {
        require("./_probe.js")(win);
    }

    signale.complete("Frontend window created!");
    win.show();
    // Forward window lifecycle events to the renderer bridge
    win.on("resize", () => {
        if (!win.isDestroyed()) win.webContents.send("edex:win:resize");
    });
    win.on("leave-full-screen", () => {
        if (!win.isDestroyed()) win.webContents.send("edex:win:leave-full-screen");
    });
    if (!settings.allowWindowed) {
        win.setResizable(false);
    } else if (!require(lastWindowStateFile)["useFullscreen"]) {
        win.setFullScreen(false);
    }

    signale.watch("Waiting for frontend connection...");
}

app.on('ready', async () => {
    signale.pending(`Loading settings file...`);
    let settings = require(settingsFile);
    signale.pending(`Resolving shell path...`);
    settings.shell = await which(settings.shell).catch(e => { throw(e) });
    signale.info(`Shell found at ${settings.shell}`);
    signale.success(`Settings loaded!`);

    if (!require("fs").existsSync(settings.cwd)) throw new Error("Configured cwd path does not exist.");

    // See #366
    let cleanEnv = await require("shell-env")(settings.shell).catch(e => { throw e; });

    Object.assign(cleanEnv, {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        TERM_PROGRAM: "eDEX-UI",
        TERM_PROGRAM_VERSION: app.getVersion()
    }, settings.env);

    signale.pending(`Creating new terminal process on port ${settings.port || '3000'}`);
    tty = new Terminal({
        role: "server",
        shell: settings.shell,
        params: settings.shellArgs || '',
        cwd: settings.cwd,
        env: cleanEnv,
        port: settings.port || 3000
    });
    signale.success(`Terminal back-end initialized!`);
    tty.onclosed = (code, signal) => {
        tty.ondisconnected = () => {};
        signale.complete("Terminal exited", code, signal);
        app.quit();
    };
    tty.onopened = () => {
        signale.success("Connected to frontend!");
        signale.timeEnd("Startup");
    };
    tty.onresized = (cols, rows) => {
        signale.info("Resized TTY to ", cols, rows);
    };
    tty.ondisconnected = () => {
        signale.error("Lost connection to frontend");
        signale.watch("Waiting for frontend connection...");
    };

    // Support for multithreaded systeminformation calls
    signale.pending("Starting multithreaded calls controller...");
    require("./_multithread.js");

    createWindow(settings);

    // Support for more terminals, used for creating tabs (currently limited to 4 extra terms)
    extraTtys = {};
    let basePort = settings.port || 3000;
    basePort = Number(basePort) + 2;

    for (let i = 0; i < 4; i++) {
        extraTtys[basePort+i] = null;
    }

    ipc.on("ttyspawn", (e, arg) => {
        // Only accept requests from the app's own main window (# S4)
        if (!win || e.sender !== win.webContents) {
            signale.error("TTY spawn denied (Reason: unauthorized sender)");
            return;
        }
        let port = null;
        Object.keys(extraTtys).forEach(key => {
            if (extraTtys[key] === null && port === null) {
                extraTtys[key] = {};
                port = key;
            }
        });

        if (port === null) {
            signale.error("TTY spawn denied (Reason: exceeded max TTYs number)");
            e.sender.send("ttyspawn-reply", "ERROR: max number of ttys reached");
        } else {
            signale.pending(`Creating new TTY process on port ${port}`);
            let term = new Terminal({
                role: "server",
                shell: settings.shell,
                params: settings.shellArgs || '',
                cwd: tty.tty._cwd || settings.cwd,
                env: cleanEnv,
                port: port
            });
            signale.success(`New terminal back-end initialized at ${port}`);
            term.onclosed = (code, signal) => {
                term.ondisconnected = () => {};
                term.wss.close();
                signale.complete(`TTY exited at ${port}`, code, signal);
                extraTtys[term.port] = null;
                term = null;
            };
            term.onopened = pid => {
                signale.success(`TTY ${port} connected to frontend (process PID ${pid})`);
            };
            term.onresized = () => {};
            term.ondisconnected = () => {
                term.onclosed = () => {};
                term.close();
                term.wss.close();
                extraTtys[term.port] = null;
                term = null;
            };

            extraTtys[port] = term;
            e.sender.send("ttyspawn-reply", "SUCCESS: "+port);
        }
    });

    // Backend support for theme and keyboard hotswitch
    let themeOverride = null;
    let kbOverride = null;
    ipc.on("getThemeOverride", (e, arg) => {
        e.sender.send("getThemeOverride", themeOverride);
    });
    ipc.on("getKbOverride", (e, arg) => {
        e.sender.send("getKbOverride", kbOverride);
    });
    ipc.on("setThemeOverride", (e, arg) => {
        themeOverride = arg;
    });
    ipc.on("setKbOverride", (e, arg) => {
        kbOverride = arg;
    });
});

app.on('web-contents-created', (e, contents) => {
    // Prevent creating more than one window
    contents.on('new-window', (e, url) => {
        e.preventDefault();
        shell.openExternal(url);
    });

    // Prevent loading something else than the UI
    contents.on('will-navigate', (e, url) => {
        if (url !== contents.getURL()) e.preventDefault();
    });
});

app.on('window-all-closed', () => {
    signale.info("All windows closed");
    app.quit();
});

app.on('before-quit', () => {
    tty.close();
    Object.keys(extraTtys).forEach(key => {
        if (extraTtys[key] !== null) {
            extraTtys[key].close();
        }
    });
    signale.complete("Shutting down...");
});
