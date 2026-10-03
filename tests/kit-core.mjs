import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const autoContinue = readFileSync(resolve(root, "extensions/auto-continue.ts"), "utf8");
const contextGuard = readFileSync(resolve(root, "extensions/context-guard.ts"), "utf8");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

function sliceBalancedBlock(source, openBrace) {
	assert.equal(source[openBrace], "{", "expected an opening brace");
	let depth = 0;
	let quote = null;
	let escaped = false;
	let lineComment = false;
	let blockComment = false;
	for (let index = openBrace; index < source.length; index += 1) {
		const character = source[index];
		const next = source[index + 1];
		if (lineComment) {
			if (character === "\n") lineComment = false;
			continue;
		}
		if (blockComment) {
			if (character === "*" && next === "/") {
				blockComment = false;
				index += 1;
			}
			continue;
		}
		if (quote) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === quote) quote = null;
			continue;
		}
		if (character === "/" && next === "/") {
			lineComment = true;
			index += 1;
			continue;
		}
		if (character === "/" && next === "*") {
			blockComment = true;
			index += 1;
			continue;
		}
		if (character === "'" || character === '"' || character === "`") {
			quote = character;
			continue;
		}
		if (character === "{") depth += 1;
		if (character === "}") {
			depth -= 1;
			if (depth === 0) return source.slice(openBrace, index + 1);
		}
	}
	assert.fail("unbalanced function block");
}

function sliceNamedFunction(source, name) {
	const marker = `function ${name}`;
	const start = source.indexOf(marker);
	assert.notEqual(start, -1, `missing ${marker}`);
	const openBrace = source.indexOf("{", start + marker.length);
	assert.notEqual(openBrace, -1, `missing body for ${marker}`);
	return source.slice(start, openBrace) + sliceBalancedBlock(source, openBrace);
}

function sliceEventHandler(source, eventName) {
	const registration = `pi.on("${eventName}"`;
	const start = source.indexOf(registration);
	assert.notEqual(start, -1, `missing ${registration}`);
	const arrow = source.indexOf("=>", start);
	assert.notEqual(arrow, -1, `missing callback for ${registration}`);
	const openBrace = source.indexOf("{", arrow);
	assert.notEqual(openBrace, -1, `missing callback body for ${registration}`);
	return source.slice(arrow, openBrace) + sliceBalancedBlock(source, openBrace);
}

test("package is named as a full client kit, not a single feature", () => {
	assert.equal(pkg.name, "@cyuh/pi-kit");
	assert.ok(Array.isArray(pkg.pi?.extensions));
	assert.ok(pkg.pi.extensions.length >= 5);
	assert.ok(pkg.pi.extensions.every((p) => p.startsWith("./extensions/")));
});

test("auto-continue loads providers from env with safe defaults", () => {
	assert.match(autoContinue, /CYUH_PI_KIT_PREMATURE_PROVIDERS/);
	assert.match(autoContinue, /PI_AUTO_CONTINUE_PROVIDERS/);
	assert.match(autoContinue, /DEFAULT_PREMATURE_PROVIDERS/);
	assert.match(autoContinue, /omlx/);
	assert.match(autoContinue, /YCBWIN_TRIAL/);
	assert.match(autoContinue, /loadPrematureProviders/);
	assert.match(autoContinue, /empty-after-truncated-write/);
	assert.match(autoContinue, /const MAX_CONTINUES\s*=\s*5\b/);
	assert.doesNotMatch(autoContinue, /\/Users\/cyuh/);
});

test("session_compact defers the compact nudge", () => {
	const handler = sliceEventHandler(autoContinue, "session_compact");
	assert.match(handler, /setTimeout\s*\(\s*\(\)\s*=>\s*compactNudge\(pi,\s*ctx\)\s*,\s*50\s*\)/);
	assert.match(
		handler,
		/if\s*\(\s*\(event\s+as\s+\{\s*willRetry\?:\s*boolean\s*\}\)\.willRetry\s*\)\s*return\s*;/,
	);
});

test("compactNudge is provider-agnostic", () => {
	const compactBody = sliceNamedFunction(autoContinue, "compactNudge");
	assert.doesNotMatch(compactBody, /allowsPrematureStopNudge/);
	assert.doesNotMatch(compactBody, /__piLoopActive/);
	assert.match(compactBody, /MAX_COMPACT_CONTINUES/);
});

test("/auto-continue reset clears both budgets", () => {
	const commandStart = autoContinue.indexOf('pi.registerCommand("auto-continue"');
	assert.notEqual(commandStart, -1);
	const command = autoContinue.slice(commandStart);
	const resetStart = command.indexOf('cmd === "reset"');
	assert.notEqual(resetStart, -1);
	const resetBlock = command.slice(resetStart, resetStart + 200);
	assert.match(resetBlock, /continueCount\s*=\s*0/);
	assert.match(resetBlock, /compactContinueCount\s*=\s*0/);
});

test("context-guard includes trial provider and env override", () => {
	assert.match(contextGuard, /YCBWIN_TRIAL/);
	assert.match(contextGuard, /CYUH_PI_KIT_CONTEXT_PROVIDERS/);
	assert.match(contextGuard, /const RESET_RATIO\s*=\s*0\.3\b/);
	assert.match(contextGuard, /const WARM_RATIO\s*=\s*0\.6\b/);
	assert.doesNotMatch(contextGuard, /\/Users\/cyuh/);
});
