# [Bug] All copy actions in the desktop app fail silently (code-block copy, message copy, JSON-tree copy)

> File at: https://github.com/anywhere-labs/deepseek-harness-desktop/issues
> Title can be used as-is. Note: the upstream `dsh` CLI (deepseek-ai/deepseek-harness) is NOT affected — both faulty layers live in the desktop shell repo.

## Environment

- **App**: DeepSeek Harness desktop (Electron), `0.1.0-rc.5` (Info.plist CFBundleShortVersionString)
- **CLI**: `@deepseek-ai/dsh@0.1.0-rc.6` hosting the `web` profile
- **OS**: macOS 26.5.2 (arm64)
- Same page opened in a normal browser (Chrome/Safari against the same `http://127.0.0.1:<port>`): **copy works**

## Symptom

In the desktop app, every clipboard write initiated from the UI fails silently — no error toast, no "copied" feedback:

1. The copy button at the top-right of code blocks in assistant messages
2. The copy action at the bottom-left of messages (copy message / copy compact JSON)
3. The copy button in JSON tree views (Copy value / Copy JSON / Copy path)

Selecting text and pressing ⌘C still works (native keybinding); only the in-app copy buttons are broken.

## Root cause

Two layers combine into this bug:

**1. Main process denies every permission, including clipboard**

The desktop main process installs a blanket deny-all handler (found in `app.asar`):

```js
desktopSession.setPermissionCheckHandler(() => false);
desktopSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
  callback(false);
});
```

`navigator.clipboard.writeText()` requires the `clipboard-sanitized-write` permission in Chromium, so every call rejects with `NotAllowedError` inside the desktop app.

**2. The frontend copy helper never falls back when the API is *denied***

The shared copy helper (apps/web shell bundle, `br()` in `index-*.js`) is:

```js
async function br(n) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(n); return true; }
    catch { return false; }          // <-- denial swallowed here
  }
  // execCommand fallback only runs when the API is MISSING,
  // not when it exists but was denied
  ...document.execCommand("copy")...
}
```

Because `navigator.clipboard` *exists* in Electron, the execCommand fallback is skipped and the swallowed rejection surfaces as a plain `false` — the UI shows nothing.

## Repro

1. Launch the desktop app, open any conversation containing a code block
2. Click the copy button on the code block → nothing is copied, no feedback
3. Open the same URL in a normal browser → copy works

## Suggested fix (either one suffices)

**Option A (main process)** — allow the low-risk clipboard permission:

```js
desktopSession.setPermissionRequestHandler((_webContents, permission, callback) => {
  callback(permission === "clipboard-sanitized-write");
});
```

`clipboard-sanitized-write` only lets the page write to the clipboard (no read), and only in response to a user gesture.

**Option B (frontend)** — fall back to execCommand on rejection, not only on absence:

```js
async function br(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  // fall through: also covers "exists but denied"
  const area = document.createElement("textarea");
  ...
  return document.execCommand("copy");
}
```

## Workaround

A community plugin can patch `navigator.clipboard.writeText` at page load to fall back to a hidden-textarea `execCommand("copy")` when the native call rejects — verified working on 0.1.0-rc.5.
