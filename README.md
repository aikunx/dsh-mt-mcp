# dsh-mt-mcp

**English** · [简体中文](README.zh.md)

Connect **MT Manager** ([mt.cc](https://mt.cc)) on your Android phone to **DeepSeek Harness (DSH)**.

MT Manager ships an MCP server: start it on the phone and it becomes a **Streamable HTTP** MCP endpoint exposing phone files, APK, and ZIP capabilities. This plugin is the **desktop-side client** — a DSH plugin bundle that brings MT's tools into DSH sessions and adds a settings panel where the address can be changed at any time.

Once connected, MT's capabilities appear as `mcp__mt__*` tools, so you can just ask in plain language:

```
Read test.txt in MT's Home folder and summarize it. Don't modify anything yet.
Analyze the startup flow of the current APK and explain the relevant classes and methods.
Pack the project folder in Home into project.zip at the archive root.
```

## Why this exists

DSH's built-in MCP client (`@deepseek-ai/dsh-mcp-client`) is configured through the composition: changing the endpoint means editing a profile patch file and restarting the Host. But a phone's LAN IP **changes** — DHCP lease renewal, a different Wi-Fi, a hotspot.

This plugin moves "where to connect" out of configuration files and into the Web settings page: type the address, save, and it reconnects. No restart, no YAML.

## Install

Requires a working DSH (`dsh web` opens the UI).

**Compatible with DSH `0.2.0-rc.2` and later** (`0.2.x`). The plugin has **no runtime third-party dependencies**: the MCP protocol is implemented in `lib/mcp-http.js` using Node's built-in `fetch`, and the only import is DSH's own `@deepseek-ai/dsh-tools`. Any install method works, and `pnpm install` is never needed.

### One-line install (recommended)

```bash
dsh plugin --profile web add github:aikunx/dsh-mt-mcp
```

Then **refresh the Web page once** — a newly installed client plugin has to be reloaded. "MT Manager" then appears in the settings sidebar.

> Using a different profile? Replace `web`. The Electron-managed `desktop` profile is handled by the app itself and does not go through this command.
>
> `dsh plugin` forwards its arguments to pnpm verbatim, so any pnpm-supported spec works. To pin a commit:
> `dsh plugin --profile web add github:aikunx/dsh-mt-mcp#<commit-sha>`

### Install from the plugin market

Add this index URL to the Plugins settings page, then install from the Discover tab:

```
https://raw.githubusercontent.com/aikunx/dsh-mt-mcp/main/market.json
```

### Local development

```bash
git clone https://github.com/aikunx/dsh-mt-mcp.git
cd dsh-mt-mcp
dsh plugin --profile web add .
```

No dependency install needed. Alternatively, have the Agent driving your session call `plugin_manager(action: "install_bundle", target: "<absolute clone path>")`.

> If the plugin row reports `ERR_MODULE_NOT_FOUND` with a path pointing at a **previous** install location, the Host process cached the old module resolution — restart DSH.

## The panel

![The "MT Manager" panel in DSH settings](docs/settings-panel.png)

Settings → MT Manager: enter the address and an optional token, then save to connect. The panel lists discovered tools and shows the config file path.

> The image is drawn from the panel source's layout and sizing, to convey the information structure. Actual appearance follows your DSH theme (light/dark).

## Usage

1. On the phone: MT Manager → **sidebar → Tools → MCP Service → Start**.
2. Copy the address MT shows. DSH runs on your computer, so use the **LAN address**, e.g. `http://192.168.5.20:8787/mcp`.
   - The trailing `/mcp` is required; the default port is `8787`.
   - **Do not use `127.0.0.1`** — that points at the computer itself, not the phone.
3. In DSH: **Settings → MT Manager**, paste the address, then "Save and connect".
4. A green status line means connected, and the panel lists the discovered tools (measured: MT 2.26.x exposes **57**).

### The address changes; edit it any time

Edit the address in the panel and save — **no DSH restart needed**. It reconnects immediately and replaces both the old connection and the registered tools.

Set a **static IP / DHCP reservation** for the phone on your router to avoid editing it at all.

### Bearer token (optional)

MT has authentication **off** by default: anyone who can reach the port can call it. Enable Bearer token auth under MT's **Settings → Authentication**, then paste the token into the panel's token field:

- The token is created by MT; it is unrelated to any model API key.
- Leaving the field empty keeps the current token; only "Clear token" removes it.
- It is echoed only as `abcd****wxyz` — the full token never appears in any output.
- Authentication does **not** encrypt HTTP. Use it on a trusted LAN only, and **never expose port 8787 to the internet**.

## What it can do

The tools come from MT; this plugin only forwards them. Three groups by name:

| Prefix | Purpose |
| --- | --- |
| `mcp__mt__mt_file_*` | Phone files: list directories, search by name/content/size/time, read and write text and bytes, move and delete, create directories |
| `mcp__mt__mt_apk_*` | APK: open a workspace, analyze manifest/resources/smali/so, edit, rebuild and sign, manage workspaces |
| `mcp__mt__mt_zip_*` | ZIP: browse, read entries, verify integrity, create, add/replace/delete entries, extract |

Plus two helper tools from this plugin:

| Tool | Purpose |
| --- | --- |
| `mt_mcp_status` | Show address, connection state, tool count, last error (never echoes the token) |
| `mt_mcp_connect` | Reconnect using the saved address |

### The phone decides the access scope

Which files are reachable is **entirely decided by MT's file access rules**; this plugin offers no bypass. The measured default is "the Home folder is read-write, everything else is denied":

- Home defaults to `/storage/emulated/0/MT2/mcp` (changeable in MT's **Settings → General**).
- To read outside Home, add a rule for that directory in MT's **Settings → Files**.
- Files inside Home **cannot** be tightened to read-only; put files needing read-only protection outside Home and grant them individually.

Only you can change these rules, on the phone.

## Disconnects and reconnects

- On disconnect it retries with **1s → 2s → 4s … 30s** backoff, up to 10 attempts. After that, press "Reconnect" in the panel.
- Android may kill MT in the background. Enable **floating ball** in MT's **Settings → General** and grant the overlay permission; this markedly improves survival.
- Restarting MT's service or the phone changing IP will drop the connection. Edit the address and save, or press "Reconnect".
- Phone and computer must be on the **same LAN**. Guest Wi-Fi, AP isolation, and VPNs can all prevent connection.

## Security boundary

| Item | Detail |
| --- | --- |
| Config storage | `~/.dsh/dsh-mt-mcp.json`, mode `0600` |
| Settings routes | `/api/dsh-mt-mcp/*` accepts **loopback requests only** (verified via source IP, Host header, Origin), so nobody else on the LAN can change your config |
| Token echo | Always masked; the full token exists only in the config file above |
| Transport encryption | **None**. MT's MCP service is plain HTTP; trusted LAN only |
| Where data goes | The phone performs the operation and returns results to the AI tool, which may forward them to a model service. Only expose files you are willing to hand to them |

## Gotcha: why this plugin has zero runtime dependencies

Worth recording; it cost most of a day.

The first implementation imported `@modelcontextprotocol/sdk` directly. A local `link:` install blew up immediately:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'zod'
  imported from .../node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js
```

The cause: **DSH loads plugins with symlink resolution preserved** (`--preserve-symlinks` semantics), while pnpm puts a package's dependencies inside its `.pnpm` virtual store:

```
node_modules/dsh-mt-mcp -> .pnpm/dsh-mt-mcp@.../node_modules/dsh-mt-mcp
                         ^ only this sibling directory has @modelcontextprotocol/sdk
```

Resolving upward from the symlink's real path, the SDK's transitive dependencies (`zod`, `zod-to-json-schema`, …) are not one level up, so resolution fails. Flattening with `--config.node-linker=hoisted` fixes the local-link case, but **tarball / git / market installs each produce a different layout**, so users could still fail after installing.

**The fix: reduce dependencies to zero.** MCP's Streamable HTTP is just POSTed JSON-RPC plus SSE responses — about a hundred lines on Node's built-in `fetch`, which became `lib/mcp-http.js`. The plugin now imports only DSH's own `@deepseek-ai/dsh-tools` and Node built-ins, so every install method loads directly with no `pnpm install`.

The cost is implementing a slice of the protocol (initialize / tools/list / tools/call / notifications + session header) and not supporting stdio, resources, prompts, or sampling. For "connect to MT", that is enough.

## Layout

```
dsh-mt-mcp/
├── package.json          # package + DSH bundle declaration (dsh.bundle.patch / dsh.client)
├── cordis.patch.yml      # inserts the mt-mcp row into the profile
├── market.json           # plugin market index (format 1)
├── icon.svg
├── lib/
│   ├── index.js          # Host half: connection, mcp__mt__* registration, /api/dsh-mt-mcp/* routes, helpers
│   ├── mcp-http.js       # dependency-free MCP Streamable HTTP client
│   └── client.js         # Client half: the "MT Manager" settings panel
├── docs/
│   └── settings-panel.png
└── README.md / README.zh.md
```

`lib/mcp-http.js` handles JSON-RPC over HTTP: it remembers `Mcp-Session-Id`, negotiates the protocol version, parses both `application/json` and `text/event-stream` responses, and recognizes `notifications/tools/list_changed`. `lib/index.js` registers each `tools/list` result on `ctx.tools` under an `mcp__mt__` prefix (adding a hash suffix when a name is too long or contains invalid characters).

## Security review notes

If you are reviewing this plugin before installing, these are the only places it touches the outside world. Everything else is bookkeeping.

**Outbound network** — there is exactly one destination: the MCP endpoint the user typed into the settings panel (`lib/mcp-http.js`). No telemetry, no analytics, no fixed third-party host, no update pings. The only URL literals in `lib/` are `https://mt.cc` in a comment and `http://192.168.1.23:8787/mcp` as an input placeholder.

**Filesystem** — the only write is the plugin's own config, `~/.dsh/dsh-mt-mcp.json`, created with mode `0600` (`lib/index.js`). No other path is written, and nothing is deleted.

**Credentials** — the optional MT bearer token is read from the panel, stored only in that config file, and sent only as an `Authorization` header to the user's configured endpoint. It is never logged and echoed only masked (`abcd****wxyz`). No `process.env` reads.

**No dynamic code** — no `eval`, `new Function`, `vm`, `child_process`, or shell invocation anywhere. No crypto-mining or download-and-execute patterns.

**Local routes** — `/api/dsh-mt-mcp/*` refuses any request that is not loopback (source IP, `Host`, and `Origin` are all checked), so nothing on the LAN can read or rewrite the configuration.

**Third-party code** — none at runtime. `package.json` declares no `dependencies`; the MCP client is the plugin's own `lib/mcp-http.js`.

## Known limitations

- **Streamable HTTP only.** MT's MCP service is HTTP-based; there is no stdio branch.
- `lib/mcp-http.js` implements only initialize / tools/list / tools/call and tool-change notifications; resources, prompts, and sampling are not implemented (MT does not offer them).
- Tool descriptions and parameter schemas come **verbatim from MT**; this plugin adds no validation.
- Image/audio MCP content blocks keep only a type marker; **their payloads are not retained**.
- A single tool call times out after **180 seconds** (APK rebuilds can be slow, so there is headroom).
- DSH must provide the `tools`, `systemPrompt`, and `webServer` services.

## License

MIT
