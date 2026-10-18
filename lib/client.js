window.__ModuleLoader__.load({
	id: "dsh-mt-mcp",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let jsx_runtime = require("react/jsx-runtime");
		//#endregion
		//#region src/client/locales.ts
		/** 文案命名空间。 */
		const LOCALE_NAMESPACE = "mt-mcp";
		/** 中英文案。key 与使用处一一对应。 */
		const LOCALES = {
			zh: {
				"title": "MT 管理器 MCP",
				"loading": "加载中…",
				"status.unconfigured": "未配置地址 — 在 MT 里打开「侧拉栏 → 工具 → MCP 服务 → 启动」，把显示的本机或局域网地址填到下面。",
				"status.connected": "已连接",
				"status.disconnected": "未连接",
				"status.line": "{url} · {state} · 工具 {count} 个",
				"intro": "连接手机上的 MT 管理器：MT 内「侧拉栏 → 工具 → MCP 服务 → 启动」，复制它显示的「局域网地址」（形如 http://192.168.1.23:8787/mcp，必须带末尾 /mcp）填到下面。DSH 跑在电脑上，所以用局域网地址，不要用 127.0.0.1。地址随时可改，保存后立即重连。",
				"field.url": "MCP 地址",
				"field.urlPlaceholder": "http://192.168.1.23:8787/mcp",
				"field.tokenSet": "Bearer 令牌（已设置 {masked}，留空保持不变）",
				"field.tokenUnset": "Bearer 令牌（MT 默认不启用认证，留空即可）",
				"field.tokenPlaceholderUnset": "未设置",
				"field.tokenPlaceholderKeep": "留空保持不变",
				"button.save": "保存并连接",
				"button.reconnect": "重新连接",
				"button.clearToken": "清除令牌",
				"tools.found": "已发现的 MT 工具（{count}）：",
				"config.path": "地址与令牌保存在 {path}（权限 0600）。",
				"confirm.clearToken": "清除已保存的 MT Bearer 令牌吗？清除后若 MT 开启了认证，连接会失败。",
				"msg.cancelled": "已取消。",
				"msg.statusFailed": "读取状态失败: {error}",
				"msg.actionFailed": "操作失败: {error}",
				"msg.networkFailed": "网络请求失败: {error}",
				"msg.invalidJson": "HTTP {status}: 响应不是 JSON",
				"msg.savedConnected": "已保存并连接，发现 {count} 个 MT 工具。",
				"msg.savedNotConnected": "已保存，但未连接：{reason}",
				"msg.reconnected": "连接成功，发现 {count} 个 MT 工具。",
				"msg.connectFailed": "连接失败：{reason}",
				"msg.tokenCleared": "已清除保存的令牌。",
				"msg.seeStatus": "详见上方状态行",
				"nav.label": "MT 管理器"
			},
			en: {
				"title": "MT Manager MCP",
				"loading": "Loading…",
				"status.unconfigured": "No address configured — in MT open “sidebar → Tools → MCP Service → Start” and paste the address it shows below.",
				"status.connected": "connected",
				"status.disconnected": "disconnected",
				"status.line": "{url} · {state} · {count} tools",
				"intro": "Connect to MT Manager on your phone: in MT open “sidebar → Tools → MCP Service → Start”, then copy the LAN address it shows (like http://192.168.1.23:8787/mcp — the trailing /mcp matters) into the field below. DSH runs on your computer, so use the LAN address, not 127.0.0.1. You can change it any time; saving reconnects immediately.",
				"field.url": "MCP address",
				"field.urlPlaceholder": "http://192.168.1.23:8787/mcp",
				"field.tokenSet": "Bearer token (currently {masked}; leave empty to keep it)",
				"field.tokenUnset": "Bearer token (MT has auth off by default; leave empty)",
				"field.tokenPlaceholderUnset": "not set",
				"field.tokenPlaceholderKeep": "leave empty to keep",
				"button.save": "Save and connect",
				"button.reconnect": "Reconnect",
				"button.clearToken": "Clear token",
				"tools.found": "Discovered MT tools ({count}): ",
				"config.path": "Address and token are stored in {path} (mode 0600).",
				"confirm.clearToken": "Clear the saved MT bearer token? If MT has authentication enabled, the connection will fail.",
				"msg.cancelled": "Cancelled.",
				"msg.statusFailed": "Could not read status: {error}",
				"msg.actionFailed": "Action failed: {error}",
				"msg.networkFailed": "Network request failed: {error}",
				"msg.invalidJson": "HTTP {status}: response was not JSON",
				"msg.savedConnected": "Saved and connected; {count} MT tools discovered.",
				"msg.savedNotConnected": "Saved, but not connected: {reason}",
				"msg.reconnected": "Connected; {count} MT tools discovered.",
				"msg.connectFailed": "Connection failed: {reason}",
				"msg.tokenCleared": "Saved token cleared.",
				"msg.seeStatus": "see the status line above",
				"nav.label": "MT Manager"
			}
		};
		/** 当前语言字典；register 成功后由 translate 使用。 */
		let activeDict = LOCALES.zh;
		/** 把 {name} 占位符替换成参数。 */
		function format(text, params) {
			if (params === undefined) return text;
			return text.replace(/\{(\w+)\}/g, (whole, name) =>
				Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole);
		}
		/** 取一条文案；参数用 {name} 插值。 */
		function t(key, params) {
			const dict = activeDict ?? LOCALES.zh;
			const text = dict[key] ?? LOCALES.zh[key] ?? key;
			return format(text, params);
		}
		//#endregion
		//#region src/client/api.ts
		/** 路由表，与 Host 半保持一致。 */
		const API = {
			status: "/api/dsh-mt-mcp/status",
			save: "/api/dsh-mt-mcp/save",
			connect: "/api/dsh-mt-mcp/connect"
		};
		/** 错误文案。 */
		function describe(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/** 一个 JSON 请求；非 2xx 或非 JSON 时抛出带原因的 Error。 */
		async function request(path, init) {
			let response;
			try {
				response = await fetch(path, init);
			} catch (error) {
				throw new Error(t("msg.networkFailed", { error: describe(error) }));
			}
			let body;
			try {
				body = await response.json();
			} catch {
				throw new Error(t("msg.invalidJson", { status: response.status }));
			}
			if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${response.status}`);
			return body;
		}
		/** 提交 JSON 请求体。 */
		function postJson(path, payload) {
			return request(path, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload ?? {})
			});
		}
		//#endregion
		//#region src/client/MtMcpPanel.tsx
		/** 共享样式（跟随主题，只做尺寸与弱化边框）。 */
		const s = {
			card: {
				display: "flex",
				flexDirection: "column",
				gap: "10px",
				maxWidth: "620px",
				padding: "14px 16px",
				borderRadius: "10px",
				border: "1px solid rgba(128,128,128,0.3)",
				fontSize: "13px",
				color: "inherit"
			},
			title: {
				fontWeight: 600,
				fontSize: "13px",
				margin: 0
			},
			status: {
				fontSize: "12px",
				opacity: .85
			},
			statusWarn: {
				fontSize: "12px",
				opacity: .9,
				color: "#c9763a"
			},
			row: {
				display: "flex",
				gap: "6px",
				alignItems: "center",
				flexWrap: "wrap"
			},
			field: {
				display: "flex",
				flexDirection: "column",
				gap: "4px"
			},
			label: {
				fontSize: "12px",
				opacity: .8
			},
			input: {
				width: "100%",
				boxSizing: "border-box",
				padding: "5px 8px",
				borderRadius: "6px",
				border: "1px solid rgba(128,128,128,0.35)",
				background: "rgba(128,128,128,0.08)",
				color: "inherit",
				fontSize: "12px"
			},
			button: {
				padding: "5px 10px",
				borderRadius: "6px",
				border: "1px solid rgba(128,128,128,0.35)",
				background: "rgba(128,128,128,0.12)",
				color: "inherit",
				fontSize: "12px",
				cursor: "pointer"
			},
			msg: {
				fontSize: "12px",
				whiteSpace: "pre-wrap",
				wordBreak: "break-all",
				opacity: .9
			},
			hint: {
				fontSize: "11px",
				opacity: .75,
				lineHeight: 1.6
			}
		};
		/** 一行状态摘要。 */
		function statusText(view) {
			if (view === null) return t("loading");
			if ((view.url ?? "") === "") return t("status.unconfigured");
			const state = view.connected ? t("status.connected") : t("status.disconnected");
			let line = t("status.line", { url: view.url, state, count: view.toolCount ?? 0 });
			if (view.error) line += ` · ${view.error}`;
			return line;
		}
		/** 设置页里的「MT 管理器」面板。 */
		function MtMcpSettingsPanel() {
			const [view, setView] = react.useState(null);
			const [urlDraft, setUrlDraft] = react.useState("");
			const [tokenDraft, setTokenDraft] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [msg, setMsg] = react.useState("");
			const seeded = react.useRef(false);
			const refreshStatus = react.useCallback(async () => {
				try {
					const next = await request(API.status);
					setView(next);
					if (!seeded.current) {
						seeded.current = true;
						setUrlDraft(next.url ?? "");
					}
				} catch (error) {
					setMsg("读取状态失败: " + describe(error));
				}
			}, []);
			react.useEffect(() => {
				refreshStatus();
			}, [refreshStatus]);
			react.useEffect(() => {
				const onFocus = () => {
					refreshStatus();
				};
				window.addEventListener("focus", onFocus);
				return () => window.removeEventListener("focus", onFocus);
			}, [refreshStatus]);
			/** 执行一个面板动作，统一维护 busy 与提示行。 */
			const run = async (action) => {
				setBusy(true);
				setMsg("");
				try {
					const result = await action();
					if (result !== undefined) setMsg(result.message);
				} catch (error) {
					setMsg(t("msg.actionFailed", { error: describe(error) }));
				} finally {
					setBusy(false);
				}
			};
			const save = () => {
				run(async () => {
					const result = await postJson(API.save, {
						url: urlDraft,
						token: tokenDraft
					});
					setView(result.view);
					setTokenDraft("");
					// 用面板自己的语言拼提示，不直接用 Host 返回的中文 message。
					if (result.ok) return { message: "[ok] " + t("msg.savedConnected", { count: result.view?.toolCount ?? 0 }) };
					const reason = result.error ?? result.view?.error;
					return { message: "[failed] " + t("msg.savedNotConnected", { reason: reason || t("msg.seeStatus") }) };
				});
			};
			const reconnect = () => {
				run(async () => {
					const result = await postJson(API.connect);
					setView(result.view);
					if (result.ok) return { message: "[ok] " + t("msg.reconnected", { count: result.view?.toolCount ?? 0 }) };
					const reason = result.error ?? result.view?.error;
					return { message: "[failed] " + t("msg.connectFailed", { reason: reason || t("msg.seeStatus") }) };
				});
			};
			const clearToken = () => {
				run(async () => {
					if (!window.confirm(t("confirm.clearToken"))) return { message: t("msg.cancelled") };
					const result = await postJson(API.save, { clearToken: true });
					setView(result.view);
					return { message: "[ok] " + t("msg.tokenCleared") };
				});
			};
			const configured = view !== null && (view.url ?? "") !== "";
			const tools = view?.tools ?? [];
			return jsx_runtime.jsxs("div", {
				style: s.card,
				children: [
					jsx_runtime.jsx("p", {
						style: s.title,
						children: t("title")
					}),
					jsx_runtime.jsx("div", {
						style: configured ? s.status : s.statusWarn,
						children: statusText(view)
					}),
					jsx_runtime.jsx("div", {
						style: s.hint,
						children: t("intro")
					}),
					jsx_runtime.jsxs("label", {
						style: s.field,
						children: [jsx_runtime.jsx("span", {
							style: s.label,
							children: t("field.url")
						}), jsx_runtime.jsx("input", {
							style: s.input,
							type: "text",
							placeholder: t("field.urlPlaceholder"),
							value: urlDraft,
							onChange: (event) => setUrlDraft(event.target.value)
						})]
					}),
					jsx_runtime.jsxs("label", {
						style: s.field,
						children: [jsx_runtime.jsx("span", {
							style: s.label,
							children: view?.tokenConfigured
								? t("field.tokenSet", { masked: view.tokenMasked })
								: t("field.tokenUnset")
						}), jsx_runtime.jsx("input", {
							style: s.input,
							type: "password",
							placeholder: view?.tokenConfigured
								? t("field.tokenPlaceholderKeep")
								: t("field.tokenPlaceholderUnset"),
							value: tokenDraft,
							onChange: (event) => setTokenDraft(event.target.value)
						})]
					}),
					jsx_runtime.jsxs("div", {
						style: s.row,
						children: [
							jsx_runtime.jsx("button", {
								style: s.button,
								onClick: save,
								disabled: busy,
								children: t("button.save")
							}),
							jsx_runtime.jsx("button", {
								style: s.button,
								onClick: reconnect,
								disabled: busy || !configured,
								children: t("button.reconnect")
							}),
							jsx_runtime.jsx("button", {
								style: s.button,
								onClick: clearToken,
								disabled: busy || !view?.tokenConfigured,
								children: t("button.clearToken")
							})
						]
					}),
					tools.length > 0 && jsx_runtime.jsx("div", {
						style: s.hint,
						children: t("tools.found", { count: tools.length })
							+ tools.slice(0, 12).join(", ")
							+ (tools.length > 12 ? "…" : "")
					}),
					jsx_runtime.jsx("div", {
						style: s.hint,
						children: view?.configPath ? t("config.path", { path: view.configPath }) : ""
					}),
					msg !== "" && jsx_runtime.jsx("div", {
						style: s.msg,
						children: msg
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Required services. */
		const inject = ["slots", "locale"];
		/** 语言服务实例（注册失败时为 null，此时退回中文）。 */
		let localeService = null;
		/** 按 active locale 前缀选字典：zh / zh-cn / zh-hans 都用 zh，其余用 en。 */
		function dictFor(active) {
			if (typeof active !== "string" || active === "") return LOCALES.zh;
			return active.toLowerCase().startsWith("zh") ? LOCALES.zh : LOCALES.en;
		}
		/**
		* Register the MT MCP settings page.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			// locale 在 inject 里声明过，但宿主版本差异可能让它缺席：取不到就退回中文。
			try { localeService = ctx.locale; } catch { localeService = null; }
			if (localeService === null && typeof ctx.get === "function") {
				try { localeService = ctx.get("locale"); } catch { localeService = null; }
			}
			if (localeService !== null && typeof localeService.getLocale === "function") {
				try {
					activeDict = dictFor(localeService.getLocale()?.active);
				} catch { activeDict = LOCALES.zh; }
			}
			if (localeService !== null && typeof localeService.register === "function") {
				try {
					const disposeDictionaries = localeService.register(LOCALE_NAMESPACE, LOCALES);
					if (typeof ctx.effect === "function") {
						ctx.effect(() => disposeDictionaries, "dsh-mt-mcp: dictionaries");
					}
				} catch (error) {
					console.warn("[dsh-mt-mcp] locale registration failed:", error);
				}
			}
			// 语言切换后重算字典。slots 的 label 每个投影都会重新读取，面板靠重渲染跟进。
			if (localeService !== null && typeof localeService.subscribe === "function") {
				const sync = () => {
					try { activeDict = dictFor(localeService.getLocale()?.active); } catch { /* 保持现有字典 */ }
				};
				const unsubscribe = localeService.subscribe(sync);
				if (typeof ctx.effect === "function") {
					ctx.effect(() => unsubscribe, "dsh-mt-mcp: locale subscription");
				}
				sync();
			}
			try {
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "mt-mcp",
					order: 321,
					label: () => t("nav.label")
				}, MtMcpSettingsPanel));
			} catch (error) {
				console.warn("[dsh-mt-mcp] settings panel registration failed:", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
