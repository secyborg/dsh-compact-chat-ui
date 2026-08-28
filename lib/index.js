// dsh-compact-chat-ui — host half.
//
// The feature itself lives in the client bundle (lib/client.js). What the
// host half contributes is a SETTINGS NAMESPACE: DSH Desktop 2.0.2's
// Plugins settings tab only dispatches cards whose slot `key` matches a
// namespace the Host serves (the settings document's view.namespaces).
// Registering "dsh-compact-chat-ui" here puts this plugin on that served
// list, which is what makes the client card appear under 设置 → 插件.
//
// The knobs themselves live in client-side localStorage, so the namespace
// VALUE is unused — but the settings service touches three schema
// surfaces, and ALL must exist or the whole settings describe pipeline
// breaks for every plugin at once:
//
//   1. callable          — resolve: `schema(mergeLayers(base, section))`
//   2. schema.toJSON()   — describe(): serialized into the descriptor the
//                          client mirror reads; a plain function has none
//                          and describe() throws for EVERYONE (v0.8.1 bug:
//                          all plugins' settings cards vanished silently)
//   3. .type / .dict     — redactSecrets' walk() on wire surfaces
//
// Hence a hand-rolled empty-object schema with exactly those surfaces —
// the package stays dependency-free (a real schemastery dep broke the
// plugin tree on a missing `z` named export in v0.8.0).

export const name = "dsh-compact-chat-ui";
export const inject = ["settings"];

const SETTINGS_NS = "dsh-compact-chat-ui";

const emptyObjectSchema = Object.assign(
	function schema() { return {}; },
	{
		type: "object",
		dict: {},
		meta: {},
		toJSON() { return { type: "object", dict: {} }; }
	}
);

export function apply(ctx) {
	ctx.settings.register(SETTINGS_NS, emptyObjectSchema, { base: {} });
}
