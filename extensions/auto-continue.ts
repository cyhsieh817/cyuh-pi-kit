/**
 * auto-continue — quiet continuation so Pi tasks finish without babysitting.
 *
 * Part of @cyuh/pi-kit (client pack). Portable: no host paths, no internal fleet deps.
 *
 * Why: pi does not retry threshold/manual compaction after session_compact.
 * Compaction-driven continuation applies to every provider. Local / trial models can
 * also narrate "next I will…" and stop (or end empty after tools), so premature-stop
 * heuristics cover a configurable provider allow-list.
 *
 * Scope:
 *   - compact-driven continuation: every provider
 *   - premature-stop continuation: allow-list (env or defaults)
 *   - max 5 auto-continues per real user turn
 *   - length truncation always continues
 *   - premature-stop heuristics (plan-to-continue language, unfinished markers,
 *     empty/short wrap-up after tools, truncated write bodies)
 *   - skips when the model is clearly waiting for the user, or looks done
 *
 * Config (optional):
 *   CYUH_PI_KIT_PREMATURE_PROVIDERS  comma/space list, e.g. "omlx,YCBWIN_TRIAL,openai"
 *   PI_AUTO_CONTINUE_PROVIDERS       alias of the above
 *   Default: omlx,YCBWIN_TRIAL
 *
 * Control:
 *   /auto-continue          status
 *   /auto-continue on|off   toggle for this process
 *   /auto-continue reset    clear continue counter
 *
 * Placement: via `pi install` package, or copy into ~/.pi/agent/extensions/.
 * Reload with /reload after install.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

declare global {
	// Soft cooperation with optional /loop extensions — never required.
	// eslint-disable-next-line no-var
	var __piLoopActive: boolean | undefined;
}

const MAX_CONTINUES = 5;
const MARKER = "[auto-continue]";
const DEFAULT_PREMATURE_PROVIDERS = ["omlx", "YCBWIN_TRIAL"];

function loadPrematureProviders(): Set<string> {
	const raw =
		process.env.CYUH_PI_KIT_PREMATURE_PROVIDERS ||
		process.env.PI_AUTO_CONTINUE_PROVIDERS ||
		"";
	const parts = raw
		.split(/[,\s]+/)
		.map((s) => s.trim())
		.filter(Boolean);
	if (parts.length === 0) return new Set(DEFAULT_PREMATURE_PROVIDERS);
	return new Set(parts);
}

const PREMATURE_STOP_PROVIDERS = loadPrematureProviders();

const CONTINUE_PROMPT =
	`${MARKER} Continue the unfinished task now. ` +
	`Do not summarize progress. Do not restate the plan. ` +
	`Call tools until the original request is verified complete. ` +
	`If a deliverable file was written, read it back: finish incomplete sections; ` +
	`never overwrite a complete file with a shorter incomplete draft. ` +
	`When done, stop with one line: path + size + complete. ` +
	`If you are blocked on a user decision, stop and ask one clear question.`;

/** Model is still planning / deferring work instead of finishing. */
const INCOMPLETE_RE =
	/(接下來|下一步|我會|我將|稍後|待會|尚未完成|還沒[有完]|繼續完成|待辦|未完成|to be continued|\bi will (now|next|continue|proceed)\b|\bi'll (now|next|continue)\b|\blet me (now |next )?continue\b|\bnext[,:]?\s+i (will|'ll)\b|\bstill need(s|ed)? to\b|\bremaining (steps?|work|tasks?)\b|\btodo\b|\bnot (yet |fully )?done\b|\bpartially (done|complete)\b|\bcontinue (from|with|working)\b)/i;

/** Model is asking the user — do not auto-nudge. */
const WAITING_RE =
	/(請問|是否要|要我|你希望|請確認|請告訴我|需要你|等你|which (option|one)|should i\b|do you want|would you like|please confirm|your (choice|preference)|awaiting (your|user))/i;

/** Strong completion signals — prefer settle. */
const DONE_RE =
	/(已完成|全部完成|任務完成|驗證通過|驗收通過|\ball (done|complete|set)\b|\btask (is )?complete\b|\bcompleted successfully\b|\bverification passed\b|\bnothing (else|more) to do\b|\bno further action\b|path\s*[:：].*complete|\bcomplete\b.*\b(bytes?|chars?|lines?)\b)/i;

type AssistantLike = {
	role?: string;
	stopReason?: string;
	content?: Array<{ type?: string; text?: string; name?: string; arguments?: unknown }>;
	errorMessage?: string;
};

type UserLike = {
	role?: string;
	content?: string | Array<{ type?: string; text?: string }>;
};

let enabled = true;
let continueCount = 0;
let lastNudgeAt = 0;
// Compaction-driven continues get their own budget: a long task can trigger
// several threshold compactions, each of which legitimately needs one nudge.
let compactContinueCount = 0;
const MAX_COMPACT_CONTINUES = 8;

function allowsPrematureStopNudge(ctx: ExtensionContext): boolean {
	const provider = ctx.model?.provider;
	return typeof provider === "string" && PREMATURE_STOP_PROVIDERS.has(provider);
}

function providerAllowListLabel(): string {
	return [...PREMATURE_STOP_PROVIDERS].join(",") || "(empty)";
}

function textOf(message: AssistantLike | UserLike | undefined): string {
	if (!message) return "";
	const content = (message as UserLike).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => part && (part.type === "text" || part.type === undefined) && typeof part.text === "string")
		.map((part) => part.text as string)
		.join("\n");
}

function lastAssistant(messages: unknown[]): AssistantLike | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i] as AssistantLike;
		if (msg?.role === "assistant") return msg;
	}
	return undefined;
}

function runHadTools(messages: unknown[]): boolean {
	for (const raw of messages) {
		const msg = raw as AssistantLike;
		if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;
		if (msg.content.some((part) => part?.type === "toolCall" || part?.type === "tool_use")) {
			return true;
		}
	}
	return false;
}

function lastWriteToolContent(messages: unknown[]): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i] as AssistantLike;
		if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;
		for (let j = msg.content.length - 1; j >= 0; j--) {
			const part = msg.content[j];
			if (!part || (part.type !== "toolCall" && part.type !== "tool_use")) continue;
			const name = (part.name || "").toLowerCase();
			if (name !== "write" && name !== "create" && name !== "write_file") continue;
			const args = part.arguments;
			if (typeof args === "string") {
				try {
					const parsed = JSON.parse(args) as { content?: unknown };
					return typeof parsed.content === "string" ? parsed.content : "";
				} catch {
					return args;
				}
			}
			if (args && typeof args === "object" && typeof (args as { content?: unknown }).content === "string") {
				return (args as { content: string }).content;
			}
			return "";
		}
	}
	return null;
}

function looksLikeTruncatedDeliverable(body: string): boolean {
	const text = body.trimEnd();
	if (text.length < 40) return true;
	// Mid-sentence / open colon endings common when a rewrite clobbers a full draft.
	if (/[:：]\s*$/.test(text)) return true;
	if (/[，、,]\s*$/.test(text)) return true;
	// Very short "article" after a write is almost never complete.
	if (text.length < 800 && !DONE_RE.test(text)) return true;
	return false;
}

function isOurContinue(text: string): boolean {
	return text.trimStart().startsWith(MARKER);
}

function looksIncomplete(
	assistant: AssistantLike,
	hadTools: boolean,
	messages: unknown[],
): { yes: boolean; reason: string } {
	const stop = assistant.stopReason ?? "stop";

	if (stop === "error" || stop === "aborted") {
		return { yes: false, reason: stop };
	}
	if (stop === "length") {
		return { yes: true, reason: "length" };
	}

	const text = textOf(assistant).trim();
	if (!text) {
		// Empty final text after tools is often a broken local/trial turn
		// (e.g. write succeeded then stop with content=[]).
		if (hadTools) {
			const written = lastWriteToolContent(messages);
			if (written !== null && looksLikeTruncatedDeliverable(written)) {
				return { yes: true, reason: "empty-after-truncated-write" };
			}
			return { yes: true, reason: "empty-after-tools" };
		}
		return { yes: false, reason: "empty" };
	}

	if (WAITING_RE.test(text)) {
		return { yes: false, reason: "waiting-user" };
	}
	if (DONE_RE.test(text) && !INCOMPLETE_RE.test(text)) {
		return { yes: false, reason: "done" };
	}

	if (INCOMPLETE_RE.test(text)) {
		return { yes: true, reason: "incomplete-language" };
	}

	// Trailing ellipsis / ":" after tool work often means deferred next step.
	if (hadTools && /([:：…]|\.\.\.)\s*$/.test(text) && text.length < 1200) {
		return { yes: true, reason: "trailing-defer" };
	}

	// Tool work then a very short wrap-up with no done signal — common local bail-out.
	if (hadTools && text.length < 280 && !DONE_RE.test(text)) {
		// Avoid nudging pure status ACKs that look finished enough.
		if (/^(ok|done|好|完成)[.!。！\s]*$/i.test(text)) {
			return { yes: false, reason: "short-ack" };
		}
		return { yes: true, reason: "short-after-tools" };
	}

	return { yes: false, reason: "complete-enough" };
}

function maybeNudge(pi: ExtensionAPI, ctx: ExtensionContext, messages: unknown[]): void {
	if (!enabled) return;
	// Subagent children are short isolated runs; never auto-nudge them.
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	// Optional /loop owns multi-turn continue when armed — avoid double-nudge.
	if (globalThis.__piLoopActive) return;
	if (!allowsPrematureStopNudge(ctx)) return;
	if (ctx.hasPendingMessages?.()) return;

	const assistant = lastAssistant(messages);
	if (!assistant) return;

	const hadTools = runHadTools(messages);
	const verdict = looksIncomplete(assistant, hadTools, messages);
	if (!verdict.yes) return;

	if (continueCount >= MAX_CONTINUES) {
		// Only speak when giving up — still quiet otherwise.
		ctx.ui.notify(
			`auto-continue: hit ${MAX_CONTINUES}x limit (${verdict.reason}). Say "continue" or /auto-continue reset.`,
			"warning",
		);
		return;
	}

	// Debounce double-fires from overlapping end events.
	const now = Date.now();
	if (now - lastNudgeAt < 400) return;
	lastNudgeAt = now;

	continueCount += 1;
	pi.sendUserMessage(CONTINUE_PROMPT, { deliverAs: "followUp" });
}

/**
 * Snapshot the last assistant message text straight from the session file.
 * Best-effort: used only to avoid nudging when the model is clearly asking
 * the user a question right after a compaction.
 */
function lastAssistantText(ctx: ExtensionContext): string {
	try {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i] as { type?: string; message?: unknown };
			if (entry?.type !== "message") continue;
			const msg = (entry as { message: unknown }).message;
			if (msg && (msg as { role?: string }).role === "assistant") {
				return textOf(msg as unknown as AssistantLike);
			}
		}
	} catch {
		/* session snapshot is best-effort; ignore and keep going */
	}
	return "";
}

/**
 * After an autocompaction pi will NOT auto-retry (willRetry=false), the model
 * frequently emits a progress summary and stops — leaving the task unfinished.
 * Force a continue here so the task resumes right after compaction.
 */
function compactNudge(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (!enabled) return;
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	if (ctx.hasPendingMessages?.()) return;

	// If the model is explicitly asking the user, let it wait for the answer.
	if (WAITING_RE.test(lastAssistantText(ctx))) return;

	if (compactContinueCount >= MAX_COMPACT_CONTINUES) {
		ctx.ui.notify(
			`auto-continue: compaction nudge limit (${MAX_COMPACT_CONTINUES}x) reached. Say "continue" or /auto-continue reset.`,
			"warning",
		);
		return;
	}

	const now = Date.now();
	if (now - lastNudgeAt < 400) return;
	lastNudgeAt = now;

	compactContinueCount += 1;
	pi.sendUserMessage(CONTINUE_PROMPT, { deliverAs: "followUp" });
}

export default function (pi: ExtensionAPI) {
	// Real user turns reset the budget; our own continue markers do not.
	pi.on("message_end", async (event) => {
		const msg = event.message as UserLike;
		if (msg?.role !== "user") return;
		const text = textOf(msg);
		if (!text || isOurContinue(text)) return;
		continueCount = 0;
	});

	pi.on("session_start", async () => {
		continueCount = 0;
		compactContinueCount = 0;
		lastNudgeAt = 0;
	});

	pi.on("agent_end", async (event, ctx) => {
		maybeNudge(pi, ctx, event.messages ?? []);
	});

	// Autocompact handler: after a compaction pi is NOT going to auto-retry
	// (willRetry=false), the model tends to summarize and stop. Nudge it.
	// Overflow-recovery (willRetry=true) is retried by pi itself — do not double-prompt.
	pi.on("session_compact", (event, ctx) => {
		if ((event as { willRetry?: boolean }).willRetry) return;
		setTimeout(() => compactNudge(pi, ctx), 50);
	});

	pi.registerCommand("auto-continue", {
		description: "Toggle/status for quiet auto-continue (cyuh-pi-kit)",
		handler: async (args, ctx) => {
			const cmd = (args ?? "").trim().toLowerCase();
			if (!cmd || cmd === "status") {
				ctx.ui.notify(
					`auto-continue: ${enabled ? "on" : "off"} · count ${continueCount}/${MAX_CONTINUES} · provider ${ctx.model?.provider ?? "none"} · premature=${providerAllowListLabel()}`,
					"info",
				);
				return;
			}
			if (cmd === "on" || cmd === "enable") {
				enabled = true;
				ctx.ui.notify("auto-continue: on", "info");
				return;
			}
			if (cmd === "off" || cmd === "disable") {
				enabled = false;
				ctx.ui.notify("auto-continue: off", "info");
				return;
			}
			if (cmd === "reset") {
				continueCount = 0;
				compactContinueCount = 0;
				ctx.ui.notify("auto-continue: counter reset", "info");
				return;
			}
			ctx.ui.notify("Usage: /auto-continue [status|on|off|reset]", "warning");
		},
	});
}
