class Terminal {
    constructor(opts) {
        if (opts.role === "client") {
            if (!opts.parentId) throw "Missing options";

            // In the sandboxed renderer these are loaded as browser globals (see ui.html).
            // The addon UMD builds export a namespace object (e.g. window.FitAddon.FitAddon),
            // so normalize to the actual class.
            this.xTerm = window.Terminal;
            const fromNamespace = (ns, name) => (ns && typeof ns === "object" && typeof ns[name] === "function") ? ns[name] : ns;
            const AttachAddon = fromNamespace(window.AttachAddon, "AttachAddon");
            const FitAddon = fromNamespace(window.FitAddon, "FitAddon");
            const LigaturesAddon = window.LigaturesAddon;
            const WebglAddon = fromNamespace(window.WebglAddon, "WebglAddon");
            this.Ipc = window.__edex.ipc;

            this.port = opts.port || 3000;
            this.cwd = "";
            this.oncwdchange = () => {};

            this._sendSizeToServer = () => {
                let cols = this.term.cols.toString();
                let rows = this.term.rows.toString();
                while (cols.length < 3) {
                    cols = "0"+cols;
                }
                while (rows.length < 3) {
                    rows = "0"+rows;
                }
                this.Ipc.send("terminal_channel-"+this.port, "Resize", cols, rows);
            };

            // Support for custom color filters on the terminal - see #483
            let doCustomFilter = (window.isTermFilterValidated) ? true : false;

            // Parse & validate color filter
            if (window.isTermFilterValidated !== true && typeof window.theme.terminal.colorFilter === "object" && window.theme.terminal.colorFilter.length > 0) {
                doCustomFilter = window.theme.terminal.colorFilter.every((step, i, a) => {
                    let func = step.slice(0, step.indexOf("("));

                    switch(func) {
                        case "negate":
                        case "grayscale":
                            a[i] = {
                                func,
                                arg: []
                            };
                            return true;
                        case "lighten":
                        case "darken":
                        case "saturate":
                        case "desaturate":
                        case "whiten":
                        case "blacken":
                        case "fade":
                        case "opaquer":
                        case "rotate":
                        case "mix":
                            break;
                        default:
                            return false;
                    }

                    let arg = step.slice(step.indexOf("(")+1, step.indexOf(")"));

                    if (typeof Number(arg) === "number") {
                        a[i] = {
                            func,
                            arg: [Number(arg)]
                        };
                        window.isTermFilterValidated = true;
                        return true;
                    }

                    return false;
                });
            }

            // Color math runs in the preload context (chained color lib API
            // cannot cross the contextBridge); helpers.colorify returns a hex string.
            let colorify = (base, target) => {
                let filter = doCustomFilter ? window.theme.terminal.colorFilter : null;
                return window.__edex.helpers.colorify(base, target, filter);
            };

            let themeColor = `rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b})`;

            const termFontFamily = window.theme.terminal.fontFamily || "Fira Mono";
            const termFontSize = window.theme.terminal.fontSize || window.settings.termFontSize || 15;

            this.term = new this.xTerm({
                cols: 80,
                rows: 24,
                cursorBlink: window.theme.terminal.cursorBlink || true,
                cursorStyle: window.theme.terminal.cursorStyle || "block",
                allowTransparency: window.theme.terminal.allowTransparency || false,
                fontFamily: termFontFamily,
                fontSize: termFontSize,
                fontWeight: window.theme.terminal.fontWeight || "normal",
                fontWeightBold: window.theme.terminal.fontWeightBold || "bold",
                letterSpacing: window.theme.terminal.letterSpacing || 0,
                lineHeight: window.theme.terminal.lineHeight || 1,
                scrollback: 1500,
                bellStyle: "none",
                theme: {
                    foreground: window.theme.terminal.foreground,
                    background: window.theme.terminal.background,
                    cursor: window.theme.terminal.cursor,
                    cursorAccent: window.theme.terminal.cursorAccent,
                    selection: window.theme.terminal.selection,
                    black: window.theme.colors.black || colorify("#2e3436", themeColor),
                    red: window.theme.colors.red || colorify("#cc0000", themeColor),
                    green: window.theme.colors.green || colorify("#4e9a06", themeColor),
                    yellow: window.theme.colors.yellow || colorify("#c4a000", themeColor),
                    blue: window.theme.colors.blue || colorify("#3465a4", themeColor),
                    magenta: window.theme.colors.magenta || colorify("#75507b", themeColor),
                    cyan: window.theme.colors.cyan || colorify("#06989a", themeColor),
                    white: window.theme.colors.white || colorify("#d3d7cf", themeColor),
                    brightBlack: window.theme.colors.brightBlack || colorify("#555753", themeColor),
                    brightRed: window.theme.colors.brightRed || colorify("#ef2929", themeColor),
                    brightGreen: window.theme.colors.brightGreen || colorify("#8ae234", themeColor),
                    brightYellow: window.theme.colors.brightYellow || colorify("#fce94f", themeColor),
                    brightBlue: window.theme.colors.brightBlue || colorify("#729fcf", themeColor),
                    brightMagenta: window.theme.colors.brightMagenta || colorify("#ad7fa8", themeColor),
                    brightCyan: window.theme.colors.brightCyan || colorify("#34e2e2", themeColor),
                    brightWhite: window.theme.colors.brightWhite || colorify("#eeeeec", themeColor)
                }
            });
            let fitAddon = new FitAddon();
            this.term.loadAddon(fitAddon);
            this.term.open(document.getElementById(opts.parentId));
            // WebGL renderer is optional. It is NOT harmless when it half-fails:
            // the addon rounds the character cell to device pixels and, if its
            // renderer never activates, the core keeps that (narrower) cell size —
            // text then renders visibly smaller/cramped than the configured size.
            // So: load it, then verify the resulting cell against an independent
            // canvas measurement, and fall back to the canvas renderer on mismatch.
            let webglAddon = null;
            try {
                webglAddon = new WebglAddon();
                this.term.loadAddon(webglAddon);
                // The WebGL renderer rounds the character cell down to whole device
                // pixels. On fractional-DPI displays (150%/125% scaling) that makes
                // the cell ~3-4% narrower than the font's natural advance, so glyphs
                // are drawn at the configured size but squeezed into narrower cells —
                // text looks smaller/cramped. Accept the addon only when its metrics
                // match the font; otherwise fall back to the (exact) canvas renderer.
                const cellWidth = this.term._core._renderService.dimensions.css.cell.width;
                const probeCtx = document.createElement("canvas").getContext("2d");
                probeCtx.font = `${termFontSize}px "${termFontFamily}"`;
                const expectedWidth = probeCtx.measureText("W".repeat(32)).width / 32;
                if (!(cellWidth > 0) || Math.abs(cellWidth - expectedWidth) > expectedWidth * 0.01) {
                    throw new Error(`cell ${Number(cellWidth).toFixed(3)} != font advance ${expectedWidth.toFixed(3)} (dpr ${window.devicePixelRatio})`);
                }
            } catch (e) {
                console.warn("WebglAddon disabled, using canvas renderer:", e && e.message ? e.message : e);
                try { if (webglAddon) webglAddon.dispose(); } catch (err) { /* already gone */ }
                // Nudge the core into re-measuring with the canvas renderer
                try {
                    this.term.options.fontSize = termFontSize + 0.01;
                    this.term.options.fontSize = termFontSize;
                } catch (err) { /* non-fatal */ }
            }
            // Ligatures addon ships a CommonJS-only build (depends on font-finder),
            // so it can't be loaded as a browser global; it's optional here.
            let ligaturesAddon = null;
            if (typeof LigaturesAddon !== "undefined") {
                try {
                    ligaturesAddon = new LigaturesAddon();
                    this.term.loadAddon(ligaturesAddon);
                } catch (e) {
                    console.warn("LigaturesAddon unavailable:", e && e.message ? e.message : e);
                }
            }
            this.term.attachCustomKeyEventHandler(e => {
                window.keyboard.keydownHandler(e);
                return true;
            });
            // Prevent soft-keyboard on touch devices #733
            document.querySelectorAll('.xterm-helper-textarea').forEach(textarea => textarea.setAttribute('readonly', 'readonly'))
            this.term.focus();

            this.Ipc.send("terminal_channel-"+this.port, "Renderer startup");
            this.Ipc.on("terminal_channel-"+this.port, (...args) => {
                switch(args[0]) {
                    case "New cwd":
                        this.cwd = args[1];
                        this.oncwdchange(this.cwd);
                        break;
                    case "Fallback cwd":
                        this.cwd = "FALLBACK |-- "+args[1];
                        this.oncwdchange(this.cwd);
                        break;
                    case "New process":
                        if (this.onprocesschange) {
                            this.onprocesschange(args[1]);
                        }
                        break;
                    default:
                        return;
                }
            });
            this.resendCWD = () => {
                this.oncwdchange(this.cwd || null);
            };

            let sockHost = opts.host || "127.0.0.1";
            let sockPort = this.port;

            this.socket = new WebSocket("ws://"+sockHost+":"+sockPort);
            this.socket.onopen = () => {
                let attachAddon = new AttachAddon(this.socket);
                this.term.loadAddon(attachAddon);
                this.fit();
            };
            this.socket.onerror = e => {throw JSON.stringify(e)};
            this.socket.onclose = e => {
                if (this.onclose) {
                    this.onclose(e);
                }
            };

            this.lastSoundFX = Date.now();
            this.socket.addEventListener("message", e => {
                let d = Date.now();

                if (d - this.lastSoundFX > 30) {
                    if(window.passwordMode == "false")
                        window.audioManager.stdout.play();
                    this.lastSoundFX = d;
                }
                if (d - this.lastRefit > 10000) {
                    this.fit();
                }

                // See #397
                if (!window.settings.experimentalGlobeFeatures) return;
                let ips = e.data.match(/((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g);
                if (ips !== null && ips.length >= 1) {
                    ips = ips.filter((val, index, self) => { return self.indexOf(val) === index; });
                    ips.forEach(ip => {
                        window.mods.globe.addTemporaryConnectedMarker(ip);
                    });
                }
            });

            let parent = document.getElementById(opts.parentId);
            parent.addEventListener("wheel", e => {
                this.term.scrollLines(Math.round(e.deltaY/10));
            });
            this._lastTouchY = null;
            parent.addEventListener("touchstart", e => {
                this._lastTouchY = e.targetTouches[0].screenY;
            });
            parent.addEventListener("touchmove", e => {
                if (this._lastTouchY) {
                    let y = e.changedTouches[0].screenY;
                    let deltaY = y - this._lastTouchY;
                    this._lastTouchY = y;
                    this.term.scrollLines(-Math.round(deltaY/10));
                }
            });
            parent.addEventListener("touchend", e => {
                this._lastTouch = null;
            });
            parent.addEventListener("touchcancel", e => {
                this._lastTouch = null;
            });

            document.querySelector(".xterm-helper-textarea").addEventListener("keydown", e => {
                if (e.key === "F11" && window.settings.allowWindowed) {
                    e.preventDefault();
                    window.toggleFullScreen();
                }
            });

            this.fit = () => {
                this.lastRefit = Date.now();
                let {cols, rows} = fitAddon.proposeDimensions();

                // Apply custom fixes based on screen ratio, see #302
                let w = screen.width;
                let h = screen.height;
                let x = 1;
                let y = 0;

                function gcd(a, b) {
                    return (b == 0) ? a : gcd(b, a%b);
                }
                let d = gcd(w, h);

                if (d === 100) { y = 1; x = 3;}
                // if (d === 120) y = 1;
                if (d === 256) x = 2;

                if (window.settings.termFontSize < 15) y = y - 1;

                cols = cols+x;
                rows = rows+y;

                if (this.term.cols !== cols || this.term.rows !== rows) {
                    this.resize(cols, rows);
                }
            };

            this.resize = (cols, rows) => {
                this.term.resize(cols, rows);
                this._sendSizeToServer();
            };

            this.write = cmd => {
                this.socket.send(cmd);
            };

            this.writelr = cmd => {
                this.socket.send(cmd+"\r");
            };

            this.clipboard = {
                copy: () => {
                    if (!this.term.hasSelection()) return false;
                    const selection = this.term.getSelection();
                    this.clipboard.didCopy = true;
                    // Electron 44 removed the clipboard module from renderers and
                    // rewired it to the W3C shape; write through the preload bridge.
                    try {
                        window.__edex.services.clipboard.writeText(selection);
                    } catch (e) {
                        // Last-resort fallback for old engines
                        try { document.execCommand("copy"); } catch (err) {}
                    }
                    this.term.clearSelection();
                },
                // @electron/remote is gone: read the system clipboard through the
                // preload bridge (async IPC) instead of a non-existent `remote`.
                paste: async () => {
                    this.clipboard.didCopy = false;
                    let text = "";
                    try {
                        text = await window.__edex.services.clipboard.readText();
                    } catch (e) {
                        console.warn("Clipboard read failed:", e && e.message ? e.message : e);
                        return false;
                    }
                    if (typeof text === "string" && text.length > 0) {
                        try {
                            this.write(text);
                        } catch (e) {
                            console.warn("Clipboard paste failed:", e && e.message ? e.message : e);
                        }
                    }
                    return true;
                },
                didCopy: false
            };

        } else if (opts.role === "server") {

            this.Pty = require("node-pty");
            this.Websocket = require("ws").Server;
            this.Ipc = require("electron").ipcMain;

            this.renderer = null;
            this.port = opts.port || 3000;

            this._closed = false;
            this.onclosed = () => {};
            this.onopened = () => {};
            this.onresize = () => {};
            this.ondisconnected = () => {};

            this._disableCWDtracking = false;
            this._getTtyCWD = tty => {
                return new Promise((resolve, reject) => {
                    let pid = tty._pid;
                    switch(require("os").type()) {
                        case "Linux":
                            require("fs").readlink(`/proc/${pid}/cwd`, (e, cwd) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(cwd);
                                }
                            });
                            break;
                        case "Darwin":
                            require("child_process").execFile("lsof", ["-a", "-d", "cwd", "-p", String(pid)], (e, stdout) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    let lines = stdout.split("\n").filter(l => l.trim() !== "");
                                    let dataLine = lines.length > 1 ? lines[lines.length - 1] : "";
                                    resolve(dataLine.split(/\s+/).slice(8).join(" ").trim());
                                }
                            });
                            break;
                        default:
                            reject("Unsupported OS");
                    }
                });
            };
            this._getTtyProcess = tty => {
                return new Promise((resolve, reject) => {
                    let pid = tty._pid;
                    switch(require("os").type()) {
                        case "Linux":
                        case "Darwin":
                            require("child_process").execFile("ps", ["-o", "comm", "--no-headers", "--sort=+pid", "-g", String(pid)], (e, stdout) => {
                                let proc = stdout.trim().split("\n").pop();
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(proc.trim());
                                }
                            });
                            break;
                        default:
                            reject("Unsupported OS");
                    }
                });
            };
            this._nextTickUpdateTtyCWD = false;
            this._nextTickUpdateProcess = false;
            this._tick = setInterval(() => {
                if (this._nextTickUpdateTtyCWD && this._disableCWDtracking === false) {
                    this._nextTickUpdateTtyCWD = false;
                    this._getTtyCWD(this.tty).then(cwd => {
                        if (this.tty._cwd === cwd) return;
                        this.tty._cwd = cwd;
                        if (this.renderer) {
                            this.renderer.send("terminal_channel-"+this.port, "New cwd", cwd);
                        }
                    }).catch(e => {
                        if (!this._closed) {
                            console.log("Error while tracking TTY working directory: ", e);
                            this._disableCWDtracking = true;
                            try {
                                this.renderer.send("terminal_channel-"+this.port, "Fallback cwd", opts.cwd || process.env.PWD);
                            } catch(e) {
                                // renderer closed
                            }
                        }
                    });
                }

                if (this.renderer && this._nextTickUpdateProcess) {
                    this._nextTickUpdateProcess = false;
                    this._getTtyProcess(this.tty).then(process => {
                        if (this.tty._process === process) return;
                        this.tty._process = process;
                        if (this.renderer) {
                            this.renderer.send("terminal_channel-"+this.port, "New process", process);
                        }
                    }).catch(e => {
                        if (!this._closed) {
                            console.log("Error while retrieving TTY subprocess: ", e);
                            try {
                                this.renderer.send("terminal_channel-"+this.port, "New process", "");
                            } catch(e) {
                                // renderer closed
                            }
                        }
                    });
                }
            }, 1000);

            this.tty = this.Pty.spawn(opts.shell || "bash", (opts.params.length > 0 ? opts.params : (process.platform === "win32" ? [] : ["--login"])), {
                name: opts.env.TERM || "xterm-256color",
                cols: 80,
                rows: 24,
                cwd: opts.cwd || process.env.PWD,
                env: opts.env || process.env
            });

            this.tty.onExit((code, signal) => {
                this._closed = true;
                this.onclosed(code, signal);
            });

            // SECURITY: bind the terminal socket to loopback only.
            // `ws` listens on every interface when `host` is omitted, which turned
            // this socket into a raw shell reachable from the whole LAN (any peer
            // could type into this TTY).
            this.wss = new this.Websocket({
                host: "127.0.0.1",
                port: this.port,
                clientTracking: true,
                verifyClient: info => {
                    // Single consumer only: the renderer that owns this TTY.
                    if (this.wss.clients.length >= 1) {
                        return false;
                    }
                    // Reject browser-originated handshakes: an arbitrary website
                    // must not be able to drive ws://127.0.0.1:<port>. The app's own
                    // renderer loads from file:// (Chromium may send "file://" or
                    // "null"), so only those origins are accepted.
                    const origin = (info && (info.origin ||
                        (info.req && info.req.headers && info.req.headers.origin))) || "";
                    if (origin && origin !== "null" && !/^file:\/\//i.test(origin)) {
                        console.warn(`Terminal websocket rejected (origin: ${origin})`);
                        return false;
                    }
                    return true;
                }
            });
            this.Ipc.on("terminal_channel-"+this.port, (e, ...args) => {
                switch(args[0]) {
                    case "Renderer startup":
                        this.renderer = e.sender;
                        if (!this._disableCWDtracking && this.tty._cwd) {
                            this.renderer.send("terminal_channel-"+this.port, "New cwd", this.tty._cwd);
                        }
                        if (this._disableCWDtracking) {
                            this.renderer.send("terminal_channel-"+this.port, "Fallback cwd", opts.cwd || process.env.PWD);
                        }
                        break;
                    case "Resize":
                        let cols = args[1];
                        let rows = args[2];
                        try {
                            this.tty.resize(Number(cols), Number(rows));
                        } catch (error) {
                            //Keep going, it'll work anyways.
                        }
                        this.onresized(cols, rows);
                        break;
                    default:
                        return;
                }
            });
            // Server-level errors (e.g. listen failures) must be handled or they
            // surface as uncaught exceptions in the main process.
            this.wss.on("error", e => {
                console.warn("Terminal websocket server error:", e && e.message ? e.message : e);
            });
            this.wss.on("connection", ws => {
                this.onopened(this.tty._pid);
                // Socket-level errors (ECONNRESET etc.) must be handled too, otherwise
                // node emits an unhandled 'error' event -> uncaughtException.
                ws.on("error", e => {
                    console.warn("Terminal websocket error:", e && e.message ? e.message : e);
                });
                ws.on("close", (code, reason) => {
                    this.ondisconnected(code, reason);
                });
                ws.on("message", msg => {
                    this.tty.write(msg);
                });
                this.tty.onData(data => {
                    this._nextTickUpdateTtyCWD = true;
                    this._nextTickUpdateProcess = true;
                    try {
                        ws.send(data);
                    } catch (e) {
                        // Websocket closed
                    }
                });
            });

            this.close = () => {
                this.tty.kill();
                this._closed = true;
            };
        } else {
            throw "Unknown purpose";
        }
    }
}

module.exports = {
    Terminal
};
