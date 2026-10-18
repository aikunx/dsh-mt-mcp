/**
 * 极简 MCP Streamable HTTP 客户端（零依赖）。
 *
 * 为什么不用 @modelcontextprotocol/sdk：DSH 加载插件时保留符号链接解析，
 * 而 pnpm 把包的依赖放进 .pnpm 虚拟店；插件被安装到 profile 后，SDK 的
 * 传递依赖（zod 等）解析不到，插件直接导入失败。用内置 fetch 实现这一点
 * 协议，本插件就不需要任何运行时第三方依赖。
 *
 * 只实现本插件需要的最小集：
 *   - POST JSON-RPC（initialize / tools/list / tools/call / ping）
 *   - 响应既可能是 application/json，也可能是 text/event-stream
 *   - 记住 Mcp-Session-Id 并在后续请求回传
 *   - 解析 tools/list_changed 通知（SSE 通道）
 */

/** 协议版本：与服务端协商，服务端回什么就用什么。 */
const PROTOCOL_VERSION = '2025-06-18';

/** 请求超时（毫秒）。 */
const DEFAULT_TIMEOUT_MS = 60_000;

/** 单条 SSE 数据行的上限，防止异常响应撑爆内存。 */
const MAX_SSE_LINE_BYTES = 8 * 1024 * 1024;

/** JSON-RPC / MCP 错误。 */
export class McpError extends Error {
  constructor(message, { code = 0, data } = {}) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.data = data;
  }
}

/** 把响应体按 SSE 分帧，逐条给出 data 负载。 */
async function* sseEvents(stream) {
  const decoder = new TextDecoder();
  let buffer = '';
  let size = 0;
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    size += chunk.length ?? 0;
    if (size > MAX_SSE_LINE_BYTES) throw new McpError('SSE 响应过大，已中止');
    let index;
    // 事件以空行分隔
    while ((index = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data !== '') yield data;
    }
  }
  const tail = buffer
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (tail !== '') yield tail;
}

/**
 * 一个 Streamable HTTP MCP 连接。
 */
export class McpHttpClient {
  #url;
  #getToken;
  #sessionId = null;
  #protocolVersion = null;
  #nextId = 1;
  #closed = false;
  #pending = new Map();
  #notice = null;
  #abort = null;

  /**
   * @param {string} url - MCP 端点，必须以 /mcp 结尾
   * @param {{ getToken?: () => string }} [options] - 每次请求时取当前令牌
   */
  constructor(url, options = {}) {
    this.#url = url;
    this.#getToken = options.getToken ?? (() => '');
  }

  /** 服务端给出的会话 id（没有则为 null）。 */
  get sessionId() {
    return this.#sessionId;
  }

  /** 协商出的协议版本。 */
  get protocolVersion() {
    return this.#protocolVersion;
  }

  /** 注册 tools/list_changed 回调。 */
  onToolsChanged(listener) {
    this.#notice = listener;
    return () => {
      if (this.#notice === listener) this.#notice = null;
    };
  }

  #headers(extra = {}) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...extra,
    };
    const token = this.#getToken();
    if (token !== '') headers.authorization = `Bearer ${token}`;
    if (this.#sessionId !== null) headers['mcp-session-id'] = this.#sessionId;
    if (this.#protocolVersion !== null) headers['mcp-protocol-version'] = this.#protocolVersion;
    return headers;
  }

  /** 发一条 JSON-RPC 消息并等结果。 */
  async request(method, params, { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
    if (this.#closed) throw new McpError('连接已关闭');
    const id = this.#nextId++;
    const body = { jsonrpc: '2.0', id, method };
    if (params !== undefined) body.params = params;

    const timeout = AbortSignal.timeout(timeoutMs);
    const composite = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

    let response;
    try {
      response = await fetch(this.#url, {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify(body),
        signal: composite,
      });
    } catch (error) {
      if (error?.name === 'TimeoutError') throw new McpError(`${method} 超时（${timeoutMs}ms）`);
      if (error?.name === 'AbortError') throw new McpError(`${method} 已取消`);
      throw new McpError(`无法连接 MT：${error instanceof Error ? error.message : String(error)}`);
    }

    const session = response.headers.get('mcp-session-id');
    if (session !== null && session !== '') this.#sessionId = session;

    if (response.status === 401 || response.status === 403) {
      throw new McpError(`认证失败（HTTP ${response.status}）：检查 MT 的 Bearer 令牌`, {
        code: response.status,
      });
    }
    if (response.status === 404) {
      throw new McpError('端点不存在（HTTP 404）：确认地址以 /mcp 结尾且 MT 服务已启动');
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new McpError(`HTTP ${response.status}${text === '' ? '' : `：${text.slice(0, 200)}`}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      return this.#readStream(id, response, composite);
    }
    const text = await response.text();
    if (text.trim() === '') {
      // 通知类请求（如 notifications/initialized）可能回 202 空体
      return undefined;
    }
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      throw new McpError('服务端返回了无法解析的 JSON');
    }
    if (Array.isArray(message)) {
      const hit = message.find((item) => item?.id === id);
      if (hit === undefined) throw new McpError(`${method} 没有对应响应`);
      return this.#unwrap(hit, method);
    }
    // 服务端可能在响应体里先塞通知再给结果
    if (message?.id !== id && message?.method !== undefined) {
      this.#handleNotification(message);
      throw new McpError(`${method} 只收到通知，没有结果`);
    }
    return this.#unwrap(message, method);
  }

  /** 从 SSE 通道读到本次请求的响应为止。 */
  async #readStream(id, response, signal) {
    for await (const data of sseEvents(response.body)) {
      let message;
      try {
        message = JSON.parse(data);
      } catch {
        continue;
      }
      const list = Array.isArray(message) ? message : [message];
      for (const item of list) {
        if (item?.id === id) return this.#unwrap(item, 'request');
        if (item?.method !== undefined) this.#handleNotification(item);
      }
    }
    if (signal.aborted) throw new McpError('请求已取消');
    throw new McpError('SSE 流结束但没有收到结果');
  }

  /** 统一把 JSON-RPC 结果/错误展开。 */
  #unwrap(message, method) {
    if (message?.error !== undefined && message.error !== null) {
      const error = message.error;
      throw new McpError(
        typeof error.message === 'string' ? error.message : `${method} 失败`,
        { code: typeof error.code === 'number' ? error.code : 0, data: error.data },
      );
    }
    return message?.result;
  }

  /** 处理服务端推来的通知。 */
  #handleNotification(message) {
    if (message.method === 'notifications/tools/list_changed') {
      try {
        this.#notice?.();
      } catch {
        /* 通知监听自身的错误不影响连接 */
      }
    }
  }

  /** 只发通知，不等结果。 */
  async notify(method, params) {
    if (this.#closed) return;
    const body = { jsonrpc: '2.0', method };
    if (params !== undefined) body.params = params;
    try {
      await fetch(this.#url, {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch {
      /* 通知失败不致命：MT 不强制要求 initialized */
    }
  }

  /** 完成 MCP 握手。 */
  async initialize({ name: clientName = 'dsh-mt-mcp', version = '0.1.0' } = {}) {
    const result = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: clientName, version },
    });
    if (typeof result?.protocolVersion === 'string') {
      this.#protocolVersion = result.protocolVersion;
    }
    await this.notify('notifications/initialized');
    return result;
  }

  /** 拉取全部工具（自动翻页）。 */
  async listTools() {
    const tools = [];
    let cursor;
    for (;;) {
      const params = cursor === undefined ? undefined : { cursor };
      const result = await this.request('tools/list', params);
      if (Array.isArray(result?.tools)) tools.push(...result.tools);
      const next = result?.nextCursor;
      if (typeof next !== 'string' || next === '') break;
      cursor = next;
    }
    return tools;
  }

  /** 调用一个工具。 */
  async callTool(name, args, { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
    return this.request('tools/call', { name, arguments: args }, { timeoutMs, signal });
  }

  /** 关闭连接（无状态 HTTP，只是标记）。 */
  close() {
    this.#closed = true;
    for (const controller of this.#pending.values()) controller.abort();
    this.#pending.clear();
  }
}
