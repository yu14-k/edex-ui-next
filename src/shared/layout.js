// Shared schema + normaliser for the extensible layout config.
//
// Loaded by BOTH the renderer (`<script src="shared/layout.js">`) and the
// build-time validator (`lib/check-syntax.js` via `require`), so a schema drift
// cannot pass CI while the UI silently falls back to defaults.
//
// Design goals:
//   * one declarative file (`userData/layout.json`) decides which module goes in
//     which column, in what order, and how wide each of the three regions is;
//   * unknown module names must never break the UI — they are dropped with a
//     warning so a hand-edited config degrades instead of blank-screening;
//   * every value has a documented default, so partial configs are valid.
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.EDEX_LAYOUT = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // Modules that exist today, in the order they are appended when nothing else
    // is specified (matches the historical hard-coded two-column layout).
    const KNOWN_MODULES = [
        "clock", "sysinfo", "hardwareInspector", "cpuinfo", "ramwatcher", "toplist",
        "netstat", "globe", "conninfo"
    ];

    const COLUMNS = ["left", "right"];

    // Width constraints, in CSS percent of the viewport. The terminal region is
    // whatever is left in the middle, so the three values must sum to <= 100.
    const DEFAULT_LAYOUT = {
        version: 1,
        columns: {
            left: { width: 17, modules: ["clock", "sysinfo", "hardwareInspector", "cpuinfo", "ramwatcher", "toplist"] },
            right: { width: 17, modules: ["netstat", "globe", "conninfo"] }
        },
        terminal: { width: 65 },
        // Optional per-module options (currently only consumed by a few modules;
        // unknown keys are preserved so a newer config does not get wiped).
        modules: {}
    };

    const isPlainObject = v => (v !== null && typeof v === "object" && !Array.isArray(v));

    // Merge a user file over the defaults. Never throws: bad input yields defaults
    // plus a `warnings` array the caller can log or surface in the settings panel.
    function normalize(input) {
        const warnings = [];
        const out = {
            version: DEFAULT_LAYOUT.version,
            columns: {
                left: { width: DEFAULT_LAYOUT.columns.left.width, modules: DEFAULT_LAYOUT.columns.left.modules.slice() },
                right: { width: DEFAULT_LAYOUT.columns.right.width, modules: DEFAULT_LAYOUT.columns.right.modules.slice() }
            },
            terminal: { width: DEFAULT_LAYOUT.terminal.width },
            modules: {}
        };

        if (!isPlainObject(input)) {
            if (input !== undefined) warnings.push("layout config is not an object; using defaults");
            return { layout: out, warnings };
        }

        const clampWidth = (value, fallback, name, min, max) => {
            const n = typeof value === "string" ? Number(value.replace("%", "")) : Number(value);
            if (!isFinite(n)) {
                warnings.push(`${name}: not a number (${JSON.stringify(value)}), using ${fallback}`);
                return fallback;
            }
            if (n < min || n > max) {
                warnings.push(`${name}: ${n} out of range [${min}, ${max}], clamped`);
            }
            return Math.min(max, Math.max(min, n));
        };

        for (const col of COLUMNS) {
            const src = isPlainObject(input.columns) && isPlainObject(input.columns[col]) ? input.columns[col] : null;
            if (!src) {
                if (input.columns) warnings.push(`columns.${col} missing; using defaults`);
                continue;
            }
            if (src.width !== undefined) {
                out.columns[col].width = clampWidth(src.width, out.columns[col].width, `columns.${col}.width`, 10, 30);
            }
            if (Array.isArray(src.modules)) {
                const seen = {};
                const modules = [];
                for (const name of src.modules) {
                    if (typeof name !== "string") {
                        warnings.push(`columns.${col}.modules: ignoring non-string entry`);
                        continue;
                    }
                    if (KNOWN_MODULES.indexOf(name) === -1) {
                        warnings.push(`columns.${col}.modules: unknown module "${name}" ignored`);
                        continue;
                    }
                    if (seen[name]) {
                        warnings.push(`columns.${col}.modules: duplicate "${name}" ignored`);
                        continue;
                    }
                    seen[name] = true;
                    modules.push(name);
                }
                out.columns[col].modules = modules;
            }
        }

        if (isPlainObject(input.terminal) && input.terminal.width !== undefined) {
            out.terminal.width = clampWidth(input.terminal.width, out.terminal.width, "terminal.width", 40, 80);
        }
        if (isPlainObject(input.modules)) {
            // Preserve per-module option bags verbatim (validated lazily per module).
            for (const key of Object.keys(input.modules)) {
                out.modules[key] = isPlainObject(input.modules[key]) ? input.modules[key] : {};
                if (!isPlainObject(input.modules[key])) {
                    warnings.push(`modules.${key}: not an object, ignored`);
                    delete out.modules[key];
                }
            }
        }

        // Modules dropped from both columns must still be reported: the UI will
        // simply not instantiate them (that is how you hide a panel).
        const placed = out.columns.left.modules.concat(out.columns.right.modules);
        const missing = KNOWN_MODULES.filter(m => placed.indexOf(m) === -1);
        if (missing.length === KNOWN_MODULES.length) {
            warnings.push("no modules placed in any column; restoring defaults");
            return { layout: JSON.parse(JSON.stringify(DEFAULT_LAYOUT)), warnings };
        }
        if (missing.length > 0) {
            warnings.push(`modules hidden by config: ${missing.join(", ")}`);
        }

        return { layout: out, warnings };
    }

    return {
        KNOWN_MODULES,
        COLUMNS,
        DEFAULT_LAYOUT,
        normalize
    };
}));
