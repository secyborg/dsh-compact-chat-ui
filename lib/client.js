// dsh-compact-chat-ui — client half (v0.5).
//
// What this plugin does: tunes the READING DENSITY of the chat content area
// (font size, line height, block spacing) with a settings card in
// Settings → Plugins → 可配置. The composer and the rest of the shell keep
// their native sizes.
//
// Why the rescaler exists: the chat content area hardcodes 16px typography
// in two places, with no setting to change it:
//
//   1. Markdown text (assistant output) is sized by DESIGN TOKENS declared on
//      <body> in the app-shell stylesheet, e.g.
//          body { --dsw-font-markdown-base: 16px/28px var(--dsw-font-family); }
//      consumed as `font: var(--dsw-font-markdown-base)`. Explicit font-size
//      beats inheritance, so shrinking any ancestor does nothing.
//   2. The user-message bubble sets font-size:16px directly in a CSS module
//      whose class hash changes on every build (e.g. `._56UBBq_bubble`).
//
// Strategy (hash-agnostic, update-proof):
//   * Tokens: read every --dsw-font-markdown-* shorthand from the computed
//     <body> style, scale its "Npx/Mpx" pair, re-declare on body with
//     !important (later sheet + important wins).
//   * Rules: scan <style data-plugin-css="…"> sheets — the tag is
//     build-stable — but ONLY whitelisted message-content modules, emitting
//     overrides with the current build's real selectors.
//   * Block spacing: markdown margins live under a hashed `._markdown_`
//     class in the shell stylesheet; scale their px values and the message
//     body's flex gap, and reset the `li::marker` 28px line-height pin.
//
// The settings card writes the same localStorage keys the rescaler reads, so
// console tweaking still works:
//   dsh-compact-chat-ui:px  (11–18, default 15, 16 = stock)
//   dsh-compact-chat-ui:lh  (1.2–2.0, default 1.5)
//   dsh-compact-chat-ui:mg  (0.25–1.5, default 0.5, 1 = stock)

window.__ModuleLoader__.load({
	id: "dsh-compact-chat-ui",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var react = require("react");
		var h = react.createElement;

		//#region knobs
		var STORAGE_PREFIX = "dsh-compact-chat-ui:";
		var KEY_PX = STORAGE_PREFIX + "px";
		var KEY_LH = STORAGE_PREFIX + "lh";
		var KEY_MG = STORAGE_PREFIX + "mg";
		var DEFAULT_PX = 15;
		// Line-height ratio (font-size multiples). The stock sheet uses an airy
		// 1.75 (16px/28px); we tighten to 1.5 by default and never loosen a
		// cohort that is already tighter (headings sit at ~1.42).
		var DEFAULT_LH = 1.5;
		// Block-margin/gap scale. The stock sheet spaces markdown blocks with
		// 16px paragraph margins + a 16px flex gap on the message body (flex
		// containers do not collapse margins, so two paragraphs sit 48px apart)
		// and 32px heading margins. Halving these is the single biggest
		// vertical-space win.
		var DEFAULT_MG = 0.5;
		var BASE_PX = 16;
		var MIN_TOKEN_PX = 15; // scale body/heading/table cohorts; leave small+code cohorts alone
		var STYLE_ID = "dsh-compact-chat-ui-overrides";

		// localStorage.getItem returns null for a missing key, and Number(null)
		// is 0 (not NaN) — treat null explicitly or the default never applies
		// and every knob clamps to its minimum.
		function readNumber(key) {
			try {
				var raw = window.localStorage.getItem(key);
				if (raw === null || raw === "") return null;
				var value = Number(raw);
				return Number.isFinite(value) ? value : null;
			} catch (error) {
				return null;
			}
		}

		function readKnobs() {
			var px = readNumber(KEY_PX);
			var lh = readNumber(KEY_LH);
			var mg = readNumber(KEY_MG);
			return {
				px: px === null ? DEFAULT_PX : Math.min(18, Math.max(11, Math.round(px))),
				lh: lh === null ? DEFAULT_LH : Math.min(2, Math.max(1.2, lh)),
				mg: mg === null ? DEFAULT_MG : Math.min(1.5, Math.max(0.25, mg))
			};
		}

		function writeKnob(key, value) {
			try {
				window.localStorage.setItem(key, String(value));
			} catch (error) {
				// private mode / storage full — the live re-apply still works
			}
		}

		function clearKnob(key) {
			try {
				window.localStorage.removeItem(key);
			} catch (error) {}
		}
		//#endregion

		//#region rescaler
		// Only these CSS modules of the conversation plugin may be rescaled.
		// MessageItem = user bubbles; AssistantMarkdown = assistant text root.
		// NOT InputBar — the composer keeps its native 16px.
		var MODULE_WHITELIST = [
			"@deepseek-ai/dsh-client-ui-conversation/MessageItem.module.css",
			"@deepseek-ai/dsh-client-ui-conversation/AssistantMarkdown.module.css"
		];

		// Markdown font tokens (shorthand form "Npx/Mpx family") declared on body.
		var MARKDOWN_TOKENS = [
			"--dsw-font-markdown-base",
			"--dsw-font-markdown-base-strong",
			"--dsw-font-markdown-base-italic",
			"--dsw-font-markdown-base-strong-italic",
			"--dsw-font-markdown-h1",
			"--dsw-font-markdown-h2",
			"--dsw-font-markdown-h3",
			"--dsw-font-markdown-h4",
			"--dsw-font-markdown-table",
			"--dsw-font-markdown-table-head"
		];

		function parsePx(text) {
			var match = /^(\d+(?:\.\d+)?)px$/.exec(String(text || "").trim());
			return match ? Number(match[1]) : null;
		}

		// "italic 600 16px/28px var(--f)" with a scale factor — both numbers
		// of the size/line-height pair shrink, everything else is preserved.
		// The new line-height is the SMALLER of (proportional scale, size × lh
		// ratio), floored at size + 3px so lines never collide; cohorts that
		// are already tighter than lh (e.g. headings at ~1.42) keep their own
		// proportional value — the knob only tightens, never loosens.
		function scaleShorthand(value, ratio, lh) {
			return String(value).replace(
				/(\d+(?:\.\d+)?)px\/(\d+(?:\.\d+)?)px/,
				function (all, size, lineHeight) {
					var newSize = Math.round(Number(size) * ratio);
					var proportional = Math.round(Number(lineHeight) * ratio);
					var capped = Math.round(newSize * lh);
					var newLine = Math.max(newSize + 3, Math.min(proportional, capped));
					return newSize + "px/" + newLine + "px";
				}
			);
		}

		function buildTokenOverrides(knobs) {
			var ratio = knobs.px / BASE_PX;
			var computed = window.getComputedStyle(document.body);
			var css = "";
			for (var i = 0; i < MARKDOWN_TOKENS.length; i++) {
				var name = MARKDOWN_TOKENS[i];
				var value = computed.getPropertyValue(name).trim();
				if (value === "") continue;
				var pair = /(\d+(?:\.\d+)?)px\/(\d+(?:\.\d+)?)px/.exec(value);
				if (pair === null || Number(pair[1]) < MIN_TOKEN_PX) continue;
				var scaled = scaleShorthand(value, ratio, knobs.lh);
				css += "body{" + name + ":" + scaled + " !important;}\n";
				// keep the sub-tokens consistent for any font-size:/line-height:
				// consumers composing from the parts
				var parts = /(\d+(?:\.\d+)?)px\/(\d+(?:\.\d+)?)px/.exec(scaled);
				css += "body{" + name + "-font-size:" + parts[1] + "px !important;" +
					name + "-line-height:" + parts[2] + "px !important;}\n";
			}
			return css;
		}

		function buildRuleOverrides(knobs) {
			var ratio = knobs.px / BASE_PX;
			var out = "";
			var sheets = document.querySelectorAll("style[data-plugin-css]");
			for (var i = 0; i < sheets.length; i++) {
				var tag = sheets[i].getAttribute("data-plugin-css") || "";
				if (MODULE_WHITELIST.indexOf(tag) === -1) continue;
				var rules;
				try {
					rules = sheets[i].sheet && sheets[i].sheet.cssRules;
				} catch (error) {
					continue;
				}
				if (!rules) continue;
				for (var j = 0; j < rules.length; j++) {
					var rule = rules[j];
					if (!(rule instanceof CSSStyleRule)) continue;
					var selector = rule.selectorText;
					if (!selector || selector.indexOf("@") !== -1) continue;
					// flex gap between message blocks (AssistantMarkdown body):
					// flex containers do not collapse margins, so the gap stacks
					// on top of per-block margins — scale it with the mg knob
					var gap = rule.style.getPropertyValue("gap");
					if (gap !== "" && gap.indexOf("px") !== -1) {
						var scaledGap = scalePxValues(gap, knobs.mg, 3);
						if (scaledGap !== gap) out += selector + "{gap:" + scaledGap + " !important;}\n";
					}
					var fontSize = parsePx(rule.style.getPropertyValue("font-size"));
					if (fontSize === null || fontSize < 15 || fontSize > 17) continue;
					var lineHeight = parsePx(rule.style.getPropertyValue("line-height"));
					var lineHeightCss = "";
					if (lineHeight !== null) {
						var proportional = Math.round(lineHeight * ratio);
						var capped = Math.round(knobs.px * knobs.lh);
						var newLine = Math.max(knobs.px + 3, Math.min(proportional, capped));
						lineHeightCss = "line-height:" + newLine + "px !important;";
					}
					out += selector + "{font-size:" + knobs.px + "px !important;" + lineHeightCss + "}\n";
				}
			}
			return out;
		}

		// Replace every "<N>px" in a declaration value by round(N × factor),
		// floored at `min` px. Returns the value unchanged when nothing moved.
		function scalePxValues(value, factor, min) {
			return String(value).replace(
				/(\d+(?:\.\d+)?)px/g,
				function (all, n) {
					var scaled = Math.round(Number(n) * factor);
					return Math.max(min, scaled) + "px";
				}
			);
		}

		// Markdown block margins live in the app-shell stylesheet under a
		// hashed class (`._markdown_<hash>`): paragraphs 16px, headings 32/16,
		// hr 32px, list items 6px. The hash changes per build, but every rule
		// we care about carries the stable `_markdown_` substring in its
		// selector — discover the real rules at runtime and re-emit them
		// scaled. Also resets `li::marker{line-height:28px}`, which pins list
		// rows open regardless of the lh knob, to inherit.
		function buildMarginOverrides(knobs) {
			var out = "";
			var sheets = document.styleSheets;
			for (var i = 0; i < sheets.length; i++) {
				var rules;
				try {
					rules = sheets[i].cssRules;
				} catch (error) {
					continue; // cross-origin sheet
				}
				if (!rules) continue;
				for (var j = 0; j < rules.length; j++) {
					var rule = rules[j];
					if (!(rule instanceof CSSStyleRule)) continue;
					var sel = rule.selectorText || "";
					if (sel.indexOf("_markdown_") === -1) continue;
					if (knobs.mg !== 1) {
						var props = ["margin", "margin-top", "margin-bottom"];
						for (var k = 0; k < props.length; k++) {
							var value = rule.style.getPropertyValue(props[k]);
							if (value === "" || value.indexOf("px") === -1) continue;
							var scaled = scalePxValues(value, knobs.mg, 2);
							if (scaled !== value) out += sel + "{" + props[k] + ":" + scaled + " !important;}\n";
						}
					}
					if (sel.indexOf("::marker") !== -1) out += sel + "{line-height:inherit !important;}\n";
				}
			}
			return out;
		}

		function applyOverrides() {
			try {
				var knobs = readKnobs();
				var css = buildTokenOverrides(knobs) + buildRuleOverrides(knobs) + buildMarginOverrides(knobs);
				if (!css) return;
				var style = document.getElementById(STYLE_ID);
				if (!style) {
					style = document.createElement("style");
					style.id = STYLE_ID;
					style.setAttribute("data-plugin-css", "dsh-compact-chat-ui/overrides.css");
					document.head.appendChild(style);
				}
				if (style.textContent !== css) style.textContent = css;
			} catch (error) {
				// never break the host page over a cosmetic tweak
				console.warn("[dsh-compact-chat-ui] skipped:", error);
			}
		}
		//#endregion

		//#region settings card
		var LOCALE_NS = "dsh-compact-chat-ui";
		var LOCALE_ZH = {
			title: "聊天区排版",
			description: "调整对话内容的字号、行高与块间距",
			fontSize: "字号",
			lineHeight: "行高",
			spacing: "块间距",
			fontSizeHint: "11–18（原始 16）",
			lineHeightHint: "1.2–2.0（原始 1.00）",
			spacingHint: "0.25–1.5（原始 1.00）",
			unsaved: "未保存",
			discard: "取消",
			save: "保存",
			overridden: "已覆盖",
			resetField: "回退",
			invalid: "请输入有效数字",
			hint: "保存后立即生效并自动持久化；清空输入框保存即恢复插件默认（15 / 1.50 / 0.50）"
		};
		var LOCALE_EN = {
			title: "Chat reading density",
			description: "Tune font size, line height and block spacing of the conversation area",
			fontSize: "Font size",
			lineHeight: "Line height",
			spacing: "Block spacing",
			fontSizeHint: "11–18 (stock 16)",
			lineHeightHint: "1.2–2.0 (stock 1.00)",
			spacingHint: "0.25–1.5 (stock 1.00)",
			unsaved: "Unsaved",
			discard: "Discard",
			save: "Save",
			overridden: "overridden",
			resetField: "reset",
			invalid: "Enter a valid number",
			hint: "Applies on save and persists; clearing a field and saving restores the plugin default (15 / 1.50 / 0.50)"
		};

		// Self-contained translate for surfaces that receive no locale prop
		// (settings.section components only get { close } + inject() values).
		// ACTIVE_LANG is seeded from the environment and refined by the locale
		// service subscription when available.
		var ACTIVE_LANG = typeof navigator !== "undefined" ? (navigator.language || "en") : "en";
		function localeT(key) {
			var dict = /^zh/i.test(ACTIVE_LANG) ? LOCALE_ZH : LOCALE_EN;
			return dict[key] !== undefined ? dict[key] : key;
		}

		// Values mirror PluginCard/ValueField in dsh-client-ui-settings-plugins
		// (hashed module css there; reproduced verbatim here so this card is
		// pixel-identical to the tab's other cards).
		var CARD_CSS = ".ccui_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}" +
			".ccui_card:hover{border-color:var(--dsw-alias-label-dimmed)}" +
			".ccui_card[data-open=true]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}" +
			".ccui_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}" +
			".ccui_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}" +
			".ccui_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}" +
			".ccui_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}" +
			".ccui_desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}" +
			".ccui_pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}" +
			".ccui_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}" +
			".ccui_card[data-open=true] .ccui_chevron{transform:rotate(180deg)}" +
			".ccui_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}" +
			".ccui_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}" +
			".ccui_field+.ccui_field{border-top:1px solid var(--dsw-alias-border-l2)}" +
			".ccui_fhead{align-items:center;gap:8px;display:flex}" +
			".ccui_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}" +
			".ccui_labelHint{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:1.5}" +
			".ccui_badges{align-items:center;gap:8px;display:inline-flex}" +
			".ccui_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}" +
			".ccui_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}" +
			".ccui_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}" +
			".ccui_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}" +
			".ccui_input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}" +
			".ccui_inputInvalid{border-color:var(--dsw-alias-label-error)}" +
			".ccui_invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}" +
			".ccui_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5;padding:12px 0}" +
			".ccui_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}" +
			".ccui_discard,.ccui_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}" +
			".ccui_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}" +
			".ccui_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}" +
			".ccui_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}" +
			".ccui_discard:disabled,.ccui_save:disabled{opacity:.4;cursor:default}" +
			".ccui_discard:focus-visible,.ccui_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}";

		function injectCardCss() {
			if (typeof document === "undefined") return;
			var tagId = "dsh-compact-chat-ui/SettingsCard.module.css";
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
				var tag = document.createElement("style");
				tag.setAttribute("data-plugin-css", tagId);
				tag.textContent = CARD_CSS;
				document.head.appendChild(tag);
			}
		}

		function ChevronDown() {
			return h("svg", {
				className: "ccui_chevron",
				width: 14, height: 14, viewBox: "0 0 16 16", fill: "none",
				stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round",
				"aria-hidden": true
			}, h("path", { d: "M3.5 6.5 8 11l4.5-4.5" }));
		}

		// Knob defaults (plugin defaults, not the app's stock values).
		var DEFAULTS = { px: 15, lh: 1.5, mg: 0.5 };
		var FIELDS = [
			{ key: KEY_PX, name: "px", label: "fontSize", hint: "fontSizeHint", min: 11, max: 18 },
			{ key: KEY_LH, name: "lh", label: "lineHeight", hint: "lineHeightHint", min: 1.2, max: 2 },
			{ key: KEY_MG, name: "mg", label: "spacing", hint: "spacingHint", min: 0.25, max: 1.5 }
		];

		function readRaw() {
			var out = {};
			try {
				for (var i = 0; i < FIELDS.length; i++) {
					var raw = localStorage.getItem(FIELDS[i].key);
					var num = raw === null ? null : Number(raw);
					out[FIELDS[i].name] = Number.isFinite(num) ? num : null;
				}
			} catch (error) { out = { px: null, lh: null, mg: null }; }
			return out;
		}

		function effective(raw) {
			return {
				px: raw.px === null ? DEFAULTS.px : raw.px,
				lh: raw.lh === null ? DEFAULTS.lh : raw.lh,
				mg: raw.mg === null ? DEFAULTS.mg : raw.mg
			};
		}

		function formatNum(value) {
			return String(value);
		}

		// Parse one draft text: "" → default (clear), finite number → set,
		// anything else → invalid (blocks the save).
		function parseDraft(text) {
			var trimmed = text.trim();
			if (trimmed === "") return { kind: "default" };
			var parsed = Number(trimmed);
			return Number.isFinite(parsed) ? { kind: "set", value: parsed } : { kind: "invalid" };
		}

		function SettingsCard(props) {
			// Prefer the slot-provided locale translator (bound to LOCALE_NS
			// via the registration's `locale` field); localeT is the fallback
			// for renderers that pass nothing.
			var t = typeof (props && props.t) === "function" ? props.t : localeT;
			var openState = react.useState(false); // collapsed row in the Plugins tab
			var open = openState[0];
			var setOpen = openState[1];

			var committedState = react.useState(readRaw);
			var committed = committedState[0];
			var setCommitted = committedState[1];
			var eff = effective(committed);

			var draftState = react.useState(function () {
				return { px: formatNum(eff.px), lh: formatNum(eff.lh), mg: formatNum(eff.mg) };
			});
			var draft = draftState[0];
			var setDraft = draftState[1];

			// re-read if the console (or another tab) changed the keys
			react.useEffect(function () {
				function onStorage(event) {
					if (String(event.key || "").indexOf(STORAGE_PREFIX) !== 0) return;
					var next = readRaw();
					setCommitted(next);
					setDraft(function (current) {
						var clean = true;
						for (var i = 0; i < FIELDS.length; i++) {
							var name = FIELDS[i].name;
							var parsed = parseDraft(current[name]);
							var target = formatNum(effective(next)[name]);
							if (!(parsed.kind === "default" && target === formatNum(DEFAULTS[name])) &&
								!(parsed.kind === "set" && parsed.value === effective(next)[name])) { clean = false; break; }
						}
						if (clean) return { px: formatNum(effective(next).px), lh: formatNum(effective(next).lh), mg: formatNum(effective(next).mg) };
						return current;
					});
				}
				window.addEventListener("storage", onStorage);
				return function () { window.removeEventListener("storage", onStorage); };
			}, []);

			var fieldState = {};
			var dirty = false;
			var invalid = false;
			for (var i = 0; i < FIELDS.length; i++) {
				var field = FIELDS[i];
				var parsed = parseDraft(draft[field.name]);
				var target = eff[field.name];
				var isDefault = parsed.kind === "default";
				var fieldDirty = isDefault
					? committed[field.name] !== null
					: parsed.kind === "set" && parsed.value !== target;
				var fieldInvalid = parsed.kind === "invalid" || (parsed.kind === "set" && (parsed.value < field.min || parsed.value > field.max));
				if (fieldDirty) dirty = true;
				if (fieldInvalid) invalid = true;
				fieldState[field.name] = { parsed: parsed, dirty: fieldDirty, invalid: fieldInvalid };
			}

			function save() {
				for (var j = 0; j < FIELDS.length; j++) {
					var f = FIELDS[j];
					var p = parseDraft(draft[f.name]);
					if (p.kind === "invalid") return; // blocked by the disabled save anyway
					if (p.kind === "default") clearKnob(f.key);
					else writeKnob(f.key, p.value);
				}
				applyOverrides();
				var next = readRaw();
				setCommitted(next);
				var e2 = effective(next);
				setDraft({ px: formatNum(e2.px), lh: formatNum(e2.lh), mg: formatNum(e2.mg) });
			}

			function discard() {
				setDraft({ px: formatNum(eff.px), lh: formatNum(eff.lh), mg: formatNum(eff.mg) });
			}

			function edit(name, text) {
				setDraft(function (current) {
					var next = {}; next.px = current.px; next.lh = current.lh; next.mg = current.mg;
					next[name] = text;
					return next;
				});
			}

			function resetField(name) {
				edit(name, formatNum(DEFAULTS[name]));
			}

			return h("li", { className: "ccui_card", "data-open": open },
				h("button", {
					type: "button",
					className: "ccui_header",
					"aria-expanded": open,
					onClick: function () { setOpen(!open); }
				},
					h("span", { className: "ccui_headText" },
						h("span", { className: "ccui_name" }, t("title")),
						h("span", { className: "ccui_desc" }, t("description"))
					),
					dirty ? h("span", { className: "ccui_pending" }, t("unsaved")) : null,
					h(ChevronDown)
				),
				open ? h("div", { className: "ccui_body" },
					FIELDS.map(function (field) {
						var state = fieldState[field.name];
						var inputId = "ccui-field-" + field.name;
						return h("div", { className: "ccui_field", key: field.name },
							h("div", { className: "ccui_fhead" },
								h("label", { className: "ccui_label", htmlFor: inputId },
									t(field.label),
									h("span", { className: "ccui_labelHint" }, " " + t(field.hint))
								),
								h("span", { className: "ccui_badges" },
									committed[field.name] !== null ? h("span", { className: "ccui_badge" }, t("overridden")) : null,
									committed[field.name] !== null ? h("button", {
										type: "button", className: "ccui_reset",
										onClick: function () { resetField(field.name); }
									}, t("resetField")) : null
								)
							),
							h("input", {
								id: inputId,
								className: state.invalid ? "ccui_input ccui_inputInvalid" : "ccui_input",
								type: "text", inputMode: "decimal",
								value: draft[field.name],
								onInput: function (event) { edit(field.name, event.target.value); }
							}),
							state.invalid ? h("p", { className: "ccui_invalid" }, t("invalid")) : null
						);
					}),
					h("p", { className: "ccui_hint" }, t("hint")),
					h("div", { className: "ccui_footer" },
						h("button", {
							type: "button", className: "ccui_discard",
							disabled: !dirty,
							onClick: discard
						}, t("discard")),
						h("button", {
							type: "button", className: "ccui_save",
							disabled: !dirty || invalid,
							onClick: save
						}, t("save"))
					)
				) : null
			);
		}
		//#endregion

		//#region clipboard shim
		// The desktop app's main process denies EVERY permission
		// (setPermissionRequestHandler → callback(false)), including Chromium's
		// clipboard-sanitized-write. Every copy button therefore fails:
		// the app's copy helper awaits navigator.clipboard.writeText, whose
		// rejection it swallows — and its execCommand fallback only runs when
		// the API is MISSING, not when it is denied.
		//
		// Patch navigator.clipboard.writeText once: keep the fast path, and on
		// rejection fall back to the textarea + document.execCommand("copy")
		// trick, which needs no permission and works within the click's
		// transient-activation window. Fixes code-block copy, message copy,
		// and JSON-tree copy alike — they all call this same API.
		function installClipboardShim(nav, doc) {
			nav = nav || (typeof navigator !== "undefined" ? navigator : null);
			doc = doc || (typeof document !== "undefined" ? document : null);
			if (!nav || !doc || !nav.clipboard || typeof nav.clipboard.writeText !== "function") return false;
			if (nav.clipboard.__ccuiClipboardShim) return false;
			var original;
			try {
				original = nav.clipboard.writeText.bind(nav.clipboard);
			} catch (error) {
				return false;
			}
			function fallback(text) {
				var area = doc.createElement("textarea");
				area.value = String(text);
				area.setAttribute("readonly", "");
				area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
				doc.body.appendChild(area);
				area.select();
				try { area.setSelectionRange(0, area.value.length); } catch (error) {}
				var ok = false;
				try { ok = doc.execCommand("copy"); } catch (error) { ok = false; }
				area.remove();
				if (!ok) throw new Error("ClipboardWriteError: execCommand fallback failed");
			}
			var patched = async function (text) {
				try {
					await original(text);
				} catch (error) {
					fallback(text); // throws when the fallback also fails
				}
			};
			try {
				Object.defineProperty(nav.clipboard, "writeText", {
					value: patched,
					writable: true,
					configurable: true,
					enumerable: true
				});
				nav.clipboard.__ccuiClipboardShim = true;
				return true;
			} catch (error) {
				return false;
			}
		}
		//#endregion

		/** Services required before mounting (provided by the client runtime). */
		const inject = ["slots", "locale"];

		function apply(ctx) {
			injectCardCss();
			installClipboardShim();
			applyOverrides();
			// Conversation styles are injected when that plugin's factory runs,
			// which may be after ours — rescan whenever <style> tags appear.
			try {
				var observer = new MutationObserver(function (records) {
					for (var i = 0; i < records.length; i++) {
						var added = records[i].addedNodes;
						for (var j = 0; j < added.length; j++) {
							if (added[j].nodeName === "STYLE" || added[j].querySelector && added[j].querySelector("style")) {
								applyOverrides();
								return;
							}
						}
					}
				});
				observer.observe(document.documentElement, { childList: true, subtree: true });
			} catch (error) {
				console.warn("[dsh-compact-chat-ui] observer skipped:", error);
			}
			// Boot-race backstops. On a cold start the shell stylesheet is a
			// <link> that may still be loading when the first pass runs:
			// computed tokens read as "" and margin rules are unreachable, so
			// the overrides come out empty and nothing re-triggers them (link
			// load events do not fire MutationObserver). Three guards:
			//   * capture-phase "load" listener — catches each stylesheet link
			//     finishing (load does not bubble, but capturing does)
			//   * window "load" — everything settled
			//   * bounded retry loop — covers late body/style injection and any
			//     loader quirk; idempotent (applyOverrides diffs before writing)
			try {
				document.addEventListener("load", function (event) {
					var target = event.target;
					if (target && target.tagName === "LINK") applyOverrides();
				}, true);
			} catch (error) {}
			try {
				window.addEventListener("load", function () { applyOverrides(); });
			} catch (error) {}
			try {
				var attempts = 0;
				var bootRetry = setInterval(function () {
					attempts += 1;
					applyOverrides();
					if (attempts >= 12) clearInterval(bootRetry);
				}, 500);
			} catch (error) {}
			// Settings card under 设置 → 插件 (the Plugins tab). Desktop 2.0.2
			// made "settings.plugin.item" a keyed slot whose key must match a
			// Host-served settings namespace — the host half now registers
			// "dsh-compact-chat-ui" for exactly that, so the tab dispatches
			// this card.
			try {
				var offZh = ctx.locale.register(LOCALE_NS, "zh", LOCALE_ZH);
				var offEn = ctx.locale.register(LOCALE_NS, "en", LOCALE_EN);
				ACTIVE_LANG = (ctx.locale.getSnapshot && ctx.locale.getSnapshot().active) || ACTIVE_LANG;
				ctx.effect(function () {
					var offLang = ctx.locale.subscribe ? ctx.locale.subscribe(function () {
						try { ACTIVE_LANG = ctx.locale.getSnapshot().active || ACTIVE_LANG; } catch (error) {}
					}) : null;
					return function () {
						offZh(); offEn();
						if (offLang) try { offLang(); } catch (error) {}
					};
				}, "dsh-compact-chat-ui: dictionaries");
				ctx.slots.inject("settings.plugin.item", function () {
					return ctx.slots.register({
						name: "settings.plugin.item",
						key: "dsh-compact-chat-ui", // must equal the host half's registered namespace
						locale: LOCALE_NS,
						inject: function () { return {}; }
					}, SettingsCard);
				}, "dsh-compact-chat-ui: settings card");
			} catch (error) {
				console.warn("[dsh-compact-chat-ui] settings card skipped:", error);
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.installClipboardShim = installClipboardShim; // exported for tests
		return module.exports;
	}
});
