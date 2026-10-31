/**
 * lib/annotations.js 的测试。全部离线、零第三方依赖（node:test + node:assert）。
 *
 * 重点不是覆盖率，而是三条会真正弄坏工具的行为约束：
 *   1. 归一化后的注解必须是四个显式 boolean；
 *   2. 透传给 DSH 的 schema 不能含它拒绝的关键字/形态（否则注册直接抛错）；
 *   3. 输出的 structuredContent 必须保持可选（否则真实返回缺少它时
 *      dsh-tools 会用 schema 校验并抛 ToolOutputError，工具当场失败）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANNOTATION_KEYS,
  DEFAULT_ANNOTATIONS,
  normalizeAnnotations,
  withAnnotations,
  safeStructuredSchema,
  buildOutput,
} from '../lib/annotations.js';

test('normalizeAnnotations 恰好返回四个显式 boolean', () => {
  const out = normalizeAnnotations({ readOnlyHint: true });
  assert.deepEqual(Object.keys(out).sort(), [...ANNOTATION_KEYS].sort());
  for (const key of ANNOTATION_KEYS) {
    assert.equal(typeof out[key], 'boolean', `${key} 必须是 boolean`);
  }
  assert.equal(out.readOnlyHint, true);
});

test('normalizeAnnotations 对非 boolean 输入回落保守默认值', () => {
  const out = normalizeAnnotations({
    readOnlyHint: 'true',
    destructiveHint: null,
    idempotentHint: 1,
    openWorldHint: undefined,
  });
  assert.deepEqual(out, DEFAULT_ANNOTATIONS);
});

test('normalizeAnnotations 接受缺失与非对象输入', () => {
  assert.deepEqual(normalizeAnnotations(undefined), DEFAULT_ANNOTATIONS);
  assert.deepEqual(normalizeAnnotations(null), DEFAULT_ANNOTATIONS);
  assert.deepEqual(normalizeAnnotations('nope'), DEFAULT_ANNOTATIONS);
  assert.deepEqual(normalizeAnnotations([1, 2]), DEFAULT_ANNOTATIONS);
});

test('withAnnotations 不改原定义并保留原字段', () => {
  const base = { name: 'x', description: 'd', parameters: {} };
  const out = withAnnotations(base, { readOnlyHint: true });
  assert.equal(base.annotations, undefined, '原对象不应被改动');
  assert.equal(out.name, 'x');
  assert.equal(out.description, 'd');
  assert.deepEqual(out.parameters, {});
  assert.equal(out.annotations.readOnlyHint, true);
});

test('safeStructuredSchema 拒绝非 object 根', () => {
  assert.equal(safeStructuredSchema(undefined), undefined);
  assert.equal(safeStructuredSchema(null), undefined);
  assert.equal(safeStructuredSchema([]), undefined);
  assert.equal(safeStructuredSchema({ type: 'array', items: {} }), undefined);
  assert.equal(safeStructuredSchema({ type: 'string' }), undefined);
  assert.equal(safeStructuredSchema({ properties: {} }), undefined, '缺 type 且无 oneOf');
});

test('safeStructuredSchema 原样接受合法 schema', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: { ok: { type: 'boolean' }, count: { type: 'integer' } },
    required: ['ok'],
  };
  const out = safeStructuredSchema(schema);
  assert.deepEqual(out, schema);
  assert.notEqual(out, schema, '必须返回克隆，不能与上游共享引用');
});

test('safeStructuredSchema 把 anyOf 改写成 oneOf', () => {
  const schema = {
    type: 'object',
    properties: {
      addr: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
    },
  };
  const out = safeStructuredSchema(schema);
  assert.equal(out.properties.addr.anyOf, undefined, 'anyOf 必须已被移除');
  assert.equal(out.properties.addr.oneOf.length, 2);
  assert.equal(out.properties.addr.oneOf[0].type, 'string');
});

test('safeStructuredSchema 把 type 数组展开为 oneOf 且把约束挂到非 null 分支', () => {
  // 这是 MT 上游最常见的形态：data: { type:['object','null'], properties:... }
  const schema = {
    type: 'object',
    properties: {
      data: {
        type: ['object', 'null'],
        additionalProperties: false,
        properties: { items: { type: 'array', items: { type: 'string' } } },
      },
    },
  };
  const out = safeStructuredSchema(schema);
  const data = out.properties.data;
  assert.equal(data.type, undefined, 'type 数组必须被展开');
  assert.equal(data.oneOf.length, 2);
  const objectBranch = data.oneOf.find((b) => b.type === 'object');
  const nullBranch = data.oneOf.find((b) => b.type === 'null');
  assert.ok(objectBranch, '必须有 object 分支');
  assert.ok(nullBranch, '必须有 null 分支');
  assert.deepEqual(objectBranch.properties, schema.properties.data.properties,
    '约束必须留在 object 分支上');
});

test('safeStructuredSchema 对无法安全表达的形态返回 undefined', () => {
  assert.equal(
    safeStructuredSchema({
      type: 'object',
      properties: { x: { type: 'string', pattern: '^a' } },
    }),
    undefined,
    'pattern 是 DSH 不支持的关键字',
  );
  assert.equal(
    safeStructuredSchema({ type: ['object', 'string'], properties: {} }),
    undefined,
    '多个具体类型 + 约束无法确定挂哪个分支',
  );
});

test('safeStructuredSchema 不因异常输入而抛出', () => {
  const cyclic = { type: 'object', properties: {} };
  cyclic.properties.self = cyclic;
  assert.equal(safeStructuredSchema(cyclic), undefined);

  const hostile = { type: 'object', get properties() { throw new Error('boom'); } };
  assert.equal(safeStructuredSchema(hostile), undefined);
});

test('buildOutput 的 structuredContent 永远是可选字段', () => {
  const out = buildOutput(
    { type: 'object', properties: { ok: { type: 'boolean' } } },
    () => [],
  );
  assert.deepEqual(out.schema.required, ['content'],
    'required 只能含 content：真实返回缺少 structuredContent 时不能判非法');
  assert.ok(out.schema.properties.structuredContent, '仍应声明 structuredContent 约束');
});

test('buildOutput 在没有上游 schema 时退回宽松形态', () => {
  const out = buildOutput(undefined, () => []);
  assert.deepEqual(out.schema.required, ['content']);
  assert.deepEqual(out.schema.properties.structuredContent, {});
});

test('buildOutput 保留 render 回调', () => {
  const render = () => [{ type: 'text', text: 'hi' }];
  const out = buildOutput(undefined, render);
  assert.equal(out.render, render);
});
