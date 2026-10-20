// eDEX-UI renderer shim
// The renderer is sandboxed (no nodeIntegration): CommonJS globals that the
// legacy class files reference at load time (class X ... module.exports = {X})
// are no longer provided by Node. In a browser context the top-level `class`
// declarations are already global, so `module.exports` assignments are inert;
// we only need a writable `module` object so those lines don't throw.
window.module = { exports: {} };

// Provide a minimal `process` shim backed by the preload bridge so legacy
// renderer code that reads process.platform / process.versions keeps working.
(function () {
    const edex = window.__edex;
    if (edex && edex.os) {
        window.process = {
            platform: edex.os.platform(),
            versions: edex.versions || {}
        };
    } else {
        window.process = { platform: "win32", versions: {} };
    }
})();

// Filesystem base path of the app (directory containing ui.html) as a plain
// Windows/Unix path (no file:// prefix), for use with the fs bridge.
window.__edexFsBase = (function () {
    let p = window.location.pathname || "";
    p = decodeURIComponent(p);
    // strip leading slash on Windows drive paths (/D:/... -> D:/...)
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
    return p.slice(0, p.lastIndexOf("/")) || p;
})();
