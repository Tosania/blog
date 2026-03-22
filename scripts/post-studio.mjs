#!/usr/bin/env node

import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

const HOST = "127.0.0.1";
const PORT = Number(process.env.POST_STUDIO_PORT || 4312);
const ROOT = process.cwd();
const POSTS_DIR = path.join(ROOT, "src", "content", "posts");

const KNOWN_KEYS = [
	"title",
	"published",
	"updated",
	"description",
	"image",
	"tags",
	"category",
	"draft",
	"lang",
	"comments",
	"section",
];

const DATE_KEYS = new Set(["published", "updated"]);
const markdown = new MarkdownIt({ html: true, linkify: true, breaks: true });
const execFileAsync = promisify(execFile);

function toPosix(value) {
	return value.replace(/\\/g, "/");
}

function slugify(input) {
	const s = String(input || "")
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9/]+/g, "-")
		.replace(/\/+/g, "/")
		.replace(/^-+|-+$/g, "")
		.replace(/\/-| -\//g, "/")
		.replace(/-{2,}/g, "-")
		.replace(/\/+$/g, "")
		.replace(/^\/+/, "");
	return s || `post-${new Date().toISOString().slice(0, 10)}`;
}

function isPlainObject(x) {
	return !!x && typeof x === "object" && !Array.isArray(x);
}

function tryParseScalar(raw) {
	const value = raw.trim();
	if (value === "") return "";
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null") return null;
	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

	if (
		(value.startsWith("[") && value.endsWith("]")) ||
		(value.startsWith("{") && value.endsWith("}"))
	) {
		try {
			return JSON.parse(value);
		} catch {
			return value;
		}
	}

	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		const inner = value.slice(1, -1);
		if (value.startsWith('"')) {
			try {
				return JSON.parse(value);
			} catch {
				return inner;
			}
		}
		return inner;
	}

	return value;
}

function parseFrontmatter(text) {
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!match) {
		return {
			data: {},
			content: text,
		};
	}

	const raw = match[1];
	const content = text.slice(match[0].length);
	const data = {};

	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const idx = trimmed.indexOf(":");
		if (idx < 0) continue;
		const key = trimmed.slice(0, idx).trim();
		const valueRaw = trimmed.slice(idx + 1).trim();
		data[key] = tryParseScalar(valueRaw);
	}

	return { data, content };
}

function escapeString(value) {
	return JSON.stringify(String(value));
}

function formatValue(key, value) {
	if (value === undefined) return undefined;
	if (value === null) return "''";

	if (Array.isArray(value)) {
		const normalized = value
			.map((item) => String(item).trim())
			.filter(Boolean)
			.map((item) => escapeString(item));
		return `[${normalized.join(", ")}]`;
	}

	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") return String(value);

	const str = String(value).trim();
	if (str === "") return "''";
	if (DATE_KEYS.has(key) && /^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
	return escapeString(str);
}

function normalizeTagArray(raw) {
	if (Array.isArray(raw)) {
		return raw.map((x) => String(x).trim()).filter(Boolean);
	}

	if (typeof raw !== "string") return [];
	const trimmed = raw.trim();
	if (!trimmed) return [];

	const inner =
		trimmed.startsWith("[") && trimmed.endsWith("]")
			? trimmed.slice(1, -1)
			: trimmed;

	return inner
		.split(",")
		.map((x) => x.trim().replace(/^['"]|['"]$/g, ""))
		.map((x) => x.replace(/^\[+|\]+$/g, "").trim())
		.filter(Boolean);
}

function normalizeKnownData(input) {
	const src = isPlainObject(input) ? input : {};
	const out = {};

	out.title = String(src.title ?? "").trim();
	out.published = String(src.published ?? "").trim();
	out.updated = String(src.updated ?? "").trim();
	out.description = String(src.description ?? "").trim();
	out.image = String(src.image ?? "").trim();

	out.tags = normalizeTagArray(src.tags);

	out.category = String(src.category ?? "").trim();
	out.draft = Boolean(src.draft);
	out.lang = String(src.lang ?? "").trim();
	out.comments = src.comments === undefined ? true : Boolean(src.comments);
	const sectionValue = String(src.section ?? "").trim();
	out.section = sectionValue || "";

	if (!out.published) {
		out.published = new Date().toISOString().slice(0, 10);
	}

	if (!out.title) {
		out.title = "Untitled";
	}

	return out;
}

function buildFrontmatter(data, extras) {
	const merged = {};

	if (isPlainObject(extras)) {
		for (const [k, v] of Object.entries(extras)) {
			if (!KNOWN_KEYS.includes(k)) merged[k] = v;
		}
	}

	for (const key of KNOWN_KEYS) {
		merged[key] = data[key];
	}

	if (!merged.title) merged.title = "Untitled";
	if (!merged.published) merged.published = new Date().toISOString().slice(0, 10);

	const lines = ["---"];
	for (const [key, rawValue] of Object.entries(merged)) {
		if (rawValue === undefined) continue;
		if (key === "updated" && String(rawValue).trim() === "") continue;
		if (key === "section" && String(rawValue).trim() === "") continue;

		const formatted = formatValue(key, rawValue);
		if (formatted === undefined) continue;
		lines.push(`${key}: ${formatted}`);
	}
	lines.push("---", "");
	return lines.join("\n");
}

function ensureInsidePosts(resolvedPath) {
	const relative = path.relative(POSTS_DIR, resolvedPath);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error("Illegal file path");
	}
}

function resolveIdToPath(id) {
	if (!id || typeof id !== "string") {
		throw new Error("Missing file id");
	}
	const clean = toPosix(id).replace(/^\/+/, "");
	if (clean.includes("..")) throw new Error("Illegal file id");
	const full = path.resolve(POSTS_DIR, clean);
	ensureInsidePosts(full);
	return full;
}

async function collectMarkdownFiles(dir) {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectMarkdownFiles(full)));
			continue;
		}
		if (entry.isFile() && /\.mdx?$/i.test(entry.name)) {
			files.push(full);
		}
	}
	return files;
}

function toPostSlug(relativeId) {
	const id = toPosix(relativeId);
	if (id.endsWith("/index.md")) return id.slice(0, -"/index.md".length);
	if (id.endsWith("/index.mdx")) return id.slice(0, -"/index.mdx".length);
	return id.replace(/\.mdx?$/i, "");
}

async function listPosts() {
	await fs.mkdir(POSTS_DIR, { recursive: true });
	const files = await collectMarkdownFiles(POSTS_DIR);
	const result = [];

	for (const file of files) {
		const text = await fs.readFile(file, "utf8");
		const stat = await fs.stat(file);
		const { data } = parseFrontmatter(text);
		const relative = toPosix(path.relative(POSTS_DIR, file));
		result.push({
			id: relative,
			slug: toPostSlug(relative),
			title: String(data.title ?? "Untitled"),
			published: String(data.published ?? ""),
			updated: String(data.updated ?? ""),
			draft: Boolean(data.draft),
			section: String(data.section ?? ""),
			category: String(data.category ?? ""),
			tags: normalizeTagArray(data.tags),
			mtime: stat.mtimeMs,
		});
	}

	result.sort((a, b) => {
		const da = Date.parse(a.published || "") || a.mtime;
		const db = Date.parse(b.published || "") || b.mtime;
		return db - da;
	});

	return result;
}

async function readPost(id) {
	const full = resolveIdToPath(id);
	const text = await fs.readFile(full, "utf8");
	const { data, content } = parseFrontmatter(text);

	const known = normalizeKnownData(data);
	const extras = {};
	for (const [k, v] of Object.entries(data)) {
		if (!KNOWN_KEYS.includes(k)) extras[k] = v;
	}

	const ext = path.extname(full).toLowerCase() === ".mdx" ? "mdx" : "md";
	const relative = toPosix(path.relative(POSTS_DIR, full));
	const slug = toPostSlug(relative);
	return {
		id: relative,
		slug,
		format: ext,
		data: known,
		extra: extras,
		content,
	};
}

async function nextAvailablePath(slug, format) {
	const baseSlug = slugify(slug);
	const ext = format === "mdx" ? "mdx" : "md";
	let candidateSlug = baseSlug;
	let index = 1;

	while (true) {
		const full = path.join(POSTS_DIR, candidateSlug, `index.${ext}`);
		try {
			await fs.access(full);
			index += 1;
			candidateSlug = `${baseSlug}-${index}`;
		} catch {
			return { slug: candidateSlug, fullPath: full };
		}
	}
}

function parseBody(req) {
	return new Promise((resolve, reject) => {
		let raw = "";
		req.on("data", (chunk) => {
			raw += chunk;
			if (raw.length > 5 * 1024 * 1024) {
				reject(new Error("Request too large"));
				req.destroy();
			}
		});
		req.on("end", () => {
			if (!raw) return resolve({});
			try {
				resolve(JSON.parse(raw));
			} catch {
				reject(new Error("Invalid JSON"));
			}
		});
		req.on("error", reject);
	});
}

function sendJson(res, status, payload) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	res.end(JSON.stringify(payload));
}

function sendHtml(res, html) {
	res.writeHead(200, {
		"content-type": "text/html; charset=utf-8",
		"cache-control": "no-store",
	});
	res.end(html);
}

async function savePost(payload, forcePublish = false) {
	const incomingData = normalizeKnownData(payload?.data || {});
	if (forcePublish) {
		incomingData.draft = false;
		if (!incomingData.published) {
			incomingData.published = new Date().toISOString().slice(0, 10);
		}
	}

	const content = String(payload?.content ?? "").replace(/\r\n/g, "\n");
	const extra = isPlainObject(payload?.extra) ? payload.extra : {};

	let fullPath;
	let finalSlug;
	let id;
	const format = payload?.format === "mdx" ? "mdx" : "md";

	if (payload?.id) {
		fullPath = resolveIdToPath(payload.id);
		ensureInsidePosts(fullPath);
		id = toPosix(path.relative(POSTS_DIR, fullPath));
		finalSlug = toPostSlug(id);
	} else {
		const base = String(payload?.slug || incomingData.title || "new-post");
		const next = await nextAvailablePath(base, format);
		fullPath = next.fullPath;
		finalSlug = next.slug;
		id = toPosix(path.relative(POSTS_DIR, fullPath));
	}

	await fs.mkdir(path.dirname(fullPath), { recursive: true });
	const fm = buildFrontmatter(incomingData, extra);
	const text = `${fm}${content.trimStart()}${content.endsWith("\n") ? "" : "\n"}`;
	await fs.writeFile(fullPath, text, "utf8");

	return {
		id,
		slug: finalSlug,
		path: toPosix(path.relative(ROOT, fullPath)),
		data: incomingData,
	};
}

async function runGit(args) {
	try {
		const { stdout, stderr } = await execFileAsync("git", args, {
			cwd: ROOT,
			maxBuffer: 10 * 1024 * 1024,
		});
		return {
			stdout: String(stdout || "").trim(),
			stderr: String(stderr || "").trim(),
		};
	} catch (error) {
		const stderr = String(error?.stderr || "").trim();
		const stdout = String(error?.stdout || "").trim();
		throw new Error(
			stderr || stdout || `git ${args.join(" ")} failed`,
		);
	}
}

async function publishToGitHub(payload) {
	const pushMode = payload?.pushMode === "all" ? "all" : "current";
	const remote = String(payload?.remote || "origin").trim() || "origin";
	const messageRaw = String(payload?.commitMessage || "").trim();
	let commitMessage = messageRaw || "feat(post): publish blog update";
	commitMessage = commitMessage.replace(/\s+/g, " ").slice(0, 200);

	let currentFileInRepo = "";
	if (pushMode === "current") {
		const id = String(payload?.id || "").trim();
		if (!id) {
			throw new Error("缺少文章 ID，请先保存当前文章");
		}
		const full = resolveIdToPath(id);
		currentFileInRepo = toPosix(path.relative(ROOT, full));
		await runGit(["add", "--", currentFileInRepo]);
		const staged = await runGit([
			"diff",
			"--cached",
			"--name-only",
			"--",
			currentFileInRepo,
		]);
		if (!staged.stdout) {
			throw new Error("当前文章没有可提交改动，请先修改并保存");
		}
		await runGit(["commit", "-m", commitMessage, "--", currentFileInRepo]);
	} else {
		await runGit(["add", "-A"]);
		const staged = await runGit(["diff", "--cached", "--name-only"]);
		if (!staged.stdout) {
			throw new Error("当前仓库没有可提交改动");
		}
		await runGit(["commit", "-m", commitMessage]);
	}

	const branchRaw = String(payload?.branch || "").trim();
	const branch =
		branchRaw || (await runGit(["rev-parse", "--abbrev-ref", "HEAD"])).stdout;
	if (!branch) {
		throw new Error("无法识别当前分支，请在 Git 仓库中执行");
	}

	await runGit(["push", remote, branch]);
	const commit = (await runGit(["rev-parse", "--short", "HEAD"])).stdout;

	return {
		ok: true,
		mode: pushMode,
		remote,
		branch,
		commit,
		file: currentFileInRepo || null,
	};
}

function sanitizePreview(html) {
	return sanitizeHtml(html, {
		allowedTags: sanitizeHtml.defaults.allowedTags.concat([
			"img",
			"h1",
			"h2",
			"h3",
			"h4",
			"h5",
			"h6",
			"pre",
			"code",
			"table",
			"thead",
			"tbody",
			"tr",
			"th",
			"td",
		]),
		allowedAttributes: {
			...sanitizeHtml.defaults.allowedAttributes,
			a: ["href", "name", "target", "rel"],
			img: ["src", "alt", "title"],
			code: ["class"],
			"*": ["class"],
		},
	});
}

function getHtmlShell() {
	return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Post Studio (Local)</title>
  <style>
    :root {
      --bg: #0f172a;
      --panel: #111827;
      --panel-soft: #1f2937;
      --line: #334155;
      --text: #e5e7eb;
      --muted: #9ca3af;
      --accent: #22d3ee;
      --ok: #34d399;
      --warn: #f59e0b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Roboto", "PingFang SC", "Microsoft YaHei", sans-serif;
      background: radial-gradient(circle at 20% 0%, #1f2937 0%, #0f172a 60%);
      color: var(--text);
      min-height: 100vh;
    }
    .app {
      display: grid;
      grid-template-columns: 360px 1fr;
      min-height: 100vh;
    }
    .left {
      border-right: 1px solid var(--line);
      background: rgba(17, 24, 39, 0.9);
      backdrop-filter: blur(8px);
      padding: 16px;
      overflow-y: auto;
    }
    .right {
      display: grid;
      grid-template-rows: auto 1fr;
      min-width: 0;
    }
    .topbar {
      border-bottom: 1px solid var(--line);
      padding: 12px 16px;
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
      background: rgba(17, 24, 39, 0.75);
    }
    .editor-area {
      display: grid;
      grid-template-columns: 1fr 1fr;
      min-height: 0;
    }
    .panel {
      min-height: 0;
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--line);
    }
    .panel:last-child {
      border-right: none;
    }
    .panel-title {
      padding: 10px 12px;
      font-size: 13px;
      letter-spacing: 0.04em;
      color: var(--muted);
      border-bottom: 1px solid var(--line);
    }
    textarea {
      flex: 1;
      width: 100%;
      resize: none;
      border: none;
      outline: none;
      padding: 12px;
      color: var(--text);
      background: #0b1220;
      font-size: 15px;
      line-height: 1.7;
      font-family: "JetBrains Mono", "Fira Code", monospace;
    }
    .preview {
      flex: 1;
      overflow: auto;
      padding: 20px;
      background: #0b1220;
    }
    .preview h1, .preview h2, .preview h3 { color: #f8fafc; }
    .preview a { color: var(--accent); }
    .preview code { background: #1e293b; padding: 2px 6px; border-radius: 6px; }
    .preview pre { background: #111827; padding: 12px; border-radius: 10px; overflow-x: auto; }
    .preview blockquote { border-left: 4px solid #374151; margin-left: 0; padding-left: 12px; color: #cbd5e1; }
    .preview table { border-collapse: collapse; width: 100%; }
    .preview th, .preview td { border: 1px solid #334155; padding: 8px; }

    .title {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 12px;
    }
    .row {
      margin-bottom: 10px;
    }
    label {
      display: block;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 6px;
      letter-spacing: 0.04em;
    }
    input, select, .meta-textarea {
      width: 100%;
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: var(--panel-soft);
      color: var(--text);
      outline: none;
      font-size: 14px;
    }
    .meta-textarea {
      resize: vertical;
      min-height: 64px;
      font-family: inherit;
    }
    .two {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 14px;
    }
    .actions.single {
      grid-template-columns: 1fr;
      margin-top: 8px;
    }
    button {
      border: none;
      border-radius: 10px;
      padding: 10px 12px;
      cursor: pointer;
      color: #0b1220;
      background: var(--accent);
      font-weight: 700;
      transition: transform 0.08s ease, filter 0.12s ease;
    }
    button:hover { filter: brightness(1.05); }
    button:active { transform: translateY(1px); }
    .ghost {
      background: #64748b;
      color: white;
    }
    .ok {
      background: var(--ok);
      color: #052e2b;
    }
    .warn {
      background: var(--warn);
      color: #3f2100;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      background: rgba(15, 23, 42, 0.75);
    }
    .toolbar button {
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 12px;
      background: #334155;
      color: #e2e8f0;
    }
    .status {
      font-size: 12px;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 65ch;
    }
    .tip {
      font-size: 12px;
      color: var(--muted);
      margin-top: 10px;
      line-height: 1.5;
    }
    .divider {
      border: none;
      border-top: 1px solid var(--line);
      margin: 14px 0;
    }

    @media (max-width: 1100px) {
      .app {
        grid-template-columns: 1fr;
      }
      .left {
        border-right: none;
        border-bottom: 1px solid var(--line);
      }
      .editor-area {
        grid-template-columns: 1fr;
        grid-template-rows: minmax(320px, 1fr) minmax(280px, 1fr);
      }
      .panel {
        border-right: none;
        border-bottom: 1px solid var(--line);
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="left">
      <div class="title">Post Studio (Local)</div>

      <div class="row">
        <label for="postList">现有文章</label>
        <select id="postList"></select>
      </div>
      <div class="two">
        <button id="newBtn" class="ghost" type="button">新建</button>
        <button id="loadBtn" type="button">打开</button>
      </div>

      <hr class="divider" />

      <div class="row">
        <label for="title">标题</label>
        <input id="title" placeholder="文章标题" />
      </div>
      <div class="row">
        <label for="slug">Slug（新建时生效）</label>
        <input id="slug" placeholder="例如: rl/new-policy" />
      </div>

      <div class="two">
        <div class="row">
          <label for="published">发布日期</label>
          <input id="published" type="date" />
        </div>
        <div class="row">
          <label for="updated">更新日期</label>
          <input id="updated" type="date" />
        </div>
      </div>

      <div class="row">
        <label for="description">摘要</label>
        <textarea id="description" class="meta-textarea" placeholder="简短描述"></textarea>
      </div>
      <div class="row">
        <label for="image">封面图</label>
        <input id="image" placeholder="/cover.jpg 或 ./cover.jpg" />
      </div>
      <div class="row">
        <label for="tags">标签（逗号分隔）</label>
        <input id="tags" placeholder="robot, rl, note" />
      </div>
      <div class="row">
        <label for="category">分类</label>
        <input id="category" placeholder="Research" />
      </div>

      <div class="two">
        <div class="row">
          <label for="lang">语言</label>
          <select id="lang">
            <option value="">(空)</option>
            <option value="en">en</option>
            <option value="zh_CN">zh_CN</option>
            <option value="zh_TW">zh_TW</option>
            <option value="ja">ja</option>
            <option value="ko">ko</option>
            <option value="es">es</option>
            <option value="vi">vi</option>
            <option value="id">id</option>
            <option value="th">th</option>
            <option value="tr">tr</option>
          </select>
        </div>
        <div class="row">
          <label for="format">格式（新建）</label>
          <select id="format">
            <option value="md">md</option>
            <option value="mdx">mdx</option>
          </select>
        </div>
      </div>

      <div class="two">
        <div class="row">
          <label for="section">Section</label>
          <select id="section">
            <option value="">(自动/空)</option>
            <option value="research">research</option>
            <option value="tech">tech</option>
            <option value="life">life</option>
            <option value="hidden">hidden</option>
          </select>
        </div>
        <div class="row">
          <label for="comments">评论</label>
          <select id="comments">
            <option value="true">开启</option>
            <option value="false">关闭</option>
          </select>
        </div>
      </div>

      <div class="row">
        <label for="draft">草稿状态</label>
        <select id="draft">
          <option value="true">草稿 (draft: true)</option>
          <option value="false">发布 (draft: false)</option>
        </select>
      </div>

      <div class="actions">
        <button id="saveBtn" class="ok" type="button">保存</button>
        <button id="publishBtn" class="warn" type="button">发布</button>
      </div>

      <hr class="divider" />

      <div class="row">
        <label for="commitMessage">Git Commit Message</label>
        <input id="commitMessage" placeholder="feat(post): publish new blog" />
      </div>
      <div class="two">
        <div class="row">
          <label for="pushMode">推送范围</label>
          <select id="pushMode">
            <option value="current">仅当前文章（推荐）</option>
            <option value="all">仓库全部改动</option>
          </select>
        </div>
        <div class="row">
          <label for="remote">Remote</label>
          <input id="remote" value="origin" />
        </div>
      </div>
      <div class="row">
        <label for="branch">分支（留空=当前分支）</label>
        <input id="branch" placeholder="main" />
      </div>
      <div class="actions single">
        <button id="publishGitBtn" class="warn" type="button">发布并上传到 GitHub</button>
      </div>

      <div class="tip">
        说明：
        <br />1. 工具仅在本地 <code>127.0.0.1</code> 运行。
        <br />2. “保存”会按当前 draft 状态写入。
        <br />3. “发布”会强制写入 <code>draft: false</code>。
        <br />4. “发布并上传到 GitHub”会先发布当前文章，再执行 commit + push。
      </div>
    </aside>

    <section class="right">
      <div class="topbar">
        <div class="status" id="status">准备就绪</div>
        <div id="currentFile" class="status">当前文件：未选择</div>
      </div>

      <div class="editor-area">
        <div class="panel">
          <div class="panel-title">Markdown 编辑器</div>
          <div class="toolbar">
            <button type="button" data-wrap="**|**">粗体</button>
            <button type="button" data-wrap="*|*">斜体</button>
            <button type="button" data-wrap="\`|\`">行内代码</button>
            <button type="button" data-insert="\n## 小标题\n">H2</button>
            <button type="button" data-insert="\n> 引用\n">引用</button>
            <button type="button" data-insert="\n- 列表项\n">列表</button>
            <button type="button" data-insert="\n[链接文字](https://)\n">链接</button>
            <button type="button" data-insert="\n![](./image.png)\n">图片</button>
          </div>
          <textarea id="content" placeholder="在这里输入文章正文 Markdown..."></textarea>
        </div>

        <div class="panel">
          <div class="panel-title">实时预览</div>
          <div id="preview" class="preview"></div>
        </div>
      </div>
    </section>
  </div>

  <script>
    const els = {
      postList: document.getElementById("postList"),
      loadBtn: document.getElementById("loadBtn"),
      newBtn: document.getElementById("newBtn"),
      saveBtn: document.getElementById("saveBtn"),
      publishBtn: document.getElementById("publishBtn"),
      publishGitBtn: document.getElementById("publishGitBtn"),
      currentFile: document.getElementById("currentFile"),
      status: document.getElementById("status"),
      title: document.getElementById("title"),
      slug: document.getElementById("slug"),
      published: document.getElementById("published"),
      updated: document.getElementById("updated"),
      description: document.getElementById("description"),
      image: document.getElementById("image"),
      tags: document.getElementById("tags"),
      category: document.getElementById("category"),
      lang: document.getElementById("lang"),
      format: document.getElementById("format"),
      section: document.getElementById("section"),
      comments: document.getElementById("comments"),
      draft: document.getElementById("draft"),
      commitMessage: document.getElementById("commitMessage"),
      pushMode: document.getElementById("pushMode"),
      remote: document.getElementById("remote"),
      branch: document.getElementById("branch"),
      content: document.getElementById("content"),
      preview: document.getElementById("preview"),
      toolbar: Array.from(document.querySelectorAll(".toolbar button"))
    };

    const state = {
      id: null,
      extra: {},
      list: []
    };

    function setStatus(message) {
      const now = new Date();
      const time = now.toTimeString().slice(0, 8);
      els.status.textContent = "[" + time + "] " + message;
    }

    function toTagInput(tags) {
      return Array.isArray(tags) ? tags.join(", ") : "";
    }

    function parseTags(value) {
      return String(value || "")
        .split(",")
        .map(x => x.trim())
        .filter(Boolean);
    }

    function defaultCommitMessage() {
      const title = (els.title.value || "").trim() || "new post";
      return "feat(post): publish " + title;
    }

    function resetForm() {
      state.id = null;
      state.extra = {};
      els.title.value = "";
      els.slug.value = "";
      els.published.value = new Date().toISOString().slice(0, 10);
      els.updated.value = "";
      els.description.value = "";
      els.image.value = "";
      els.tags.value = "";
      els.category.value = "";
      els.lang.value = "";
      els.format.value = "md";
      els.section.value = "";
      els.comments.value = "true";
      els.draft.value = "true";
      els.pushMode.value = "current";
      els.remote.value = "origin";
      els.branch.value = "";
      els.commitMessage.value = defaultCommitMessage();
      els.content.value = "";
      els.currentFile.textContent = "当前文件：新建（未保存）";
      renderPreview();
      setStatus("已切换到新建模式");
    }

    function applyData(data) {
      const d = data || {};
      els.title.value = d.title || "";
      els.published.value = d.published || "";
      els.updated.value = d.updated || "";
      els.description.value = d.description || "";
      els.image.value = d.image || "";
      els.tags.value = toTagInput(d.tags || []);
      els.category.value = d.category || "";
      els.lang.value = d.lang || "";
      els.section.value = d.section || "";
      els.comments.value = String(d.comments !== false);
      els.draft.value = String(Boolean(d.draft));
    }

    function collectPayload() {
      return {
        id: state.id,
        slug: els.slug.value.trim(),
        format: els.format.value,
        data: {
          title: els.title.value.trim(),
          published: els.published.value,
          updated: els.updated.value,
          description: els.description.value,
          image: els.image.value,
          tags: parseTags(els.tags.value),
          category: els.category.value,
          lang: els.lang.value,
          section: els.section.value,
          comments: els.comments.value === "true",
          draft: els.draft.value === "true"
        },
        extra: state.extra,
        content: els.content.value
      };
    }

    async function request(url, options = {}) {
      const resp = await fetch(url, {
        headers: { "content-type": "application/json" },
        ...options
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || ("请求失败: " + resp.status));
      }
      return data;
    }

    async function loadList() {
      const data = await request("/api/posts");
      state.list = data.posts || [];
      els.postList.innerHTML = "";
      if (!state.list.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "(暂无文章，点击新建)";
        els.postList.appendChild(opt);
        return;
      }

      for (const post of state.list) {
        const opt = document.createElement("option");
        opt.value = post.id;
        const marks = [];
        if (post.draft) marks.push("Draft");
        if (post.section) marks.push(post.section);
        const markText = marks.length ? " [" + marks.join("/") + "]" : "";
        const date = post.published ? " (" + post.published + ")" : "";
        opt.textContent = post.title + date + markText;
        els.postList.appendChild(opt);
      }
    }

    async function openSelected() {
      const id = els.postList.value;
      if (!id) return;
      setStatus("正在加载文章...");
      const data = await request("/api/posts/read?id=" + encodeURIComponent(id));
      state.id = data.id;
      state.extra = data.extra || {};
      els.slug.value = data.slug || "";
      els.format.value = data.format || "md";
      applyData(data.data || {});
      els.content.value = data.content || "";
      els.currentFile.textContent = "当前文件：" + data.id;
      els.commitMessage.value = defaultCommitMessage();
      renderPreview();
      setStatus("文章已加载，可编辑");
    }

    async function save(forcePublish) {
      const payload = collectPayload();
      if (forcePublish) {
        payload.data.draft = false;
      }
      const endpoint = forcePublish ? "/api/posts/publish" : "/api/posts/save";
      setStatus(forcePublish ? "正在发布..." : "正在保存...");
      const data = await request(endpoint, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      state.id = data.id;
      els.slug.value = data.slug || els.slug.value;
      els.draft.value = String(Boolean(data.data?.draft));
      els.currentFile.textContent = "当前文件：" + data.id;
      setStatus((forcePublish ? "发布完成" : "保存完成") + " -> " + data.path);
      await loadList();
      els.postList.value = data.id;
      return data;
    }

    async function publishAndPushGitHub() {
      const saved = await save(true);
      const payload = {
        id: saved.id,
        commitMessage: (els.commitMessage.value || "").trim(),
        pushMode: els.pushMode.value === "all" ? "all" : "current",
        remote: (els.remote.value || "").trim() || "origin",
        branch: (els.branch.value || "").trim()
      };

      setStatus("正在推送到 GitHub...");
      const result = await request("/api/git/publish", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      setStatus(
        "GitHub 推送成功: " +
        result.remote +
        "/" +
        result.branch +
        " @" +
        result.commit
      );
    }

    let previewTimer;
    async function renderPreview() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(async () => {
        try {
          const data = await request("/api/preview", {
            method: "POST",
            body: JSON.stringify({ content: els.content.value || "" })
          });
          els.preview.innerHTML = data.html || "";
        } catch {
          els.preview.innerHTML = "<p>预览渲染失败</p>";
        }
      }, 150);
    }

    function applyWrap(wrap) {
      const [left, right] = wrap.split("|");
      const t = els.content;
      const start = t.selectionStart;
      const end = t.selectionEnd;
      const selected = t.value.slice(start, end);
      const next = left + selected + right;
      t.setRangeText(next, start, end, "end");
      t.focus();
      renderPreview();
    }

    function applyInsert(text) {
      const t = els.content;
      const start = t.selectionStart;
      t.setRangeText(text, start, t.selectionEnd, "end");
      t.focus();
      renderPreview();
    }

    els.newBtn.addEventListener("click", resetForm);
    els.loadBtn.addEventListener("click", () => openSelected().catch(e => setStatus(e.message)));
    els.postList.addEventListener("dblclick", () => openSelected().catch(e => setStatus(e.message)));
    els.saveBtn.addEventListener("click", () => save(false).catch(e => setStatus(e.message)));
    els.publishBtn.addEventListener("click", () => save(true).catch(e => setStatus(e.message)));
    els.publishGitBtn.addEventListener("click", () => publishAndPushGitHub().catch(e => setStatus(e.message)));
    els.content.addEventListener("input", renderPreview);
    els.title.addEventListener("blur", () => {
      if (!els.commitMessage.value.trim()) {
        els.commitMessage.value = defaultCommitMessage();
      }
    });

    for (const btn of els.toolbar) {
      btn.addEventListener("click", () => {
        const wrap = btn.dataset.wrap;
        const insert = btn.dataset.insert;
        if (wrap) applyWrap(wrap);
        if (insert) applyInsert(insert);
      });
    }

    (async function boot() {
      try {
        setStatus("正在初始化...");
        await loadList();
        resetForm();
        if (state.list.length) {
          els.postList.value = state.list[0].id;
          await openSelected();
        }
        setStatus("就绪：可新建、编辑、保存、发布并上传 GitHub");
      } catch (e) {
        setStatus(e.message || "初始化失败");
      }
    })();
  </script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
	try {
		if (!req.url) return sendJson(res, 400, { error: "Bad request" });
		const requestUrl = new URL(req.url, `http://${HOST}:${PORT}`);
		const pathname = requestUrl.pathname;

		if (req.method === "GET" && pathname === "/") {
			return sendHtml(res, getHtmlShell());
		}

		if (req.method === "GET" && pathname === "/api/posts") {
			const posts = await listPosts();
			return sendJson(res, 200, { posts });
		}

		if (req.method === "GET" && pathname === "/api/posts/read") {
			const id = requestUrl.searchParams.get("id") || "";
			const post = await readPost(id);
			return sendJson(res, 200, post);
		}

		if (req.method === "POST" && pathname === "/api/posts/save") {
			const body = await parseBody(req);
			const saved = await savePost(body, false);
			return sendJson(res, 200, saved);
		}

		if (req.method === "POST" && pathname === "/api/posts/publish") {
			const body = await parseBody(req);
			const saved = await savePost(body, true);
			return sendJson(res, 200, saved);
		}

		if (req.method === "POST" && pathname === "/api/preview") {
			const body = await parseBody(req);
			const content = String(body?.content ?? "");
			const rendered = markdown.render(content);
			const html = sanitizePreview(rendered);
			return sendJson(res, 200, { html });
		}

		if (req.method === "POST" && pathname === "/api/git/publish") {
			const body = await parseBody(req);
			const result = await publishToGitHub(body);
			return sendJson(res, 200, result);
		}

		return sendJson(res, 404, { error: "Not found" });
	} catch (error) {
		return sendJson(res, 500, { error: error?.message || "Internal server error" });
	}
});

server.listen(PORT, HOST, () => {
	console.log(`Post Studio is running locally at http://${HOST}:${PORT}/`);
	console.log("Only local access is enabled (127.0.0.1).");
});
