// eDEX-UI preload script
// Bridges a curated, safe API surface from the main process / Node into the
// sandboxed renderer (contextIsolation: true, nodeIntegration: false).
// Everything exposed here is intentionally minimal: no arbitrary require(),
// no raw electron modules, no unbounded fs.
const { contextBridge, ipcRenderer, webFrame } = require("electron");

// --- Node-side helpers available in the preload context ---
const fs = require("fs");
const path = require("path");
const os = require("os");
const { nanoid } = require("nanoid/non-secure");
// `pretty-bytes` 7 and `color` 5 are ESM-only. Node 24's `require(esm)` returns
// the module namespace, so the callable sits on `.default`.
const prettyBytes = require("pretty-bytes").default;
const mime = require("mime-types");
// file-icons matcher ships as a CommonJS module; expose it as a pure function
let matchIcon = null;
try {
    matchIcon = require("./assets/misc/file-icons-match.js");
} catch (e) {
    matchIcon = () => "";
}

// All color math happens here (in the preload context where the chained API
// works) and only resulting strings cross the bridge.
const color = require("color").default;

function colorify(base, target, colorFilter) {
    let newColor = color(base);
    let targetColor = color(target);
    if (Array.isArray(colorFilter) && colorFilter.length > 0) {
        for (let i = 0; i < colorFilter.length; i++) {
            const step = colorFilter[i];
            if (step && step.func) {
                if (step.func === "mix") {
                    newColor = newColor[step.func](targetColor, ...(step.arg || []));
                } else {
                    newColor = newColor[step.func](...(step.arg || []));
                }
            }
        }
    } else {
        // Default: grayscale mix toward the accent color (see #483)
        newColor = newColor.grayscale().mix(targetColor, 0.3);
    }
    return newColor.hex();
}

// --- IPC helpers ---
const ipc = {
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    on: (channel, cb) => {
        const listener = (event, ...args) => cb(...args);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
    },
    once: (channel, cb) => {
        const listener = (event, ...args) => cb(...args);
        ipcRenderer.once(channel, listener);
    },
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
};

// --- fs subset (only what the renderer actually uses) ---
// NOTE: paths are intentionally not whitelisted here — the file browser and the
// built-in text editor are user-driven features that must reach any path the
// user picks. The surface is kept minimal instead.
// `lstat`/`stat` are required: filesystem.class.js wraps them through the
// `_asyncFSwrapper` indirection (`fs[method](...)`), which is easy to miss when
// auditing direct `fs.stat(...)` call sites.
const toPlainStats = (stats) => ({
    // Prototype methods (isDirectory etc.) do not survive the contextBridge copy,
    // so hand over a plain object with function properties.
    isDirectory: () => stats.isDirectory(),
    isFile: () => stats.isFile(),
    isSymbolicLink: () => stats.isSymbolicLink(),
    isBlockDevice: () => stats.isBlockDevice(),
    isCharacterDevice: () => stats.isCharacterDevice(),
    isFIFO: () => stats.isFIFO(),
    isSocket: () => stats.isSocket(),
    size: stats.size,
    mtime: stats.mtime,
    atime: stats.atime,
    birthtime: stats.birthtime,
    mode: stats.mode
});

const fsBridge = {
    readFileSync: (p, enc) => fs.readFileSync(p, enc),
    writeFileSync: (p, data, enc) => fs.writeFileSync(p, data, enc),
    existsSync: (p) => fs.existsSync(p),
    readdirSync: (p, opts) => fs.readdirSync(p, opts),
    readdir: (p, cb) => fs.readdir(p, cb),
    lstat: (p, cb) => fs.lstat(p, (err, stats) => {
        if (err) return cb(err);
        cb(null, toPlainStats(stats));
    }),
    stat: (p, cb) => fs.stat(p, (err, stats) => {
        if (err) return cb(err);
        cb(null, toPlainStats(stats));
    }),
    readFile: (p, enc, cb) => {
        if (typeof enc === "function") { cb = enc; enc = undefined; }
        fs.readFile(p, enc, cb);
    },
    writeFile: (p, data, enc, cb) => {
        if (typeof enc === "function") { cb = enc; enc = undefined; }
        fs.writeFile(p, data, enc, cb);
    },
    watch: (dir, cb) => {
        const w = fs.watch(dir, cb);
        return { close: () => { try { w.close(); } catch (e) {} } };
    }
};

// --- path / os subsets ---
const pathBridge = {
    join: (...args) => path.join(...args),
    resolve: (...args) => path.resolve(...args),
    basename: (p, ext) => path.basename(p, ext),
    dirname: (p) => path.dirname(p),
    extname: (p) => path.extname(p)
};
const osBridge = {
    platform: () => os.platform(),
    type: () => os.type(),
    uptime: () => os.uptime(),
    release: () => os.release(),
    cpus: () => os.cpus()
};

// --- Renderer-side helpers re-exported as functions ---
const helpers = {
    nanoid: () => nanoid(),
    prettyBytes: (n) => prettyBytes(n),
    mimeLookup: (ext) => mime.lookup(ext),
    mimeCharset: (type) => mime.charset(type),
    matchIcon: (name) => (matchIcon ? matchIcon(name) : ""),
    colorify: (base, target, colorFilter) => colorify(base, target, colorFilter),
    escapeHtml: (text) => {
        const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
        return String(text == null ? "" : text).replace(/[&<>"']/g, m => map[m]);
    }
};

// --- Main-process services (IPC-backed) ---
const services = {
    app: {
        getVersion: () => ipc.invoke("edex:app:getVersion"),
        getPath: (name) => ipc.invoke("edex:app:getPath", name),
        getArgv: () => ipc.invoke("edex:app:getArgv"),
        relaunch: () => ipc.send("edex:app:relaunch"),
        quit: () => ipc.send("edex:app:quit"),
        focus: () => ipc.send("edex:app:focus"),
        screenshot: () => ipc.invoke("edex:app:screenshot")
    },
    screen: {
        getAllDisplays: () => ipc.invoke("edex:screen:getAllDisplays")
    },
    shell: {
        openPath: (p) => ipc.invoke("edex:shell:openPath", p),
        openExternal: (url) => ipc.invoke("edex:shell:openExternal", url)
    },
    clipboard: {
        readText: () => ipc.invoke("edex:clipboard:readText"),
        writeText: (text) => ipc.invoke("edex:clipboard:writeText", text)
    },
    shortcut: {
        register: (trigger) => ipc.invoke("edex:shortcut:register", trigger),
        unregisterAll: () => ipc.send("edex:shortcut:unregisterAll")
    },
    win: {
        minimize: () => ipc.send("edex:win:minimize"),
        setFullScreen: (v) => ipc.send("edex:win:setFullScreen", v),
        isFullScreen: () => ipc.invoke("edex:win:isFullScreen"),
        getSize: () => ipc.invoke("edex:win:getSize"),
        setSize: (w, h) => ipc.send("edex:win:setSize", w, h),
        isMaximized: () => ipc.invoke("edex:win:isMaximized"),
        unmaximize: () => ipc.send("edex:win:unmaximize"),
        toggleDevTools: () => ipc.send("edex:win:toggleDevTools"),
        setVisualZoomLevelLimits: (min, max) => webFrame.setVisualZoomLevelLimits(min, max),
        onResize: (cb) => ipc.on("edex:win:resize", cb),
        onLeaveFullScreen: (cb) => ipc.on("edex:win:leave-full-screen", cb)
    },
    username: () => ipc.invoke("edex:username"),
    config: {
        defaults: () => ipc.invoke("edex:config:defaults")
    },
    update: {
        check: () => ipc.invoke("edex:update:check")
    },
    net: {
        ping: (host, port, localAddr) => ipc.invoke("edex:net:ping", host, port, localAddr),
        externalIp: (localAddr) => ipc.invoke("edex:net:externalIp", localAddr),
        geoLookup: (ip) => ipc.invoke("edex:net:geoLookup", ip),
        geoReady: () => ipc.invoke("edex:net:geoReady")
    }
};

contextBridge.exposeInMainWorld("__edex", {
    ipc,
    fs: fsBridge,
    path: pathBridge,
    os: osBridge,
    helpers,
    services,
    versions: {
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome
    }
});
