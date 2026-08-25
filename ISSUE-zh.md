# [Bug] 桌面 App 内所有复制操作静默失败（代码块复制、消息复制、JSON 树复制）

> 提交地址：https://github.com/anywhere-labs/deepseek-harness-desktop/issues
> 标题可直接使用。注：上游 `dsh` CLI（deepseek-ai/deepseek-harness）不受影响——出问题的两层都在桌面壳仓库里。

## 环境

- **App**：DeepSeek Harness 桌面版（Electron）`0.1.0-rc.5`（Info.plist CFBundleShortVersionString）
- **CLI**：`@deepseek-ai/dsh@0.1.0-rc.6` 托管 `web` profile
- **系统**：macOS 26.5.2（arm64）
- 同一页面用普通浏览器打开（Chrome/Safari 访问同样的 `http://127.0.0.1:<port>`）：**复制正常**

## 现象

桌面 App 中，所有由界面发起的剪贴板写入都静默失败——没有错误提示、没有“已复制”反馈：

1. 助手消息里代码块右上角的复制按钮
2. 消息左下角的复制操作（复制消息 / 复制紧凑 JSON）
3. JSON 树视图的复制按钮（Copy value / Copy JSON / Copy path）

手动选中文本按 ⌘C 仍可复制（原生快捷键）；只有 App 内的复制按钮全部失效。

## 根因

两层问题叠加：

**1. 主进程拒绝了所有权限，包括剪贴板**

桌面版主进程装了一刀切的全部拒绝处理器（见 `app.asar`）：

```js
desktopSession.setPermissionCheckHandler(() => false);
desktopSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
  callback(false);
});
```

`navigator.clipboard.writeText()` 在 Chromium 里需要 `clipboard-sanitized-write` 权限，因此在桌面 App 内每次调用都以 `NotAllowedError` 拒绝。

**2. 前端复制助手在 API“被拒绝”时不走兜底**

共享复制函数（apps/web shell bundle 里的 `br()`）：

```js
async function br(n) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(n); return true; }
    catch { return false; }          // <-- 拒绝在这里被吞掉
  }
  // execCommand 兜底只在 API【不存在】时执行，
  // API 存在但被拒绝时不会走到这里
  ...document.execCommand("copy")...
}
```

Electron 里 `navigator.clipboard` 是**存在**的，所以 execCommand 兜底被跳过，被吞掉的拒绝最终变成一个 `false`——界面上什么也不显示。

## 复现步骤

1. 启动桌面 App，打开任意含代码块的会话
2. 点击代码块上的复制按钮 → 无任何内容进剪贴板、无反馈
3. 同一 URL 用普通浏览器打开 → 复制正常

## 修复建议（任改一处即可根治）

**方案 A（主进程）**——放行低风险的剪贴板权限：

```js
desktopSession.setPermissionRequestHandler((_webContents, permission, callback) => {
  callback(permission === "clipboard-sanitized-write");
});
```

`clipboard-sanitized-write` 只允许页面写入剪贴板（不可读），且必须由用户手势触发。

**方案 B（前端）**——被拒绝时也退回 execCommand，而不只在 API 缺失时：

```js
async function br(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  // 落到这里：同时覆盖“API 不存在”和“存在但被拒绝”两种情况
  const area = document.createElement("textarea");
  ...
  return document.execCommand("copy");
}
```

## 临时规避

社区插件可在页面加载时给 `navigator.clipboard.writeText` 打补丁：原生调用被拒时自动退回“隐藏 textarea + `execCommand("copy")`”——已在 0.1.0-rc.5 上验证可用。
