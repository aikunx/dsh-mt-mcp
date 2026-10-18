/**
 * dsh-mt-mcp — MT 管理器（手机端）MCP 连接。Host 半。
 *
 * MT 管理器（https://mt.cc）自带 MCP 服务：在手机上「侧拉栏 → 工具 → MCP 服务」
 * 启动后，它把自己当作 Streamable HTTP 的 MCP 服务器，暴露 mt_file_* / mt_apk_* /
 * mt_zip_* 工具。本插件是这一侧（电脑上的 DSH）的客户端：
 *
 *   - 连接地址和 Bearer 令牌存在 ~/.dsh/dsh-mt-mcp.json（权限 0600），
 *     由 Web 设置页「MT 管理器」面板随时改写，改完立即重连。
 *   - 连上后把 MT 的工具注册为 mcp__mt__<toolName>，并提供 mt_mcp_status /
 *     mt_mcp_connect 两个辅助工具。
 *   - /api/dsh-mt-mcp/* 路由只接受 loopback 请求，配置不会被局域网内的其他人改。
 *
 * 零运行时第三方依赖：MCP 协议用 lib/mcp-http.js 的最小实现，因此无论用
 * 哪种方式安装（插件库 / git / tgz / link），都能直接加载，不会出现依赖
 * 解析失败。只依赖 DSH 自带的 @deepseek-ai/dsh-tools。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { McpHttpClient } from './mcp-http.js';

/** Stable cordis plugin name. */
export const name = 'mt-mcp';

/** Services required before the surfaces can mount. */
export const inject = ['tools', 'systemPrompt', 'webServer'];

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 162;

/** Config location (mode 0600). */
const CONFIG_FILE = path.join(homedir(), '.dsh', 'dsh-mt-mcp.json');

/** Mask a token for display, keeping only head and tail. */
function mask(value) {
  if (!value) return '';
  if (value.length <= 8) return value.slice(0, 2) + '****';
  return value.slice(0, 4) + '****' + value.slice(-4);
}

/** Empty config record. */
function emptyConfig() {
  return { url: '', token: '' };
}

/** Parse an unknown JSON record into a config (tolerates missing keys). */
function parseConfig(raw) {
  const record = typeof raw === 'object' && raw !== null ? raw : {};
  const str = (value) => (typeof value === 'string' ? value : '');
  return { url: str(record.url).trim(), token: str(record.token).trim() };
}

/**
 * Small config store backed by ~/.dsh/dsh-mt-mcp.json.
 * Reads are lazy and cached; writes use mode 0600.
 */
class MtStore {
  config = null;

  async load() {
    if (this.config !== null) return this.config;
    try {
      const raw = await readFile(CONFIG_FILE, 'utf8');
      this.config = parseConfig(JSON.parse(raw));
    } catch {
      this.config = emptyConfig();
    }
    return this.config;
  }

  async save(next) {
    this.config = next;
    await mkdir(path.dirname(CONFIG_FILE), { recursive: true });
    await writeFile(CONFIG_FILE, JSON.stringify(next, null, 2), { mode: 384 });
  }

  /** Public, token-free view. */
  async view() {
    const cfg = await this.load();
    return {
      url: cfg.url,
      tokenConfigured: cfg.token !== '',
      tokenMasked: mask(cfg.token),
      configPath: CONFIG_FILE,
    };
  }
}

/** The route family the settings panel talks to. */
const MT_MCP_API = {
  status: '/api/dsh-mt-mcp/status',
  save: '/api/dsh-mt-mcp/save',
  connect: '/api/dsh-mt-mcp/connect',
};

/** Cap on JSON request bodies. */
const MAX_JSON_BODY_BYTES = 64 * 1024;

/** Per-tool-call timeout (ms). MT 打包 APK 可能很慢，给足余量。 */
const TOOL_CALL_TIMEOUT_MS = 180_000;

/** Reconnect backoff bounds. */
const RECONNECT = { initialDelayMs: 1000, maxDelayMs: 30_000, maxAttempts: 10 };

/** Invalid characters in a model-facing tool name. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g;

/** Max length of a model-facing tool name. */
const MAX_PUBLIC_NAME_LENGTH = 64;

/** Derive the model-facing public name (mcp__mt__<rawName>). */
function publicToolName(rawName) {
  const joined = `mcp__mt__${rawName}`;
  const normalized = joined.replace(INVALID_NAME_CHARS, '_');
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized;
  const hash = createHash('sha256').update(`mt\0${rawName}`).digest('hex').slice(0, 12);
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - 12 - 1)}_${hash}`;
}

/** One text content block. */
function text(value) {
  return [{ type: 'text', text: value }];
}

/** Extract readable text from an MCP content array. */
function extractText(mcpContent, toolName) {
  if (!Array.isArray(mcpContent)) return `(${toolName} returned non-content output)`;
  const parts = [];
  for (const value of mcpContent) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      parts.push('[unsupported content type: unknown]');
      continue;
    }
    switch (value.type) {
      case 'text':
        if (typeof value.text === 'string') parts.push(value.text);
        break;
      case 'image':
        parts.push(`[image: ${typeof value.mimeType === 'string' ? value.mimeType : 'unknown'}, content discarded]`);
        break;
      case 'audio':
        parts.push(`[audio: ${typeof value.mimeType === 'string' ? value.mimeType : 'unknown'}, content discarded]`);
        break;
      case 'resource':
        parts.push(`[resource: ${typeof value.uri === 'string' ? value.uri : 'unknown'}]`);
        break;
      case 'resource_link':
        parts.push(`[resource link: ${typeof value.uri === 'string' ? value.uri : 'unknown'}]`);
        break;
      default:
        parts.push(`[unsupported content type: ${String(value.type)}]`);
    }
  }
  return parts.join('\n') || `(${toolName} returned no text content)`;
}

/** Human-readable error text. */
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Validate an MT endpoint; returns an error message or ''. */
function validateUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return '地址不是合法 URL';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return '地址必须以 http:// 或 https:// 开头';
  }
  if (!parsed.pathname.endsWith('/mcp')) {
    return '地址末尾需要带 /mcp（填 MT 里复制的完整地址）';
  }
  return '';
}

/** Build one model-facing tool definition for a remote MT tool. */
function makeToolDefinition(client, tool) {
  const inputSchema = tool.inputSchema;
  return {
    name: publicToolName(tool.name),
    description: tool.description ?? '',
    parameters:
      typeof inputSchema === 'object' && inputSchema !== null
        ? inputSchema
        : { type: 'object', properties: {} },
    output: {
      schema: {
        type: 'object',
        properties: {
          content: { type: 'array', items: {} },
          structuredContent: {},
        },
        required: ['content'],
        additionalProperties: false,
      },
      render(_args, value) {
        const content =
          typeof value === 'object' && value !== null ? value.content : undefined;
        return text(extractText(content, tool.name));
      },
    },
    execute: async (args, exec) => {
      const cleanArgs = typeof args === 'object' && args !== null ? args : {};
      const result = await client.callTool(tool.name, cleanArgs, {
        signal: exec.signal,
        timeoutMs: TOOL_CALL_TIMEOUT_MS,
      });
      if (!Array.isArray(result?.content)) {
        const rendered = result?.structuredContent !== undefined
          ? JSON.stringify(result.structuredContent)
          : '(no output)';
        if (result?.isError === true) throw new Error(rendered);
        return { content: [{ type: 'text', text: rendered }] };
      }
      if (result.isError === true) throw new Error(extractText(result.content, tool.name));
      return { content: result.content };
    },
  };
}

/**
 * Create the supervised MCP connection to the phone's MT server.
 * @param ctx - cordis context carrying the tools registry and logger.
 * @param store - config store (the URL gates the connection).
 * @returns the supervisor handle.
 */
function createSupervisor(ctx, store) {
  const label = 'mt-mcp';
  let client = null;
  let disposers = new Map();
  let reconnectTimer = null;
  let attempts = 0;
  let disposed = false;
  let lastError = '';
  let syncing = Promise.resolve();

  const isCurrent = (generation) => !disposed && client === generation;

  function clearTools() {
    for (const dispose of disposers.values()) dispose();
    disposers = new Map();
  }

  function scheduleReconnect() {
    if (disposed || reconnectTimer !== null) return;
    if (attempts >= RECONNECT.maxAttempts) {
      lastError = `重连失败 ${RECONNECT.maxAttempts} 次后已停止，请在设置页点「重新连接」`;
      ctx.logger.error(`${label}: giving up after ${RECONNECT.maxAttempts} reconnect attempts`);
      return;
    }
    const delayMs = Math.min(RECONNECT.maxDelayMs, RECONNECT.initialDelayMs * 2 ** attempts);
    attempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect().catch(() => {});
    }, delayMs);
    reconnectTimer.unref();
  }

  function syncTools(generation) {
    const run = syncing.then(async () => {
      if (!isCurrent(generation)) return;
      const tools = await generation.listTools();
      const definitions = tools.map((tool) => makeToolDefinition(generation, tool));
      clearTools();
      for (const definition of definitions) {
        disposers.set(definition.name, ctx.tools.register(definition));
      }
    });
    syncing = run.catch(() => {});
    return run;
  }

  async function disconnect() {
    const current = client;
    client = null;
    clearTools();
    if (current === null) return;
    try {
      current.close();
    } catch {
      /* 关闭失败不影响下一次连接 */
    }
  }

  async function connect() {
    if (disposed) return 0;
    const cfg = await store.load();
    await disconnect();
    if (cfg.url === '') {
      lastError = '';
      return 0;
    }
    const generation = new McpHttpClient(cfg.url, { getToken: () => cfg.token });
    client = generation;
    try {
      await generation.initialize();
      // 只有握手成功才订阅工具变更：MT 的 SSE 通道在未初始化时不可靠
      generation.onToolsChanged(() => {
        if (!isCurrent(generation)) return;
        syncTools(generation).catch((error) => {
          if (!disposed) ctx.logger.warn(`${label}: 工具列表重新同步失败: ${describeError(error)}`);
        });
      });
      await syncTools(generation);
      attempts = 0;
      lastError = '';
      return toolsCount();
    } catch (error) {
      lastError = describeError(error);
      await disconnect();
      throw error;
    }
  }

  return {
    async connect() {
      return connect();
    },
    isConnected() {
      return client !== null;
    },
    toolsCount() {
      return disposers.size;
    },
    toolNames() {
      return [...disposers.keys()];
    },
    lastError() {
      return lastError;
    },
    async dispose() {
      disposed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      await disconnect();
    },
  };

  function toolsCount() {
    return disposers.size;
  }
}

/** Strict loopback fence: only this machine may read or rewrite the config. */
function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress;
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false;
  const host = request.headers.host;
  if (typeof host !== 'string') return false;
  let hostUrl;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') {
    return false;
  }
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

/** One JSON response. */
function writeJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
  });
  res.end(JSON.stringify(body));
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk;
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) return undefined;
    chunks.push(buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build every /api/dsh-mt-mcp route (exact paths).
 * @param store - config store.
 * @param supervisor - MCP connection supervisor.
 * @returns the route list.
 */
function makeRoutes(store, supervisor) {
  const guard = (req, res, method) => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' });
      return false;
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` });
      return false;
    }
    return true;
  };
  const statusView = async () => ({
    ...(await store.view()),
    connected: supervisor.isConnected(),
    toolCount: supervisor.toolsCount(),
    tools: supervisor.toolNames(),
    error: supervisor.lastError(),
  });

  return [
    {
      kind: 'exact',
      path: MT_MCP_API.status,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return;
        writeJson(res, 200, await statusView());
      },
    },
    {
      kind: 'exact',
      path: MT_MCP_API.save,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return;
        const body = await readJsonBody(req);
        if (body === undefined) {
          writeJson(res, 400, { ok: false, error: '无效的 JSON 请求体' });
          return;
        }
        const next = await store.load();
        if (typeof body.url === 'string') {
          const url = body.url.trim();
          if (url !== '') {
            const problem = validateUrl(url);
            if (problem !== '') {
              writeJson(res, 400, { ok: false, error: problem, view: await statusView() });
              return;
            }
          }
          next.url = url;
        }
        // token 留空表示保持不变；clearToken 显式清空。
        if (typeof body.token === 'string' && body.token.trim() !== '') {
          next.token = body.token.trim();
        }
        if (body.clearToken === true) next.token = '';
        await store.save(next);
        let ok = false;
        let message;
        try {
          const count = await supervisor.connect();
          ok = supervisor.isConnected();
          message = ok
            ? `已保存并连接，发现 ${count} 个 MT 工具。`
            : '已保存。地址为空，暂不连接。';
        } catch (error) {
          message = '已保存，但连接失败：' + describeError(error);
        }
        writeJson(res, 200, { ok, message, view: await statusView() });
      },
    },
    {
      kind: 'exact',
      path: MT_MCP_API.connect,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return;
        try {
          const count = await supervisor.connect();
          writeJson(res, 200, {
            ok: supervisor.isConnected(),
            message: supervisor.isConnected()
              ? `连接成功，发现 ${count} 个 MT 工具。`
              : '地址为空，请先填写并保存。',
            view: await statusView(),
          });
        } catch (error) {
          writeJson(res, 200, {
            ok: false,
            message: '连接失败：' + describeError(error),
            view: await statusView(),
          });
        }
      },
    },
  ];
}

/** Model-facing announcement: plugin presence, address source, and limits. */
const MT_MCP_GUIDANCE =
  '本机已安装 dsh-mt-mcp 插件（MT 管理器 MCP 连接）：手机 MT 管理器「侧拉栏 → 工具 → MCP 服务」启动后，把 MT 显示的局域网地址（形如 http://192.168.x.x:8787/mcp）填入 Web 设置页「MT 管理器」面板并保存，MT 的文件 / APK / ZIP 能力即以 mcp__mt__* 工具形式可用。mt_mcp_status 查看连接状态（不回显令牌），mt_mcp_connect 重新连接。地址与令牌存 ~/.dsh/dsh-mt-mcp.json（权限 0600）。用户提到「MT / MT管理器 / 手机上的文件、APK、ZIP」时即指本插件，请据此协作。';

/** Build the agent-facing helper tools. */
function buildTools(store, supervisor) {
  return [
    defineTool({
      name: 'mt_mcp_status',
      description:
        '查看 MT 管理器 MCP 连接状态：是否已配置地址、是否已连接、已注册的 MT 工具数量与错误信息。不会泄露令牌。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            message: { type: 'string', required: true },
            url: { type: 'string' },
            connected: { type: 'boolean' },
            toolCount: { type: 'number' },
            configPath: { type: 'string' },
          },
        },
        render: (_args, value) => text(String(value.message ?? '')),
      },
      async execute() {
        const view = await store.view();
        return {
          ok: true,
          message:
            'dsh-mt-mcp：' +
            [
              view.url === '' ? '未配置地址' : '地址 ' + view.url,
              supervisor.isConnected() ? '已连接' : '未连接',
              '已注册工具 ' + supervisor.toolsCount() + ' 个',
              view.tokenConfigured ? '已设置令牌' : '未设置令牌',
              view.configPath,
            ].join('；') +
            '。' +
            (view.url === ''
              ? '请在 Web 设置页「MT 管理器」面板填入 MT 显示的局域网地址。'
              : supervisor.isConnected()
                ? '可直接使用 mcp__mt__* 工具。'
                : '请在设置页检查地址与连接，或调用 mt_mcp_connect 重试。') +
            (supervisor.lastError() === '' ? '' : ' 最近错误：' + supervisor.lastError()),
          url: view.url,
          connected: supervisor.isConnected(),
          toolCount: supervisor.toolsCount(),
          configPath: view.configPath,
        };
      },
    }),
    defineTool({
      name: 'mt_mcp_connect',
      description:
        '按已保存的地址重新连接手机上的 MT 管理器 MCP 服务（地址在 Web 设置页「MT 管理器」面板修改），返回发现的工具数量。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            message: { type: 'string', required: true },
            toolCount: { type: 'number' },
          },
        },
        render: (_args, value) => text(String(value.message ?? '')),
      },
      async execute() {
        try {
          const count = await supervisor.connect();
          const connected = supervisor.isConnected();
          return {
            ok: connected,
            message: connected
              ? `已连接 MT，发现 ${count} 个工具。`
              : '尚未配置 MCP 地址：请在 Web 设置页「MT 管理器」面板填写。',
            toolCount: count,
          };
        } catch (error) {
          return {
            ok: false,
            message: '连接失败：' + describeError(error),
            toolCount: 0,
          };
        }
      },
    }),
  ];
}

/**
 * Mount the MT MCP connection, helper tools, routes, and announcement.
 * @param ctx - host plugin context carrying tools/systemPrompt/webServer.
 * @param config - plugin config from the composition row.
 */
export function apply(ctx, config) {
  const enabled = config?.enabled !== false;
  if (!enabled) return;
  const store = new MtStore();
  const supervisor = createSupervisor(ctx, store);

  ctx.effect(() => {
    const disposers = [
      ...buildTools(store, supervisor).map((tool) => ctx.tools.register(tool)),
      ...makeRoutes(store, supervisor).map((route) => ctx.webServer.register(route)),
    ];
    if (config?.announceToAgent !== false) {
      disposers.push(
        ctx.systemPrompt.section({
          name: 'plugin:dsh-mt-mcp',
          order: SECTION_ORDER,
          text: MT_MCP_GUIDANCE,
        }),
      );
    }
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, 'dsh-mt-mcp: surfaces');

  ctx.effect(
    () => () => {
      void supervisor.dispose();
    },
    'dsh-mt-mcp: connection',
  );

  // 启动即尝试连接；地址为空时静默跳过。
  supervisor.connect().catch((error) => {
    ctx.logger.warn(`mt-mcp: 启动连接失败: ${describeError(error)}`);
  });
}
