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

### 方式一：从插件库安装（推荐）

在设置页「插件」里把本插件的市场索引 URL 加进去，然后在 Discover 页安装：

```
https://raw.githubusercontent.com/aikunx/dsh-mt-mcp/main/market.json
```

依赖由 DSH 的包管理器负责安装，**不需要任何手动步骤**。

### 方式二：直接按 spec 安装

不配索引也可以，直接告诉 DSH 装这个包（`plugin_manager` 工具的 `install_bundle`）：

```
git+https://github.com/aikunx/dsh-mt-mcp.git#<commit-sha>
```

装完 **刷新一次 Web 页面**（新装的客户端插件需要重新加载），设置侧栏就会出现「MT 管理器」。

### 方式三：本地开发

```bash
git clone https://github.com/aikunx/dsh-mt-mcp.git
cd dsh-mt-mcp

# 本地 link 场景必须平铺装依赖，原因见下方「踩坑」
pnpm install --config.node-linker=hoisted
```

然后 `plugin_manager(action: "install_bundle", target: "<克隆目录绝对路径>")`。

> 方式三的 `pnpm install` 是**额外**步骤：以 `link:` 方式装进 profile 时，插件自己的 `node_modules` 会被直接使用，必须平铺。方式一、二由 pnpm 正规安装，会自动把依赖安置正确，无需此步（已实测验证）。
>
> 注意：`@deepseek-ai/*` 和 `react` 由 DSH 运行时提供，本插件的 `package.json` **不声明**它们。否则会出现模块双实例，插件的 React 和 DSH 的 React 不是同一个。

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

## 踩坑：为什么必须平铺安装依赖

这是本项目唯一一个非显然的点，也是排查了大半天的坑。

DSH 加载插件时**保留符号链接解析**（`--preserve-symlinks` 语义）。pnpm 默认用符号链接组织 `node_modules`：

```
node_modules/@modelcontextprotocol/sdk -> .pnpm/@modelcontextprotocol+sdk@1.32.1/node_modules/@modelcontextprotocol/sdk
```

保留符号链接后，Node 会按**符号链接真实路径**逐级向上找依赖，于是在 `.pnpm/@modelcontextprotocol+sdk@1.32.1/node_modules/` 里找不到 `zod`、`zod-to-json-schema` 等兄弟依赖，插件导入直接失败：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'zod'
  imported from .../node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js
```

**解法**：平铺安装，让依赖都落在插件自己的 `node_modules` 顶层。

```bash
pnpm install --config.node-linker=hoisted
```

`pnpm install` 默认不读 `.npmrc` 的 `node-linker`（实测 pnpm 11.28.5），所以必须**带上命令行参数**。`.npmrc` 里的同名设置只是意图记录。

## 结构

```
dsh-mt-mcp/
├── package.json          # 包与 DSH bundle 声明（dsh.bundle.patch / dsh.client）
├── cordis.patch.yml      # 往 profile 插入 mt-mcp 这一行
├── lib/
│   ├── index.js          # Host 半：连接、mcp__mt__* 注册、/api/dsh-mt-mcp/* 路由、两个辅助工具
│   └── client.js         # Client 半：设置页「MT 管理器」面板
├── .npmrc                # 记录 node-linker=hoisted 的意图
└── README.md
```

Host 半用 `@modelcontextprotocol/sdk` 的 `Client` + `StreamableHTTPClientTransport` 连接；`tools/list` 的结果逐个注册到 DSH 的 `ctx.tools`，工具名加 `mcp__mt__` 前缀（超长或有非法字符时加哈希后缀保证唯一）。MT 通过 `notifications/tools/list_changed` 通知工具变化时会自动重新同步。

## 已知限制

- **只支持 Streamable HTTP**。MT 的 MCP 服务是 HTTP 型，插件没做 stdio 分支。
- 工具描述与参数 schema **原样来自 MT**，本插件不做校验增强。
- 图片/音频类 MCP 内容块只保留类型说明，**内容不落地**。
- 单次工具调用超时 **180 秒**（MT 重打包 APK 可能较慢，留了余量）。
- 需要 DSH 侧有 `tools` / `systemPrompt` / `webServer` 三个服务；`@deepseek-ai/dsh-mcp-client` 的 MCP 客户端能力不在依赖里，是本插件自己实现的连接逻辑。

## 许可

MIT
