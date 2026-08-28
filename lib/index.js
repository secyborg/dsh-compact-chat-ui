// dsh-compact-chat-ui — host half.
//
// The feature itself lives in the client bundle (lib/client.js). What the
// host half contributes is a SETTINGS NAMESPACE: DSH Desktop 2.0.2's
// Plugins settings tab only dispatches cards whose slot `key` matches a
// namespace the Host serves (the settings document's view.namespaces).
// Registering "dsh-compact-chat-ui" here puts this plugin on that served
// list, which is what makes the client card appear under 设置 → 插件.
//
// The namespace's VALUE is unused — the card's knobs live in localStorage
// on the client — so the schema is an empty object; the registration exists
// purely to claim the namespace.

import { z } from "@deepseek-ai/schemastery";

export const name = "dsh-compact-chat-ui";
export const inject = ["settings"];

const SETTINGS_NS = "dsh-compact-chat-ui";

export function apply(ctx) {
  ctx.settings.register(SETTINGS_NS, z.object({}), { base: {} });
}
