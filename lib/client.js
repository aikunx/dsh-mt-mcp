window.__ModuleLoader__.load({
	id: "dsh-mt-mcp",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let jsx_runtime = require("react/jsx-runtime");
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
				throw new Error("网络请求失败: " + describe(error));
			}
			let body;
			try {
				body = await response.json();
			} catch {
				throw new Error(`HTTP ${response.status}: 响应不是 JSON`);
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
			if (view === null) return "加载中…";
			if ((view.url ?? "") === "") return "未配置地址 — 在 MT 里打开「侧拉栏 → 工具 → MCP 服务 → 启动」，把显示的本机或局域网地址填到下面。";
			const state = view.connected ? "已连接" : "未连接";
			let line = `${view.url} · ${state} · 工具 ${view.toolCount ?? 0} 个`;
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
					setMsg("操作失败: " + describe(error));
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
					return { message: (result.ok ? "[ok] " : "[failed] ") + result.message };
				});
			};
			const reconnect = () => {
				run(async () => {
					const result = await postJson(API.connect);
					setView(result.view);
					return { message: (result.ok ? "[ok] " : "[failed] ") + result.message };
				});
			};
			const clearToken = () => {
				run(async () => {
					if (!window.confirm("清除已保存的 MT Bearer 令牌吗？清除后若 MT 开启了认证，连接会失败。")) return { message: "已取消。" };
					const result = await postJson(API.save, { clearToken: true });
					setView(result.view);
					return { message: result.message };
				});
			};
			const configured = view !== null && (view.url ?? "") !== "";
			const tools = view?.tools ?? [];
			return jsx_runtime.jsxs("div", {
				style: s.card,
				children: [
					jsx_runtime.jsx("p", {
						style: s.title,
						children: "MT 管理器 MCP"
					}),
					jsx_runtime.jsx("div", {
						style: configured ? s.status : s.statusWarn,
						children: statusText(view)
					}),
					jsx_runtime.jsx("div", {
						style: s.hint,
						children: "连接手机上的 MT 管理器：MT 内「侧拉栏 → 工具 → MCP 服务 → 启动」，复制它显示的「局域网地址」（形如 http://192.168.1.23:8787/mcp，必须带末尾 /mcp）填到下面。DSH 跑在电脑上，所以用局域网地址，不要用 127.0.0.1。地址随时可改，保存后立即重连。"
					}),
					jsx_runtime.jsxs("label", {
						style: s.field,
						children: [jsx_runtime.jsx("span", {
							style: s.label,
							children: "MCP 地址"
						}), jsx_runtime.jsx("input", {
							style: s.input,
							type: "text",
							placeholder: "http://192.168.1.23:8787/mcp",
							value: urlDraft,
							onChange: (event) => setUrlDraft(event.target.value)
						})]
					}),
					jsx_runtime.jsxs("label", {
						style: s.field,
						children: [jsx_runtime.jsx("span", {
							style: s.label,
							children: view?.tokenConfigured ? `Bearer 令牌（已设置 ${view.tokenMasked}，留空保持不变）` : "Bearer 令牌（MT 默认不启用认证，留空即可）"
						}), jsx_runtime.jsx("input", {
							style: s.input,
							type: "password",
							placeholder: view?.tokenConfigured ? "留空保持不变" : "未设置",
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
								children: "保存并连接"
							}),
							jsx_runtime.jsx("button", {
								style: s.button,
								onClick: reconnect,
								disabled: busy || !configured,
								children: "重新连接"
							}),
							jsx_runtime.jsx("button", {
								style: s.button,
								onClick: clearToken,
								disabled: busy || !view?.tokenConfigured,
								children: "清除令牌"
							})
						]
					}),
					tools.length > 0 && jsx_runtime.jsxs("div", {
						style: s.hint,
						children: [
							"已发现的 MT 工具（",
							tools.length,
							"）：",
							tools.slice(0, 12).join("、"),
							tools.length > 12 ? "…" : ""
						]
					}),
					jsx_runtime.jsx("div", {
						style: s.hint,
						children: view?.configPath ? "地址与令牌保存在 " + view.configPath + "（权限 0600）。" : ""
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
		const inject = ["slots"];
		/**
		* Register the MT MCP settings page.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			try {
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "mt-mcp",
					order: 321,
					label: () => "MT 管理器"
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
