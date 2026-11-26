// System-information controller.
//
// History: this used to fork a pool of up to 7 `cluster` workers (7 full Node
// processes, ~65-72 MB each). Measurement showed the work is syscall/IO bound,
// so the pool added memory and IPC hops without throughput. It is now a single
// Electron `utilityProcess` running `_si-worker.js`.
//
// If the worker cannot be started (or dies and cannot be respawned), the calls
// transparently run in the main process instead — the renderer always gets a
// reply, which is the same contract as before.
"use strict";

const path = require("path");
const electron = require("electron");
const signale = require("signale");
const si = require("systeminformation");

const ipc = electron.ipcMain;

let worker = null;
let workerReady = false;
let shuttingDown = false;
let pending = {};          // id -> webContents awaiting a reply
let nextWorkerId = 0;

electron.app.on("before-quit", () => { shuttingDown = true; });
electron.app.on("will-quit", () => { shuttingDown = true; });
process.on("exit", () => { shuttingDown = true; });

function replyTo(sender, id, res) {
    try {
        // NOTE: `sender.isDestroyed` is a *function*; the previous guard
        // (`!sender.isDestroyed && ...`) evaluated a function object for truthiness,
        // so it was always false and every reply was silently dropped. Call it.
        const alive = sender && (typeof sender.isDestroyed === "function" ? !sender.isDestroyed() : true);
        if (alive) {
            sender.send("systeminformation-reply-" + id, res);
        }
    } catch (e) {
        // Window closed while the call was in flight, ignore.
    }
}

// Run the call on the main process (fallback path).
function callInProcess(type, id, args, sender, rejects) {
    Promise.resolve(si[type](...args)).then(res => {
        replyTo(sender, id, res);
    }).catch(err => {
        signale.warn(`systeminformation.${type} failed: ${err && err.message ? err.message : err}`);
        // Settle the renderer promise instead of leaving it pending.
        replyTo(sender, id, null);
    });
}

function startWorker() {
    if (worker || shuttingDown) return worker;
    try {
        worker = electron.utilityProcess.fork(path.join(__dirname, "_si-worker.js"), [], {
            serviceName: "edex-systeminformation"
        });
    } catch (e) {
        signale.warn(`Could not start systeminformation worker: ${e && e.message ? e.message : e}`);
        worker = null;
        return null;
    }

    worker.on("message", msg => {
        const id = msg && msg.id;
        const sender = pending[id];
        delete pending[id];
        replyTo(sender, id, msg && msg.res);
    });

    worker.on("exit", code => {
        workerReady = false;
        worker = null;
        // Answer everything that was waiting so the renderer never hangs.
        Object.keys(pending).forEach(id => {
            const sender = pending[id];
            delete pending[id];
            replyTo(sender, id, null);
        });
        if (shuttingDown) return;
        signale.warn(`systeminformation worker exited (code=${code}); restarting`);
        setTimeout(() => {
            if (!shuttingDown) startWorker();
        }, 500).unref();
    });

    workerReady = true;
    return worker;
}

// Lazily start on the first call: startup no longer pays for forking a pool.
ipc.on("systeminformation-call", (e, type, id, ...args) => {
    if (typeof si[type] !== "function") {
        signale.warn("Illegal request for systeminformation");
        return;
    }

    // Multi-arg calls are not supported by the worker protocol; handle locally.
    if (args.length > 1) {
        callInProcess(type, id, args, e.sender, true);
        return;
    }

    const w = startWorker();
    if (!w) {
        callInProcess(type, id, args, e.sender, true);
        return;
    }

    pending[id] = e.sender;
    try {
        w.postMessage({ id, type, arg: args[0] });
    } catch (err) {
        delete pending[id];
        signale.warn(`Could not dispatch to systeminformation worker: ${err && err.message ? err.message : err}`);
        callInProcess(type, id, args, e.sender, true);
    }
});

// Keep the id counter exported for debugging/consistency with older logs.
module.exports = {
    get workerPid() {
        return (worker && worker.pid) || null;
    },
    get workerReady() {
        return workerReady;
    },
    nextId() {
        return ++nextWorkerId;
    }
};
