// Isolated smoke test for dsh-compact-chat client logic (no browser needed).
// Mocks window/document/MutationObserver + computed body style (design tokens)
// + tagged stylesheets (MessageItem / AssistantMarkdown / InputBar / other
// plugin) and asserts the generated override CSS, including the independent
// line-height knob (px=15, lh=1.4).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, "../lib/client.js"), "utf8");

globalThis.CSSStyleRule = class CSSStyleRule {};

function fakeRule(selector, decls) {
	const map = new Map(decls.map(([k, v]) => [k, v]));
	const rule = {
		selectorText: selector,
		style: { getPropertyValue: (k) => (map.has(k) ? map.get(k) : "") },
	};
	Object.setPrototypeOf(rule, CSSStyleRule.prototype);
	return rule;
}

const sheets = [
	{
		attr: "@deepseek-ai/dsh-client-ui-conversation/MessageItem.module.css",
		rules: [
			fakeRule("._56UBBq_bubble", [["font-size", "16px"], ["line-height", "24px"]]),
			fakeRule("._56UBBq_compactionTitle", [["font-size", "13px"]]),
		],
	},
	{
		attr: "@deepseek-ai/dsh-client-ui-conversation/AssistantMarkdown.module.css",
		rules: [
			fakeRule(".ltnGdq_root", [["font-size", "16px"], ["line-height", "28px"]]),
			fakeRule(".ltnGdq_body", [["gap", "16px"], ["flex-direction", "column"]]),
		],
	},
	{
		attr: "@deepseek-ai/dsh-client-ui-conversation/InputBar.module.css",
		rules: [fakeRule(".SmaQRa_card", [["font-size", "16px"], ["line-height", "24px"]])],
	},
	{
		attr: "dsh-better-sidebar/other.module.css",
		rules: [fakeRule(".zzz_big", [["font-size", "16px"], ["line-height", "24px"]])],
	},
];

// computed body style: markdown tokens as declared in the app-shell css
const bodyTokens = new Map(Object.entries({
	"--dsw-font-markdown-base": "16px/28px var(--dsw-font-family)",
	"--dsw-font-markdown-base-strong": "600 16px/28px var(--dsw-font-family)",
	"--dsw-font-markdown-h1": "700 24px/34px var(--dsw-font-family)",
	"--dsw-font-markdown-h2": "700 22px/32px var(--dsw-font-family)",
	"--dsw-font-markdown-h4": "600 16px/28px var(--dsw-font-family)",
	"--dsw-font-markdown-table": "15px/25px var(--dsw-font-family)",
	"--dsw-font-markdown-small": "14px/24px var(--dsw-font-family)",
	"--dsw-font-markdown-code": "14px/22px var(--ds-font-family-code)",
	"--dsw-font-markdown-code-block": "13px/22px var(--ds-font-family-code)",
}));

const store = new Map([["dsh-compact-chat-ui:px", "15"], ["dsh-compact-chat-ui:lh", "1.4"]]);
const appended = [];

globalThis.window = {
	localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null) },
	getComputedStyle: () => ({ getPropertyValue: (k) => bodyTokens.get(k) ?? "" }),
	__ModuleLoader__: { load(entry) { globalThis.__entry = entry; } },
};

globalThis.document = {
	body: {},
	head: { appendChild(el) { appended.push(el); } },
	querySelector: () => null,
	querySelectorAll: () => sheets.map((s) => ({
		getAttribute: () => s.attr,
		sheet: { cssRules: s.rules },
	})),
	getElementById: () => null,
	createElement: () => ({
		setAttribute() {},
		set textContent(v) { this._t = v; },
		get textContent() { return this._t ?? ""; },
	}),
};

// app-shell stylesheet (served as a <link>, enumerated via document.styleSheets):
// markdown block margins under the build-hashed class `_markdown_1nba0_5`
globalThis.document.styleSheets = [
	{
		cssRules: [
			fakeRule("._markdown_1nba0_5", [["font", "var(--dsw-font-markdown-base)"]]),
			fakeRule("._markdown_1nba0_5 p", [["margin", "16px 0"]]),
			fakeRule("._markdown_1nba0_5 h1", [["margin", "32px 0 16px"]]),
			fakeRule("._markdown_1nba0_5 li:not(:first-child)", [["margin-top", "6px"]]),
			fakeRule("._markdown_1nba0_5 li::marker", [["line-height", "28px"]]),
		],
	},
];
globalThis.MutationObserver = class { observe() {} };

// run the client bundle, then drive the plugin like the real module loader does
(0, eval)(src);
// minimal react shim: the settings card only needs createElement hooks at
// definition time (rendering is not exercised here)
const fakeReact = {
	createElement: () => ({}),
	useState: (init) => [typeof init === "function" ? init() : init, () => {}],
	useEffect: () => {},
};
const slotRegistrations = [];
const mockCtx = {
	locale: { register: () => () => {} },
	slots: {
		inject: (slot, fn) => { slotRegistrations.push({ slot, entry: fn() }); },
		register: (options, component) => ({ ...options, component }),
	},
	effect: (fn) => {},
};
const loaded = globalThis.__entry.factory(() => fakeReact);
loaded.apply(mockCtx);

const css = appended[1]?.textContent ?? "";
const checks = [
	// base 16/28 @px15,lh1.4: size 15, proportional 26, capped 21 → 21
	["markdown base token 16/28 → 15/21", css.includes("body{--dsw-font-markdown-base:15px/21px var(--dsw-font-family) !important;}")],
	["sub-token consistency 15/21", css.includes("body{--dsw-font-markdown-base-font-size:15px !important;--dsw-font-markdown-base-line-height:21px !important;}")],
	// h1 24/34: size 23, proportional 32, capped 32 → min 32 (already tight, keeps own)
	["h1 keeps its tighter rhythm 23/32", css.includes("body{--dsw-font-markdown-h1:700 23px/32px var(--dsw-font-family) !important;}")],
	// h2 22/32: size 21, proportional 30, capped 29 → 29
	["h2 21/29", css.includes("body{--dsw-font-markdown-h2:700 21px/29px var(--dsw-font-family) !important;}")],
	// table 15/25: size 14, proportional 23, capped 20 → 20
	["table 14/20", css.includes("body{--dsw-font-markdown-table:14px/20px var(--dsw-font-family) !important;}")],
	["code tokens untouched (13px < 15px)", !css.includes("--dsw-font-markdown-code-block:")],
	["small token untouched (14px < 15px)", !css.includes("--dsw-font-markdown-small:")],
	// bubble 16/24: proportional 23, capped 21 → 21
	["user bubble 15px/21px", css.includes("._56UBBq_bubble{font-size:15px !important;line-height:21px !important;}")],
	["assistant root 15px/21px", css.includes(".ltnGdq_root{font-size:15px !important;line-height:21px !important;}")],
	["InputBar NOT touched (composer keeps 16px)", !css.includes("SmaQRa")],
	["13px rule untouched", !css.includes("compactionTitle")],
	["other plugins untouched", !css.includes("zzz_big")],
	// mg = 0.5 (default, unset in store): markdown block margins halved
	["paragraph margin 16px 0 → 8px 0", css.includes("._markdown_1nba0_5 p{margin:8px 0 !important;}")],
	["h1 margin 32/16 → 16/8", css.includes("._markdown_1nba0_5 h1{margin:16px 0 8px !important;}")],
	["li margin-top 6px → 3px", css.includes("._markdown_1nba0_5 li:not(:first-child){margin-top:3px !important;}")],
	["marker line-height reset to inherit", css.includes("._markdown_1nba0_5 li::marker{line-height:inherit !important;}")],
	["message body flex gap 16px → 8px", css.includes(".ltnGdq_body{gap:8px !important;}")],
	// settings card: css tag injected + keyed registration in the Plugins tab
	// (the host half registers the matching "dsh-compact-chat-ui" namespace)
	["card css injected", (appended[0]?.textContent ?? "").includes(".ccui_card{")],
	["settings card registered keyed in settings.plugin.item", slotRegistrations.length === 1 && slotRegistrations[0].slot === "settings.plugin.item" && slotRegistrations[0].entry.key === "dsh-compact-chat-ui" && slotRegistrations[0].entry.locale === "dsh-compact-chat-ui" && typeof slotRegistrations[0].entry.component === "function"],
];

// clipboard shim (exported for tests): three scenarios against fake nav/doc
let shimResults = [];
{
	const makeNav = (impl) => {
		const clipboard = { writeText: impl };
		return { clipboard };
	};
	const makeDoc = (execResult) => {
		let textarea = null;
		return {
			createElement: () => {
				textarea = {
					style: { cssText: "" }, value: "", _selected: false,
					setAttribute() {}, select() { this._selected = true; }, setSelectionRange() {}, remove() { textarea = null; },
				};
				return textarea;
			},
			body: { appendChild() {} },
			execCommand: (cmd) => { lastExec = { cmd, value: textarea ? textarea.value : null }; return execResult; },
		};
	};
	let lastExec = null;

	// 1. success path passes through (permission granted): original called, no execCommand
	let lastExec_outer = null;
	{
		const nav = makeNav(async (t) => { calledWith = t; });
		let calledWith = null;
		const doc = makeDoc(true);
		const ok = loaded.installClipboardShim(nav, doc);
		await nav.clipboard.writeText("hello");
		shimResults.push(["shim installs", ok === true]);
		shimResults.push(["success path: original API used, no fallback", calledWith === "hello" && lastExec === null]);
	}
	// 2. denial path (desktop app): original rejects → execCommand fallback copies the text
	{
		const nav = makeNav(async () => { throw new Error("NotAllowedError"); });
		const doc = makeDoc(true);
		loaded.installClipboardShim(nav, doc);
		let threw = false;
		try { await nav.clipboard.writeText("copied-text"); } catch { threw = true; }
		shimResults.push(["denial path: fallback copies via execCommand", !threw && lastExec && lastExec.cmd === "copy" && lastExec.value === "copied-text"]);
	}
	// 3. both fail: patched writeText rejects so callers see the failure
	{
		const nav = makeNav(async () => { throw new Error("NotAllowedError"); });
		const doc = makeDoc(false);
		loaded.installClipboardShim(nav, doc);
		let threw = false;
		try { await nav.clipboard.writeText("x"); } catch { threw = true; }
		shimResults.push(["both paths fail: writeText rejects", threw]);
	}
	// 4. double install is a no-op
	{
		const nav = makeNav(async () => {});
		const doc = makeDoc(true);
		loaded.installClipboardShim(nav, doc);
		const again = loaded.installClipboardShim(nav, doc);
		shimResults.push(["second install is a no-op", again === false]);
	}
}
checks.push(...shimResults);
let failed = 0;
for (const [name, ok] of checks) { console.log((ok ? "PASS" : "FAIL") + " " + name); if (!ok) failed++; }
console.log("--- generated css ---\n" + css);
process.exit(failed ? 1 : 0);
