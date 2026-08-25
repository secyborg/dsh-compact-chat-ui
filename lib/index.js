// dsh-compact-chat-ui — host half.
//
// Deliberately a no-op: the entire feature lives in the client bundle
// (lib/client.js), which rescales the conversation plugin's typography and
// contributes a settings card. This file exists only so the cordis loader
// has a valid plugin to mount when the bundle patch inserts the row.

export const name = "dsh-compact-chat-ui";
export const inject = [];

export function apply() {
  // nothing to do on the host side
}
