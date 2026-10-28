#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, exit, platform } from "node:process";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const MODES = {
	"1": {
		label: "网页预览 (Astro dev)",
		url: "http://127.0.0.1:4321/",
		script: "dev",
		args: ["--host", "127.0.0.1", "--port", "4321"],
	},
	"2": {
		label: "编辑页面预览 (Post Studio)",
		url: "http://127.0.0.1:4312/",
		script: "post-studio",
		args: [],
	},
};

function resolvePackageManager() {
	const userAgent = process.env.npm_config_user_agent || "";
	const inferred = userAgent.split(" ")[0]?.split("/")[0];
	return inferred || "npm";
}

function resolveExecutable(command) {
	return platform === "win32" ? `${command}.cmd` : command;
}

function normalizeChoice(raw) {
	const value = String(raw || "").trim().toLowerCase();
	if (["1", "web", "site", "astro", "dev"].includes(value)) return "1";
	if (["2", "studio", "post", "post-studio", "editor"].includes(value)) return "2";
	return "";
}

async function promptChoice() {
	const rl = createInterface({ input, output });
	try {
		console.log("请选择启动模式:");
		console.log("  1) 网页预览 (Astro dev)");
		console.log("  2) 编辑页面预览 (Post Studio)");
		const answer = await rl.question("输入 1 或 2: ");
		return normalizeChoice(answer);
	} finally {
		rl.close();
	}
}

function runMode(modeKey) {
	const mode = MODES[modeKey];
	if (!mode) {
		console.error("无效输入，请重新运行并输入 1 或 2。");
		exit(1);
	}

	const packageManager = resolvePackageManager();
	const executable = resolveExecutable(packageManager);

	console.log(`正在启动${mode.label}...`);
	console.log(`访问地址: ${mode.url}`);

	const scriptArgs = ["run", mode.script, ...mode.args];

	// Node 20.12 起禁止直接 spawn .cmd/.bat（会抛 EINVAL），Windows 下改由 cmd.exe 执行
	const command = platform === "win32" ? process.env.ComSpec || "cmd.exe" : executable;
	const commandArgs =
		platform === "win32" ? ["/d", "/s", "/c", [executable, ...scriptArgs].join(" ")] : scriptArgs;

	const child = spawn(command, commandArgs, {
		cwd: ROOT_DIR,
		stdio: "inherit",
	});

	child.on("exit", (code, signal) => {
		if (signal) {
			exit(1);
		}
		exit(code ?? 0);
	});

	child.on("error", (error) => {
		console.error(`启动失败: ${error.message}`);
		exit(1);
	});
}

const choice = normalizeChoice(process.argv[2]) || (await promptChoice());
runMode(choice);
