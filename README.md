# dsh-mt-mcp

把手机上的 **MT 管理器**（[mt.cc](https://mt.cc)）接进 **DeepSeek Harness（DSH）**。

MT 管理器自带 MCP 服务：在手机上点一下启动，它就把自己变成一个 **Streamable HTTP** 的 MCP 服务器，对外提供手机文件、APK、ZIP 三类能力。本插件是**电脑这一侧的客户端** —— 一个 DSH 插件包，把 MT 的工具接进 DSH 会话，并在 DSH 的 Web 设置页提供一个可随时修改地址的面板。

连上之后，MT 的能力以 `mcp__mt__*` 工具出现在会话里，直接用自然语言让 AI 操作手机：

```
请用 MT 读取 Home 里的 test.txt，概括内容，先不要修改。
请分析当前 APK 的启动流程，说明相关类和方法。
请把 Home 中 project 文件夹打包为 project.zip，放在压缩包根目录。
```

## 为什么需要它

DSH 自带的 MCP 客户端（`@deepseek-ai/dsh-mcp-client`）走组合配置，改一次连接地址要改 profile 的 patch 文件并重启 Host。而手机的局域网 IP 是**会变**的 —— DHCP 换租约、换 Wi-Fi、开热点，地址就变了。

本插件把「连哪里」从配置文件搬到了 Web 设置页：地址填在输入框里，保存即重连，不用重启、不用改 YAML。

## 安装

前提：DSH 已装好并且能用（`dsh web` 能打开界面）。

本插件**没有任何运行时第三方依赖**：MCP 协议用自带的 `lib/mcp-http.js` 实现（Node 内置 `fetch`），只依赖 DSH 本身提供的 `@deepseek-ai/dsh-tools`。所以无论用哪种方式安装都不会出现依赖解析问题，也不需要 `pnpm install`。

### 方式一：从插件库安装（推荐）

在设置页「插件」里把本插件的市场索引 URL 加进去，然后在 Discover 页安装：

```
https://raw.githubusercontent.com/aikunx/dsh-mt-mcp/main/market.json
```

### 方式二：直接按 spec 安装

不配索引也可以，直接让 DSH 装这个包（`plugin_manager` 工具的 `install_bundle`，`target` 填下面任一形式）：

```
https://github.com/aikunx/dsh-mt-mcp#<commit-sha>
```

或者用仓库的 tarball 地址：

```
https://codeload.github.com/aikunx/dsh-mt-mcp/tar.gz/refs/heads/main
```

装完 **刷新一次 Web 页面**（新装的客户端插件需要重新加载），设置侧栏就会出现「MT 管理器」。

### 方式三：本地开发

```bash
git clone https://github.com/aikunx/dsh-mt-mcp.git
cd dsh-mt-mcp
```

无需安装依赖，直接 `plugin_manager(action: "install_bundle", target: "<克隆目录绝对路径>")`。

> 安装后如果插件行报 `ERR_MODULE_NOT_FOUND` 且路径指向你**之前**的安装位置，那是 Host 进程缓存了旧的模块解析结果 —— 重启 DSH 即可。

## 使用

1. 手机打开 MT 管理器 → **侧拉栏 → 工具 → MCP 服务 → 启动**。
2. 复制 MT 显示的地址。DSH 跑在电脑上，所以要用**局域网地址**，形如 `http://192.168.5.20:8787/mcp`。
   - 末尾的 `/mcp` 不能少，端口默认 `8787`。
   - **不要用 `127.0.0.1`** —— 那指向电脑自己，不是手机。
3. 电脑 DSH 的 **设置 → MT 管理器**，粘贴地址 →「保存并连接」。
4. 状态行变绿即已连接，下方会列出发现的工具（实测 MT 2.26.x 提供 **57 个**）。

### 地址会变，随时改

面板里直接改地址再保存即可，**不需要重启 DSH**。改完立刻重连，并把旧连接和已注册的工具一起换掉。

推荐给手机在路由器上设**静态 IP / DHCP 保留**，省得每次都要改。

### Bearer 令牌（可选）

MT 默认**不开认证**，任何能连到该端口的人都能调用。在 MT 的 **设置 → 认证** 启用 Bearer 令牌认证后，把令牌填进面板的令牌框：

- 令牌是 MT 创建的，和模型的 API 密钥无关。
- 输入框留空＝保持不变；点「清除令牌」才会清掉。
- 回显时只显示 `abcd****wxyz`，完整令牌不会出现在任何输出里。
- 认证**不加密** HTTP 连接。只在可信局域网里用，**不要把 8787 端口暴露到公网**。

## 它能做什么

工具由 MT 提供，本插件只负责转发。按名称分三类：

| 前缀 | 用途 |
| --- | --- |
| `mcp__mt__mt_file_*` | 手机文件：列目录、按名称/内容/大小/时间搜索、读写文本与字节、移动删除、创建目录 |
| `mcp__mt__mt_apk_*` | APK：打开工作区、分析 Manifest/资源/Smali/so、编辑、重打包签名、工作区管理 |
| `mcp__mt__mt_zip_*` | ZIP：浏览、读条目、完整性检查、创建、增删改条目、提取 |

外加两个本插件的辅助工具：

| 工具 | 作用 |
| --- | --- |
| `mt_mcp_status` | 看地址、连接状态、工具数量、最近错误（不回显令牌） |
| `mt_mcp_connect` | 按已保存的地址重新连接 |

### 访问范围由手机决定

能操作哪些文件，**完全由 MT 里的文件访问权限规则决定**，本插件不提供任何绕过。实测默认策略是「Home 文件夹可读写，其余一律禁止」：

- Home 默认在 `/storage/emulated/0/MT2/mcp`（可在 MT 的 **设置 → 通用** 改）。
- 要读 Home 之外的文件，得先在 MT 的 **设置 → 文件** 给那个目录加规则。
- Home 里的文件**无法**收紧成只读；需要只读保护的文件放到 Home 外面再单独授权。

这些规则只有你自己能在手机上改。

## 断线与重连

- 连接断开后按 **1s → 2s → 4s … 30s** 退避自动重连，最多 10 次；到顶后在面板点「重新连接」。
- MT 切到后台可能被系统杀掉。在 MT 的 **设置 → 通用** 开启**悬浮球**并授予悬浮窗权限，能显著提高存活率。
- MT 服务重启、手机 IP 变了，都会断。改地址保存或点「重新连接」即可。
- 手机与电脑要在**同一个局域网**。访客 Wi-Fi、AP 隔离、VPN 都可能导致连不上。

## 安全边界

| 项 | 说明 |
| --- | --- |
| 配置存储 | `~/.dsh/dsh-mt-mcp.json`，权限 `0600` |
| 设置路由 | `/api/dsh-mt-mcp/*` **只接受 loopback 请求**（校验来源 IP、Host 头、Origin），局域网内其他人改不了你的配置 |
| 令牌回显 | 一律掩码，完整令牌只存在于上述配置文件里 |
| 传输加密 | **无**。MT 的 MCP 服务是明文 HTTP，仅限可信局域网 |
| 数据去向 | 手机执行操作并把结果返回给 AI 工具，AI 工具可能再把它发给模型服务。只开放你愿意交给它们处理的文件 |

## 踩坑：为什么这个插件没有任何运行时依赖

排查了大半天的坑，值得写下来。

最初的实现直接 `import '@modelcontextprotocol/sdk'`。本地 `link:` 安装时立刻炸：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'zod'
  imported from .../node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js
```

原因是 **DSH 加载插件时保留符号链接解析**（`--preserve-symlinks` 语义），而 pnpm 把包依赖放进 `.pnpm` 虚拟店：

```
node_modules/dsh-mt-mcp -> .pnpm/dsh-mt-mcp@.../node_modules/dsh-mt-mcp
                         ^ 该目录的兄弟位置才有 @modelcontextprotocol/sdk
```

按符号链接真实路径向上找依赖时，SDK 的传递依赖（`zod`、`zod-to-json-schema` 等）不在上一层，于是解析失败。用 `--config.node-linker=hoisted` 平铺能缓解本地 link 场景，但**换成 tarball / git / 插件库安装时布局又不同**，用户装完照样可能失败。

**最终解法：把依赖降到零。** MCP 的 Streamable HTTP 只是「POST JSON-RPC + SSE 响应」，用 Node 内置 `fetch` 一百多行就够，于是有了 `lib/mcp-http.js`。插件现在只 import DSH 自己提供的 `@deepseek-ai/dsh-tools` 和 Node 内置模块，任何安装方式都能直接加载，不需要 `pnpm install`。

代价是实现了协议的一小块（initialize / tools/list / tools/call / 通知 + 会话头），不支持 stdio、resources、prompts、sampling。对「连 MT」这个目标够了。

## 结构

```
dsh-mt-mcp/
├── package.json          # 包与 DSH bundle 声明（dsh.bundle.patch / dsh.client）
├── cordis.patch.yml      # 往 profile 插入 mt-mcp 这一行
├── market.json           # 插件库索引（format 1）
├── icon.svg
├── lib/
│   ├── index.js          # Host 半：连接、mcp__mt__* 注册、/api/dsh-mt-mcp/* 路由、两个辅助工具
│   ├── mcp-http.js       # 零依赖 MCP Streamable HTTP 客户端
│   └── client.js         # Client 半：设置页「MT 管理器」面板
└── README.md
```

`lib/mcp-http.js` 负责 JSON-RPC over HTTP：记住 `Mcp-Session-Id`、协商协议版本、解析 `application/json` 与 `text/event-stream` 两种响应、识别 `notifications/tools/list_changed`。`lib/index.js` 把 `tools/list` 的结果逐个注册到 `ctx.tools`，工具名加 `mcp__mt__` 前缀（超长或有非法字符时加哈希后缀保证唯一）。

## 已知限制

- **只支持 Streamable HTTP**。MT 的 MCP 服务是 HTTP 型，插件没做 stdio 分支。
- `lib/mcp-http.js` 只实现了 initialize / tools/list / tools/call 与工具变更通知；MT 不提供的 resources、prompts、sampling 未实现。
- 工具描述与参数 schema **原样来自 MT**，本插件不做校验增强。
- 图片/音频类 MCP 内容块只保留类型说明，**内容不落地**。
- 单次工具调用超时 **180 秒**（MT 重打包 APK 可能较慢，留了余量）。
- 需要 DSH 侧有 `tools` / `systemPrompt` / `webServer` 三个服务。

## 许可

MIT
