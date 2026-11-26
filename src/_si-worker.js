// eDEX-UI systeminformation worker (runs inside an Electron utilityProcess).
//
// One shared process replaced the old pool of 7 full Node processes (cluster):
// measuring showed each worker carried ~65-72 MB working set for the same
// syscall-bound work, so 7 of them cost ~470 MB with no throughput gain.
//
// Protocol is unchanged (see _multithread.js):
//   in : { id, type, arg }      (arg may be undefined for zero-arg calls)
//   out: { id, res }            (res is null when the call failed)
"use strict";

const si = require("systeminformation");

// utilityProcess children get process.parentPort; fall back to process.send so
// the file also works under plain cluster/child_process if it is ever used that way.
const parent = process.parentPort || null;

function reply(payload) {
    try {
        if (parent) {
            parent.postMessage(payload);
        } else if (typeof process.send === "function") {
            process.send(JSON.stringify(payload));
        }
    } catch (e) {
        // Parent is gone (shutdown); nothing to do.
    }
}

function handle(msg) {
    const type = msg && msg.type;
    const id = msg && msg.id;

    if (typeof si[type] !== "function") {
        reply({ id, res: null });
        return;
    }

    // arg === undefined means "call with no arguments"
    const call = (typeof msg.arg === "undefined") ? si[type]() : si[type](msg.arg);

    Promise.resolve(call).then(res => {
        reply({ id, res });
    }).catch(err => {
        // Reply with null so the renderer promise settles instead of leaking
        reply({ id, res: null });
        console.warn(`systeminformation.${type} failed in worker: ${err && err.message ? err.message : err}`);
    });
}

if (parent) {
    parent.on("message", e => handle(e && e.data));
} else if (typeof process.on === "function") {
    process.on("message", raw => {
        let parsed;
        try {
            parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch (e) {
            return;
        }
        handle(parsed);
    });
}

// A worker-side unhandled error must not take down the app; exit cleanly and let
// the controller decide whether to respawn.
process.on("uncaughtException", err => {
    const code = err && err.code;
    const msg = err && err.message ? err.message : String(err);
    if (code === "ERR_IPC_CHANNEL_CLOSED" || code === "EPIPE" || /Channel closed|EPIPE/.test(msg)) {
        process.exit(0);
    }
    console.error(`systeminformation worker fatal: ${msg}`);
    process.exit(1);
});
