/**
 * lib/mcp-http.js 的测试。用假 fetch，全部离线，不连手机、不装任何依赖。
 *
 * 覆盖的是「连不上/连错」时最容易静默出问题的地方：错误映射、会话 id 回传、
 * SSE 分帧、翻页、通知处理。这些路径平时走不到，坏掉也难发现。
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { McpHttpClient, McpError } from '../lib/mcp-http.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** 装一个假 fetch，按调用顺序返回预设响应。 */
function stubFetch(handlers) {
  const calls = [];
  let index = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const handler = handlers[Math.min(index, handlers.length - 1)];
    index += 1;
    return handler(init);
  };
  return calls;
}

/** 造一个 JSON 响应。 */
function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const ENDPOINT = 'http://198.51.100.7:8787/mcp';

test('initialize 发送正确的握手并记录协商版本', async () => {
  const calls = stubFetch([
    () => jsonResponse(
      { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: {} } },
    ),
    () => new Response(null, { status: 202 }),
  ]);

  const client = new McpHttpClient(ENDPOINT, { getToken: () => '' });
  await client.initialize();

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.method, 'initialize');
  assert.equal(body.params.clientInfo.name, 'dsh-mt-mcp');
  assert.equal(client.protocolVersion, '2025-06-18');
  assert.ok(calls.some((c) => JSON.parse(c.init.body).method === 'notifications/initialized'),
    '握手后必须发 initialized 通知');
});

test('令牌只在有值时放进 Authorization 头', async () => {
  const calls = stubFetch([
    () => jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [] } }),
  ]);
  const client = new McpHttpClient(ENDPOINT, { getToken: () => 'secret-token' });
  await client.request('tools/list');
  assert.equal(calls[0].init.headers.authorization, 'Bearer secret-token');

  const calls2 = stubFetch([
    () => jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [] } }),
  ]);
  const anon = new McpHttpClient(ENDPOINT, { getToken: () => '' });
  await anon.request('tools/list');
  assert.equal(calls2[0].init.headers.authorization, undefined,
    '没有令牌时不得发空的 Authorization 头');
});

test('服务端返回的 Mcp-Session-Id 会带到后续请求', async () => {
  const calls = stubFetch([
    () => jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, { headers: { 'mcp-session-id': 'sess-1' } }),
    () => jsonResponse({ jsonrpc: '2.0', id: 2, result: { tools: [] } }),
  ]);
  const client = new McpHttpClient(ENDPOINT);
  await client.request('initialize');
  await client.request('tools/list');
  assert.equal(calls[1].init.headers['mcp-session-id'], 'sess-1');
});

test('401/403 映射为令牌相关的错误', async () => {
  stubFetch([() => new Response('denied', { status: 401 })]);
  const client = new McpHttpClient(ENDPOINT);
  await assert.rejects(
    () => client.request('tools/list'),
    (error) => {
      assert.ok(error instanceof McpError);
      assert.equal(error.code, 401);
      assert.match(error.message, /认证失败/);
      return true;
    },
  );
});

test('404 提示地址问题', async () => {
  stubFetch([() => new Response('', { status: 404 })]);
  const client = new McpHttpClient(ENDPOINT);
  await assert.rejects(
    () => client.request('tools/list'),
    (error) => {
      assert.equal(error.code, 0);
      assert.match(error.message, /404/);
      assert.match(error.message, /\/mcp/);
      return true;
    },
  );
});

test('JSON-RPC error 成员展开为 McpError 并保留 code', async () => {
  stubFetch([
    () => jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: '参数错误' } }),
  ]);
  const client = new McpHttpClient(ENDPOINT);
  await assert.rejects(
    () => client.request('tools/call', { name: 'x' }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /参数错误/);
      return true;
    },
  );
});

test('202 空体视为成功（通知类请求）', async () => {
  stubFetch([() => new Response(null, { status: 202 })]);
  const client = new McpHttpClient(ENDPOINT);
  const result = await client.request('notifications/initialized');
  assert.equal(result, undefined);
});

test('从 SSE 流里读到本次请求的响应', async () => {
  const sse = [
    'data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}',
    '',
    'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}',
    '',
  ].join('\n');
  stubFetch([
    () => new Response(sse, { headers: { 'content-type': 'text/event-stream' } }),
  ]);
  const client = new McpHttpClient(ENDPOINT);
  const result = await client.request('tools/list');
  assert.deepEqual(result, { tools: [] });
});

test('SSE 流里的通知会触发 tools/list_changed 回调', async () => {
  let changed = 0;
  const sse = [
    'data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}',
    '',
    'data: {"jsonrpc":"2.0","id":1,"result":{}}',
    '',
  ].join('\n');
  stubFetch([
    () => new Response(sse, { headers: { 'content-type': 'text/event-stream' } }),
  ]);
  const client = new McpHttpClient(ENDPOINT);
  client.onToolsChanged(() => { changed += 1; });
  await client.request('initialize');
  assert.equal(changed, 1);
});

test('SSE 流结束但无结果时报错，而不是挂住', async () => {
  stubFetch([
    () => new Response('data: {"jsonrpc":"2.0","method":"x"}\n\n',
      { headers: { 'content-type': 'text/event-stream' } }),
  ]);
  const client = new McpHttpClient(ENDPOINT);
  await assert.rejects(
    () => client.request('tools/list'),
    (error) => {
      assert.match(error.message, /SSE/);
      return true;
    },
  );
});

test('listTools 自动跟完 nextCursor 翻页', async () => {
  const calls = stubFetch([
    () => jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'a' }], nextCursor: 'c1' } }),
    () => jsonResponse({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'b' }] } }),
  ]);
  const client = new McpHttpClient(ENDPOINT);
  const tools = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), ['a', 'b']);
  const second = JSON.parse(calls[1].init.body);
  assert.deepEqual(second.params, { cursor: 'c1' }, '第二页必须带 cursor');
});

test('listTools 在没有 nextCursor 时只请求一次', async () => {
  const calls = stubFetch([
    () => jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'a' }] } }),
  ]);
  const client = new McpHttpClient(ENDPOINT);
  await client.listTools();
  assert.equal(calls.length, 1);
});

test('callTool 把参数包进 tools/call', async () => {
  const calls = stubFetch([
    () => jsonResponse({
      jsonrpc: '2.0', id: 1,
      result: { content: [{ type: 'text', text: 'ok' }], isError: false },
    }),
  ]);
  const client = new McpHttpClient(ENDPOINT);
  const result = await client.callTool('mt_zip_list', { path: '/x.zip' });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.method, 'tools/call');
  assert.deepEqual(body.params, { name: 'mt_zip_list', arguments: { path: '/x.zip' } });
  assert.equal(result.content[0].text, 'ok');
});

test('请求超时映射为超时错误', async () => {
  stubFetch([
    () => {
      throw new DOMException('aborted', 'TimeoutError');
    },
  ]);
  const client = new McpHttpClient(ENDPOINT);
  await assert.rejects(
    () => client.request('tools/list', undefined, { timeoutMs: 50 }),
    (error) => {
      assert.match(error.message, /超时/);
      return true;
    },
  );
});

test('连接失败映射为可读的「无法连接」', async () => {
  stubFetch([() => { throw new TypeError('fetch failed'); }]);
  const client = new McpHttpClient(ENDPOINT);
  await assert.rejects(
    () => client.request('tools/list'),
    (error) => {
      assert.match(error.message, /无法连接 MT/);
      return true;
    },
  );
});

test('close 之后的请求直接被拒绝', async () => {
  stubFetch([() => jsonResponse({ jsonrpc: '2.0', id: 1, result: {} })]);
  const client = new McpHttpClient(ENDPOINT);
  client.close();
  await assert.rejects(
    () => client.request('tools/list'),
    (error) => {
      assert.match(error.message, /已关闭/);
      return true;
    },
  );
});

test('无法解析的响应体给出明确错误', async () => {
  stubFetch([() => new Response('not json', { headers: { 'content-type': 'application/json' } })]);
  const client = new McpHttpClient(ENDPOINT);
  await assert.rejects(
    () => client.request('tools/list'),
    (error) => {
      assert.match(error.message, /无法解析/);
      return true;
    },
  );
});
