class UpdateChecker {
    constructor() {
        let services = window.__edex.services;

        this._failed = false;

        services.update.check().then(release => {
            if (!release || !release.tag_name) {
                // Failed or no data
                window.__edex.ipc.send("log", "note", "UpdateChecker: Could not fetch latest release from GitHub's API.");
                return;
            }
            try {
                let current = "";
                // Version is resolved asynchronously in _renderer.js; read from the cached value
                current = (window.edexVersion) ? window.edexVersion : "";
                let tagName = String(release.tag_name).replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
                // The main process resolves the repo slug from package.json, so forks
                // point at their own releases instead of the upstream project's.
                let downloadUrl = (typeof release.html_url === "string" && release.html_url.startsWith("https://github.com/"))
                    ? release.html_url
                    : (release.releasesUrl || "https://github.com");

                if (tagName.slice(1) === current) {
                    window.__edex.ipc.send("log", "info", "UpdateChecker: Running latest version.");
                } else if (Number(tagName.slice(1).replace(/\./g, "")) < Number(String(current).replace("-pre", "").replace(/\./g, ""))) {
                    window.__edex.ipc.send("log", "info", "UpdateChecker: Running an unreleased, development version.");
                } else {
                    new Modal({
                        type: "custom",
                        title: "New version available",
                        html: `eDEX-UI <strong>${tagName}</strong> is now available.<br/>Head over to github.com to download the latest version.`,
                        buttons: [
                            {label: "Open Download Page", action: () => { services.shell.openExternal(downloadUrl); }}
                        ]
                    });
                    window.__edex.ipc.send("log", "info", `UpdateChecker: New version ${release.tag_name} available.`);
                }
            } catch (e) {
                window.__edex.ipc.send("log", "debug", `UpdateChecker error: ${e}`);
            }
        }).catch(e => {
            window.__edex.ipc.send("log", "note", "UpdateChecker: Could not fetch latest release from GitHub's API.");
        });
    }
}

module.exports = {
    UpdateChecker
};
