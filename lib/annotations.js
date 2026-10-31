/**
 * 上游 MCP 元数据的「安全承载」层。
 *
 * 两件事，都源自同一条教训：**不能为了多带信息，把工具注册弄坏**。
 *
 * 1. `annotations`：上游 MT 的 57 个工具全部声明了 readOnlyHint/destructiveHint
 *    等 hint，但 DSH 的 ToolSchema（@deepseek-ai/dsh-llm 的 types.d.ts:455-466）
 *    只有 deferLoading/name/description/parameters，`defineTool` 也是白名单拷贝，
 *    没有 annotations 槽位。这里把它挂到 ToolDefinition 对象上（宿主可见、
 *    不会进提示词、registry 的校验也不看它），至少不把上游的声明丢掉。
 *
 * 2. `outputSchema`：上游 56/57 个工具声明了 outputSchema。但 `tools.register`
 *    会调用 `assertSupportedJsonSchema`（dsh-tools/lib/index.js:2878-2886），
 *    后者只接受 type/oneOf/properties/required/additionalProperties/items/
 *    enum/const + 注解白名单，**任何越界关键字直接抛 JsonSchemaError**。
 *    所以透传必须带 try/catch 回落——这正是官方 @deepseek-ai/dsh-mcp-client
 *    的 supportedOutputSchema（lib/index.js:163-171）在做的事。
 *
 * 设计要点：这两件事都是「尽力而为」，失败时必须安静地退回到原行为
 * （固定的宽松 schema），绝不能把插件从「能用」变成「连不上工具」。
 */

/** MCP 规范定义的四个 hint 键。 */
export const ANNOTATION_KEYS = [
  'readOnlyHint',
  'destructiveHint',
  'idempotentHint',
  'openWorldHint',
];

/**
 * 缺省值取自 MCP 规范：未声明注解的工具按「非只读、可能有破坏性、
 * 非幂等、接触开放世界」对待——保守一边，宁可多提示也不静默放过。
 */
export const DEFAULT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

/** 只接受真正的 boolean，其余（字符串、null、缺失）一律视为未声明。 */
function booleanHint(value) {
  return value === true || value === false ? value : undefined;
}

/**
 * 把任意上游 `annotations` 记录归一成四个显式 boolean。
 * @param raw - 上游 tools/list 里的 annotations 字段，可缺失或非对象。
 * @returns 恰好含 ANNOTATION_KEYS 四个 boolean 的新对象。
 */
export function normalizeAnnotations(raw) {
  const record = typeof raw === 'object' && raw !== null ? raw : {};
  const next = {};
  for (const key of ANNOTATION_KEYS) {
    const hint = booleanHint(record[key]);
    next[key] = hint === undefined ? DEFAULT_ANNOTATIONS[key] : hint;
  }
  return next;
}

/**
 * 给工具定义附加归一化注解，返回新对象（不改原定义）。
 * 注意：注解在 DSH 里不会进提示词，这是「不丢失上游声明」的承载，
 * 而不是「让模型看见只读性」的手段（后者只能靠 description 写清）。
 * @param definition - 工具定义字面量或 defineTool 产物。
 * @param annotations - 上游声明的 annotations，可缺失。
 * @returns 带 `annotations` 的浅拷贝定义。
 */
export function withAnnotations(definition, annotations) {
  return { ...definition, annotations: normalizeAnnotations(annotations) };
}

/**
 * DSH 受支持的 JSON Schema 关键字子集（来自 dsh-tools 的 JsonSchemaError 文案）。
 * 只用于**尽量**判断能否安全透传，不是完整校验器。
 */
const CONSTRAINT_KEYWORDS = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
]);

/** 注解类关键字：值只要是合法 JSON 即可（校验器只检查无损 JSON）。 */
const ANNOTATION_KEYWORDS = new Set([
  'description',
  'title',
  'default',
  'examples',
  '$comment',
  'deprecated',
  'readOnly',
  'writeOnly',
  'format',
]);

/**
 * DSH 认的 type 取值（对应 dsh-tools 的 SCHEMA_TYPES）。
 * 注意 DSH 拒绝 type 数组形态（`type: ["object","null"]` 会被判为
 * "type arrays are not supported"），而 MCP 上游大量使用这种写法。
 */
const SCHEMA_TYPES = new Set([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
]);

/**
 * 上游元数据与 DSH 支持子集的差异，实测结论（MT 57 个工具）：
 *   - 越界关键字只有 `anyOf`（48 处），DSH 只支持 `oneOf`；
 *   - 另有 `type: ["object","null"]` 这类数组形态，DSH 明确拒绝。
 * 两者都在 `coerceKeywords` 里做等价改写：前者 anyOf→oneOf，后者展开成 oneOf。
 * 改写不成立的形态一律原样保留，由 `findUnsupportedKeyword` 判为不支持，
 * 进而退回宽松 schema（见 safeStructuredSchema 的回落）。
 */

/**
 * 把 `anyOf` 就地转成 `oneOf`，并把 `type: [...]` 数组形态展开成 `oneOf`。
 * 其余节点递归处理。返回新树，不改入参。
 * @param node - 待改写的节点。
 * @returns 改写后的新节点，或原值（非对象时）。
 */
function coerceKeywords(node) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return node;

  // type 数组 -> oneOf 展开。
  //
  // 这是上游最常见的写法（MT 的 56 个工具都写了 data: type:["object","null"]），
  // 且它几乎总是和 properties/required 等约束一起出现。因此不能因为「有兄弟
  // 约束」就放弃，要把约束挂到「非 null 的那个分支」上：
  //
  //   { type:["object","null"], properties:{...} }
  //     => { oneOf: [ {type:"object", properties:{...}}, {type:"null"} ] }
  //
  // 语义等价：值要么是满足约束的 object，要么就是 null。
  if (Array.isArray(node.type)) {
    const entries = node.type;
    if (entries.length === 0) return node;
    if (!entries.every((t) => typeof t === 'string' && SCHEMA_TYPES.has(t))) return node;

    // null 只能单独成一个分支，不能带约束
    const hasNull = entries.includes('null');
    const concrete = entries.filter((t) => t !== 'null');
    if (hasNull && concrete.length === 0) {
      // 纯 ["null"]：退化成普通 type
      const rest = {};
      for (const [key, value] of Object.entries(node)) if (key !== 'type') rest[key] = value;
      return { ...rest, type: 'null' };
    }
    if (concrete.length === 0) return node;

    // 约束挂到哪个分支？必须唯一，否则无法表达
    const constraintKeys = Object.keys(node).filter(
      (key) => key !== 'type' && CONSTRAINT_KEYWORDS.has(key),
    );
    const annotationKeys = Object.keys(node).filter(
      (key) => key !== 'type' && !CONSTRAINT_KEYWORDS.has(key),
    );
    if (concrete.length > 1 && constraintKeys.length > 0) return node; // 约束该挂谁说不清，放弃

    const annotationOnly = {};
    for (const key of annotationKeys) annotationOnly[key] = node[key];

    const branches = [];
    for (const t of entries) {
      if (t === 'null') {
        branches.push({ type: 'null' });
        continue;
      }
      const branch = { type: t, ...annotationOnly };
      // 约束只放第一个（唯一）具体类型分支
      if (constraintKeys.length > 0 && branches.length === 0) {
        const reduced = {};
        for (const [key, value] of Object.entries(node)) {
          if (key === 'type' || annotationKeys.includes(key)) continue;
          reduced[key] = value;
        }
        Object.assign(branch, coerceKeywords(reduced));
      }
      branches.push(branch);
    }
    const outer = { ...annotationOnly };
    delete outer.oneOf;
    return { ...outer, oneOf: branches };
  }

  const next = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'anyOf' && Array.isArray(value)) {
      // oneOf 已存在时无法安全合并，交给上层判定为不支持
      if (Object.hasOwn(node, 'oneOf')) return node;
      next.oneOf = value.map((entry) => coerceKeywords(entry));
      continue;
    }
    if (key === 'properties' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const props = {};
      for (const [name, sub] of Object.entries(value)) props[name] = coerceKeywords(sub);
      next[key] = props;
      continue;
    }
    if (key === 'items' || key === 'additionalProperties') {
      next[key] = typeof value === 'object' && value !== null ? coerceKeywords(value) : value;
      continue;
    }
    next[key] = value;
  }
  return next;
}

/**
 * 递归检查一个 schema 是否只用了 DSH 支持的子集。
 * 宁可保守：任何无法确认的形态都判为不支持，让调用方回落到安全默认值。
 * @param node - 待检查的 schema 节点。
 * @param seen - 环检测集合（JSON 理论上无环，但上游可能构造出来）。
 * @returns 不支持的原因；空串表示可以透传。
 */
function findUnsupportedKeyword(node, seen = new Set()) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return '根节点必须是 schema 对象';
  }
  if (seen.has(node)) return 'schema 存在环';
  seen.add(node);

  for (const key of Object.keys(node)) {
    if (CONSTRAINT_KEYWORDS.has(key) || ANNOTATION_KEYWORDS.has(key)) continue;
    return `含不支持的关键字 ${key}`;
  }

  // type 必须是单个合法字符串（DSH 明确拒绝 type 数组，见 coerceKeywords 的改写）
  if (Object.hasOwn(node, 'type')) {
    const type = node.type;
    if (typeof type !== 'string' || !SCHEMA_TYPES.has(type)) {
      return Array.isArray(type) ? 'type 数组形态不受支持' : `type 非法: ${String(type)}`;
    }
  }

  // DSH 不允许同时声明 type 与 oneOf
  if (Object.hasOwn(node, 'type') && Object.hasOwn(node, 'oneOf')) {
    return '不能同时声明 type 与 oneOf';
  }

  // 无 type 也无 oneOf 时，约束关键字没有落点
  if (!Object.hasOwn(node, 'type') && !Object.hasOwn(node, 'oneOf')) {
    const orphans = Object.keys(node).filter((key) => CONSTRAINT_KEYWORDS.has(key));
    if (orphans.length > 0) return `缺 type/oneOf 却有 ${orphans.join(',')}`;
  }

  // oneOf 旁边不允许出现其它约束关键字（DSH 的 ONE_OF_SIBLING_KEYWORDS 判定）
  if (Object.hasOwn(node, 'oneOf')) {
    const siblings = Object.keys(node).filter(
      (key) => key !== 'oneOf' && CONSTRAINT_KEYWORDS.has(key),
    );
    if (siblings.length > 0) return `oneOf 旁存在关键字 ${siblings.join(',')}`;
    const list = node.oneOf;
    if (!Array.isArray(list) || list.length === 0) return 'oneOf 必须是非空数组';
    for (const entry of list) {
      const bad = findUnsupportedKeyword(entry, seen);
      if (bad !== '') return bad;
    }
    seen.delete(node);
    return '';
  }

  // 以下约束关键字只对特定 type 有意义（DSH 的 key/type 配对判定）
  const typeOf = node.type;
  const typeGuarded = {
    properties: 'object',
    required: 'object',
    additionalProperties: 'object',
    items: 'array',
  };
  for (const [key, wanted] of Object.entries(typeGuarded)) {
    if (Object.hasOwn(node, key) && typeOf !== wanted) {
      return `${key} 只能用于 type=${wanted}`;
    }
  }

  if (Object.hasOwn(node, 'items')) {
    const bad = findUnsupportedKeyword(node.items, seen);
    if (bad !== '') return bad;
  }
  if (Object.hasOwn(node, 'properties')) {
    const props = node.properties;
    if (props === null || typeof props !== 'object' || Array.isArray(props)) {
      return 'properties 必须是对象';
    }
    for (const value of Object.values(props)) {
      const bad = findUnsupportedKeyword(value, seen);
      if (bad !== '') return bad;
    }
  }
  if (Object.hasOwn(node, 'additionalProperties')) {
    const extra = node.additionalProperties;
    // true/false 是布尔开关；对象形态才需要继续校验
    if (typeof extra === 'object' && extra !== null && !Array.isArray(extra)) {
      const bad = findUnsupportedKeyword(extra, seen);
      if (bad !== '') return bad;
    } else if (typeof extra !== 'boolean') {
      return 'additionalProperties 必须是布尔或对象';
    }
  }

  seen.delete(node);
  return '';
}

/**
 * 尝试把上游 `outputSchema` 归一成 DSH 能注册的 structuredContent schema。
 *
 * 返回 `undefined` 表示「不要透传」，调用方应保留原有的宽松 schema；
 * 返回对象表示「可以安全放进 output.schema.properties.structuredContent」。
 * 无论哪种情况，工具都能正常注册——这是本函数的首要保证。
 *
 * @param candidate - 上游 tools/list 里的 outputSchema，可缺失。
 * @returns 可安全注册的 schema，或 undefined。
 */
export function safeStructuredSchema(candidate) {
  if (candidate === undefined) return undefined;
  try {
    // DSH 的 outputSchema 必须是 object-rooted（assertObjectJsonSchema 语义）
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return undefined;
    }
    if (candidate.type !== 'object') return undefined;
    // anyOf -> oneOf 等已知等价改写，然后按 DSH 子集严格复核
    const coerced = coerceKeywords(candidate);
    if (findUnsupportedKeyword(coerced) !== '') return undefined;
    // 深层克隆一次：避免上游对象被宿主持有后再被我们改动
    const clone = JSON.parse(JSON.stringify(coerced));
    // 克隆后再复核一次：确保序列化没有引入意外形态
    if (findUnsupportedKeyword(clone) !== '') return undefined;
    return clone;
  } catch {
    // 任何异常（循环引用、getter 抛错、JSON 不可序列化）都退回安全默认
    return undefined;
  }
}

/**
 * 构造工具的输出声明。
 *
 * 关键安全约束：`structuredContent` 必须保持**可选**（required 只写 `content`）。
 * 原因见 dsh-tools/lib/index.js:3543——它会拿这里的 schema 去校验每次调用的
 * 真实返回值，不合法就抛 ToolOutputError，工具调用当场失败。而上游 MCP 的
 * `structuredContent` 在 `isError: true` 或纯文本结果时可能缺席，若把它写成
 * required，那些正常结果就会被判为非法输出。
 *
 * 因此：有安全的上游 outputSchema 时，把它放进 properties 作为可选约束
 * （校验器会校验「若存在则须合规」，缺省不算违规）；否则退回原来的宽松 schema。
 *
 * @param candidate - 上游 outputSchema。
 * @param render - 渲染函数。
 * @returns `defineTool`/registry 需要的 output 对象。
 */
export function buildOutput(candidate, render) {
  const structured = safeStructuredSchema(candidate);
  return {
    schema: {
      type: 'object',
      properties: {
        content: { type: 'array', items: {} },
        structuredContent: structured === undefined ? {} : structured,
      },
      required: ['content'],
      additionalProperties: false,
    },
    render,
  };
}
