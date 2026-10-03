/**
 * Notify when agent fully settles (ready for input).
 * - macOS: osascript display notification
 * - terminals: OSC 777 / Kitty OSC 99
 * Uses agent_settled (not agent_end) so auto-continue/retry doesn't spam.
 *
 * /notify-ready on|off|status|test
 */

import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

let enabled = true;
let lastNotifyAt = 0;

function notifyOSC777(title: string, body: string): void {
	try {
		process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
	} catch {
		/* ignore */
	}
}

function notifyOSC99(title: string, body: string): void {
	try {
		process.stdout.write(`\x1b]99;i=1:d=0;${title}\x1b\\`);
		process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
	} catch {
		/* ignore */
	}
}

function notifyMac(title: string, body: string): void {
	if (process.platform !== "darwin") return;
	const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
	execFile("osascript", ["-e", script], () => {
		/* fire-and-forget */
	});
}

function notify(title: string, body: string): void {
	if (process.env.KITTY_WINDOW_ID) {
		notifyOSC99(title, body);
	} else {
		notifyOSC777(title, body);
	}
	notifyMac(title, body);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("notify-ready", {
		description: "Toggle settle notifications (on|off|status|test)",
		handler: async (args, ctx) => {
			const cmd = (args ?? "").trim().toLowerCase();
			if (!cmd || cmd === "status") {
				ctx.ui.notify(`notify-ready: ${enabled ? "on" : "off"}`, "info");
				return;
			}
			if (cmd === "on") {
				enabled = true;
				ctx.ui.notify("notify-ready: on", "info");
				return;
			}
			if (cmd === "off") {
				enabled = false;
				ctx.ui.notify("notify-ready: off", "info");
				return;
			}
			if (cmd === "test") {
				notify("Pi", "notify-ready test");
				ctx.ui.notify("Sent test notification", "info");
				return;
			}
			ctx.ui.notify("Usage: /notify-ready [status|on|off|test]", "warning");
		},
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!enabled) return;
		const now = Date.now();
		if (now - lastNotifyAt < 1500) return;
		lastNotifyAt = now;

		const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "pi";
		notify("Pi ready", model);
	});
}
