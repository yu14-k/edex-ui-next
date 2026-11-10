#!/usr/bin/env node
// One-command release helper.
//
//   npm run release -- 2.4.1                 # 改版本号 + 跑测试 + 提交 + 打标签
//   npm run release -- 2.4.1 --build         # 额外在本机跑一次 pack + 打包（较慢）
//   npm run release -- 2.4.1 --push          # 提交并推送分支与标签（触发 CI 发布）
//
// 推了标签之后 CI 会自动构建并创建 Release（见 .github/workflows/build-binaries.yaml）。
// 也可以只把版本号改好合并进 main：CI 检测到 package.json 版本还没发布过，会自动打标签发布。
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");

const argv = process.argv.slice(2);
const version = argv.find((a) => /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(a));
const flags = new Set(argv.filter((a) => a.startsWith("--")));

if (!version) {
    console.error("用法: npm run release -- <x.y.z> [--build] [--push] [--allow-dirty]");
    process.exit(2);
}
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    console.error(`版本号格式不对: ${version}`);
    process.exit(2);
}

function run(cmd, args, opts) {
    const res = spawnSync(cmd, args, Object.assign({ cwd: root, stdio: "inherit" }, opts || {}));
    if (res.status !== 0) {
        throw new Error(`${cmd} ${args.join(" ")} 失败 (status ${res.status})`);
    }
}
function out(cmd, args) {
    const res = spawnSync(cmd, args, { cwd: root, encoding: "utf8" });
    return res.status === 0 ? String(res.stdout).trim() : "";
}

// --- 1. 前置检查 --------------------------------------------------------
const currentVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
console.log(`当前版本 ${currentVersion} → 目标版本 ${version}`);

if (version === currentVersion) {
    console.error("目标版本与当前版本相同，无需发布");
    process.exit(1);
}

const dirty = out("git", ["status", "--porcelain"]);
if (dirty && !flags.has("--allow-dirty")) {
    console.error("工作区有未提交的改动，先提交或用 --allow-dirty 跳过检查：\n" + dirty);
    process.exit(1);
}

const branch = out("git", ["branch", "--show-current"]);
console.log(`分支: ${branch || "(detached)"}`);

if (out("git", ["tag", "-l", `v${version}`])) {
    console.error(`标签 v${version} 已存在`);
    process.exit(1);
}

// --- 2. 改版本号（两处 manifest + 两份 lock）---------------------------
for (const rel of ["package.json", "src/package.json"]) {
    const file = path.join(root, rel);
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    pkg.version = version;
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`  updated ${rel}`);
}
for (const rel of ["package-lock.json", "src/package-lock.json"]) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    const next = src.replace(/("version":\s*")\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(")/g, `$1${version}$3`);
    fs.writeFileSync(file, next);
    console.log(`  updated ${rel}`);
}

// --- 3. 静态检查（版本一致性也在其中）----------------------------------
console.log("\n== npm test ==");
run("npm", ["test"]);

// --- 4. 可选：本机打包验证 --------------------------------------------
if (flags.has("--build")) {
    console.log("\n== 本机构建（较慢，用于确认打包链路没坏）==");
    run("npm", ["run", "pack-windows"]);
    run("npm", ["run", "build-windows"]);
}

// --- 5. 提交 + 打标签 --------------------------------------------------
console.log("\n== commit + tag ==");
run("git", ["add", "-A"]);
run("git", ["commit", "-m", `chore(release): v${version}`]);
run("git", ["tag", "-a", `v${version}`, "-m", `eDEX-UI v${version}`]);

// --- 6. 推送（可选）---------------------------------------------------
if (flags.has("--push")) {
    console.log("\n== push ==");
    run("git", ["push", "origin", branch || "HEAD"]);
    run("git", ["push", "origin", `v${version}`]);
    console.log(`\n已推送。CI 会在标签构建完成后自动创建 Release v${version}。`);
} else {
    console.log(`\n已完成本地准备。推送后 CI 自动发布：`);
    console.log(`  git push origin ${branch || "HEAD"}`);
    console.log(`  git push origin v${version}`);
}
