// dsh-compact-chat-ui — host half.
//
// The feature itself lives in the client bundle (lib/client.js). What the
// host half contributes is a SETTINGS NAMESPACE: DSH Desktop 2.0.2's
// Plugins settings tab only dispatches cards whose slot `key` matches a
// namespace the Host serves (the settings document's view.namespaces).
// Registering "dsh-compact-chat-ui" here puts this plugin on that served
// list, which is what makes the client card appear under 设置 → 插件.
//
// The settings service's resolver only CALLS the schema
// (`resolve = schema(mergedLayers)`) to derive the namespace value — and
// this plugin's knobs live in client-side localStorage, so the value is
// unused. A constant empty-object callable is the whole schema, keeping
// this package dependency-free (a real schemastery dep once broke the
// plugin tree on a missing `z` named export — see v0.8.0 → v0.8.1).

export const name = "dsh-compact-chat-ui";
export const inject = ["settings"];

const SETTINGS_NS = "dsh-compact-chat-ui";
const emptyObjectSchema = () => ({});

export function apply(ctx) {
  ctx.settings.register(SETTINGS_NS, emptyObjectSchema, { base: {} });
}
