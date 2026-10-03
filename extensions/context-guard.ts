import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

/**
 * context-guard — 智慧雙水位線預熱與 Plan 錨定結構化壓縮保護器
 *
 * 審查加固版：
 * 1. 雙水位線機制：
 *    - 60% 水位 (WARM_RATIO)：標記狀態與 UI 狀態提醒。
 *    - 70% 水位 (TRIGGER_RATIO)：執行 ctx.compact({ customInstructions }) 結構化壓縮。
 *    - 30% 水位 (RESET_RATIO)：回落至此水位以下重新武裝 (armed = true)。
 * 2. Plan-Aware 提示詞：固定骨架（Goal、Plan、Milestone、改動檔案、避坑紀錄）。
 * 3. 嚴格隔離與防重入：
 *    - 單純通知不強加 triggerTurn，避免重入或多餘對話輪次。
 *    - 安全錯誤處理（防範 error 為非 Error 物件）。
 */

const MARKER = "context-guard";
const RESET_RATIO = 0.3;
const WARM_RATIO = 0.6;

let enabled = true;
let triggerRatio = 0.7;
/** Override with CYUH_PI_KIT_CONTEXT_PROVIDERS (comma/space list). */
function loadGuardedProviders(): Set<string> {
	const raw = process.env.CYUH_PI_KIT_CONTEXT_PROVIDERS || "";
	const parts = raw
		.split(/[,\s]+/)
		.map((s) => s.trim())
		.filter(Boolean);
	if (parts.length > 0) return new Set(parts);
	return new Set([
		"omlx",
		"ycbwin",
		"YCBWIN_TRIAL",
		"anthropic",
		"openai",
		"openrouter",
		"google",
	]);
}
let guardedProviders = loadGuardedProviders();
let armed = true;
let compacting = false;
let isWarmed = false;
let lastTokens: number | null = null;
let lastWindow: number | null = null;

function isGuardedProvider(ctx: ExtensionContext): boolean {
	return Boolean(ctx.model && guardedProviders.has(ctx.model.provider));
}

function ratioLabel(tokens: number, window: number): string {
	return `${Math.round((tokens / window) * 100)}% (${tokens.toLocaleString()}/${window.toLocaleString()})`;
}

const PLAN_AWARE_COMPACT_INSTRUCTIONS = `
You are performing structured compaction for the coding agent.
Preserve the following core skeleton with zero ambiguity:
1. [GOAL & CONFIRMED PLAN]: The original goal, confirmed plan steps (from confirm_plan or user consensus), and current execution status.
2. [COMPLETED MILESTONES & DECISIONS]: Exact milestones finished, architecture decisions made, verified API conventions, and constraints.
3. [MODIFIED ARTIFACTS & PATHS]: Exact file paths created or edited, key function exports touched, and temporary log paths.
4. [FAILURES & FIXES]: Non-obvious errors/pitfalls encountered and how they were resolved (to prevent repetitive mistakes).
5. [NEXT IMMEDIATE ACTIONS]: The exact remaining steps required to finish the overarching goal.

Omit repetitive tool output traces, verbose raw logs, and transient conversational chatter. Keep it dense, structured, and factual.
`.trim();

function triggerCompaction(ctx: ExtensionContext, reason: string): void {
	if (compacting) return;
	compacting = true;
	armed = false;
	isWarmed = false;

	if (ctx.hasUI) {
		ctx.ui.notify(`${MARKER}: ${reason}，開始 Plan-Aware 結構化壓縮`, "warning");
		ctx.ui.setStatus(MARKER, ctx.ui.theme.fg("warning", "compacting…"));
	}

	ctx.compact({
		customInstructions: PLAN_AWARE_COMPACT_INSTRUCTIONS,
		onComplete: () => {
			compacting = false;
			lastTokens = null;
			if (ctx.hasUI) {
				ctx.ui.notify(`${MARKER}: 壓縮完成，已固化 Plan 與關鍵骨架`, "info");
				ctx.ui.setStatus(
					MARKER,
					ctx.ui.theme.fg("dim", "guard:") +
						ctx.ui.theme.fg("success", `${Math.round(triggerRatio * 100)}%`),
				);
			}
		},
		onError: (error) => {
			compacting = false;
			armed = false; // 失敗時鎖定，避免下個 turn_end 立即引發無窮重試風暴
			const errMsg = error instanceof Error ? error.message : String(error);
			if (ctx.hasUI) {
				ctx.ui.notify(`${MARKER}: compaction 失敗：${errMsg}`, "error");
				ctx.ui.setStatus(MARKER, ctx.ui.theme.fg("error", "guard:latched"));
			}
		},
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		armed = true;
		compacting = false;
		isWarmed = false;
		lastTokens = null;
		lastWindow = ctx.model?.contextWindow ?? null;
		if (ctx.hasUI) {
			ctx.ui.setStatus(
				MARKER,
				enabled
					? ctx.ui.theme.fg("dim", "guard:") +
							ctx.ui.theme.fg("success", `${Math.round(triggerRatio * 100)}%`)
					: undefined,
			);
		}
	});

	pi.on("model_select", (_event, ctx) => {
		armed = true;
		compacting = false;
		isWarmed = false;
		lastTokens = null;
		lastWindow = ctx.model?.contextWindow ?? null;
	});

	pi.on("turn_end", (_event, ctx) => {
		if (!enabled || compacting || !isGuardedProvider(ctx) || !ctx.model) return;

		const usage = ctx.getContextUsage();
		const tokens = usage?.tokens;
		const window = ctx.model.contextWindow;
		if (
			tokens === undefined ||
			!Number.isFinite(tokens) ||
			!Number.isFinite(window) ||
			window <= 0
		)
			return;

		lastTokens = tokens;
		lastWindow = window;
		const ratio = tokens / window;

		if (ratio < RESET_RATIO) {
			armed = true;
			isWarmed = false;
			return;
		}

		if (ratio >= WARM_RATIO && ratio < triggerRatio && !isWarmed) {
			isWarmed = true;
			if (ctx.hasUI) {
				ctx.ui.setStatus(
					MARKER,
					ctx.ui.theme.fg("dim", "guard:") +
						ctx.ui.theme.fg("warning", `warm ${Math.round(ratio * 100)}%`),
				);
			}
		}

		if (ratio >= triggerRatio && armed) {
			triggerCompaction(
				ctx,
				`${ctx.model.provider}/${ctx.model.id} context ${ratioLabel(tokens, window)}，已達 ${Math.round(triggerRatio * 100)}% 門檻`,
			);
		}
	});

	pi.registerCommand("ctx-guard", {
		description: "控制 model context 雙水位線預熱與 Plan-Aware compaction",
		handler: async (args, ctx) => {
			const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
			const command = parts[0] ?? "status";

			if (command === "status") {
				const usage =
					lastTokens !== null && lastWindow !== null
						? ratioLabel(lastTokens, lastWindow)
						: "尚無資料";
				ctx.ui.notify(
					`${MARKER}: ${enabled ? "on" : "off"} · trigger ${Math.round(triggerRatio * 100)}% (warm at ${Math.round(WARM_RATIO * 100)}%) · reset ${Math.round(RESET_RATIO * 100)}% · ${armed ? "armed" : "latched"} · usage ${usage} · providers [${[...guardedProviders].join(", ")}]`,
					"info",
				);
				return;
			}

			if (command === "on" || command === "off") {
				enabled = command === "on";
				if (enabled) armed = true;
				ctx.ui.setStatus(
					MARKER,
					enabled
						? ctx.ui.theme.fg("muted", `[guard:${Math.round(triggerRatio * 100)}%]`)
						: undefined,
				);
				ctx.ui.notify(`${MARKER}: ${enabled ? "on" : "off"}`, "info");
				return;
			}

			if (command === "ratio") {
				const value = Number(parts[1]);
				if (!Number.isFinite(value) || value < 0.35 || value > 0.9) {
					ctx.ui.notify(`${MARKER}: ratio 必須介於 0.35–0.90`, "error");
					return;
				}
				triggerRatio = value;
				armed = true;
				ctx.ui.setStatus(
					MARKER,
					ctx.ui.theme.fg("muted", `[guard:${Math.round(triggerRatio * 100)}%]`),
				);
				ctx.ui.notify(
					`${MARKER}: trigger 改為 ${Math.round(triggerRatio * 100)}%`,
					"info",
				);
				return;
			}

			if (command === "compact") {
				triggerCompaction(ctx, "手動觸發");
				return;
			}

			if (command === "providers" && parts.length >= 2) {
				guardedProviders = new Set(parts.slice(1));
				armed = true;
				ctx.ui.notify(
					`${MARKER}: providers [${[...guardedProviders].join(", ")}]`,
					"info",
				);
				return;
			}

			ctx.ui.notify(
				`用法：/ctx-guard [status|on|off|ratio 0.80|compact|providers p1 p2]`,
				"warning",
			);
		},
	});
}
