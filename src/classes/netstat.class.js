class Netstat {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        const services = window.__edex.services;
        this._services = services;

        // Create DOM
        this.parent = document.getElementById(parentId);
        this.parent.innerHTML += `<div id="mod_netstat">
            <div id="mod_netstat_inner">
                <h1>NETWORK STATUS<i id="mod_netstat_iname"></i></h1>
                <div id="mod_netstat_innercontainer">
                    <div>
                        <h1>STATE</h1>
                        <h2>UNKNOWN</h2>
                    </div>
                    <div>
                        <h1>IPv4</h1>
                        <h2>--.--.--.--</h2>
                    </div>
                    <div>
                        <h1>PING</h1>
                        <h2>--ms</h2>
                    </div>
                </div>
            </div>
        </div>`;

        this.offline = false;
        this.lastconn = {finished: false}; // Prevent geoip lookup attempt until maxminddb is loaded
        this.iface = null;
        this.failedAttempts = {};
        this.runsBeforeGeoIPUpdate = 0;

        // Init updaters
        this.updateInfo();
        this.infoUpdater = setInterval(() => {
            this.updateInfo();
        }, 2000);

        // GeoIP is hosted in the main process (see _netService.js) and therefore
        // resolved asynchronously over IPC. Keep a synchronous cache so callers
        // such as locationGlobe can read the last known value immediately; on a
        // miss we kick off a background lookup and return null (the caller's
        // next tick will pick up the resolved value).
        this._geoReady = false;
        this._geoCache = {};
        this.geoLookup = {
            get: (ip) => {
                if (!this._geoReady || !ip) return null;
                if (Object.prototype.hasOwnProperty.call(this._geoCache, ip)) {
                    let loc = this._geoCache[ip];
                    return loc ? { location: loc } : null;
                }
                // Mark as in-flight (null) to avoid duplicate concurrent lookups
                this._geoCache[ip] = null;
                services.net.geoLookup(ip).then(loc => {
                    this._geoCache[ip] = loc || null;
                }).catch(() => {
                    this._geoCache[ip] = null;
                });
                return null;
            }
        };
        services.net.geoReady().then(ready => {
            this._geoReady = !!ready;
            if (this._geoReady) {
                this.lastconn.finished = true;
            }
        });
    }
    updateInfo() {
        window.si.networkInterfaces().then(async data => {
            let offline = false;

            let net = data[0];
            let netID = 0;

            if (typeof window.settings.iface === "string") {
                while (net.iface !== window.settings.iface) {
                    netID++;
                    if (data[netID]) {
                        net = data[netID];
                    } else {
                        // No detected interface has the custom iface name, fallback to automatic detection on next loop
                        window.settings.iface = false;
                        return false;
                    }
                }
            } else {
                // Find the first external, IPv4 connected networkInterface that has a MAC address set

                while (net.operstate !== "up" || net.internal === true || net.ip4 === "" || net.mac === "") {
                    netID++;
                    if (data[netID]) {
                        net = data[netID];
                    } else {
                        // No external connection!
                        this.iface = null;
                        document.getElementById("mod_netstat_iname").innerText = "Interface: (offline)";

                        this.offline = true;
                        document.querySelector("#mod_netstat_innercontainer > div:first-child > h2").innerHTML = "OFFLINE";
                        document.querySelector("#mod_netstat_innercontainer > div:nth-child(2) > h2").innerHTML = "--.--.--.--";
                        document.querySelector("#mod_netstat_innercontainer > div:nth-child(3) > h2").innerHTML = "--ms";
                        break;
                    }
                }
            }

            if (net.ip4 !== this.internalIPv4) this.runsBeforeGeoIPUpdate = 0;

            this.iface = net.iface;
            this.internalIPv4 = net.ip4;
            document.getElementById("mod_netstat_iname").innerText = "Interface: "+net.iface;

            if (net.ip4 === "127.0.0.1") {
                offline = true;
            } else {
                if (this.runsBeforeGeoIPUpdate === 0 && this.lastconn.finished) {
                    try {
                        let ip = await this._services.net.externalIp(net.ip4);
                        let geo = await this._services.net.geoLookup(ip);
                        this.ipinfo = {
                            ip,
                            geo: geo || { latitude: null, longitude: null }
                        };

                        document.querySelector("#mod_netstat_innercontainer > div:nth-child(2) > h2").innerHTML = window._escapeHtml(ip);

                        this.runsBeforeGeoIPUpdate = 10;
                    } catch(e) {
                        this.failedAttempts[e] = (this.failedAttempts[e] || 0) + 1;
                        if (this.failedAttempts[e] > 2) return false;
                        console.warn(e);
                        window.__edex.ipc.send("log", "note", "NetStat: Error parsing data from myexternalip.com");
                        window.__edex.ipc.send("log", "debug", `Error: ${e}`);
                    }
                } else if (this.runsBeforeGeoIPUpdate !== 0) {
                    this.runsBeforeGeoIPUpdate = this.runsBeforeGeoIPUpdate - 1;
                }

                let p = await this.ping(window.settings.pingAddr || "1.1.1.1", 80, net.ip4).catch(() => { offline = true });

                this.offline = offline;
                if (offline) {
                    document.querySelector("#mod_netstat_innercontainer > div:first-child > h2").innerHTML = "OFFLINE";
                    document.querySelector("#mod_netstat_innercontainer > div:nth-child(2) > h2").innerHTML = "--.--.--.--";
                    document.querySelector("#mod_netstat_innercontainer > div:nth-child(3) > h2").innerHTML = "--ms";
                } else {
                    document.querySelector("#mod_netstat_innercontainer > div:first-child > h2").innerHTML = "ONLINE";
                    document.querySelector("#mod_netstat_innercontainer > div:nth-child(3) > h2").innerHTML = Math.round(p)+"ms";
                }
            }
        });
    }
    ping(target, port, local) {
        // TCP ping runs in the main process (net socket lives there)
        return this._services.net.ping(target, port, local);
    }
}

module.exports = {
    Netstat
};
