#!/usr/bin/env node
/**
 * cyuh-pi-kit — client pack helper
 *
 *   cyuh-pi-kit install|update|doctor|where
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_GIT = "https://github.com/cyhsieh817/cyuh-pi-kit.git";

function run(cmd, args) {
	console.log("+", cmd, args.join(" "));
	const r = spawnSync(cmd, args, { stdio: "inherit" });
	return r.status ?? 1;
}

function readPkg() {
	return JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
}

function resolveWorkspace() {
	return (
		process.env.PI_KIT_WORKSPACE ||
		process.env.THEVOIDWEAVER_ROOT ||
		process.cwd()
	);
}

function cmdWhere() {
	const pkg = readPkg();
	console.log(
		JSON.stringify(
			{
				package_root: PACKAGE_ROOT,
				workspace: resolveWorkspace(),
				name: pkg.name,
				version: pkg.version,
				pi_extensions: pkg.pi?.extensions?.length ?? 0,
				default_git: DEFAULT_GIT,
			},
			null,
			2,
		),
	);
	return 0;
}

function basenameFromExtRel(rel) {
	const parts = rel.replace(/\\/g, "/").split("/");
	const last = parts[parts.length - 1] || "";
	if (last === "index.ts") return parts[parts.length - 2] || last;
	return last.replace(/\.ts$/, "");
}

function cmdDoctor() {
	const workspace = resolveWorkspace();
	const pkg = readPkg();
	const extDir = join(workspace, ".pi", "extensions");
	const homeExt = join(
		process.env.HOME || process.env.USERPROFILE || "",
		".pi",
		"agent",
		"extensions",
	);
	const dual = [];
	const extList = pkg.pi?.extensions || [];
	const kitNames = new Set(extList.map(basenameFromExtRel));
	// legacy TVW filename that collides with kit auto-continue
	kitNames.add("local-auto-continue");

	function scan(dir, label) {
		if (!dir || !existsSync(dir)) return;
		for (const ent of readdirSync(dir)) {
			const full = join(dir, ent);
			let st;
			try {
				st = statSync(full);
			} catch {
				continue;
			}
			const name = st.isDirectory() ? ent : ent.replace(/\.ts$/, "");
			if (kitNames.has(name) || kitNames.has(ent)) {
				dual.push({ path: full, via: label, name });
			}
		}
	}

	scan(extDir, "project");
	scan(homeExt, "home");

	const report = {
		ok: dual.length === 0,
		package_root: PACKAGE_ROOT,
		workspace,
		home_extensions: homeExt,
		dual_load_risk: dual,
		kit_modules: [...kitNames].sort(),
		hint:
			dual.length > 0
				? "Same-named extensions exist beside the package. Prefer package-only OR project/home copies — not both — then /reload."
				: "No obvious dual-load names vs kit modules.",
	};
	console.log(JSON.stringify(report, null, 2));
	return dual.length === 0 ? 0 : 2;
}

function cmdInstall() {
	const spec = process.env.CYUH_PI_KIT_GIT || DEFAULT_GIT;
	return run("pi", ["install", "-l", spec]);
}

function cmdUpdate() {
	const spec = process.env.CYUH_PI_KIT_GIT || DEFAULT_GIT;
	return run("pi", ["update", "--extension", spec]);
}

function main(argv) {
	const cmd = (argv[2] || "where").toLowerCase();
	if (cmd === "where") return cmdWhere();
	if (cmd === "doctor") return cmdDoctor();
	if (cmd === "install") return cmdInstall();
	if (cmd === "update") return cmdUpdate();
	console.error("Usage: cyuh-pi-kit <install|update|doctor|where>");
	return 1;
}

process.exit(main(process.argv));
