Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_obfuscator = require("./obfuscator-BEQrQtUs.cjs");
let lodash = require("lodash");
lodash = require_obfuscator.__toESM(lodash, 1);
let fs = require("fs");
fs = require_obfuscator.__toESM(fs, 1);
let os = require("os");
os = require_obfuscator.__toESM(os, 1);
let path = require("path");
path = require_obfuscator.__toESM(path, 1);
let minimist = require("minimist");
minimist = require_obfuscator.__toESM(minimist, 1);
//#region src/cli.ts
function stringArray(value) {
	if (value === void 0) return [];
	return Array.isArray(value) ? value : [value];
}
function isRecord(value) {
	return typeof value == "object" && value !== null && !Array.isArray(value);
}
function recordStringArray(value) {
	return Array.isArray(value) && value.every((item) => typeof item == "string") ? value : void 0;
}
function packageMainConfig(value) {
	if (!isRecord(value)) return null;
	const toildefenderConfig = isRecord(value.toildefender) ? value.toildefender : void 0;
	const defendjsConfig = isRecord(value.defendjs) ? value.defendjs : void 0;
	return {
		defendjs: defendjsConfig ? { mainFiles: recordStringArray(defendjsConfig.mainFiles) } : void 0,
		main: typeof value.main == "string" ? value.main : void 0,
		toildefender: toildefenderConfig ? { mainFiles: recordStringArray(toildefenderConfig.mainFiles) } : void 0
	};
}
function parsePackageConfig(code) {
	if (code === void 0) return null;
	try {
		return packageMainConfig(JSON.parse(code));
	} catch {
		return null;
	}
}
function run() {
	const argv = (0, minimist.default)(process.argv.slice(2));
	if (argv.help) {
		console.info("# Usage\n\ntoildefender --input [directory] --output [directory] --features [features] --preprocessor [variable]\n\n# Parameters\n\n--input\n	Path to input directory or file. Can be repeated multiple times.\n\n--output\n	Path to output directory.\n\n--features\n	Comma-separated list of features. (available features: " + lodash.default.join(lodash.default.keys(require_obfuscator.api.features), ", ") + ")\n	e.g. --features scope,control_flow,compress\n\n--preprocessor\n	Preprocessor variable declaration or assignment.\n" + (() => {
			switch (os.default.platform()) {
				case "win32": return "	e.g. --preprocessor PLATFORM_WINDOWS --preprocessor PLATFORM_WINDOWS_VERSION=10\n";
				case "darwin": return "	e.g. --preprocessor PLATFORM_MACOS --preprocessor PLATFORM_MACOS_VERSION=10.12\n";
				default: return "	e.g. --preprocessor PLATFORM_LINUX --preprocessor PLATFORM_LINUX_VERSION=4.8\n";
			}
		})() + "\n# Example\n\n" + (() => {
			switch (os.default.platform()) {
				case "win32": return "toildefender --input \"D:\\project\\src\" --output \"D:\\project\\dist\" --features scope,control_flow,compress --preprocessor PLATFORM_WINDOWS\n";
				case "darwin": return "toildefender --input \"~/project/src\" --output \"~/project/dist\" --features scope,control_flow,compress --preprocessor PLATFORM_MACOS\n";
				default: return "toildefender --input \"~/project/src\" --output \"~/project/dist\" --features scope,control_flow,compress --preprocessor PLATFORM_LINUX\n";
			}
		})() + "\n");
		process.exit(0);
	}
	const input = stringArray(argv.input);
	const preprocessor = stringArray(argv.preprocessor);
	if (input.length == 0) {
		console.error("Missing --input");
		process.exit(0);
	}
	if (!argv.output) {
		console.error("Missing --output");
		process.exit(0);
	}
	const output = argv.output;
	const files = {};
	input.forEach((item) => {
		const stat = fs.default.lstatSync(item);
		if (stat.isDirectory()) readdirRecursiveSync(item).filter((file) => !/(^|[\\/])(\.git|node_modules)($|[\\/])/.test(file)).forEach((file) => files[file] = fs.default.readFileSync(path.default.join(item, file), "utf8"));
		else if (stat.isFile()) files[item] = fs.default.readFileSync(item, "utf8");
	});
	const mainFiles = getMainFiles(files);
	const selectedFeatures = new Set(stringArray(argv.features).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean));
	const features = Object.fromEntries(Object.keys(require_obfuscator.api.features).map((key) => [key, selectedFeatures.has(key)]));
	const preprocessorVariables = {};
	preprocessor.forEach((decl) => {
		const [, variable, value] = /^\s*([\w\d]+)\s*(?:=\s*([\w\d]+))?\s*$/.exec(decl) || [];
		if (variable) preprocessorVariables[variable] = value || null;
	});
	const results = lodash.default.fromPairs(mainFiles.map((key) => {
		const code = files[key];
		if (code === void 0) throw new Error(`Main file not found: ${key}`);
		console.info(`Obfuscating ${key} ...`);
		return [key, require_obfuscator.api.do({
			code,
			modulesCode: lodash.default.pickBy(files, (_value, _key) => key != _key && isCodeFile(_key) && !mainFiles.includes(_key)),
			features,
			preprocessorVariables
		})];
	}));
	lodash.default.each(results, (result, key) => {
		const target = path.default.join(output, key);
		if (!pathExists(path.default.dirname(target))) fs.default.mkdirSync(path.default.dirname(target));
		if (pathExists(target)) fs.default.unlinkSync(target);
		fs.default.writeFileSync(target, result.code);
	});
	function readdirRecursiveSync(dir) {
		const results = [];
		fs.default.readdirSync(dir).forEach(function(file) {
			if (fs.default.statSync(dir + "/" + file).isDirectory()) readdirRecursiveSync(dir + "/" + file).forEach((subfile) => results.push(file + "/" + subfile));
			else results.push(file);
		});
		return results;
	}
	function isSourceFile(name) {
		return lodash.default.includes([".js", ".json"], path.default.extname(name));
	}
	function isCodeFile(name) {
		return path.default.extname(name) == ".js";
	}
	function pathExists(path$2) {
		try {
			const stat = fs.default.lstatSync(path$2);
			return stat.isFile() || stat.isDirectory();
		} catch (e) {
			return false;
		}
	}
	function getMainFiles(files) {
		const packageConfig = parsePackageConfig(files["package.json"]);
		if (packageConfig?.toildefender?.mainFiles) return packageConfig.toildefender.mainFiles;
		else if (packageConfig?.defendjs?.mainFiles) return packageConfig.defendjs.mainFiles;
		else if (packageConfig?.main) return [packageConfig.main];
		else if (Object.keys(files).filter(isSourceFile).length == 1) return [Object.keys(files).filter(isSourceFile)[0]];
		else return [
			"app.js",
			"main.js",
			"index.js"
		].filter((x) => files[x] != null).slice(0, 1);
	}
}
//#endregion
exports.run = run;
