# dsh-compact-chat-ui

DSH web 插件：为聊天内容区提供**排版设置卡片**（设置 → 插件 → 可配置），
可实时调整字号、行高、块间距；输入框与界面其他部分保持原生大小。

## 原理

聊天正文排版硬编码在两处且无设置项：

1. **助手 markdown** 由 shell 设计令牌控制（`body` 上 `--dsw-font-markdown-base: 16px/28px`，
   以 `font: var(...)` 显式消费，不吃继承）；
2. **用户气泡** 直接在 CSS module 里写 `font-size:16px`，类名哈希每次构建都变。

插件在浏览器端运行时发现真实选择器/令牌并生成覆盖样式（改构建哈希不影响）：
- 令牌：读取 computed style，按比例改写后带 `!important` 原位覆盖
- 规则：只扫白名单模块（`MessageItem` / `AssistantMarkdown`，不含 `InputBar`）
- 块间距：缩放 `_markdown_` 系规则的 margin 与消息体 flex gap，重置 `li::marker` 的 28px 钉死行高

## 安装

```sh
npm pack                                # 生成 dsh-compact-chat-ui-0.5.0.tgz
dsh plugin --profile web add ./dsh-compact-chat-ui-0.5.0.tgz
```

安装后**重启一次应用**（宿主在启动时装载插件清单），刷新页面生效。

## 使用

设置 → 插件 → **可配置** tab → “聊天区排版”卡片：

| 滑杆 | 范围 | 默认 | 原始值 |
|---|---|---|---|
| 字号 | 11–18px | 15px | 16px |
| 行高 | 1.20–2.00 | 1.50 | ~1.75 |
| 块间距 | 25%–150% | 50% | 100% |

改动即时生效并自动保存（localStorage），也可用控制台：

```js
localStorage.setItem("dsh-compact-chat-ui:px", "14");  // 字号
localStorage.setItem("dsh-compact-chat-ui:lh", "1.4"); // 行高
localStorage.setItem("dsh-compact-chat-ui:mg", "0.5"); // 块间距
location.reload();
```

## 卸载

```sh
dsh plugin --profile web remove dsh-compact-chat-ui
```
