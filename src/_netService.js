// eDEX-UI main-process network services
// Hosts the Node-only network/GeoIP logic that previously lived in the
// renderer's netstat.class.js, so the renderer can stay sandboxed.
// Handles: TCP ping, external IP lookup, MaxMind GeoLite2 GeoIP lookup.
const https = require("https");
const net = require("net");
const path = require("path");
const { app } = require("electron");

class NetService {
    constructor() {
        this._httpsAgent = new https.Agent({ keepAlive: false, maxSockets: 10 });
        this._geoLookup = { get: () => null };
        this._geoReady = false;

        // Init GeoIP backend (MaxMind GeoLite2)
        try {
            const geolite2 = require("geolite2-redist");
            const maxmind = require("maxmind");
            geolite2.downloadDbs(path.join(app.getPath("userData"), "geoIPcache")).then(() => {
                return geolite2.open("GeoLite2-City", p => maxmind.open(p));
            }).then(lookup => {
                this._geoLookup = lookup;
                this._geoReady = true;
                console.log("NetService: GeoIP database loaded");
            }).catch(e => {
                console.warn("NetService: GeoIP database unavailable:", e && e.message ? e.message : e);
                this._geoReady = false;
            });
        } catch (e) {
            console.warn("NetService: geolite2/maxmind unavailable:", e && e.message ? e.message : e);
        }
    }

    geoReady() {
        return this._geoReady;
    }

    geoLookup(ip) {
        try {
            const data = this._geoLookup.get(ip);
            if (data && data.location) {
                return {
                    latitude: data.location.latitude,
                    longitude: data.location.longitude
                };
            }
        } catch (e) {
            // noop
        }
        return null;
    }

    ping(target, port, localAddress) {
        return new Promise((resolve, reject) => {
            const s = new net.Socket();
            const start = process.hrtime();
            let settled = false;
            const done = (fn, val) => {
                if (settled) return;
                settled = true;
                try { s.destroy(); } catch (e) {}
                fn(val);
            };
            s.connect({ port, host: target, localAddress, family: 4 }, () => {
                const timeArr = process.hrtime(start);
                const ms = (timeArr[0] * 1e9 + timeArr[1]) / 1e6;
                done(resolve, ms);
            });
            s.on("error", e => done(reject, e));
            s.setTimeout(1900, () => done(reject, new Error("Socket timeout")));
        });
    }

    externalIp(localAddress) {
        return new Promise((resolve, reject) => {
            https.get({
                host: "myexternalip.com",
                port: 443,
                path: "/json",
                localAddress,
                agent: this._httpsAgent
            }, res => {
                let rawData = "";
                res.on("data", chunk => { rawData += chunk; });
                res.on("end", () => {
                    try {
                        const data = JSON.parse(rawData);
                        resolve(data.ip || null);
                    } catch (e) {
                        reject(e);
                    }
                });
            }).on("error", reject);
        });
    }
}

module.exports = NetService;
