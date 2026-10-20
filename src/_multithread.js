const cluster = require("cluster");

if (cluster.isMaster) {
    const electron = require("electron");
    const ipc = electron.ipcMain;
    const signale = require("signale");
    // Also, leave a core available for the renderer process
    const osCPUs = require("os").cpus().length - 1;
    // See #904. Math.max(1, ...) guards single-core machines where osCPUs would be 0,
    // which previously produced an empty worker pool and a broken dispatch().
    const numCPUs = Math.max(1, (osCPUs > 7) ? 7 : osCPUs);

    const si = require("systeminformation");

    cluster.setupMaster({
        exec: require("path").join(__dirname, "_multithread.js")
    });

    var shuttingDown = false;

    // Stop respawning workers once the app starts quitting (forking during
    // teardown races the shutdown). We intentionally do NOT force-disconnect
    // workers here: cluster/Node tears them down itself, and forcing it while
    // IPC is in flight can corrupt the shutdown.
    electron.app.on("before-quit", () => { shuttingDown = true; });
    electron.app.on("will-quit", () => { shuttingDown = true; });
    process.on("exit", () => { shuttingDown = true; });

    // Fork with an 'error' listener attached: an unhandled worker 'error' event
    // (e.g. EPIPE when the worker just died) would otherwise crash the whole app.
    function forkWorker() {
        let worker = cluster.fork();
        worker.on("error", err => {
            signale.warn(`Multithread worker ${worker.id} error: ${err && err.message ? err.message : err}`);
        });
        return worker;
    }

    for (let i = 0; i < numCPUs; i++) {
        forkWorker();
    }

    signale.success("Multithreaded controller ready");

    // Live workers only (cluster.workers is pruned automatically by Node/cluster)
    function liveWorkers() {
        return Object.keys(cluster.workers)
            .map(id => cluster.workers[id])
            .filter(w => w && !w.isDead());
    }

    var lastID = 0;

    // Dispatch to a live worker. Returns false if no worker could accept the job,
    // so the caller can fall back to an in-process call instead of hanging forever.
    function dispatch(type, id, arg) {
        let workers = liveWorkers();
        if (workers.length === 0) return false;

        lastID = (lastID + 1) % workers.length;
        let worker = workers[lastID];

        try {
            worker.send(JSON.stringify({
                id,
                type,
                arg
            }));
            return true;
        } catch (err) {
            signale.warn(`Could not dispatch to multithread worker: ${err && err.message ? err.message : err}`);
            return false;
        }
    }

    var queue = {};

    // Run the call on the main process instead (fallback / high-arity calls)
    function callInProcess(type, id, args, sender) {
        return si[type](...args).then(res => {
            try {
                if (sender && !sender.isDestroyed()) {
                    sender.send("systeminformation-reply-"+id, res);
                }
            } catch (e) {
                // Window closed while the call was in flight, ignore.
            }
        }).catch(err => {
            signale.warn(`systeminformation.${type} failed: ${err && err.message ? err.message : err}`);
        });
    }

    ipc.on("systeminformation-call", (e, type, id, ...args) => {
        if (typeof si[type] !== "function") {
            signale.warn("Illegal request for systeminformation");
            return;
        }

        // Multi-arg calls are not supported by the worker protocol; handle locally.
        if (args.length > 1) {
            callInProcess(type, id, args, e.sender);
            return;
        }

        queue[id] = e.sender;
        if (!dispatch(type, id, args[0])) {
            // No usable worker - answer from the main process so the renderer
            // never waits on a reply that will not come.
            delete queue[id];
            callInProcess(type, id, args, e.sender);
        }
    });

    cluster.on("message", (worker, msg) => {
        let parsed;
        try {
            parsed = JSON.parse(msg);
        } catch (e) {
            return;
        }
        try {
            if (queue[parsed.id] && !queue[parsed.id].isDestroyed()) {
                queue[parsed.id].send("systeminformation-reply-"+parsed.id, parsed.res);
            }
        } catch (e) {
            // Window has been closed, ignore.
        }
        delete queue[parsed.id];
    });

    // Keep the pool at the expected size and answer pending requests if a worker dies.
    cluster.on("exit", (worker, code, signal) => {
        if (shuttingDown) return;
        signale.warn(`Multithread worker ${worker.id} exited (code=${code} signal=${signal}); respawning`);
        try {
            forkWorker();
        } catch (e) {
            signale.warn(`Could not respawn multithread worker: ${e && e.message ? e.message : e}`);
        }
    });
} else if (cluster.isWorker) {
    const signale = require("signale");
    const si = require("systeminformation");

    signale.info("Multithread worker started at "+process.pid);

    function reply(payload) {
        try {
            process.send(JSON.stringify(payload));
        } catch (e) {
            // Master is gone (shutdown); nothing to do.
        }
    }

    process.on("message", msg => {
        let parsed;
        try {
            parsed = JSON.parse(msg);
        } catch (e) {
            return;
        }

        if (typeof si[parsed.type] !== "function") {
            reply({ id: parsed.id, res: null });
            return;
        }

        si[parsed.type](parsed.arg).then(res => {
            reply({ id: parsed.id, res });
        }).catch(err => {
            // Reply with null so the renderer promise settles instead of leaking
            reply({ id: parsed.id, res: null });
            signale.warn(`systeminformation.${parsed.type} failed in worker: ${err && err.message ? err.message : err}`);
        });
    });

    // A worker-side unhandled error must not take down the master; log and exit cleanly
    // (the master will respawn the worker unless the app is quitting).
    process.on("uncaughtException", err => {
        const code = err && err.code;
        const msg = err && err.message ? err.message : String(err);
        // "Channel closed" / EPIPE simply means the master is gone (normal shutdown).
        if (code === "ERR_IPC_CHANNEL_CLOSED" || code === "EPIPE" || /Channel closed|EPIPE/.test(msg)) {
            process.exit(0);
        }
        signale.error(`Multithread worker fatal: ${msg}`);
        process.exit(1);
    });
}
