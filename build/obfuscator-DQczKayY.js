import Preprocessing from "./processors/preprocessing.js";
import { createRequire } from "node:module";
import path from "node:path";
import * as modernParser from "@babel/parser";
import _ from "lodash";
import escodegen from "escodegen";
import escope from "escope";
import * as esprima from "esprima";
import assert from "assert";
import estraverse from "estraverse";
import { EventEmitter } from "events";
import esshorten from "esshorten";
import crypto from "crypto";
//#region src/estest.ts
var EXPRESSIONS = ["Identifier"];
function record(value) {
	return typeof value == "object" && value !== null ? value : null;
}
function isNode(x) {
	return typeof record(x)?.type == "string";
}
function isStatement(x) {
	assert.ok(isNode(x));
	return x.type == "Program" || x.type.endsWith("Statement") || x.type.endsWith("Declaration");
}
function isCompoundStatement(x) {
	assert.ok(isNode(x));
	return false;
}
function isExpression(x) {
	assert.ok(isNode(x));
	return EXPRESSIONS.includes(x.type) || x.type.endsWith("Expression");
}
function isFunction(x) {
	assert.ok(isNode(x));
	return x.type.startsWith("Function");
}
var estest_default = {
	isNode,
	isStatement,
	isCompoundStatement,
	isExpression,
	isFunction
};
//#endregion
//#region src/utils.ts
function splice(arr, pos, del, elems) {
	arr.splice(pos, del, ...elems);
}
function unshift(arr, arr2) {
	if (Array.isArray(arr2)) arr.unshift(...arr2);
	else arr.push(arr2);
}
function push(arr, arr2) {
	if (Array.isArray(arr2)) arr.push(...arr2);
	else arr.push(arr2);
}
function array(obj) {
	return Array.isArray(obj) ? obj : [obj];
}
function cloneISwearIKnowWhatImDoing(obj) {
	return JSON.parse(JSON.stringify(obj));
}
/**
* Generate a random number.
* @param {number} Inclusive minimum
* @param {number} Inclusive maximum
* @returns {number}
*/
function random(minimum, maximum) {
	return Math.floor(Math.random() * (maximum - minimum)) + minimum;
}
function randomAlpha(length) {
	let text = "";
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
	for (let i = 0; i < length; i++) text += possible.charAt(Math.floor(Math.random() * 52));
	return text;
}
function isResolvedReference(reference) {
	return reference.resolved !== void 0 && reference.resolved !== null && Array.isArray(reference.resolved.defs) && reference.resolved.defs.length > 0;
}
var UniqueRandom = class {
	arr;
	idx = 0;
	max;
	constructor(max) {
		assert(typeof max == "number");
		if (max > 32768) console.warn(`Allocating large (${max}) UniqueRandom instance`);
		this.max = max;
		this.arr = _.shuffle(_.range(max));
	}
	get() {
		if (this.idx < this.max) return this.arr[this.idx++];
		else throw new Error("No numbers left");
	}
};
var UniqueRandomAlpha = class {
	offset;
	rng;
	constructor(len) {
		assert(typeof len == "number");
		this.offset = Math.pow(32, len - 1);
		this.rng = new UniqueRandom(this.offset * 31);
	}
	get() {
		return (this.offset + this.rng.get()).toString(32);
	}
};
var HashMap = class {
	store = {};
	get(key) {
		return this.store["HashMap" + key];
	}
	set(key, value) {
		return this.store["HashMap" + key] = value;
	}
	exists(key) {
		return this.store["HashMap" + key] !== void 0;
	}
	remove(key) {
		delete this.store["HashMap" + key];
	}
};
function isHashableObject(value) {
	return typeof value == "object" && value !== null || typeof value == "function";
}
function hash(obj) {
	if (obj == null) return "x";
	if (typeof obj == "string") return "s" + obj;
	if (typeof obj == "number") return "n" + obj.toString();
	if (!isHashableObject(obj)) return String(obj);
	if (obj.$$hash) return obj.$$hash;
	Object.defineProperty(obj, "$$hash", {
		configurable: false,
		enumerable: false,
		value: "o" + randomAlpha(8)
	});
	return obj.$$hash || "x";
}
var utils_default = {
	splice,
	unshift,
	push,
	array,
	cloneISwearIKnowWhatImDoing,
	random,
	randomAlpha,
	isResolvedReference,
	UniqueRandom,
	UniqueRandomAlpha,
	HashMap,
	hash
};
//#endregion
//#region src/traverser.ts
var VISITOR_KEYS = Object.assign({}, estraverse.VisitorKeys, {
	ChainExpression: ["expression"],
	PropertyDefinition: ["key", "value"],
	FieldDefinition: ["key", "value"]
});
function nodeFields$8(node) {
	return node;
}
function unknownArray(value) {
	return Array.isArray(value) ? value : null;
}
function traverse(node, stack, processor) {
	assert.ok(estest_default.isNode(node));
	assert.ok(Array.isArray(stack));
	assert.equal(typeof processor, "function");
	visitChildren(node, (child, key) => {
		return traverse(child, [{
			node,
			key
		}, ...stack], processor);
	});
	return processor(node, [{ node }].concat(stack));
}
function traverseEx(node, stack, processor) {
	assert.ok(estest_default.isNode(node));
	assert.ok(Array.isArray(stack));
	assert.equal(typeof processor, "function");
	let abort = false;
	const controller = { abort: function() {
		abort = true;
	} };
	const queue = [];
	visitChildrenEx(node, (child, key) => {
		const repl = processor.call(controller, child, [{ node }, ...stack]);
		if (repl == child) queue.push({
			child,
			key
		});
		return repl;
	});
	if (!abort) queue.every((elem) => {
		traverseEx.call(controller, elem.child, [{
			node,
			key: elem.key
		}, ...stack], processor);
		return !abort;
	});
	return node;
}
var traverser_default = {
	traverse,
	traverseEx,
	visitChildren,
	visitChildrenEx
};
function visitChildren(node, processor) {
	assert.ok(estest_default.isNode(node));
	assert.equal(typeof processor, "function");
	const fields = nodeFields$8(node);
	(VISITOR_KEYS[node.type] || []).forEach((key) => {
		const value = fields[key];
		const values = unknownArray(value);
		if (values) fields[key] = values.map((x) => {
			if (!estest_default.isNode(x)) return x;
			const repl = processor(x, key);
			assert(repl);
			return repl;
		});
		else if (estest_default.isNode(value)) {
			const repl = processor(value, key);
			assert(repl);
			fields[key] = repl;
		}
	});
}
function visitChildrenEx(node, processor) {
	assert.ok(estest_default.isNode(node));
	assert.equal(typeof processor, "function");
	const fields = nodeFields$8(node);
	(VISITOR_KEYS[node.type] || []).forEach((key) => {
		const value = fields[key];
		const values = unknownArray(value);
		if (values) {
			let i = values.length;
			while (i--) {
				const child = values[i];
				if (!estest_default.isNode(child)) continue;
				let replacement = processor(child, key);
				assert(replacement);
				if (Array.isArray(replacement) && replacement.length == 1) replacement = replacement[0];
				if (Array.isArray(replacement)) utils_default.splice(values, i, 1, replacement);
				else values[i] = replacement;
			}
		} else if (estest_default.isNode(value)) {
			let replacement = processor(value, key);
			assert(replacement);
			if (Array.isArray(replacement) && replacement.length == 1) replacement = replacement[0];
			if (Array.isArray(replacement)) throw new Error("Cannot use array here: " + node.type + "." + key + "\n" + JSON.stringify(node) + "\n" + JSON.stringify(replacement));
			else fields[key] = replacement;
		}
	});
}
//#endregion
//#region src/logger.ts
var Logger = class {
	adapter;
	constructor(adapter) {
		this.adapter = adapter || function(level, args) {
			console.log(level + ": " + JSON.stringify(args));
		};
	}
	log(...args) {
		this.adapter("log", args);
	}
	error(...args) {
		this.adapter("error", args);
	}
	warn(...args) {
		this.adapter("warn", args);
	}
	info(...args) {
		this.adapter("info", args);
	}
	debug(...args) {
		this.adapter("debug", args);
	}
};
//#endregion
//#region src/processors/deadCode.ts
var KEYWORDS = [
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"export",
	"extends",
	"finally",
	"for",
	"function",
	"if",
	"implements",
	"import",
	"in",
	"instanceof",
	"interface",
	"let",
	"new",
	"package",
	"private",
	"protected",
	"public",
	"return",
	"static",
	"super",
	"switch",
	"this",
	"throw",
	"try",
	"typeof",
	"var",
	"void",
	"while",
	"with",
	"yield"
];
function isClassMethodBody(stack) {
	return stack.some((frame) => frame.node.type == "MethodDefinition" || frame.node.type == "ClassBody");
}
function blockBody(node) {
	const body = node.body;
	return Array.isArray(body) ? body : [];
}
function containsLexicalDeclaration(node) {
	if (node.type == "ClassDeclaration" || node.type == "FunctionDeclaration" || node.type == "VariableDeclaration" && node.kind != "var") return true;
	let found = false;
	traverser_default.traverseEx(node, [], function(child) {
		if (child != node && estest_default.isFunction(child)) return child;
		if (child.type == "ClassDeclaration" || child.type == "FunctionDeclaration" || child.type == "VariableDeclaration" && child.kind != "var") {
			found = true;
			this.abort();
		}
		return child;
	});
	return found;
}
var DeadCode = class {
	logger;
	constructor(logger) {
		this.logger = logger;
	}
	/**
	* Insert dead code
	* @param {Node} ast
	* @returns {Node}
	*/
	insert(ast, probability) {
		assert.ok(estest_default.isNode(ast));
		new utils_default.UniqueRandomAlpha(3);
		return traverser_default.traverse(ast, [], (node, stack) => {
			if (node.type == "BlockStatement" && !isClassMethodBody(stack)) {
				const body = blockBody(node);
				if (body.length == 0) return node;
				for (let i = 0; i < probability; ++i) {
					if (probability - i < Math.random()) continue;
					const pos = utils_default.random(0, body.length - 1);
					const len = utils_default.random(1, body.length - pos);
					const varValue = KEYWORDS[utils_default.random(0, KEYWORDS.length)] || KEYWORDS[0];
					if (body.slice(pos, pos + len).some(containsLexicalDeclaration)) continue;
					const spliced = body.splice(pos, len);
					body.splice(pos, 0, {
						type: "IfStatement",
						test: {
							type: "BinaryExpression",
							operator: "==",
							left: {
								type: "Literal",
								value: varValue
							},
							right: {
								type: "Literal",
								value: varValue
							}
						},
						consequent: {
							type: "BlockStatement",
							body: spliced
						}
					});
				}
			}
			return node;
		});
	}
};
//#endregion
//#region src/esutils.ts
function nodeFields$7(node) {
	return node;
}
function isStatementContainer(node) {
	return node.type == "Program" || node.type == "BlockStatement";
}
function statementBody(node) {
	const body = nodeFields$7(node).body;
	return Array.isArray(body) ? body : null;
}
function nestedStatementContainer(node) {
	const body = nodeFields$7(node).body;
	return estest_default.isNode(body) && isStatementContainer(body) ? body : null;
}
var ESUtils = class {
	logger;
	constructor(logger) {
		this.logger = logger;
	}
	setParents(node) {
		assert.ok(estest_default.isNode(node));
		traverser_default.visitChildrenEx(node, (child) => {
			Object.defineProperty(child, "toildefender$parent", {
				value: node,
				configurable: true
			});
			return child;
		});
	}
	setParentsRecursive(node) {
		assert.ok(estest_default.isNode(node));
		traverser_default.visitChildrenEx(node, (child) => {
			Object.defineProperty(child, "toildefender$parent", {
				value: node,
				configurable: true
			});
			this.setParentsRecursive(child);
			return child;
		});
	}
	canInsertIntoScope(scope) {
		if (!scope || !scope.block) return false;
		if (nestedStatementContainer(scope.block)) return true;
		return isStatementContainer(scope.block);
	}
	insertIntoScope(scope, node, idx = 0) {
		assert.ok(estest_default.isNode(node));
		const nested = nestedStatementContainer(scope.block);
		if (nested) {
			const body = statementBody(nested);
			assert.ok(body);
			body.splice(idx, 0, node);
			Object.defineProperty(node, "toildefender$parent", {
				value: nested,
				configurable: true
			});
		} else if (isStatementContainer(scope.block)) {
			const body = statementBody(scope.block);
			assert.ok(body);
			body.splice(idx, 0, node);
			Object.defineProperty(node, "toildefender$parent", {
				value: scope.block,
				configurable: true
			});
		} else throw new Error("Cannot insert into scope.block of type " + scope.block.type);
	}
	replaceNode(root, child, replacement) {
		assert.ok(estest_default.isNode(root));
		assert.ok(estest_default.isNode(child));
		assert.ok(estest_default.isNode(replacement));
		assert.equal(estest_default.isStatement(child), estest_default.isStatement(replacement), `Replacee ${child.type} is not of the same type as replacement ${replacement.type}`);
		assert.equal(estest_default.isExpression(child), estest_default.isExpression(replacement), `Replacee ${child.type} is not of the same type as replacement ${replacement.type}`);
		const parent = this.getParent(child);
		if (parent && parent.type == "Property" && parent.shorthand === true && parent.value == child) parent.shorthand = false;
		root = parent || root;
		let replaced = false;
		traverser_default.traverseEx(root, [], (node) => {
			if (!replaced && node == child) {
				replaced = true;
				Object.defineProperty(replacement, "toildefender$parent", {
					value: child.toildefender$parent,
					configurable: true
				});
				this.setParents(replacement);
				return replacement;
			} else return node;
		});
	}
	getParent(node) {
		assert.ok(estest_default.isNode(node));
		const parent = node.toildefender$parent;
		let legit = false;
		if (parent) traverser_default.visitChildren(parent, (child) => {
			if (node == child) legit = true;
			return child;
		});
		if (legit) return parent || null;
		else if (parent) {
			this.logger.debug("Child has wrong parent");
			return null;
		} else {
			this.logger.debug("Child has no parent");
			return null;
		}
		return null;
	}
};
//#endregion
//#region src/processors/modules.ts
function nodeArray$5(value) {
	return Array.isArray(value) ? value : [];
}
function childNode$7(node, key) {
	const value = node[key];
	return estest_default.isNode(value) ? value : null;
}
function nodeName$9(node) {
	const name = node?.name;
	return typeof name == "string" ? name : null;
}
function literalValue(node) {
	return node?.value;
}
function nodeArguments$3(node) {
	return nodeArray$5(node.arguments);
}
function nodeBody$2(node) {
	return nodeArray$5(node.body);
}
function setNodeBody$1(node, body) {
	node.body = body;
}
function parentOf$2(node) {
	const parent = node.toildefender$parent;
	return estest_default.isNode(parent) ? parent : null;
}
function isIdentifierNamed$1(node, name) {
	return node?.type == "Identifier" && nodeName$9(node) == name;
}
function isRequireCall(node) {
	return node.type == "CallExpression" && isIdentifierNamed$1(childNode$7(node, "callee"), "require");
}
function firstStringArgument(node) {
	const value = literalValue(nodeArguments$3(node)[0] || null);
	return typeof value == "string" ? value : null;
}
function isModuleExportsMember(node) {
	if (!node || node.type != "MemberExpression") return false;
	const object = childNode$7(node, "object");
	const property = childNode$7(node, "property");
	return isIdentifierNamed$1(object, "module") && (isIdentifierNamed$1(property, "exports") || property?.type == "Literal" && literalValue(property) == "exports");
}
/**
* Transform calls to require().
* @param {Node} node Root node
* @param {Function} processor Transformer
* @returns {Node} Root node
*/
function findRequires(node, processor) {
	assert.ok(estest_default.isNode(node));
	assert.equal(typeof processor, "function");
	return traverser_default.traverse(node, [], (child, stack) => {
		if (isRequireCall(child)) return processor(child, stack);
		return child;
	});
}
/**
* Split path into parts.
* @param {string} path
* @returns {string[]}
*/
function splitPath(path) {
	return path.split(/[\\/]/g).filter((part) => part.length > 0);
}
/**
* Normalize path.
* @param {string[]} path
* @returns {string}
*/
function normalizePath(path) {
	const parts = splitPath(path);
	for (let i = parts.length - 1; i >= 0; --i) if (parts[i] == "" || parts[i] == ".") parts.splice(i, 1);
	else if (parts[i] == "..") parts.splice(i - 1, 2);
	return parts.join("/");
}
/**
* Get directory from path.
* @param {string} path
* @returns {string}
*/
function getPathDir(path) {
	return splitPath(path).slice(0, -1).join("/");
}
/**
* Resolve path.
* TODO: This doesnt work as expected when path starts with a slash. Fix this.
* @param {string} curr Executing script
* @param {string} path Path
* @returns {string}
*/
function resolvePath(curr, path) {
	return normalizePath(getPathDir(curr) + "/" + path);
}
var Modules = class {
	logger;
	esutils;
	constructor(logger) {
		this.logger = logger;
		this.esutils = new ESUtils(logger);
	}
	/**
	* Replace references to exports and module.exports.
	* @param {Node} ast Root node
	* @param {Node} replacement Replacement
	* @returns {Node} Root node
	*/
	replaceExportsReferences(ast, replacement) {
		this.esutils.setParentsRecursive(ast);
		escope.analyze(ast, { optimistic: true }).scopes.forEach((scope) => {
			scope.references.filter((reference) => !utils_default.isResolvedReference(reference)).forEach((reference) => {
				const parent = parentOf$2(reference.identifier);
				if (nodeName$9(reference.identifier) == "exports") this.esutils.replaceNode(ast, reference.identifier, utils_default.cloneISwearIKnowWhatImDoing(replacement));
				else if (parent && isModuleExportsMember(parent)) this.esutils.replaceNode(ast, parent, utils_default.cloneISwearIKnowWhatImDoing(replacement));
			});
		});
		return ast;
	}
	/**
	* Merges multiple modules into a single main module.
	* @param {Object.<string, Node>} modules Module dictionary
	* @param {string} mainKey Main module key
	* @param {ScopeManager} scopeManager Scope manager
	* @returns {Node} Transformed root node
	*/
	merge(modules, mainKey, _scopeManager) {
		assert.ok(Object.keys(modules).length > 0);
		assert.equal(typeof mainKey, "string");
		const normalizedModules = {};
		for (const [key, value] of Object.entries(modules)) normalizedModules[normalizePath(key)] = value;
		const normalizedMainKey = normalizePath(mainKey);
		const declarationDeclarations = [];
		const declaration = {
			type: "VariableDeclaration",
			kind: "var",
			declarations: declarationDeclarations
		};
		const embeds = [];
		const rng = new utils_default.UniqueRandomAlpha(3);
		const processedModules = {};
		const walkDeps = (key, stack = []) => {
			const moduleAst = normalizedModules[key];
			if (!moduleAst) {
				this.logger.warn(`Local module not found: ${key}`);
				return;
			}
			findRequires(moduleAst, (node) => {
				const requestPath = firstStringArgument(node);
				if (!requestPath) return node;
				if (![
					"/",
					"./",
					"../"
				].some((prefix) => requestPath.startsWith(prefix))) return node;
				let requiredPath = resolvePath(key, requestPath);
				if (requiredPath.slice(-3) == ".js") requiredPath = requiredPath.slice(0, -3);
				if (!normalizedModules[requiredPath]) requiredPath = requiredPath + ".js";
				let requiredModule = normalizedModules[requiredPath];
				if (!requiredModule) {
					this.logger.warn(`Local module not found: ${requiredPath}`);
					return node;
				}
				if (stack.indexOf(requiredPath) == -1) walkDeps(requiredPath, stack.concat(requiredPath));
				else this.logger.warn("Skipping cyclic depedency: " + requiredPath);
				if (!processedModules[requiredPath]) {
					const id = "$$module$" + rng.get();
					processedModules[requiredPath] = id;
					declarationDeclarations.push({
						type: "VariableDeclarator",
						id: {
							type: "Identifier",
							name: id
						},
						init: {
							type: "ObjectExpression",
							properties: []
						}
					});
					requiredModule = this.replaceExportsReferences(requiredModule, {
						type: "Identifier",
						name: id
					});
					embeds.push({
						type: "ExpressionStatement",
						expression: {
							type: "CallExpression",
							callee: {
								type: "FunctionExpression",
								params: [],
								body: {
									type: "BlockStatement",
									body: nodeBody$2(requiredModule)
								}
							},
							arguments: []
						},
						toildefender$module: requiredPath
					});
				}
				return {
					type: "Identifier",
					name: processedModules[requiredPath]
				};
			});
		};
		walkDeps(normalizedMainKey);
		const mainModule = normalizedModules[normalizedMainKey];
		assert.ok(mainModule, `Main module not found: ${normalizedMainKey}`);
		if (declarationDeclarations.length > 0) setNodeBody$1(mainModule, [declaration].concat(embeds).concat(nodeBody$2(mainModule)));
		return mainModule;
	}
};
//#endregion
//#region src/processors/methods.ts
var METHODS_INJECT = `
function toildefender$mergeArguments(a, b) {
    return Array.prototype.slice.call(a).concat(Array.prototype.slice.call(b));
}

function toildefender$bind() {
    var fn = arguments[0], prepend = Array.prototype.slice.call(arguments, 1);
    var wrapper = function() {
        return fn.apply(this, prepend.concat(Array.prototype.slice.call(arguments)));
    };
    wrapper.prototype = fn.prototype;
    return wrapper;
}

function toildefender$sliceArguments(args, num) {
    return Array.prototype.slice.call(args, num);
}

var toildefender$objectKeys = {};

function toildefender$toObject(cacheKey, schema, values) {
    if (values === undefined && Array.isArray(cacheKey)) {
        values = schema;
        schema = cacheKey;
        cacheKey = "";
    }
    var obj = {};
    if (values === undefined) {
        for (var legacy = 0; legacy < schema.length; legacy += 2) {
            obj[schema[legacy]] = schema[legacy + 1];
        }
        return obj;
    }
    var decoded = cacheKey ? toildefender$objectKeys[cacheKey] : null;
    if (decoded) {
        for (var cached = 0; cached < decoded.length; cached += 1) {
            obj[decoded[cached]] = values[cached];
        }
        return obj;
    }
    var cursor = 2;
    var salt = schema[0];
    var count = schema[1];
    var keys = new Array(count);
    for (var i = 0; i < count; i += 1) {
        var len = schema[cursor++] ^ ((salt + i * 131) & 65535);
        var key = "";
        for (var j = 0; j < len; j += 1) {
            key += String.fromCharCode(schema[cursor++] ^ ((salt + i * 257 + j * 17) & 65535));
        }
        keys[i] = key;
        obj[key] = values[i];
    }
    if (cacheKey) {
        toildefender$objectKeys[cacheKey] = keys;
    }
    return obj;
}

function toildefender$objectWithoutKeys(source, excluded) {
    var target = {};
    if (source == null) {
        return target;
    }
    for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key) && excluded.indexOf(key) < 0) {
            target[key] = source[key];
        }
    }
    return target;
}

function toildefender$decodeString(arr) {
    return arr.map(function(x) { return String.fromCharCode(x & ~0 >>> 16) + String.fromCharCode(x >> 16); }).join("");
}

function toildefender$fromCharCodes() {
    return String.fromCharCode.apply(null, arguments);
}

`;
var ANON_METHOD_ID = "toildefender$anonymousMethodId";
function nodeFields$6(node) {
	return node;
}
function astArray$2(value) {
	return Array.isArray(value) ? value : [];
}
function childNode$6(node, key) {
	const value = nodeFields$6(node)[key];
	return estest_default.isNode(value) ? value : null;
}
function setChildValue$1(node, key, value) {
	nodeFields$6(node)[key] = value;
}
function nodeName$8(node) {
	const name = node?.name;
	return typeof name == "string" ? name : null;
}
function setNodeName$3(node, name) {
	node.name = name;
}
function nodeComputed$4(node) {
	return node.computed === true;
}
function nodeFlag$5(node, key) {
	return node[key] === true;
}
function nodeValue$4(node) {
	return nodeFields$6(node).value;
}
function setNodeValue$1(node, value) {
	nodeFields$6(node).value = value;
}
function nodeParams$5(node) {
	return astArray$2(nodeFields$6(node).params);
}
function setNodeParams(node, params) {
	nodeFields$6(node).params = params;
}
function mutableBody$4(node) {
	const body = nodeFields$6(node).body;
	if (Array.isArray(body)) return body;
	const nextBody = [];
	nodeFields$6(node).body = nextBody;
	return nextBody;
}
function functionBody(method) {
	return childNode$6(method, "body") || {
		type: "BlockStatement",
		body: []
	};
}
function anonName(node) {
	const value = nodeFields$6(node)[ANON_METHOD_ID];
	return typeof value == "string" ? value : null;
}
function defineAnonName(node) {
	const existing = anonName(node);
	if (existing) return existing;
	const value = `toildefender$anon$${utils_default.hash(node)}`;
	Object.defineProperty(node, ANON_METHOD_ID, {
		configurable: false,
		enumerable: false,
		value
	});
	return value;
}
/**
* Wrap function with toildefender$bind.
* @param {Identifier} Function identifier
* @returns {Node} Wrapped function
*/
function createMethodStub(id) {
	assert.equal(id.type, "Identifier");
	return {
		type: "CallExpression",
		callee: {
			type: "Identifier",
			name: "toildefender$bind"
		},
		arguments: [id]
	};
}
function anonymousMethodName(node) {
	assert.equal(node.type, "FunctionExpression");
	return defineAnonName(node);
}
function functionDeclarationName(node) {
	assert.equal(node.type, "FunctionDeclaration");
	let id = childNode$6(node, "id");
	const name = nodeName$8(id);
	if (!id || !name) {
		const generated = defineAnonName(node);
		id = {
			type: "Identifier",
			name: generated
		};
		setChildValue$1(node, "id", id);
		return generated;
	}
	return name;
}
function isReferenceIdentifier$2(node, stack) {
	const parentFrame = stack[1];
	if (!parentFrame) return true;
	const parent = parentFrame.node;
	const key = parentFrame.key;
	if ((parent.type == "FunctionDeclaration" || parent.type == "FunctionExpression") && (key == "id" || key == "params")) return false;
	if (parent.type == "VariableDeclarator" && key == "id") return false;
	if (parent.type == "CatchClause" && key == "param") return false;
	if ((parent.type == "MemberExpression" || parent.type == "Property") && key == "property" && !nodeComputed$4(parent)) return false;
	if (parent.type == "Property" && key == "key" && !nodeComputed$4(parent)) return false;
	if ((parent.type == "LabeledStatement" || parent.type == "BreakStatement" || parent.type == "ContinueStatement") && key == "label") return false;
	return true;
}
function renameFunctionExpressionSelfReferences(node, name) {
	assert.equal(node.type, "FunctionExpression");
	const oldName = nodeName$8(childNode$6(node, "id"));
	if (!oldName || oldName == name) return;
	traverser_default.traverse(functionBody(node), [], (child, stack) => {
		if (child.type == "Identifier" && nodeName$8(child) == oldName && isReferenceIdentifier$2(child, stack)) setNodeName$3(child, name);
		return child;
	});
}
function isClassMethodFunction$1(stack) {
	return stack.some((frame) => frame.node.type == "MethodDefinition" || frame.node.type == "ClassBody");
}
function isNumericVmInternalFunction$3(node, stack) {
	return nodeFlag$5(node, "toildefender$numericVmInternal") || stack.some((frame) => nodeFlag$5(frame.node, "toildefender$numericVmInternal"));
}
/**
* Get index of argument in function.
* @param {Function} method Function
* @param {Identifier} identifier} Argument identifier
* @returns {number} Index of argument
*/
function getArgumentIndex(method, identifier) {
	assert.ok(estest_default.isFunction(method));
	assert.equal(identifier.type, "Identifier");
	const name = nodeName$8(identifier);
	return nodeParams$5(method).findIndex((param) => nodeName$8(param) == name);
}
function rawArgumentsIdentifier() {
	return {
		type: "Identifier",
		name: "arguments",
		toildefender$rawArguments: true
	};
}
function acquiredReferences(scopeManager, method) {
	const manager = scopeManager;
	if (typeof manager.acquire != "function") return [];
	const scope = manager.acquire(method);
	return scope ? scope.references : [];
}
var Methods = class {
	logger;
	constructor(logger) {
		this.logger = logger;
	}
	/**
	* Adds helper methods to the beginning of the app.
	* @param {Node} Root node
	*/
	addCustomBind(ast) {
		assert.ok(estest_default.isNode(ast));
		const code = esprima.parseScript(METHODS_INJECT);
		mutableBody$4(ast).splice(0, 0, ...mutableBody$4(code));
	}
	/**
	* Checks whether a method refers to the "arguments" array.
	* @param {Function} method
	* @param {ScopeManager} scopeManager
	* @returns {boolean}
	*/
	methodRefersToArguments(method, scopeManager) {
		assert.ok(estest_default.isFunction(method));
		assert.ok(scopeManager);
		return acquiredReferences(scopeManager, method).some((reference) => !utils_default.isResolvedReference(reference) && nodeName$8(reference.identifier) == "arguments");
	}
	/**
	* Inserts code to copy/slice arguments from the arguments array like
	* function () { ... }
	* to
	* function () { var toildefender$arguments = toildefender$sliceArguments(arguments, 1); ... }
	* @param {Function} method
	* @param {number} num Number of arguments to be sliced off. 0 if none.
	*/
	removeFirstArguments(method, num) {
		assert.ok(estest_default.isFunction(method));
		assert.equal(typeof num, "number");
		mutableBody$4(functionBody(method)).splice(0, 0, {
			type: "VariableDeclaration",
			kind: "var",
			declarations: [{
				type: "VariableDeclarator",
				id: {
					type: "Identifier",
					name: "toildefender$arguments"
				},
				init: rawArgumentsIdentifier()
			}, {
				type: "VariableDeclarator",
				id: {
					type: "Identifier",
					name: "toildefender$bareArguments"
				},
				init: num > 0 ? {
					type: "CallExpression",
					callee: {
						type: "Identifier",
						name: "toildefender$sliceArguments"
					},
					arguments: [rawArgumentsIdentifier(), {
						type: "Literal",
						value: num,
						toildefender$removeFirstArguments: true
					}]
				} : rawArgumentsIdentifier()
			}],
			toildefender$reassigningArguments: true,
			toildefender$followsSlicingArguments: num > 0
		});
	}
	/**
	* Lists all methods.
	* @param {Node} ast Root node
	* @returns {string[]} Method names
	*/
	listMethods(ast) {
		assert.ok(estest_default.isNode(ast));
		const methods = [];
		traverser_default.traverse(ast, [], (node, stack) => {
			if (isNumericVmInternalFunction$3(node, stack)) return node;
			if (node.type == "FunctionDeclaration") methods.push(functionDeclarationName(node));
			else if (node.type == "FunctionExpression" && !isClassMethodFunction$1(stack)) methods.push(anonymousMethodName(node));
			return node;
		});
		return methods;
	}
	/**
	* Extracts all methods from the AST.
	* @param {Node} ast Root node
	* @returns {Function[]}
	*/
	extractMethods(ast) {
		assert.ok(estest_default.isNode(ast));
		const methods = [];
		traverser_default.traverse(ast, [], (node, stack) => {
			if (isNumericVmInternalFunction$3(node, stack)) return node;
			if (node.type == "FunctionDeclaration") {
				functionDeclarationName(node);
				methods.push(node);
				return {
					type: "ExpressionStatement",
					expression: createMethodStub(childNode$6(node, "id") || {
						type: "Identifier",
						name: functionDeclarationName(node)
					})
				};
			} else if (node.type == "FunctionExpression" && !isClassMethodFunction$1(stack)) {
				const id = anonymousMethodName(node);
				renameFunctionExpressionSelfReferences(node, id);
				Object.assign(node, {
					type: "FunctionDeclaration",
					id: {
						type: "Identifier",
						name: id
					}
				});
				methods.push(node);
				return createMethodStub({
					type: "Identifier",
					name: id
				});
			}
			return node;
		});
		return methods;
	}
	/**
	* Replaces direct argument references with arguments references like
	* function (a) { return a; }
	* to
	* function (a) { return toildefender$arguments[0]; }
	* @param {Function} method Function whose body will be transformed
	* @param {boolean} useReassignedVariable Use toildefender$arguments instead of arguments
	* @returns {Function} Function from method parameter
	*/
	replaceArgumentReferences(method, useReassignedVariable) {
		assert.ok(estest_default.isFunction(method));
		traverser_default.traverse(functionBody(method), [], (node, stack) => {
			if (node.type == "Identifier") {
				const nestedFunction = stack.some((frame) => estest_default.isFunction(frame.node));
				if (useReassignedVariable && nodeName$8(node) == "arguments" && !nodeFlag$5(node, "toildefender$rawArguments") && !nestedFunction) return {
					type: "Identifier",
					name: "toildefender$bareArguments"
				};
				const index = getArgumentIndex(method, node);
				if (index != -1) return {
					type: "MemberExpression",
					object: {
						type: "Identifier",
						name: useReassignedVariable ? "toildefender$arguments" : "arguments"
					},
					property: {
						type: "Literal",
						value: index
					},
					computed: true
				};
			}
			return node;
		});
		setNodeParams(method, []);
		return method;
	}
	/**
	* Replaces function calls with main calls like
	* test()
	* to
	* toildefender$bind(main, 1234)()
	* @param {Node} ast Root node
	* @param {Object[]} methodEntryExitPoints Method entry point table
	* @param {number} methodEntryExitPoints[].entry Entry point
	*/
	replaceFunctionCalls(ast, methodEntryExitPoints) {
		assert.ok(estest_default.isNode(ast));
		assert.equal(typeof methodEntryExitPoints, "object");
		traverser_default.traverse(ast, [], (node, stack) => {
			if (isNumericVmInternalFunction$3(node, stack)) return node;
			const name = nodeName$8(node);
			const entryPoint = name ? methodEntryExitPoints[name] : void 0;
			if (node.type == "Identifier" && entryPoint?.entry) return {
				type: "CallExpression",
				callee: {
					type: "Identifier",
					name: "toildefender$bind"
				},
				arguments: [{
					type: "Identifier",
					name: entryPoint.dispatcher || "main"
				}, {
					type: "Identifier",
					name: entryPoint.entry
				}]
			};
			return node;
		});
	}
	/**
	* Bumps all arguments indices like
	* toildefender$arguments[0]
	* to
	* toildefender$arguments[1]
	* @param {Function} method Function whose body will be transformed
	* @param {number} inc Number to be added to all argument indices
	*/
	bumpArgumentsIndices(method, inc) {
		assert.ok(estest_default.isFunction(method));
		assert.equal(typeof inc, "number");
		traverser_default.traverse(functionBody(method), [], (node) => {
			const object = childNode$6(node, "object");
			if (node.type == "MemberExpression" && object?.type == "Identifier" && nodeName$8(object) == "toildefender$arguments") {
				const property = childNode$6(node, "property");
				const value = property ? nodeValue$4(property) : null;
				if (typeof value == "number" && property) setNodeValue$1(property, value + inc);
			}
			if (nodeFlag$5(node, "toildefender$removeFirstArguments")) {
				const value = nodeValue$4(node);
				if (typeof value == "number") setNodeValue$1(node, value + inc);
			}
			return node;
		});
	}
};
//#endregion
//#region src/processors/variables.ts
function nodeFields$5(node) {
	return node;
}
function astArray$1(value) {
	return Array.isArray(value) ? value : [];
}
function childNode$5(node, key) {
	const value = nodeFields$5(node)[key];
	return estest_default.isNode(value) ? value : null;
}
function setChildValue(node, key, value) {
	nodeFields$5(node)[key] = value;
}
function nodeName$7(node) {
	const name = node?.name;
	return typeof name == "string" ? name : null;
}
function setNodeName$2(node, name) {
	node.name = name;
}
function nodeComputed$3(node) {
	return node.computed === true;
}
function nodeFlag$4(node, key) {
	return node[key] === true;
}
function nodeParams$4(node) {
	return astArray$1(nodeFields$5(node).params);
}
function parentOf$1(node) {
	const parent = node.toildefender$parent;
	return estest_default.isNode(parent) ? parent : null;
}
function scopeList$1(scopeManager) {
	const scopes = scopeManager.scopes;
	return Array.isArray(scopes) ? scopes : [];
}
function isReferenceIdentifier$1(node, stack) {
	const parentFrame = stack[1];
	if (!parentFrame) return true;
	const parent = parentFrame.node;
	const key = parentFrame.key;
	if ((parent.type == "FunctionDeclaration" || parent.type == "FunctionExpression") && (key == "id" || key == "params")) return false;
	if ((parent.type == "ClassDeclaration" || parent.type == "ClassExpression") && key == "id") return false;
	if (parent.type == "VariableDeclarator" && key == "id") return false;
	if (parent.type == "CatchClause" && key == "param") return false;
	if ((parent.type == "MemberExpression" || parent.type == "Property") && key == "property" && !nodeComputed$3(parent)) return false;
	if (parent.type == "Property" && key == "key" && !nodeComputed$3(parent)) return false;
	if ((parent.type == "MethodDefinition" || parent.type == "PropertyDefinition" || parent.type == "FieldDefinition") && key == "key" && !nodeComputed$3(parent)) return false;
	if ((parent.type == "LabeledStatement" || parent.type == "BreakStatement" || parent.type == "ContinueStatement") && key == "label") return false;
	return true;
}
function functionExpressionUsesOwnName(node) {
	assert.equal(node.type, "FunctionExpression");
	const name = nodeName$7(childNode$5(node, "id"));
	if (!name) return false;
	const body = childNode$5(node, "body");
	if (!body) return false;
	let used = false;
	traverser_default.traverse(body, [], (child, stack) => {
		if (child.type == "Identifier" && nodeName$7(child) == name && isReferenceIdentifier$1(child, stack)) used = true;
		return child;
	});
	return used;
}
function isClassMethodScope$1(scope) {
	let node = scope.block;
	while (node) {
		if (node.type == "MethodDefinition" || node.type == "ClassBody") return true;
		node = parentOf$1(node);
	}
	return false;
}
function isNumericVmInternalNode$2(node) {
	while (node) {
		if (nodeFlag$4(node, "toildefender$numericVmInternal")) return true;
		node = parentOf$1(node);
	}
	return false;
}
function isNumericVmInternalScope$1(scope) {
	return isNumericVmInternalNode$2(scope.block);
}
function isNumericVmInternalVariable(variable) {
	return variable.defs.some((def) => isNumericVmInternalNode$2(def.node));
}
var Variables = class {
	logger;
	esutils;
	constructor(logger) {
		this.logger = logger;
		this.esutils = new ESUtils(logger);
	}
	/**
	* Removes the id property from FunctionExpressions.
	* They trip up functionDeclarationToExpression and escope (?),
	* causing scopes.js to incorrectly rename some references.
	* @param {Node} ast Root node
	* @returns {Node} Root node
	*/
	removeFunctionExpressionIds(ast) {
		return traverser_default.traverse(ast, [], (node) => {
			if (isNumericVmInternalNode$2(node)) return node;
			if (node.type == "FunctionExpression" && childNode$5(node, "id") && !functionExpressionUsesOwnName(node)) setChildValue(node, "id", null);
			return node;
		});
	}
	/**
	* Converts function declarations like
	* function test() { ... }
	* to function expression variables like
	* var test = function() { ... };
	* @param {Node} ast Root node
	* @param {ScopeManager} scopeManager Scope manager
	*/
	functionDeclarationToExpression(ast, scopeManager) {
		assert.ok(estest_default.isNode(ast));
		this.esutils.setParentsRecursive(ast);
		scopeList$1(scopeManager).forEach((scope) => {
			if (!this.esutils.canInsertIntoScope(scope) || isClassMethodScope$1(scope) || isNumericVmInternalScope$1(scope)) return;
			scope.variables.forEach((variable) => {
				variable.defs.forEach((def) => {
					if (def.type == "FunctionName") {
						assert(estest_default.isFunction(def.node));
						/**
						* Here you have to ensure that def.node is statement.
						* Expressions like { foo: function() { ... }} are parsed
						* as a FunctionExpression with an id, which are then
						* mistakingly replaced with EmptyStatements.
						*/
						if (estest_default.isStatement(def.node) && !isNumericVmInternalNode$2(def.node)) {
							this.esutils.replaceNode(ast, def.node, { type: "EmptyStatement" });
							this.esutils.insertIntoScope(scope, {
								type: "VariableDeclaration",
								kind: "var",
								declarations: [{
									type: "VariableDeclarator",
									id: childNode$5(def.node, "id"),
									init: {
										type: "FunctionExpression",
										params: nodeParams$4(def.node),
										body: childNode$5(def.node, "body"),
										generator: nodeFlag$4(def.node, "generator"),
										expression: nodeFlag$4(def.node, "expression"),
										async: nodeFlag$4(def.node, "async"),
										toildefender$numericVmInternal: nodeFlag$4(def.node, "toildefender$numericVmInternal")
									}
								}]
							});
						}
					}
				});
			});
		});
	}
	/**
	* Renames identifiers with unique names, e.g.
	* var a, b = 5;
	* to
	* var $$var$123$a, $$var$123$b = 5;
	* @param {Node} ast Root node
	* @param {ScopeManager} scopeManager Scope manager
	*/
	obfuscateIdentifiers(ast, scopeManager) {
		const usedNames = /* @__PURE__ */ new Set();
		function uniqueName(variable) {
			const base = "$$var$" + utils_default.hash(variable);
			let name = base + "$" + variable.name;
			let counter = 0;
			while (usedNames.has(name)) {
				counter += 1;
				name = base + counter.toString(36) + "$" + variable.name;
			}
			usedNames.add(name);
			return name;
		}
		scopeList$1(scopeManager).forEach((scope) => {
			if (isClassMethodScope$1(scope) || isNumericVmInternalScope$1(scope)) return;
			if (scope.isStatic?.()) {
				scope.variables.sort((a, b) => {
					if (a.tainted) return 1;
					if (b.tainted) return -1;
					return b.identifiers.length + b.references.length - (a.identifiers.length + a.references.length);
				});
				for (const variable of scope.variables) {
					if (isNumericVmInternalVariable(variable)) continue;
					const name = uniqueName(variable);
					if (variable.defs.some((def) => def.type == "ClassName")) continue;
					if (variable.tainted) continue;
					if (variable.identifiers.length === 0) continue;
					for (const def of variable.identifiers) setNodeName$2(def, name);
					for (const ref of variable.references.filter((ref) => ref.resolved === variable)) setNodeName$2(ref.identifier, name);
				}
			}
		});
	}
	/**
	* Replaces direct parameter references like
	* function (a) {
	*     return a;
	* }
	* to copys like
	* function (a) {
	*     var $$arg$abc = a;
	*     return $$arg$abc;
	* }
	* @param {Node} ast Root node
	* @param {ScopeManager} scopeManager Scope manager
	*/
	redefineParameters(ast, scopeManager) {
		const rng = new utils_default.UniqueRandomAlpha(3);
		scopeList$1(scopeManager).forEach((scope) => {
			if (!this.esutils.canInsertIntoScope(scope) || isClassMethodScope$1(scope) || isNumericVmInternalScope$1(scope)) return;
			scope.variables.forEach((variable) => {
				if (isNumericVmInternalVariable(variable)) return;
				variable.defs.forEach((def) => {
					if (def.type == "Parameter") {
						assert(def.name?.type == "Identifier");
						const name = "$$arg$" + rng.get();
						this.esutils.insertIntoScope(scope, {
							type: "VariableDeclaration",
							kind: "var",
							declarations: [{
								type: "VariableDeclarator",
								id: {
									type: "Identifier",
									name
								},
								init: def.name
							}]
						});
						variable.references.forEach((reference) => {
							setNodeName$2(reference.identifier, name);
						});
					}
				});
			});
		});
	}
};
//#endregion
//#region src/processors/scopes.ts
function nodeFields$4(node) {
	return node;
}
function nodeArray$4(value) {
	return Array.isArray(value) ? value : [];
}
function childNode$4(node, key) {
	const value = nodeFields$4(node)[key];
	return estest_default.isNode(value) ? value : null;
}
function setNodeField$3(node, key, value) {
	nodeFields$4(node)[key] = value;
}
function nodeName$6(node) {
	const name = node?.name;
	return typeof name == "string" ? name : null;
}
function nodeComputed$2(node) {
	return node.computed === true;
}
function nodeFlag$3(node, key) {
	return node[key] === true;
}
function nodeParams$3(node) {
	return nodeArray$4(nodeFields$4(node).params);
}
function parentOf(node) {
	const parent = node?.toildefender$parent;
	return estest_default.isNode(parent) ? parent : null;
}
function scopeManagerObject(scopeManager) {
	const manager = scopeManager;
	if (Array.isArray(manager.scopes)) return manager;
	return { scopes: [] };
}
function scopeReference(scopeVarName, index) {
	return {
		type: "MemberExpression",
		object: {
			type: "Identifier",
			name: scopeVarName
		},
		property: {
			type: "Literal",
			value: index
		},
		computed: true,
		toildefender$scopeObjectReference: true
	};
}
function isClassMethodFunction(stack) {
	return stack.some((frame) => frame.node.type == "MethodDefinition" || frame.node.type == "ClassBody");
}
function isClassMethodScope(scope) {
	let node = scope.block;
	while (node) {
		if (node.type == "MethodDefinition" || node.type == "ClassBody") return true;
		node = parentOf(node);
	}
	return false;
}
function isNumericVmInternalNode$1(node) {
	while (node) {
		if (nodeFlag$3(node, "toildefender$numericVmInternal")) return true;
		node = parentOf(node);
	}
	return false;
}
function isNumericVmInternalFunction$2(stack) {
	return stack.some((frame) => isNumericVmInternalNode$1(frame.node));
}
function isNumericVmInternalScope(scope) {
	return isNumericVmInternalNode$1(scope.block);
}
function isReferenceIdentifier(node, stack) {
	const parentFrame = stack[1];
	if (!parentFrame) return true;
	const parent = parentFrame.node;
	const key = parentFrame.key;
	if ((parent.type == "FunctionDeclaration" || parent.type == "FunctionExpression") && (key == "id" || key == "params")) return false;
	if ((parent.type == "ClassDeclaration" || parent.type == "ClassExpression") && key == "id") return false;
	if (parent.type == "VariableDeclarator" && key == "id") return false;
	if (parent.type == "CatchClause" && key == "param") return false;
	if ((parent.type == "MemberExpression" || parent.type == "Property") && key == "property" && !nodeComputed$2(parent)) return false;
	if (parent.type == "Property" && key == "key" && !nodeComputed$2(parent)) return false;
	if ((parent.type == "MethodDefinition" || parent.type == "PropertyDefinition" || parent.type == "FieldDefinition") && key == "key" && !nodeComputed$2(parent)) return false;
	if ((parent.type == "LabeledStatement" || parent.type == "BreakStatement" || parent.type == "ContinueStatement") && key == "label") return false;
	return true;
}
function isInsideNestedScope(stack, root, scopeBlocks) {
	return stack.some((frame) => frame.node != root && scopeBlocks.has(frame.node));
}
function isMovableVariable(variable) {
	return variable.defs.some((def) => {
		if (isNumericVmInternalNode$1(def.node)) return false;
		if (def.type == "Variable" || def.type == "CatchClause") return true;
		return def.type == "FunctionName" && def.node.type != "FunctionExpression";
	});
}
function markPropertyValueReplacement(stack) {
	const parentFrame = stack[1];
	if (!parentFrame) return;
	const parent = parentFrame.node;
	if (parent.type == "Property" && nodeFlag$3(parent, "shorthand") && parentFrame.key == "value") setNodeField$3(parent, "shorthand", false);
}
function isReferenceInsideNestedFunction(scopeBlock, identifier) {
	let current = parentOf(identifier);
	while (current && current != scopeBlock) {
		if (estest_default.isFunction(current)) return true;
		current = parentOf(current);
	}
	return false;
}
function normalizeRatio$1(value) {
	const ratio = Number(value);
	if (!Number.isFinite(ratio)) return 1;
	if (ratio < 0) return 0;
	if (ratio > 1) return 1;
	return ratio;
}
function hashString32(value) {
	let h = 2166136261;
	for (let i = 0; i < value.length; i += 1) {
		h ^= value.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h >>> 0;
}
function cloneReplacement(node) {
	assert.ok(node);
	return utils_default.cloneISwearIKnowWhatImDoing(node);
}
function ancestorDistance(ancestor, node) {
	let distance = 0;
	let current = node;
	while (current) {
		if (current == ancestor) return distance;
		current = parentOf(current);
		distance += 1;
	}
	return -1;
}
function variableIndex(indexes, variable) {
	const index = indexes.get(variable);
	if (typeof index != "number") throw new Error(`Missing scope index for ${variable.name}`);
	return index;
}
var Scopes = class {
	logger;
	esutils;
	constructor(logger) {
		this.logger = logger;
		this.esutils = new ESUtils(logger);
	}
	/**
	* Moves all variables to scope arrays like
	* var a = 1, b = 2;
	* to
	* var $$scope$abc = [];
	* $$scope$abc[0] = 1;
	* $$scope$abc[1] = 2;
	* @param {Node} ast Root node
	* @param {ScopeManager} scopeManager Scope manager
	*/
	createScopeObjects(ast, scopeManager, options = {}) {
		assert.ok(estest_default.isNode(ast));
		this.esutils.setParentsRecursive(ast);
		const ratio = normalizeRatio$1(options.ratio);
		const seed = options.seed || "toildefender-scope";
		const forceProgram = options.forceProgram === true;
		const manager = scopeManagerObject(scopeManager);
		const scopes = typeof manager.acquireAll == "function" ? manager.acquireAll(ast) : manager.scopes;
		const rngAlpha = new utils_default.UniqueRandomAlpha(3);
		const replacements = /* @__PURE__ */ new WeakMap();
		const referencesByVariable = /* @__PURE__ */ new Map();
		const fallbackReplacementsByName = /* @__PURE__ */ new Map();
		const scopeBlocks = /* @__PURE__ */ new WeakSet();
		scopes.forEach((scope) => {
			scopeBlocks.add(scope.block);
		});
		const addFallbackReplacement = (name, replacement, block, scopeDecl) => {
			let entries = fallbackReplacementsByName.get(name);
			if (!entries) {
				entries = [];
				fallbackReplacementsByName.set(name, entries);
			}
			entries.push({
				block,
				scopeDecl,
				replacement
			});
		};
		const fallbackReplacementForName = (name, node) => {
			const entries = fallbackReplacementsByName.get(name);
			if (!entries) return null;
			let best = null;
			let bestDistance = Infinity;
			entries.forEach((entry) => {
				const liveBlock = parentOf(entry.scopeDecl);
				let distance = liveBlock ? ancestorDistance(liveBlock, node) : -1;
				if (distance < 0) distance = ancestorDistance(entry.block, node);
				if (distance >= 0 && distance < bestDistance) {
					best = entry.replacement;
					bestDistance = distance;
				}
			});
			return best;
		};
		const addResolvedReference = (variable, reference) => {
			if (!variable) return;
			let references = referencesByVariable.get(variable);
			if (!references) {
				references = /* @__PURE__ */ new Set();
				referencesByVariable.set(variable, references);
			}
			references.add(reference);
		};
		manager.scopes.forEach((scope) => {
			scope.variables.forEach((variable) => {
				variable.references.forEach((reference) => addResolvedReference(variable, reference));
			});
			scope.references.forEach((reference) => {
				addResolvedReference(reference.resolved, reference);
			});
			scope.through.forEach((reference) => {
				addResolvedReference(reference.resolved, reference);
			});
		});
		const referencesFor = (variable) => {
			const references = referencesByVariable.get(variable);
			return (references ? Array.from(references) : variable.references).filter((reference) => reference.resolved === variable);
		};
		const shouldFlattenScope = (scope, movableVariables, index) => {
			if (forceProgram && scope.block.type == "Program") return true;
			if (movableVariables.some((variable) => referencesFor(variable).some((reference) => isReferenceInsideNestedFunction(scope.block, reference.identifier)))) return true;
			if (ratio >= 1) return true;
			if (ratio <= 0) return false;
			const variableNames = movableVariables.map((variable) => variable.name).sort().join(",");
			return hashString32(`${seed}:${index}:${scope.type || ""}:${scope.block.type}:${variableNames}`) / 4294967296 < ratio;
		};
		const rewriteKnownReferences = (node) => {
			return traverser_default.traverse(node, [], (child, stack) => {
				if (isNumericVmInternalFunction$2(stack)) return child;
				const replacement = replacements.get(child);
				if (child.type == "Identifier" && replacement) {
					markPropertyValueReplacement(stack);
					return cloneReplacement(replacement);
				}
				return child;
			});
		};
		manager.scopes.forEach((scope, scopeIndex) => {
			if (!this.esutils.canInsertIntoScope(scope) || isClassMethodScope(scope) || isNumericVmInternalScope(scope)) return;
			const movableVariables = scope.variables.filter(isMovableVariable);
			if (movableVariables.length == 0) return;
			if (!shouldFlattenScope(scope, movableVariables, scopeIndex)) return;
			const scopeVarName = `$$scope$${rngAlpha.get()}`;
			let counter = 0;
			const indexes = /* @__PURE__ */ new Map();
			const localReplacementsByName = /* @__PURE__ */ new Map();
			movableVariables.forEach((variable) => {
				indexes.set(variable, counter++);
			});
			movableVariables.forEach((variable) => {
				const index = variableIndex(indexes, variable);
				variable.defs.forEach((def) => {
					if (def.type == "Variable") {
						const replacement = scopeReference(scopeVarName, index);
						localReplacementsByName.set(variable.name, replacement);
						referencesFor(variable).forEach((reference) => {
							replacements.set(reference.identifier, scopeReference(scopeVarName, index));
						});
					} else if (def.type == "CatchClause") referencesFor(variable).forEach((reference) => {
						replacements.set(reference.identifier, scopeReference(scopeVarName, index));
					});
					else if (def.type == "FunctionName" && def.node.type != "FunctionExpression") referencesFor(variable).forEach((reference) => {
						replacements.set(reference.identifier, {
							type: "CallExpression",
							callee: {
								type: "Identifier",
								name: "toildefender$bind"
							},
							arguments: [{
								type: "Identifier",
								name: nodeName$6(reference.identifier) || variable.name
							}, {
								type: "Identifier",
								name: scopeVarName
							}]
						});
					});
				});
			});
			const rewriteLocalReferencesByName = () => {
				this.esutils.setParentsRecursive(scope.block);
				traverser_default.traverse(scope.block, [], (node, stack) => {
					if (isNumericVmInternalFunction$2(stack)) return node;
					if (isInsideNestedScope(stack, scope.block, scopeBlocks)) return node;
					if (node.type == "Identifier" && isReferenceIdentifier(node, stack)) {
						const replacement = localReplacementsByName.get(nodeName$6(node) || "");
						if (replacement) {
							markPropertyValueReplacement(stack);
							return cloneReplacement(replacement);
						}
					}
					return node;
				});
			};
			const scopeDecl = {
				type: "VariableDeclaration",
				kind: "var",
				declarations: [{
					type: "VariableDeclarator",
					id: {
						type: "Identifier",
						name: scopeVarName
					},
					init: {
						type: "ArrayExpression",
						elements: []
					}
				}],
				toildefender$scopeObject: true
			};
			this.esutils.insertIntoScope(scope, scopeDecl);
			localReplacementsByName.forEach((replacement, name) => {
				addFallbackReplacement(name, replacement, scope.block, scopeDecl);
			});
			movableVariables.forEach((variable) => {
				const index = variableIndex(indexes, variable);
				variable.defs.forEach((def) => {
					if (def.type == "Variable") {
						const parent = def.parent;
						assert(parent.type == "VariableDeclaration");
						const declarations = nodeArray$4(nodeFields$4(parent).declarations).filter((declarator) => declarator != def.node);
						setNodeField$3(parent, "declarations", declarations);
						const replacement = [];
						const init = childNode$4(def.node, "init");
						if (init) replacement.push({
							type: "ExpressionStatement",
							expression: {
								type: "AssignmentExpression",
								operator: "=",
								left: scopeReference(scopeVarName, index),
								right: rewriteKnownReferences(init)
							}
						});
						if (declarations.length > 0) replacement.push(parent);
						if (replacement.length == 0) this.esutils.replaceNode(scope.block, parent, { type: "EmptyStatement" });
						else if (replacement.length == 1) this.esutils.replaceNode(scope.block, parent, replacement[0]);
						else this.esutils.replaceNode(scope.block, parent, {
							type: "BlockStatement",
							body: replacement
						});
						referencesFor(variable).forEach((reference) => {
							this.esutils.replaceNode(scope.block, reference.identifier, cloneReplacement(replacements.get(reference.identifier) || scopeReference(scopeVarName, index)));
						});
					} else if (def.type == "CatchClause") {
						Object.defineProperty(scope.block, "toildefender$exception", {
							value: scopeReference(scopeVarName, index),
							configurable: true
						});
						this.esutils.insertIntoScope(scope, {
							type: "ExpressionStatement",
							expression: {
								type: "AssignmentExpression",
								operator: "=",
								left: scopeReference(scopeVarName, index),
								right: def.name || {
									type: "Identifier",
									name: variable.name
								}
							}
						}, 1);
						referencesFor(variable).forEach((reference) => {
							this.esutils.replaceNode(scope.block, reference.identifier, cloneReplacement(replacements.get(reference.identifier) || scopeReference(scopeVarName, index)));
						});
					} else if (def.type == "FunctionName") {
						if (def.node.type == "FunctionExpression") return;
						referencesFor(variable).forEach((reference) => {
							this.esutils.replaceNode(scope.block, reference.identifier, cloneReplacement(replacements.get(reference.identifier)));
						});
					}
				});
			});
			rewriteLocalReferencesByName();
			traverser_default.traverse(scope.block, [], (node, stack) => {
				if (scope.block == node) return node;
				if (isClassMethodFunction(stack) || isNumericVmInternalFunction$2(stack)) return node;
				if (node.type.indexOf("Function") == 0) nodeParams$3(node).unshift({
					type: "Identifier",
					name: scopeVarName
				});
				if (node.type == "FunctionExpression") return {
					type: "CallExpression",
					callee: {
						type: "Identifier",
						name: "toildefender$bind"
					},
					arguments: [node, {
						type: "Identifier",
						name: scopeVarName
					}]
				};
				return node;
			});
		});
		this.esutils.setParentsRecursive(ast);
		traverser_default.traverse(ast, [], (node, stack) => {
			const parentFrame = stack[1];
			if (node.type == "Identifier" && (nodeName$6(node) || "").indexOf("$$var$") == 0 && parentFrame && parentFrame.node.type == "CallExpression" && parentFrame.key == "callee" && isReferenceIdentifier(node, stack)) {
				const replacement = fallbackReplacementForName(nodeName$6(node) || "", node);
				if (replacement) return cloneReplacement(replacement);
			}
			return node;
		});
	}
};
//#endregion
//#region src/processors/flattener.ts
function nodeFields$3(node) {
	return node;
}
function nodeArray$3(value) {
	return Array.isArray(value) ? value : [];
}
function bodyArray$2(node) {
	return nodeArray$3(nodeFields$3(node).body);
}
function mutableBody$3(node) {
	const body = nodeFields$3(node).body;
	if (Array.isArray(body)) return body;
	const nextBody = [];
	nodeFields$3(node).body = nextBody;
	return nextBody;
}
function childNode$3(node, key) {
	const value = nodeFields$3(node)[key];
	return estest_default.isNode(value) ? value : null;
}
function requiredChild$2(node, key) {
	const child = childNode$3(node, key);
	assert.ok(child, `Missing ${node.type}.${key}`);
	return child;
}
function setNodeField$2(node, key, value) {
	nodeFields$3(node)[key] = value;
}
function nodeName$5(node) {
	const name = node?.name;
	return typeof name == "string" ? name : null;
}
function setNodeName$1(node, name) {
	node.name = name;
}
function nodeValue$3(node) {
	return node?.value;
}
function setNodeValue(node, value) {
	node.value = value;
}
function nodeFlag$2(node, key) {
	return node[key] === true;
}
function nodeDeclarations$2(node) {
	return nodeArray$3(nodeFields$3(node).declarations);
}
function switchCases(node) {
	return nodeArray$3(nodeFields$3(node).cases);
}
function labelName(node) {
	return nodeName$5(childNode$3(node, "label"));
}
function last(items) {
	return items[items.length - 1];
}
function shuffled(items) {
	const result = items.slice();
	for (let i = result.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		const tmp = result[i];
		result[i] = result[j];
		result[j] = tmp;
	}
	return result;
}
function switchCaseTestValue(node) {
	return nodeValue$3(childNode$3(node, "test"));
}
/**
* Push a SwitchCase onto an array while removing all identical SwitchCases
* @param {SwitchCase[]} arr
* @param {SwitchCase} elem
*/
function pushUniqSwitchCase(arr, elem) {
	const value = switchCaseTestValue(elem);
	for (let i = arr.length - 1; i >= 0; i -= 1) if (switchCaseTestValue(arr[i]) == value) arr.splice(i, 1);
	arr.push(elem);
}
/**
* Shuffle SwitchCase statements while respecting fall troughs.
* @param entries {SwitchCase[]} Array of the unshuffled cases
* @returns {SwitchCase[]} New array of the shuffled cases
*/
function shuffleSwitchCases(entries) {
	const groups = [];
	let stack = [];
	function clearStack() {
		if (stack.length > 0) {
			groups.push(stack);
			stack = [];
		}
	}
	entries.forEach((entry) => {
		if (bodyArray$2(entry).some((x) => x.type == "BreakStatement")) {
			clearStack();
			groups.push([entry]);
		} else stack.push(entry);
	});
	clearStack();
	return shuffled(groups).flat();
}
/**
* Merge nested BlockStatements (BlockStatements containing other BlockStatements)
* @param {BlockStatement} node Root BlockStatement
* @returns {BlockStatement} Merged BlockStatement
*/
function mergeNestedBlocks(node) {
	assert(estest_default.isNode(node));
	function getBlockBodies(child) {
		if (child.type == "Program" || child.type == "BlockStatement") {
			const stmts = [];
			bodyArray$2(child).forEach((stmt) => {
				stmts.push(...getBlockBodies(stmt));
			});
			return stmts;
		}
		return [child];
	}
	return {
		type: node.type,
		body: getBlockBodies(node)
	};
}
/**
* Split array of statements into array of compound statements and BlockStatements containing an array of non-compound statements
* @param {Node[]} nodes Array of statements
* @returns {Statement[]} Array of Statements
*/
function splitBlocks(nodes) {
	let stack = [];
	const output = [];
	for (let i = 0; i < nodes.length; ++i) if (estest_default.isCompoundStatement(nodes[i])) {
		if (stack.length > 0) {
			output.push({
				type: "BlockStatement",
				body: stack
			});
			stack = [];
		}
		output.push(nodes[i]);
	} else if (estest_default.isStatement(nodes[i])) stack.push(nodes[i]);
	else if (estest_default.isExpression(nodes[i])) {
		console.warn("Unexpected expression " + nodes[i].type);
		stack.push(nodes[i]);
	} else throw new Error("Illegal statement type " + nodes[i].type);
	if (stack.length > 0) output.push({
		type: "BlockStatement",
		body: stack
	});
	return output;
}
function targetFor(targets, label) {
	if (label) return targets.find((target) => target.label == label);
	return last(targets);
}
function memberScopeName(node) {
	if (node.type != "MemberExpression") return null;
	const object = childNode$3(node, "object");
	const property = childNode$3(node, "property");
	const objectName = nodeName$5(object);
	if (object?.type == "Identifier" && objectName?.startsWith("$$scope") && property?.type == "Literal" && typeof nodeValue$3(property) == "number") return objectName;
	return null;
}
function expressionStatement(expression) {
	return {
		type: "ExpressionStatement",
		expression
	};
}
function stateAssignment(value) {
	return expressionStatement({
		type: "AssignmentExpression",
		operator: "=",
		left: {
			type: "Identifier",
			name: "state"
		},
		right: {
			type: "Literal",
			value
		}
	});
}
function switchCase(entry, consequent) {
	return {
		type: "SwitchCase",
		test: {
			type: "Literal",
			value: entry
		},
		consequent
	};
}
var Flattener = class {
	logger;
	rng;
	emitter;
	output;
	handlers;
	breaks;
	continues;
	constructor(logger, rng) {
		this.logger = logger;
		this.rng = rng;
		this.emitter = new EventEmitter();
		this.output = [];
		this.handlers = [];
		this.breaks = [];
		this.continues = [];
	}
	/**
	* Transform method
	* @param {Statement} input Method body
	* @param {number} entry Entry point
	* @param {number} exit Exit point
	*/
	addMethod(input, entry, exit) {
		assert.ok(estest_default.isStatement(input));
		assert.equal(typeof entry, "number");
		assert.equal(typeof exit, "number");
		this.transformStatement(input, entry, exit);
	}
	/**
	* Get output switch construct
	* @param {number} entry Entry point
	* @param {number} exit Exit point
	* @returns {Statement} Switch construct
	*/
	getCases(entry, exit) {
		assert.equal(typeof entry, "number");
		assert.equal(typeof exit, "number");
		return {
			type: "TryStatement",
			block: {
				type: "BlockStatement",
				body: [{
					type: "SwitchStatement",
					discriminant: {
						type: "Identifier",
						name: "state"
					},
					cases: shuffleSwitchCases(this.output.concat([{
						type: "SwitchCase",
						test: {
							type: "Literal",
							value: exit
						},
						consequent: [{ type: "ReturnStatement" }]
					}]))
				}]
			},
			handler: {
				type: "CatchClause",
				param: {
					type: "Identifier",
					name: "e"
				},
				body: {
					type: "BlockStatement",
					body: [{
						type: "ExpressionStatement",
						expression: {
							type: "AssignmentExpression",
							operator: "=",
							left: {
								type: "Identifier",
								name: "toildefender$tobethrown"
							},
							right: {
								type: "Literal",
								value: null
							}
						}
					}, {
						type: "SwitchStatement",
						discriminant: {
							type: "Identifier",
							name: "state"
						},
						cases: this.handlers.concat({
							type: "SwitchCase",
							test: null,
							consequent: [{
								type: "ThrowStatement",
								argument: {
									type: "Identifier",
									name: "e"
								}
							}]
						})
					}]
				}
			}
		};
	}
	/**
	* Get output switch construct program
	* @param {number} entry Entry point
	* @param {number} exit Exit point
	* @param {Object} options Program options
	* @returns {Program} Switch construct program
	*/
	getProgram(entry, exit, options = {}) {
		assert.equal(typeof entry, "number");
		assert.equal(typeof exit, "number");
		const name = options.name || "main";
		const invoke = options.invoke !== false;
		const body = [{
			type: "FunctionDeclaration",
			id: {
				type: "Identifier",
				name
			},
			params: [{
				type: "Identifier",
				name: "state"
			}, {
				type: "Identifier",
				name: "scope"
			}],
			body: {
				type: "BlockStatement",
				body: [{
					type: "VariableDeclaration",
					kind: "var",
					declarations: [{
						type: "VariableDeclarator",
						id: {
							type: "Identifier",
							name: "toildefender$tobethrown"
						},
						init: null
					}]
				}, {
					type: "WhileStatement",
					test: {
						type: "Literal",
						value: true
					},
					body: this.getCases(entry, exit)
				}]
			},
			generator: options.generator === true,
			expression: false,
			async: options.async === true
		}];
		if (invoke) body.push({
			type: "ExpressionStatement",
			expression: {
				type: "CallExpression",
				callee: {
					type: "Identifier",
					name
				},
				arguments: [{
					type: "Literal",
					value: entry
				}, {
					type: "ObjectExpression",
					properties: []
				}]
			}
		});
		return {
			type: "Program",
			body
		};
	}
	/**
	* Import statement into control flow table
	* @param {Statement} node
	* @param {number} entry Entry point
	* @param {number} exit Exit point
	*/
	transformStatement(node, entry, exit) {
		assert(estest_default.isStatement(node));
		assert.equal(typeof entry, "number");
		assert.equal(typeof exit, "number");
		switch (node.type) {
			case "Program":
			case "BlockStatement":
				this.transformBlock(node, entry, exit);
				break;
			case "IfStatement":
				this.transformIf(node, entry, exit);
				break;
			case "WhileStatement":
				this.transformWhile(node, entry, exit);
				break;
			case "DoWhileStatement":
				this.transformDoWhile(node, entry, exit);
				break;
			case "SwitchStatement":
				this.transformSwitch(node, entry, exit);
				break;
			case "TryStatement":
				if (childNode$3(node, "handler") && !childNode$3(node, "finalizer")) this.transformTryCatch(node, entry, exit);
				else throw new Error("Not normalized");
				break;
			case "EmptyStatement": break;
			default:
				this.logger.warn("Unsupported type " + node.type);
				this.transformBlock({
					type: "BlockStatement",
					body: [node]
				}, entry, exit);
				break;
		}
	}
	/**
	* Import BlockStatement into control flow table
	* @param {BlockStatement} node
	* @param {number} entry Entry point
	* @param {number} exit Exit point
	*/
	transformBlock(node, entry, exit) {
		assert.ok(node.type == "Program" || node.type == "BlockStatement");
		assert.equal(typeof entry, "number");
		assert.equal(typeof exit, "number");
		node = mergeNestedBlocks(node);
		const blocks = splitBlocks(bodyArray$2(node));
		for (let i = 0; i < blocks.length; ++i) {
			if (blocks[i].type == "LabeledStatement") {
				const body = requiredChild$2(blocks[i], "body");
				setNodeField$2(body, "label", childNode$3(blocks[i], "label"));
				blocks[i] = body;
			}
			if (!estest_default.isStatement(blocks[i])) console.warn(blocks[i].type + " is not a statement");
			const partExit = i != blocks.length - 1 ? this.rng.get() : exit;
			if (blocks[i].type == "BlockStatement") this.transformSequence(blocks[i], entry, partExit);
			else this.transformStatement(blocks[i], entry, partExit);
			entry = partExit;
		}
	}
	/**
	* Import sequence from splitBlocks into control flow table
	* @param {BlockStatement} node
	* @param {number} entry Entry point
	* @param {number} exit Exit point
	*/
	transformSequence(node, entry, exit) {
		assert.equal(node.type, "BlockStatement");
		assert.equal(typeof entry, "number");
		assert.equal(typeof exit, "number");
		const stmts = [];
		if (!!bodyArray$2(node).every((stmt) => {
			assert(estest_default.isStatement(stmt), stmt.type + " is not a statement");
			switch (stmt.type) {
				case "BreakStatement": {
					const breakTarget = targetFor(this.breaks, labelName(stmt));
					assert(breakTarget, "No break target");
					stmts.push(stateAssignment(breakTarget.id));
					stmts.push({ type: "BreakStatement" });
					return false;
				}
				case "ContinueStatement": {
					const continueTarget = targetFor(this.continues, labelName(stmt));
					assert(continueTarget, "No continue target");
					stmts.push(stateAssignment(continueTarget.id));
					stmts.push({ type: "BreakStatement" });
					return false;
				}
				case "ReturnStatement":
					stmts.push(stmt);
					return false;
				case "EmptyStatement": return true;
				default:
					stmts.push(stmt);
					return true;
			}
		})) {
			stmts.push(stateAssignment(exit));
			stmts.push({ type: "BreakStatement" });
		}
		this.output.push(switchCase(entry, stmts));
		this.emitter.emit("branch", entry);
	}
	/**
	* Import IfStatement into control flow table
	* @param {IfStatement} node
	* @param {number} entry Entry point
	* @param {number} exit Exit point
	*/
	transformIf(node, entry, exit) {
		assert.equal(node.type, "IfStatement");
		assert.equal(typeof entry, "number");
		assert.equal(typeof exit, "number");
		const thenEntry = this.rng.get();
		const alternate = childNode$3(node, "alternate");
		const elseEntry = alternate ? this.rng.get() : exit;
		this.output.push(switchCase(entry, [{
			type: "ExpressionStatement",
			expression: {
				type: "AssignmentExpression",
				operator: "=",
				left: {
					type: "Identifier",
					name: "state"
				},
				right: {
					type: "ConditionalExpression",
					test: requiredChild$2(node, "test"),
					consequent: {
						type: "Literal",
						value: thenEntry
					},
					alternate: {
						type: "Literal",
						value: elseEntry
					}
				}
			}
		}, { type: "BreakStatement" }]));
		this.emitter.emit("branch", entry);
		this.transformStatement(requiredChild$2(node, "consequent"), thenEntry, exit);
		if (alternate) this.transformStatement(alternate, elseEntry, exit);
	}
	/**
	* Import WhileStatement into control flow table
	* @param {WhileStatement} node
	* @param {number} entry Entry point
	* @param {number} exit Exit point
	*/
	transformWhile(node, entry, exit) {
		assert.equal(node.type, "WhileStatement");
		assert.equal(typeof entry, "number");
		assert.equal(typeof exit, "number");
		const bodyEntry = this.rng.get();
		this.output.push(switchCase(entry, [{
			type: "ExpressionStatement",
			expression: {
				type: "AssignmentExpression",
				operator: "=",
				left: {
					type: "Identifier",
					name: "state"
				},
				right: {
					type: "ConditionalExpression",
					test: requiredChild$2(node, "test"),
					consequent: {
						type: "Literal",
						value: bodyEntry
					},
					alternate: {
						type: "Literal",
						value: exit
					}
				}
			}
		}, { type: "BreakStatement" }]));
		this.emitter.emit("branch", entry);
		this.breaks.push({
			label: labelName(node),
			id: exit
		});
		this.continues.push({
			label: labelName(node),
			id: entry
		});
		this.transformBlock(requiredChild$2(node, "body"), bodyEntry, entry);
		this.breaks.pop();
		this.continues.pop();
	}
	/**
	* Import DoWhileStatement into control flow table
	* @param {DoWhileStatement} node
	* @param {number} entry Entry point
	* @param {number} exit Exit point
	*/
	transformDoWhile(node, entry, exit) {
		assert.equal(node.type, "DoWhileStatement");
		assert.equal(typeof entry, "number");
		assert.equal(typeof exit, "number");
		const testEntry = this.rng.get();
		this.output.push(switchCase(testEntry, [{
			type: "ExpressionStatement",
			expression: {
				type: "AssignmentExpression",
				operator: "=",
				left: {
					type: "Identifier",
					name: "state"
				},
				right: {
					type: "ConditionalExpression",
					test: requiredChild$2(node, "test"),
					consequent: {
						type: "Literal",
						value: entry
					},
					alternate: {
						type: "Literal",
						value: exit
					}
				}
			}
		}, { type: "BreakStatement" }]));
		this.emitter.emit("branch", testEntry);
		this.breaks.push({
			label: labelName(node),
			id: exit
		});
		this.continues.push({
			label: labelName(node),
			id: entry
		});
		this.transformBlock(requiredChild$2(node, "body"), entry, testEntry);
		this.breaks.pop();
		this.continues.pop();
	}
	/**
	* Import SwitchStatement into control flow table
	* @param {SwitchStatement} node
	* @param {number} entry Entry point
	* @param {number} exit Exit point
	*/
	transformSwitch(node, entry, exit) {
		assert.equal(node.type, "SwitchStatement");
		assert.equal(typeof entry, "number");
		assert.equal(typeof exit, "number");
		const comps = [];
		const cases = switchCases(node);
		this.breaks.push({
			label: null,
			id: exit
		});
		let nextCaseEntry = this.rng.get();
		cases.forEach((caseNode, index) => {
			const isLast = index == cases.length - 1;
			const caseEntry = nextCaseEntry;
			nextCaseEntry = this.rng.get();
			const consequent = nodeArray$3(nodeFields$3(caseNode).consequent);
			if (consequent.length > 0) this.transformBlock({
				type: "BlockStatement",
				body: consequent
			}, caseEntry, isLast ? exit : nextCaseEntry);
			else nextCaseEntry = caseEntry;
			const test = childNode$3(caseNode, "test");
			if (test) comps.push({
				type: "IfStatement",
				test: {
					type: "BinaryExpression",
					operator: "==",
					left: utils_default.cloneISwearIKnowWhatImDoing(requiredChild$2(node, "discriminant")),
					right: test
				},
				consequent: {
					type: "BlockStatement",
					body: [stateAssignment(caseEntry), { type: "BreakStatement" }]
				}
			});
			else comps.push({
				type: "BlockStatement",
				body: [stateAssignment(caseEntry), { type: "BreakStatement" }]
			});
		});
		this.breaks.pop();
		this.output.push(switchCase(entry, comps));
	}
	/**
	* Import TryStatement into control flow table
	* @param {TryStatement} node
	* @param {number} entry Entry point
	* @param {number} exit Exit point
	*/
	transformTryCatch(node, entry, exit) {
		assert.equal(node.type, "TryStatement");
		assert.equal(typeof entry, "number");
		assert.equal(typeof exit, "number");
		const handler = requiredChild$2(node, "handler");
		assert.ok(!childNode$3(node, "finalizer"));
		const catchEntry = this.rng.get();
		const scopeDef = mutableBody$3(requiredChild$2(handler, "body")).splice(0, 2);
		const scopeDeclaration = scopeDef[0];
		const exceptionAssignment = scopeDef[1];
		const declarator = nodeDeclarations$2(scopeDeclaration)[0];
		const scopeName = nodeName$5(childNode$3(declarator, "id")) || "";
		const assignmentExpression = childNode$3(exceptionAssignment, "expression");
		const assignmentLeft = assignmentExpression ? childNode$3(assignmentExpression, "left") : null;
		const assignmentRight = assignmentExpression ? childNode$3(assignmentExpression, "right") : null;
		const exceptionReference = nodeFields$3(handler)["toildefender$exception"];
		assert(scopeDeclaration?.type == "VariableDeclaration" && nodeDeclarations$2(scopeDeclaration).length == 1 && scopeName.indexOf("$$scope") == 0, "First element of node.handler.body isn't a VariableDeclaration of a scope object");
		assert(exceptionAssignment?.type == "ExpressionStatement" && assignmentExpression?.type == "AssignmentExpression" && assignmentLeft?.type == "MemberExpression" && (nodeName$5(childNode$3(assignmentLeft, "object")) || "").indexOf("$$scope") == 0 && (nodeName$5(assignmentRight) || "").indexOf("$$var") == 0, "Second element of node.handler.body is not a e assignment");
		assert(estest_default.isNode(exceptionReference));
		const createHandler = (branchEntry) => {
			pushUniqSwitchCase(this.handlers, {
				type: "SwitchCase",
				test: {
					type: "Literal",
					value: branchEntry
				},
				consequent: [
					scopeDeclaration,
					{
						type: "ExpressionStatement",
						expression: {
							type: "AssignmentExpression",
							operator: "=",
							left: exceptionReference,
							right: {
								type: "Identifier",
								name: "e"
							}
						}
					},
					stateAssignment(catchEntry),
					{ type: "BreakStatement" }
				]
			});
		};
		this.emitter.on("branch", createHandler);
		this.transformBlock(requiredChild$2(node, "block"), entry, exit);
		this.emitter.removeListener("branch", createHandler);
		this.transformBlock(requiredChild$2(handler, "body"), catchEntry, exit);
	}
	/**
	* Transform duplicate scope and arguments into single unified declarations
	* @params {Node} ast Root node
	* @returns {Node}
	*/
	unifyPrefixStatements(ast) {
		const scopeObjects = /* @__PURE__ */ new Map();
		let maximumScopeIndex = 0;
		function ensureScopeObject(name) {
			let info = scopeObjects.get(name);
			if (!info) {
				info = {
					max: -1,
					offset: 0
				};
				scopeObjects.set(name, info);
			}
			return info;
		}
		traverser_default.traverse(ast, [], (node) => {
			if (nodeFlag$2(node, "toildefender$scopeObject")) {
				const declaration = nodeDeclarations$2(node)[0];
				const name = nodeName$5(childNode$3(declaration, "id"));
				if (name) ensureScopeObject(name);
			} else if (nodeFlag$2(node, "toildefender$scopeObjectReference")) {
				const name = memberScopeName(node);
				if (name) {
					const value = nodeValue$3(requiredChild$2(node, "property"));
					if (typeof value == "number") ensureScopeObject(name).max = Math.max(ensureScopeObject(name).max, value);
				}
			}
			return node;
		});
		if (scopeObjects.size > 1) return ast;
		let nextScopeOffset = 0;
		scopeObjects.forEach((info) => {
			info.offset = nextScopeOffset;
			nextScopeOffset += info.max + 1;
		});
		ast = traverser_default.traverse(ast, [], (node, stack) => {
			if (nodeFlag$2(node, "toildefender$reassigningArguments") && !nodeFlag$2(node, "toildefender$followsSlicingArguments")) node = { type: "EmptyStatement" };
			else if (nodeFlag$2(node, "toildefender$scopeObject")) node = { type: "EmptyStatement" };
			else if (nodeFlag$2(node, "toildefender$scopeObjectReference")) {
				const name = memberScopeName(node);
				const info = name ? scopeObjects.get(name) : null;
				const property = childNode$3(node, "property");
				const value = nodeValue$3(property);
				if (info && property && typeof value == "number") {
					const shifted = value + info.offset;
					setNodeValue(property, shifted);
					maximumScopeIndex = Math.max(maximumScopeIndex, shifted);
				}
				const object = childNode$3(node, "object");
				if (object?.type == "Identifier") setNodeName$1(object, "$$unifiedScope");
			} else if (node.type == "Identifier" && (nodeName$5(node) || "").startsWith("$$scope")) {
				const parent = stack[1]?.node;
				if (parent && nodeFlag$2(parent, "toildefender$scopeObjectReference")) return node;
				setNodeName$1(node, "$$unifiedScope");
			}
			return node;
		});
		const first = bodyArray$2(ast)[0];
		if (!first) return ast;
		const firstBody = childNode$3(first, "body");
		if (!firstBody) return ast;
		mutableBody$3(firstBody).splice(0, 0, {
			type: "ExpressionStatement",
			expression: {
				type: "VariableDeclaration",
				kind: "var",
				declarations: [{
					type: "VariableDeclarator",
					id: {
						type: "Identifier",
						name: "$$unifiedScope"
					},
					init: {
						type: "NewExpression",
						callee: {
							type: "Identifier",
							name: "Array"
						},
						arguments: [{
							type: "Literal",
							value: maximumScopeIndex
						}]
					}
				}]
			}
		}, {
			type: "VariableDeclaration",
			kind: "var",
			declarations: [{
				type: "VariableDeclarator",
				id: {
					type: "Identifier",
					name: "toildefender$arguments"
				},
				init: {
					type: "Identifier",
					name: "arguments"
				}
			}]
		});
		return ast;
	}
};
//#endregion
//#region src/processors/normalizer.ts
function nodeFields$2(node) {
	return node;
}
function nodeArray$2(value) {
	return Array.isArray(value) ? value : [];
}
function rawArray(value) {
	return Array.isArray(value) ? value : [];
}
function childNode$2(node, key) {
	const value = nodeFields$2(node)[key];
	return estest_default.isNode(value) ? value : null;
}
function requiredChild$1(node, key) {
	const child = childNode$2(node, key);
	assert.ok(child, `Missing ${node.type}.${key}`);
	return child;
}
function setNodeField$1(node, key, value) {
	nodeFields$2(node)[key] = value;
}
function nodeName$4(node) {
	const name = node?.name;
	return typeof name == "string" ? name : null;
}
function nodeValue$2(node) {
	return node?.value;
}
function nodeKind$2(node) {
	const kind = node.kind;
	return typeof kind == "string" ? kind : "var";
}
function nodeOperator$2(node) {
	const operator = node.operator;
	return typeof operator == "string" ? operator : null;
}
function nodeComputed$1(node) {
	return node.computed === true;
}
function nodeFlag$1(node, key) {
	return node[key] === true;
}
function bodyArray$1(node) {
	return nodeArray$2(nodeFields$2(node).body);
}
function mutableBody$2(node) {
	const body = nodeFields$2(node).body;
	if (Array.isArray(body)) return body;
	const nextBody = [];
	nodeFields$2(node).body = nextBody;
	return nextBody;
}
function nodeArguments$2(node) {
	return nodeArray$2(nodeFields$2(node).arguments);
}
function nodeParams$2(node) {
	return nodeArray$2(nodeFields$2(node).params);
}
function nodeDeclarations$1(node) {
	return nodeArray$2(nodeFields$2(node).declarations);
}
function nodeProperties$1(node) {
	return nodeArray$2(nodeFields$2(node).properties);
}
function nodeElements$1(node) {
	return rawArray(nodeFields$2(node).elements).map((element) => estest_default.isNode(element) ? element : null);
}
function undefinedExpression() {
	return {
		type: "Identifier",
		name: "undefined"
	};
}
function fallbackExpression(node, fallback) {
	return node || fallback;
}
/**
* Chain an array of expressions with an operator.
* @param {Expression[]} expressions
* @param {BinaryOperator} operator
* @returns {Expression}
*/
function chain(expressions, operator) {
	assert.ok(Array.isArray(expressions));
	assert.equal(typeof operator, "string");
	if (expressions.length == 0) return {
		type: "Literal",
		value: true
	};
	else if (expressions.length == 1) return expressions[0];
	else {
		let result = expressions[0];
		for (let i = 1; i < expressions.length; ++i) result = {
			type: "BinaryExpression",
			operator,
			left: result,
			right: expressions[i]
		};
		return result;
	}
}
/**
* Return node body as an array.
* @param {Node} node
* @returns {Node[]}
*/
function blockToArray(node) {
	assert.ok(estest_default.isNode(node));
	const body = nodeFields$2(node).body;
	if (Array.isArray(body)) return body;
	else if (estest_default.isNode(body)) return [body];
	else return [node];
}
function hasSpreadElement(nodes) {
	return nodes.some((node) => node.type == "SpreadElement");
}
function isSimpleThisReceiver(node) {
	return node.type == "Identifier" || node.type == "ThisExpression";
}
function buildArrayConcat(parts) {
	if (parts.length == 0) return {
		type: "ArrayExpression",
		elements: []
	};
	if (parts.length == 1) return parts[0];
	return {
		type: "CallExpression",
		callee: {
			type: "MemberExpression",
			object: parts[0],
			property: {
				type: "Identifier",
				name: "concat"
			},
			computed: false
		},
		arguments: parts.slice(1)
	};
}
function spreadArgumentsToArray(args) {
	const parts = [];
	let pending = [];
	function flushPending() {
		if (pending.length > 0) {
			parts.push({
				type: "ArrayExpression",
				elements: pending
			});
			pending = [];
		}
	}
	args.forEach((arg) => {
		if (arg.type == "SpreadElement") {
			flushPending();
			parts.push(requiredChild$1(arg, "argument"));
		} else pending.push(arg);
	});
	flushPending();
	return buildArrayConcat(parts);
}
function isLoopOrSwitch(node) {
	return node.type == "WhileStatement" || node.type == "DoWhileStatement" || node.type == "ForStatement" || node.type == "ForInStatement" || node.type == "ForOfStatement" || node.type == "SwitchStatement";
}
function exitsCurrentTry(node, stack) {
	if (node.type == "ReturnStatement") return true;
	if (node.type == "BreakStatement" || node.type == "ContinueStatement") return !stack.some((frame) => isLoopOrSwitch(frame.node));
	return false;
}
function withFinalizerBefore(node, finalizer) {
	const body = [];
	if (node.type == "ReturnStatement") {
		body.push({
			type: "VariableDeclaration",
			kind: "var",
			declarations: [{
				type: "VariableDeclarator",
				id: {
					type: "Identifier",
					name: "toildefender$return"
				},
				init: childNode$2(node, "argument")
			}]
		});
		body.push(utils_default.cloneISwearIKnowWhatImDoing(finalizer));
		body.push({
			type: "ReturnStatement",
			argument: {
				type: "Identifier",
				name: "toildefender$return"
			}
		});
	} else {
		body.push(utils_default.cloneISwearIKnowWhatImDoing(finalizer));
		body.push(node);
	}
	return {
		type: "BlockStatement",
		body
	};
}
function methodDefinitionName(method) {
	const key = method ? childNode$2(method, "key") : null;
	if (!key) return "";
	if (key.type == "Identifier" || key.type == "PrivateIdentifier") return nodeName$4(key) || "";
	if (key.type == "Literal") return String(nodeValue$2(key));
	return "";
}
function isConstructorMethod(method) {
	return method.type == "MethodDefinition" && nodeKind$2(method) == "constructor" && methodDefinitionName(method) == "constructor";
}
function privateStoreName(className, privateName) {
	return `$$private$${className}$${privateName}`;
}
function classFieldKey(field) {
	const key = requiredChild$1(field, "key");
	if (key.type == "Identifier") return {
		type: "Identifier",
		name: nodeName$4(key) || ""
	};
	if (key.type == "PrivateIdentifier") return {
		type: "Literal",
		value: nodeName$4(key) || ""
	};
	return key;
}
function assignmentStatement(left, right) {
	return {
		type: "ExpressionStatement",
		expression: {
			type: "AssignmentExpression",
			operator: "=",
			left,
			right: fallbackExpression(right, undefinedExpression())
		}
	};
}
function weakMapSetStatement(storeName, object, value) {
	return {
		type: "ExpressionStatement",
		expression: {
			type: "CallExpression",
			callee: {
				type: "MemberExpression",
				object: {
					type: "Identifier",
					name: storeName
				},
				property: {
					type: "Identifier",
					name: "set"
				},
				computed: false
			},
			arguments: [object, fallbackExpression(value, undefinedExpression())]
		}
	};
}
function weakMapGetExpression(storeName, object) {
	return {
		type: "CallExpression",
		callee: {
			type: "MemberExpression",
			object: {
				type: "Identifier",
				name: storeName
			},
			property: {
				type: "Identifier",
				name: "get"
			},
			computed: false
		},
		arguments: [object]
	};
}
function nullishTest(expression) {
	return {
		type: "BinaryExpression",
		operator: "==",
		left: expression,
		right: {
			type: "Literal",
			value: null
		}
	};
}
function notNullishTest(expression) {
	return {
		type: "BinaryExpression",
		operator: "!=",
		left: expression,
		right: {
			type: "Literal",
			value: null
		}
	};
}
function propertyKeyValue(property) {
	const key = requiredChild$1(property, "key");
	if (key.type == "Identifier") return nodeName$4(key) || "";
	if (key.type == "Literal") {
		const value = nodeValue$2(key);
		return typeof value == "string" || typeof value == "number" ? value : String(value);
	}
	return null;
}
function propertyMemberExpression(object, property) {
	const key = requiredChild$1(property, "key");
	return {
		type: "MemberExpression",
		object,
		property: key.type == "Identifier" ? {
			type: "Identifier",
			name: nodeName$4(key) || ""
		} : utils_default.cloneISwearIKnowWhatImDoing(key),
		computed: nodeComputed$1(property) || key.type == "Literal"
	};
}
function hasObjectPattern(pattern) {
	return pattern?.type == "ObjectPattern";
}
function hasArrayPattern(pattern) {
	return pattern?.type == "ArrayPattern";
}
function canLowerArrayPattern(pattern) {
	return pattern.type == "ArrayPattern" && nodeElements$1(pattern).every((element) => {
		if (element == null) return true;
		if (element.type == "Identifier") return true;
		if (element.type == "RestElement") return requiredChild$1(element, "argument").type == "Identifier";
		return element.type == "AssignmentPattern" && requiredChild$1(element, "left").type == "Identifier";
	});
}
function canLowerObjectRest(pattern) {
	return pattern.type == "ObjectPattern" && nodeProperties$1(pattern).every((prop) => {
		if (prop.type == "RestElement") return requiredChild$1(prop, "argument").type == "Identifier";
		const value = childNode$2(prop, "value");
		if (prop.type != "Property" || nodeComputed$1(prop) || propertyKeyValue(prop) == null || !value) return false;
		if (value.type == "Identifier") return true;
		return value.type == "AssignmentPattern" && requiredChild$1(value, "left").type == "Identifier";
	});
}
function hasObjectSpread(node) {
	return nodeProperties$1(node).some((prop) => prop.type == "SpreadElement");
}
function objectAssignCall(parts) {
	return {
		type: "CallExpression",
		callee: {
			type: "MemberExpression",
			object: {
				type: "Identifier",
				name: "Object"
			},
			property: {
				type: "Identifier",
				name: "assign"
			},
			computed: false
		},
		arguments: parts
	};
}
function objectWithoutKeysCall(source, keys) {
	return {
		type: "CallExpression",
		callee: {
			type: "Identifier",
			name: "toildefender$objectWithoutKeys"
		},
		arguments: [source, {
			type: "ArrayExpression",
			elements: keys.map((key) => ({
				type: "Literal",
				value: key
			}))
		}]
	};
}
function arrayElementExpression(sourceName, index) {
	return {
		type: "MemberExpression",
		object: {
			type: "Identifier",
			name: sourceName
		},
		property: {
			type: "Literal",
			value: index
		},
		computed: true
	};
}
function arrayRestExpression(sourceName, index) {
	return {
		type: "CallExpression",
		callee: {
			type: "MemberExpression",
			object: {
				type: "Identifier",
				name: sourceName
			},
			property: {
				type: "Identifier",
				name: "slice"
			},
			computed: false
		},
		arguments: [{
			type: "Literal",
			value: index
		}]
	};
}
function arrayPatternElementDeclaration(kind, sourceName, element, index) {
	if (element == null) return null;
	if (element.type == "RestElement") return {
		type: "VariableDeclaration",
		kind,
		declarations: [{
			type: "VariableDeclarator",
			id: requiredChild$1(element, "argument"),
			init: arrayRestExpression(sourceName, index)
		}]
	};
	let id = element;
	let init = arrayElementExpression(sourceName, index);
	if (element.type == "AssignmentPattern") {
		id = requiredChild$1(element, "left");
		init = {
			type: "ConditionalExpression",
			test: {
				type: "BinaryExpression",
				operator: "===",
				left: arrayElementExpression(sourceName, index),
				right: undefinedExpression()
			},
			consequent: requiredChild$1(element, "right"),
			alternate: arrayElementExpression(sourceName, index)
		};
	}
	return {
		type: "VariableDeclaration",
		kind,
		declarations: [{
			type: "VariableDeclarator",
			id,
			init
		}]
	};
}
function arrayPatternStatements(kind, pattern, init, rngAlpha) {
	const sourceName = `$$destructure$arr$${rngAlpha.get()}`;
	const statements = [{
		type: "VariableDeclaration",
		kind: "var",
		declarations: [{
			type: "VariableDeclarator",
			id: {
				type: "Identifier",
				name: sourceName
			},
			init: fallbackExpression(init, {
				type: "ArrayExpression",
				elements: []
			})
		}]
	}];
	nodeElements$1(pattern).forEach((element, index) => {
		const lowered = arrayPatternElementDeclaration(kind, sourceName, element, index);
		if (lowered) statements.push(lowered);
	});
	return statements;
}
function arrayPatternAssignmentStatement(sourceName, element, index) {
	if (element == null) return null;
	let left;
	let right;
	if (element.type == "RestElement") {
		left = requiredChild$1(element, "argument");
		right = arrayRestExpression(sourceName, index);
	} else if (element.type == "AssignmentPattern") {
		left = requiredChild$1(element, "left");
		right = {
			type: "ConditionalExpression",
			test: {
				type: "BinaryExpression",
				operator: "===",
				left: arrayElementExpression(sourceName, index),
				right: undefinedExpression()
			},
			consequent: requiredChild$1(element, "right"),
			alternate: arrayElementExpression(sourceName, index)
		};
	} else {
		left = element;
		right = arrayElementExpression(sourceName, index);
	}
	return assignmentStatement(left, right);
}
function arrayPatternAssignmentStatements(pattern, init, rngAlpha) {
	const sourceName = `$$destructure$arr$${rngAlpha.get()}`;
	const statements = [{
		type: "VariableDeclaration",
		kind: "var",
		declarations: [{
			type: "VariableDeclarator",
			id: {
				type: "Identifier",
				name: sourceName
			},
			init: fallbackExpression(init, {
				type: "ArrayExpression",
				elements: []
			})
		}]
	}];
	nodeElements$1(pattern).forEach((element, index) => {
		const lowered = arrayPatternAssignmentStatement(sourceName, element, index);
		if (lowered) statements.push(lowered);
	});
	return statements;
}
function objectPatternPropertyDeclaration(kind, sourceName, prop) {
	const member = propertyMemberExpression({
		type: "Identifier",
		name: sourceName
	}, prop);
	const value = requiredChild$1(prop, "value");
	let id = value;
	let init = member;
	if (value.type == "AssignmentPattern") {
		id = requiredChild$1(value, "left");
		init = {
			type: "ConditionalExpression",
			test: {
				type: "BinaryExpression",
				operator: "===",
				left: utils_default.cloneISwearIKnowWhatImDoing(member),
				right: undefinedExpression()
			},
			consequent: requiredChild$1(value, "right"),
			alternate: member
		};
	}
	return {
		type: "VariableDeclaration",
		kind,
		declarations: [{
			type: "VariableDeclarator",
			id,
			init
		}]
	};
}
function containsThisExpression(node) {
	let found = false;
	traverser_default.traverseEx(node, [], function(child) {
		if (child.type == "ThisExpression") {
			found = true;
			this.abort();
		}
		return child;
	});
	return found;
}
function defaultParameterStatement(param) {
	const left = requiredChild$1(param, "left");
	return {
		type: "IfStatement",
		test: {
			type: "BinaryExpression",
			operator: "===",
			left: utils_default.cloneISwearIKnowWhatImDoing(left),
			right: undefinedExpression()
		},
		consequent: {
			type: "BlockStatement",
			body: [{
				type: "ExpressionStatement",
				expression: {
					type: "AssignmentExpression",
					operator: "=",
					left: utils_default.cloneISwearIKnowWhatImDoing(left),
					right: requiredChild$1(param, "right")
				}
			}]
		}
	};
}
function restParameterStatement(param, index) {
	return {
		type: "VariableDeclaration",
		kind: "var",
		declarations: [{
			type: "VariableDeclarator",
			id: requiredChild$1(param, "argument"),
			init: {
				type: "CallExpression",
				callee: {
					type: "MemberExpression",
					object: {
						type: "MemberExpression",
						object: {
							type: "MemberExpression",
							object: {
								type: "Identifier",
								name: "Array"
							},
							property: {
								type: "Identifier",
								name: "prototype"
							},
							computed: false
						},
						property: {
							type: "Identifier",
							name: "slice"
						},
						computed: false
					},
					property: {
						type: "Identifier",
						name: "call"
					},
					computed: false
				},
				arguments: [{
					type: "Identifier",
					name: "arguments"
				}, {
					type: "Literal",
					value: index
				}]
			}
		}]
	};
}
function lowerFunctionParameters(node) {
	if (!estest_default.isFunction(node)) return node;
	const prefix = [];
	const params = [];
	nodeParams$2(node).forEach((param, index) => {
		if (param.type == "AssignmentPattern" && requiredChild$1(param, "left").type == "Identifier") {
			prefix.push(defaultParameterStatement(param));
			params.push(requiredChild$1(param, "left"));
			return;
		}
		if (param.type == "RestElement" && requiredChild$1(param, "argument").type == "Identifier") {
			prefix.push(restParameterStatement(param, index));
			return;
		}
		params.push(param);
	});
	setNodeField$1(node, "params", params);
	if (prefix.length == 0) return node;
	const body = requiredChild$1(node, "body");
	if (body.type != "BlockStatement") setNodeField$1(node, "body", {
		type: "BlockStatement",
		body: [{
			type: "ReturnStatement",
			argument: body
		}]
	});
	const nextBody = requiredChild$1(node, "body");
	setNodeField$1(nextBody, "body", prefix.concat(bodyArray$1(nextBody)));
	return node;
}
function blockNeedsLexicalScope(node) {
	if (node.type != "BlockStatement") return false;
	let needsScope = false;
	traverser_default.traverseEx(node, [], function(child) {
		if (child != node && estest_default.isFunction(child)) return child;
		if (child.type == "VariableDeclaration" && nodeKind$2(child) != "var" || child.type == "ClassDeclaration") {
			needsScope = true;
			this.abort();
		}
		return child;
	});
	return needsScope;
}
var Normalizer = class {
	logger;
	rngAlpha;
	constructor(logger) {
		this.logger = logger;
		this.rngAlpha = new utils_default.UniqueRandomAlpha(3);
	}
	/**
	* Simplify AST.
	* @param {Node} ast Root node
	* @returns {Node}
	*/
	simplify(ast) {
		assert.ok(estest_default.isNode(ast));
		return traverser_default.traverse(ast, [], (node, stack) => {
			switch (node.type) {
				case "Program":
				case "BlockStatement": return this.simplifyBlockStatement(node);
				case "ForStatement": return this.simplifyForStatement(node);
				case "ForInStatement": return this.simplifyForStatement(this.simplifyForInStatement(node));
				case "ForOfStatement": return this.simplifyForOfStatement(node);
				case "TryStatement": return this.simplifyTryStatement(node);
				case "CallExpression": return this.simplifyCallExpression(node);
				case "ExpressionStatement": return this.simplifyExpressionStatement(node);
				case "ChainExpression": return this.simplifyChainExpression(node);
				case "LogicalExpression": return this.simplifyLogicalExpression(node);
				case "ObjectExpression": return this.simplifyObjectExpression(node);
				case "VariableDeclaration": return this.simplifyVariableDeclaration(node, stack);
				case "FunctionDeclaration":
				case "FunctionExpression": return lowerFunctionParameters(node);
				case "ArrowFunctionExpression": return this.simplifyArrowFunctionExpression(node);
				case "ClassDeclaration": return this.simplifyClassDeclaration(node);
				default: return node;
			}
		});
	}
	/**
	* Simplify BlockStatement.
	* @param {BlockStatement} node
	* @return {Node}
	*/
	simplifyBlockStatement(node) {
		assert.ok(estest_default.isNode(node));
		function getBlockBodies(child, isRoot) {
			if (child.type == "Program" || child.type == "BlockStatement") {
				if (!isRoot && blockNeedsLexicalScope(child)) return [child];
				const stmts = [];
				bodyArray$1(child).forEach((stmt) => {
					stmts.push(...getBlockBodies(stmt, false));
				});
				return stmts;
			}
			return [child];
		}
		return {
			type: node.type,
			body: getBlockBodies(node, true)
		};
	}
	/**
	* Simplify WhileStatement.
	* @param {WhileStatement} node
	* @return {Node}
	*/
	simplifyWhileStatement(node) {
		assert.ok(estest_default.isNode(node));
		return {
			type: "WhileStatement",
			test: childNode$2(node, "test"),
			body: {
				type: "IfStatement",
				test: childNode$2(node, "test"),
				consequent: requiredChild$1(node, "body"),
				alternate: { type: "BreakStatement" }
			}
		};
	}
	/**
	* Simplify DoWhileStatement.
	* @param {DoWhileStatement} node
	* @return {Node}
	*/
	simplifyDoWhileStatement(node) {
		assert.ok(estest_default.isNode(node));
		return {
			type: "WhileStatement",
			test: {
				type: "Literal",
				value: true
			},
			body: {
				type: "BlockStatement",
				body: [requiredChild$1(node, "body"), {
					type: "IfStatement",
					test: requiredChild$1(node, "test"),
					consequent: { type: "EmptyStatement" },
					alternate: { type: "BreakStatement" }
				}]
			}
		};
	}
	/**
	* Simplify ForStatement.
	* @param {ForStatement} node
	* @return {Node}
	*/
	simplifyForStatement(node) {
		assert.ok(estest_default.isNode(node));
		const body = [];
		const init = childNode$2(node, "init");
		if (init) if (estest_default.isStatement(init)) body.push(init);
		else if (estest_default.isExpression(init)) body.push({
			type: "ExpressionStatement",
			expression: init
		});
		else throw new Error("Invalid node.init type " + init.type);
		const update = childNode$2(node, "update");
		body.push({
			type: "WhileStatement",
			test: childNode$2(node, "test"),
			body: {
				type: "BlockStatement",
				body: blockToArray(requiredChild$1(node, "body")).concat(update ? [{
					type: "ExpressionStatement",
					expression: update
				}] : [])
			}
		});
		return {
			type: "BlockStatement",
			body
		};
	}
	/**
	* Simplify ForInStatement.
	* @param {ForInStatement} node
	* @return {Node}
	*/
	simplifyForInStatement(node) {
		assert.ok(estest_default.isNode(node));
		const propsName = `$$forin$props$${this.rngAlpha.get()}`;
		const iterName = `$$forin$iter$${this.rngAlpha.get()}`;
		const left = requiredChild$1(node, "left");
		const valueAtIndex = {
			type: "MemberExpression",
			object: {
				type: "Identifier",
				name: propsName
			},
			property: {
				type: "Identifier",
				name: iterName
			},
			computed: true
		};
		let assignStatements;
		if (left.type == "VariableDeclaration") {
			const declaration = nodeDeclarations$1(left)[0];
			const id = requiredChild$1(declaration, "id");
			if (hasArrayPattern(id) && canLowerArrayPattern(id)) assignStatements = arrayPatternStatements(nodeKind$2(left) == "const" ? "let" : nodeKind$2(left), id, valueAtIndex, this.rngAlpha);
			else assignStatements = [{
				type: "VariableDeclaration",
				kind: "var",
				declarations: [{
					type: "VariableDeclarator",
					id,
					init: valueAtIndex
				}]
			}];
		} else if (hasArrayPattern(left) && canLowerArrayPattern(left)) assignStatements = arrayPatternAssignmentStatements(left, valueAtIndex, this.rngAlpha);
		else assignStatements = [assignmentStatement(left, valueAtIndex)];
		return {
			type: "ForStatement",
			init: {
				type: "VariableDeclaration",
				kind: "var",
				declarations: [{
					type: "VariableDeclarator",
					id: {
						type: "Identifier",
						name: propsName
					},
					init: {
						type: "CallExpression",
						callee: {
							type: "MemberExpression",
							object: {
								type: "Identifier",
								name: "Object"
							},
							property: {
								type: "Identifier",
								name: "keys"
							},
							computed: false
						},
						arguments: [requiredChild$1(node, "right")]
					}
				}, {
					type: "VariableDeclarator",
					id: {
						type: "Identifier",
						name: iterName
					},
					init: {
						type: "Literal",
						value: 0
					}
				}]
			},
			test: {
				type: "BinaryExpression",
				operator: "<",
				left: {
					type: "Identifier",
					name: iterName
				},
				right: {
					type: "MemberExpression",
					object: {
						type: "Identifier",
						name: propsName
					},
					property: {
						type: "Identifier",
						name: "length"
					},
					computed: false
				}
			},
			update: {
				type: "UpdateExpression",
				operator: "++",
				argument: {
					type: "Identifier",
					name: iterName
				},
				prefix: true
			},
			body: {
				type: "BlockStatement",
				body: assignStatements.concat([requiredChild$1(node, "body")])
			}
		};
	}
	/**
	* Simplify ForOfStatement to an index-based ForStatement.
	* @param {ForOfStatement} node
	* @return {Node}
	*/
	simplifyForOfStatement(node) {
		assert.ok(estest_default.isNode(node));
		const valuesName = `$$forof$values$${this.rngAlpha.get()}`;
		const iterName = `$$forof$iter$${this.rngAlpha.get()}`;
		const left = requiredChild$1(node, "left");
		const valueAtIndex = {
			type: "MemberExpression",
			object: {
				type: "Identifier",
				name: valuesName
			},
			property: {
				type: "Identifier",
				name: iterName
			},
			computed: true
		};
		let assignStatements;
		if (left.type == "VariableDeclaration") {
			const declaration = nodeDeclarations$1(left)[0];
			const id = requiredChild$1(declaration, "id");
			if (hasArrayPattern(id) && canLowerArrayPattern(id)) assignStatements = arrayPatternStatements(nodeKind$2(left) == "const" ? "let" : nodeKind$2(left), id, valueAtIndex, this.rngAlpha);
			else assignStatements = [{
				type: "VariableDeclaration",
				kind: nodeKind$2(left) == "const" ? "let" : nodeKind$2(left),
				declarations: [{
					type: "VariableDeclarator",
					id,
					init: valueAtIndex
				}]
			}];
		} else if (hasArrayPattern(left) && canLowerArrayPattern(left)) assignStatements = arrayPatternAssignmentStatements(left, valueAtIndex, this.rngAlpha);
		else assignStatements = [assignmentStatement(left, valueAtIndex)];
		return {
			type: "BlockStatement",
			body: [{
				type: "VariableDeclaration",
				kind: "var",
				declarations: [{
					type: "VariableDeclarator",
					id: {
						type: "Identifier",
						name: valuesName
					},
					init: requiredChild$1(node, "right")
				}, {
					type: "VariableDeclarator",
					id: {
						type: "Identifier",
						name: iterName
					},
					init: {
						type: "Literal",
						value: 0
					}
				}]
			}, {
				type: "ForStatement",
				init: null,
				test: {
					type: "BinaryExpression",
					operator: "<",
					left: {
						type: "Identifier",
						name: iterName
					},
					right: {
						type: "MemberExpression",
						object: {
							type: "Identifier",
							name: valuesName
						},
						property: {
							type: "Identifier",
							name: "length"
						},
						computed: false
					}
				},
				update: {
					type: "UpdateExpression",
					operator: "++",
					argument: {
						type: "Identifier",
						name: iterName
					},
					prefix: false
				},
				body: {
					type: "BlockStatement",
					body: assignStatements.concat(blockToArray(requiredChild$1(node, "body")))
				}
			}]
		};
	}
	/**
	* Simplify SwitchStatement.
	* @param {SwitchStatement} node
	* @return {Node}
	*/
	simplifySwitchStatement(node) {
		assert.ok(estest_default.isNode(node));
		const cases = nodeArray$2(nodeFields$2(node).cases).map((caseNode) => {
			const consequent = nodeArray$2(nodeFields$2(caseNode).consequent);
			const breakIndex = consequent.findIndex((child) => child.type == "BreakStatement");
			return {
				test: childNode$2(caseNode, "test"),
				statements: breakIndex != -1 ? consequent.slice(0, breakIndex) : consequent,
				breaks: breakIndex != -1
			};
		});
		let stack = [];
		const ifStmts = [];
		for (let i = 0; i < cases.length; ++i) {
			stack.push(cases[i]);
			if (cases[i].breaks) {
				let ifStmt = null;
				for (let j = 0; j < stack.length; ++j) {
					const sliced = stack.slice(0, j + 1);
					if (sliced.every((entry) => entry.test)) ifStmt = {
						type: "IfStatement",
						test: chain(sliced.map((entry) => {
							return {
								type: "BinaryExpression",
								operator: "==",
								left: entry.test || {
									type: "Literal",
									value: null
								},
								right: requiredChild$1(node, "discriminant")
							};
						}), "||"),
						consequent: {
							type: "BlockStatement",
							body: [...ifStmt ? [ifStmt] : [], ...stack[j].statements]
						}
					};
					else ifStmt = {
						type: "BlockStatement",
						body: [...ifStmt ? [ifStmt] : [], ...stack[j].statements]
					};
				}
				if (ifStmt) ifStmts.push(ifStmt);
				stack = [];
			}
		}
		this.logger.log(ifStmts);
		let combinedIfStmt = ifStmts[ifStmts.length - 1] || { type: "EmptyStatement" };
		for (let i = ifStmts.length - 2; i >= 0; --i) combinedIfStmt = {
			type: "IfStatement",
			test: requiredChild$1(ifStmts[i], "test"),
			consequent: requiredChild$1(ifStmts[i], "consequent"),
			alternate: combinedIfStmt
		};
		return combinedIfStmt;
	}
	/**
	* Simplify TryStatement.
	* @param {TryStatement} node
	* @return {Node}
	*/
	simplifyTryStatement(node) {
		assert.ok(estest_default.isNode(node));
		const finalizer = childNode$2(node, "finalizer");
		const handler = childNode$2(node, "handler");
		if (finalizer) {
			if (handler) return this.simplifyTryStatement({
				type: "TryStatement",
				block: {
					type: "BlockStatement",
					body: [{
						type: "TryStatement",
						block: requiredChild$1(node, "block"),
						handler
					}]
				},
				finalizer
			});
			const block = requiredChild$1(node, "block");
			traverser_default.traverseEx(block, [], function(child, stack) {
				if (stack.some((x) => estest_default.isFunction(x.node))) {
					this.abort();
					return child;
				} else if (exitsCurrentTry(child, stack)) return withFinalizerBefore(child, finalizer);
				return child;
			});
			return {
				type: "BlockStatement",
				body: [
					{
						type: "TryStatement",
						block,
						handler: {
							type: "CatchClause",
							param: {
								type: "Identifier",
								name: "toildefender$e"
							},
							body: {
								type: "BlockStatement",
								body: [{
									type: "VariableDeclaration",
									kind: "var",
									declarations: [{
										type: "VariableDeclarator",
										id: {
											type: "Identifier",
											name: "toildefender$_e"
										},
										init: {
											type: "Identifier",
											name: "toildefender$e"
										}
									}]
								}]
							}
						}
					},
					finalizer,
					{
						type: "IfStatement",
						test: {
							type: "Identifier",
							name: "toildefender$_e"
						},
						consequent: {
							type: "ThrowStatement",
							argument: {
								type: "Identifier",
								name: "toildefender$_e"
							}
						}
					}
				]
			};
		}
		return node;
	}
	/**
	* Lower simple spread calls like target.push(...items) to
	* target.push.apply(target, items). This keeps append-style calls stable
	* even when Babel is disabled.
	* @param {CallExpression} node
	* @return {Node}
	*/
	simplifyCallExpression(node) {
		assert.ok(estest_default.isNode(node));
		const args = nodeArguments$2(node);
		if (!hasSpreadElement(args)) return node;
		const callee = requiredChild$1(node, "callee");
		let thisArg = {
			type: "Literal",
			value: null
		};
		if (callee.type == "MemberExpression") {
			const object = requiredChild$1(callee, "object");
			if (!isSimpleThisReceiver(object)) return node;
			thisArg = utils_default.cloneISwearIKnowWhatImDoing(object);
		}
		return {
			type: "CallExpression",
			callee: {
				type: "MemberExpression",
				object: callee,
				property: {
					type: "Identifier",
					name: "apply"
				},
				computed: false
			},
			arguments: [thisArg, spreadArgumentsToArray(args)]
		};
	}
	simplifyExpressionStatement(node) {
		assert.ok(estest_default.isNode(node));
		const expression = requiredChild$1(node, "expression");
		const left = childNode$2(expression, "left");
		if (expression.type == "AssignmentExpression" && nodeOperator$2(expression) == "=" && hasArrayPattern(left) && left && canLowerArrayPattern(left)) return {
			type: "BlockStatement",
			body: arrayPatternAssignmentStatements(left, childNode$2(expression, "right"), this.rngAlpha)
		};
		return node;
	}
	/**
	* Lower optional chains to conditional expressions before legacy passes.
	* This intentionally targets deterministic AST compatibility rather than
	* Babel-perfect single-evaluation semantics for every exotic receiver.
	* @param {ChainExpression} node
	* @return {Node}
	*/
	simplifyChainExpression(node) {
		assert.ok(estest_default.isNode(node));
		return this.lowerOptionalChain(requiredChild$1(node, "expression"));
	}
	lowerOptionalChain(node) {
		if (node.type == "MemberExpression") {
			const object = this.lowerOptionalChain(requiredChild$1(node, "object"));
			const member = {
				type: "MemberExpression",
				object: utils_default.cloneISwearIKnowWhatImDoing(object),
				property: requiredChild$1(node, "property"),
				computed: nodeComputed$1(node)
			};
			if (nodeFlag$1(node, "optional")) return {
				type: "ConditionalExpression",
				test: nullishTest(utils_default.cloneISwearIKnowWhatImDoing(object)),
				consequent: undefinedExpression(),
				alternate: member
			};
			return member;
		}
		if (node.type == "CallExpression") {
			const calleeNode = requiredChild$1(node, "callee");
			if (calleeNode.type == "MemberExpression") return this.lowerOptionalMemberCall(node);
			const callee = this.lowerOptionalChain(calleeNode);
			const call = {
				type: "CallExpression",
				callee: utils_default.cloneISwearIKnowWhatImDoing(callee),
				arguments: nodeArguments$2(node),
				optional: false
			};
			if (nodeFlag$1(node, "optional")) return {
				type: "ConditionalExpression",
				test: nullishTest(utils_default.cloneISwearIKnowWhatImDoing(callee)),
				consequent: undefinedExpression(),
				alternate: call
			};
			return call;
		}
		return node;
	}
	lowerOptionalMemberCall(node) {
		const member = requiredChild$1(node, "callee");
		const object = this.lowerOptionalChain(requiredChild$1(member, "object"));
		const directMember = {
			type: "MemberExpression",
			object: utils_default.cloneISwearIKnowWhatImDoing(object),
			property: requiredChild$1(member, "property"),
			computed: nodeComputed$1(member)
		};
		let alternate;
		if (nodeFlag$1(node, "optional")) {
			alternate = {
				type: "CallExpression",
				callee: {
					type: "MemberExpression",
					object: utils_default.cloneISwearIKnowWhatImDoing(directMember),
					property: {
						type: "Identifier",
						name: "call"
					},
					computed: false
				},
				arguments: [utils_default.cloneISwearIKnowWhatImDoing(object)].concat(nodeArguments$2(node)),
				optional: false
			};
			alternate = {
				type: "ConditionalExpression",
				test: nullishTest(utils_default.cloneISwearIKnowWhatImDoing(directMember)),
				consequent: undefinedExpression(),
				alternate
			};
		} else alternate = {
			type: "CallExpression",
			callee: directMember,
			arguments: nodeArguments$2(node),
			optional: false
		};
		if (nodeFlag$1(member, "optional")) return {
			type: "ConditionalExpression",
			test: nullishTest(utils_default.cloneISwearIKnowWhatImDoing(object)),
			consequent: undefinedExpression(),
			alternate
		};
		return alternate;
	}
	/**
	* Lower nullish coalescing to an ES5-compatible conditional expression.
	* @param {LogicalExpression} node
	* @return {Node}
	*/
	simplifyLogicalExpression(node) {
		assert.ok(estest_default.isNode(node));
		if (nodeOperator$2(node) != "??") return node;
		return {
			type: "ConditionalExpression",
			test: notNullishTest(utils_default.cloneISwearIKnowWhatImDoing(requiredChild$1(node, "left"))),
			consequent: requiredChild$1(node, "left"),
			alternate: requiredChild$1(node, "right")
		};
	}
	/**
	* Lower object spread to Object.assign({}, ...parts).
	* @param {ObjectExpression} node
	* @return {Node}
	*/
	simplifyObjectExpression(node) {
		assert.ok(estest_default.isNode(node));
		if (!hasObjectSpread(node)) return node;
		const parts = [{
			type: "ObjectExpression",
			properties: []
		}];
		let pending = [];
		function flushPending() {
			if (pending.length > 0) {
				parts.push({
					type: "ObjectExpression",
					properties: pending
				});
				pending = [];
			}
		}
		nodeProperties$1(node).forEach((prop) => {
			if (prop.type == "SpreadElement") {
				flushPending();
				parts.push(requiredChild$1(prop, "argument"));
			} else pending.push(prop);
		});
		flushPending();
		return objectAssignCall(parts);
	}
	/**
	* Lower simple object rest declarations:
	*   const { a, ...rest } = source
	* becomes:
	*   var tmp = source; var a = tmp.a; var rest = withoutKeys(tmp, ["a"])
	* @param {VariableDeclaration} node
	* @param {Node[]} stack
	* @return {Node}
	*/
	simplifyVariableDeclaration(node, stack) {
		assert.ok(estest_default.isNode(node));
		const declarations = nodeDeclarations$1(node);
		if (!declarations.some((decl) => hasObjectPattern(childNode$2(decl, "id")) || hasArrayPattern(childNode$2(decl, "id")))) return node;
		if (declarations.some((decl) => {
			const id = childNode$2(decl, "id");
			return hasObjectPattern(id) && id !== null && !canLowerObjectRest(id);
		})) return node;
		if (declarations.some((decl) => {
			const id = childNode$2(decl, "id");
			return hasArrayPattern(id) && id !== null && !canLowerArrayPattern(id);
		})) return node;
		const parentFrame = stack[1];
		if (parentFrame && parentFrame.node.type == "ForStatement" && parentFrame.key == "init") return node;
		if (parentFrame && (parentFrame.node.type == "ForOfStatement" || parentFrame.node.type == "ForInStatement") && parentFrame.key == "left") return node;
		let statements = [];
		let normalDeclarations = [];
		const declarationKind = "var";
		function flushNormalDeclarations() {
			if (normalDeclarations.length > 0) {
				statements.push({
					type: "VariableDeclaration",
					kind: declarationKind,
					declarations: normalDeclarations
				});
				normalDeclarations = [];
			}
		}
		declarations.forEach((decl) => {
			const id = requiredChild$1(decl, "id");
			if (!hasObjectPattern(id) && !hasArrayPattern(id)) {
				normalDeclarations.push(decl);
				return;
			}
			flushNormalDeclarations();
			if (hasArrayPattern(id)) {
				statements = statements.concat(arrayPatternStatements("var", id, childNode$2(decl, "init"), this.rngAlpha));
				return;
			}
			const sourceName = `$$destructure$obj$${this.rngAlpha.get()}`;
			statements.push({
				type: "VariableDeclaration",
				kind: "var",
				declarations: [{
					type: "VariableDeclarator",
					id: {
						type: "Identifier",
						name: sourceName
					},
					init: fallbackExpression(childNode$2(decl, "init"), {
						type: "ObjectExpression",
						properties: []
					})
				}]
			});
			const excluded = [];
			nodeProperties$1(id).forEach((prop) => {
				if (prop.type == "RestElement") {
					statements.push({
						type: "VariableDeclaration",
						kind: declarationKind,
						declarations: [{
							type: "VariableDeclarator",
							id: requiredChild$1(prop, "argument"),
							init: objectWithoutKeysCall({
								type: "Identifier",
								name: sourceName
							}, excluded)
						}]
					});
					return;
				}
				const key = propertyKeyValue(prop);
				excluded.push(String(key));
				statements.push(objectPatternPropertyDeclaration(declarationKind, sourceName, prop));
			});
		});
		flushNormalDeclarations();
		return {
			type: "BlockStatement",
			body: statements
		};
	}
	/**
	* Lower arrows so scope/control-flow passes do not leave callback bodies
	* inside an outer flattened frame. Bind lexical this only when needed.
	* @param {ArrowFunctionExpression} node
	* @return {Node}
	*/
	simplifyArrowFunctionExpression(node) {
		assert.ok(estest_default.isNode(node));
		const body = requiredChild$1(node, "body");
		let fn = {
			type: "FunctionExpression",
			id: null,
			params: nodeParams$2(node),
			body: body.type == "BlockStatement" ? body : {
				type: "BlockStatement",
				body: [{
					type: "ReturnStatement",
					argument: body
				}]
			},
			generator: false,
			expression: false,
			async: nodeFlag$1(node, "async")
		};
		if (nodeFlag$1(node, "toildefender$noNumericVm")) setNodeField$1(fn, "toildefender$noNumericVm", true);
		fn = lowerFunctionParameters(fn);
		if (!containsThisExpression(requiredChild$1(fn, "body"))) return fn;
		return {
			type: "CallExpression",
			callee: {
				type: "MemberExpression",
				object: fn,
				property: {
					type: "Identifier",
					name: "bind"
				},
				computed: false
			},
			arguments: [{ type: "ThisExpression" }]
		};
	}
	/**
	* Lower class fields/private fields to older ESTree nodes that escodegen
	* and the classic passes can handle.
	* @param {ClassDeclaration} node
	* @return {Node}
	*/
	simplifyClassDeclaration(node) {
		assert.ok(estest_default.isNode(node));
		const className = nodeName$4(childNode$2(node, "id")) || `$$class$${this.rngAlpha.get()}`;
		const privateStores = {};
		const instanceInitializers = [];
		const staticAssignments = [];
		const methods = [];
		const classBody = requiredChild$1(node, "body");
		bodyArray$1(classBody).forEach((element) => {
			if (element.type != "PropertyDefinition" && element.type != "FieldDefinition") {
				methods.push(element);
				return;
			}
			const key = requiredChild$1(element, "key");
			if (key.type == "PrivateIdentifier") {
				const keyName = nodeName$4(key) || "";
				const storeName = privateStoreName(className, keyName);
				privateStores[keyName] = storeName;
				if (nodeFlag$1(element, "static")) staticAssignments.push(weakMapSetStatement(storeName, {
					type: "Identifier",
					name: className
				}, childNode$2(element, "value")));
				else instanceInitializers.push(weakMapSetStatement(storeName, { type: "ThisExpression" }, childNode$2(element, "value")));
				return;
			}
			const target = {
				type: "MemberExpression",
				object: nodeFlag$1(element, "static") ? {
					type: "Identifier",
					name: className
				} : { type: "ThisExpression" },
				property: classFieldKey(element),
				computed: nodeComputed$1(element) || key.type == "Literal"
			};
			if (nodeFlag$1(element, "static")) staticAssignments.push(assignmentStatement(target, childNode$2(element, "value")));
			else instanceInitializers.push(assignmentStatement(target, childNode$2(element, "value")));
		});
		methods.forEach((method) => {
			this.lowerPrivateMembers(method, privateStores);
		});
		if (instanceInitializers.length > 0) {
			let constructor = methods.find(isConstructorMethod);
			if (!constructor) {
				constructor = {
					type: "MethodDefinition",
					key: {
						type: "Identifier",
						name: "constructor"
					},
					computed: false,
					value: {
						type: "FunctionExpression",
						id: null,
						params: [],
						body: {
							type: "BlockStatement",
							body: childNode$2(node, "superClass") ? [{
								type: "ExpressionStatement",
								expression: {
									type: "CallExpression",
									callee: { type: "Super" },
									arguments: []
								}
							}] : []
						},
						generator: false,
						expression: false,
						async: false
					},
					kind: "constructor",
					static: false
				};
				methods.unshift(constructor);
			}
			const body = mutableBody$2(requiredChild$1(requiredChild$1(constructor, "value"), "body"));
			let insertAt = 0;
			if (childNode$2(node, "superClass")) {
				const superIndex = body.findIndex((stmt) => {
					const expression = childNode$2(stmt, "expression");
					const callee = expression ? childNode$2(expression, "callee") : null;
					return stmt.type == "ExpressionStatement" && expression?.type == "CallExpression" && callee?.type == "Super";
				});
				insertAt = superIndex == -1 ? 0 : superIndex + 1;
			}
			body.splice(insertAt, 0, ...instanceInitializers);
		}
		setNodeField$1(classBody, "body", methods);
		const privateDeclarations = Object.keys(privateStores).map((name) => {
			return {
				type: "VariableDeclaration",
				kind: "var",
				declarations: [{
					type: "VariableDeclarator",
					id: {
						type: "Identifier",
						name: privateStores[name]
					},
					init: {
						type: "NewExpression",
						callee: {
							type: "Identifier",
							name: "WeakMap"
						},
						arguments: []
					}
				}]
			};
		});
		if (privateDeclarations.length == 0 && staticAssignments.length == 0) return node;
		return {
			type: "BlockStatement",
			body: [
				...privateDeclarations,
				node,
				...staticAssignments
			]
		};
	}
	lowerPrivateMembers(node, privateStores) {
		traverser_default.traverse(node, [], (child, stack) => {
			const parentFrame = stack[1];
			if (child.type == "MemberExpression" && parentFrame && parentFrame.node.type == "AssignmentExpression" && parentFrame.key == "left") return child;
			const left = childNode$2(child, "left");
			if (child.type == "AssignmentExpression" && left?.type == "MemberExpression") {
				const property = childNode$2(left, "property");
				const storeName = property?.type == "PrivateIdentifier" ? privateStores[nodeName$4(property) || ""] : void 0;
				if (storeName) return {
					type: "CallExpression",
					callee: {
						type: "MemberExpression",
						object: {
							type: "Identifier",
							name: storeName
						},
						property: {
							type: "Identifier",
							name: "set"
						},
						computed: false
					},
					arguments: [requiredChild$1(left, "object"), requiredChild$1(child, "right")]
				};
			}
			if (child.type == "MemberExpression") {
				const property = childNode$2(child, "property");
				const storeName = property?.type == "PrivateIdentifier" ? privateStores[nodeName$4(property) || ""] : void 0;
				if (storeName) return weakMapGetExpression(storeName, requiredChild$1(child, "object"));
			}
			return child;
		});
	}
};
//#endregion
//#region src/processors/postprocessing.ts
function astNodeArray(value) {
	return Array.isArray(value) ? value : [];
}
function nodeArguments$1(node) {
	return astNodeArray(node.arguments);
}
function setNodeArguments(node, args) {
	node.arguments = args;
}
function nodeBody$1(node) {
	return astNodeArray(node.body);
}
function setNodeBody(node, body) {
	node.body = body;
}
function nodeConsequent(node) {
	return astNodeArray(node.consequent);
}
function setNodeConsequent(node, consequent) {
	node.consequent = consequent;
}
function isIdentifierNamed(value, name) {
	return typeof value == "object" && value !== null && value.type == "Identifier" && value.name == name;
}
/**
* Merges nested bind calls like
* toildefender$bind(toildefender$bind(main, 1234), 5678)
* to
* toildefender$bind(main, 1234, 5678)
* @param {Node} node
* @returns {Node}
*/
function mergeNestedBinds(node) {
	assert.ok(estest_default.isNode(node));
	if (isBindCall(node)) {
		const args = nodeArguments$1(node);
		const first = args[0];
		return first ? mergeNestedBinds(first).concat(args.slice(1)) : [];
	} else return [node];
}
/**
* Checks whether node is a call to toildefender$bind.
* @param {Node} node
* @returns {boolean}
*/
function isBindCall(node) {
	assert.ok(estest_default.isNode(node));
	return node.type == "CallExpression" && isIdentifierNamed(node.callee, "toildefender$bind");
}
var Postprocessing = class {
	logger;
	constructor(logger) {
		this.logger = logger;
	}
	/**
	* Does postprocessing.
	* @param {Node} ast Root node
	* @return {Node} Root node
	*/
	do(ast) {
		assert.ok(estest_default.isNode(ast));
		return traverser_default.traverse(ast, [], (node, stack) => {
			if (isBindCall(node)) setNodeArguments(node, mergeNestedBinds(node));
			else if (node.type == "BlockStatement" || node.type == "Program") setNodeBody(node, nodeBody$1(node).filter((x) => estest_default.isNode(x) && x.type != "EmptyStatement"));
			else if (node.type == "SwitchCase") setNodeConsequent(node, nodeConsequent(node).filter((x) => estest_default.isNode(x) && x.type != "EmptyStatement"));
			return node;
		});
	}
};
//#endregion
//#region src/processors/uglifier.ts
var RESERVED_WORDS = new Set([
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"function",
	"if",
	"import",
	"in",
	"instanceof",
	"new",
	"null",
	"return",
	"super",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"typeof",
	"var",
	"void",
	"while",
	"with",
	"yield",
	"arguments",
	"undefined"
]);
var FIRST_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
var REST_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$0123456789";
function nodeKind$1(node) {
	const kind = node.kind;
	return typeof kind == "string" ? kind : void 0;
}
function nodeName$3(node) {
	const name = node?.name;
	return typeof name == "string" ? name : void 0;
}
function containsModernBindings(ast) {
	let found = false;
	traverser_default.traverseEx(ast, [], function(node) {
		if (node.type == "VariableDeclaration" && nodeKind$1(node) != "var" || node.type == "ClassDeclaration" || node.type == "ClassExpression") {
			found = true;
			this.abort();
		}
		return node;
	});
	return found;
}
function shortName(index) {
	let name = FIRST_CHARS[index % 54] || "";
	index = Math.floor(index / 54);
	while (index > 0) {
		index -= 1;
		name += REST_CHARS[index % 64] || "";
		index = Math.floor(index / 64);
	}
	return name;
}
function collectUnresolvedNames(scopeManager) {
	const names = /* @__PURE__ */ new Set();
	scopeManager.scopes.forEach((scope) => {
		scope.through.forEach((reference) => {
			const name = nodeName$3(reference.identifier);
			if (!reference.resolved && name) names.add(name);
		});
	});
	return names;
}
function isRenamableVariable(scope, variable, unresolvedNames) {
	if (scope.type == "global") return false;
	if (variable.name.indexOf("toildefender$anon$") === 0 && unresolvedNames.has(variable.name)) return false;
	if (variable.name == "arguments" || variable.name == "undefined") return false;
	if (variable.tainted) return false;
	if (variable.identifiers.length == 0) return false;
	if (variable.defs?.some((def) => def.type == "ClassName")) return false;
	return true;
}
function reserveUnrenamedNames(scopeManager, renamable) {
	const reserved = new Set(RESERVED_WORDS);
	scopeManager.scopes.forEach((scope) => {
		scope.variables.forEach((variable) => {
			if (!renamable.has(variable)) reserved.add(variable.name);
		});
		scope.through.forEach((reference) => {
			const name = nodeName$3(reference.identifier);
			if (!reference.resolved && name) reserved.add(name);
		});
	});
	return reserved;
}
function buildParentMap(ast) {
	const parents = /* @__PURE__ */ new WeakMap();
	traverser_default.traverse(ast, [], (node, stack) => {
		const parentFrame = stack[1];
		if (parentFrame) parents.set(node, parentFrame.node);
		return node;
	});
	return parents;
}
function renameIdentifier(identifier, name, parents) {
	const parent = parents.get(identifier);
	const parentFields = parent;
	if (parent && parent.type == "Property" && parentFields?.shorthand === true && (parentFields.key === identifier || parentFields.value === identifier)) {
		parentFields.shorthand = false;
		const key = {
			type: "Identifier",
			name: nodeName$3(identifier) || ""
		};
		const value = {
			type: "Identifier",
			name
		};
		parentFields.key = key;
		parentFields.value = value;
		parents.set(key, parent);
		parents.set(value, parent);
		return;
	}
	identifier.name = name;
}
function modernMangle(ast) {
	const scopeManager = escope.analyze(ast, {
		ecmaVersion: 6,
		optimistic: true,
		sourceType: "script"
	});
	const unresolvedNames = collectUnresolvedNames(scopeManager);
	const variables = [];
	scopeManager.scopes.forEach((scope) => {
		scope.variables.forEach((variable) => {
			if (isRenamableVariable(scope, variable, unresolvedNames)) variables.push({
				scope,
				variable
			});
		});
	});
	variables.sort((left, right) => {
		const leftWeight = left.variable.references.length + left.variable.identifiers.length;
		return right.variable.references.length + right.variable.identifiers.length - leftWeight;
	});
	const used = reserveUnrenamedNames(scopeManager, new Set(variables.map((entry) => entry.variable)));
	const parents = buildParentMap(ast);
	let next = 0;
	variables.forEach((entry) => {
		let name;
		do {
			name = shortName(next);
			next += 1;
		} while (used.has(name) || RESERVED_WORDS.has(name));
		used.add(name);
		entry.variable.identifiers.forEach((identifier) => {
			renameIdentifier(identifier, name, parents);
		});
		entry.variable.references.forEach((reference) => {
			renameIdentifier(reference.identifier, name, parents);
		});
	});
	return ast;
}
var Uglifier = class {
	logger;
	constructor(logger) {
		this.logger = logger;
	}
	/**
	* Uglifies tree.
	* @param {Node} ast Root node
	* @returns {Node} Root node
	*/
	uglify(ast) {
		assert.ok(estest_default.isNode(ast));
		if (containsModernBindings(ast)) return modernMangle(ast);
		return esshorten.mangle(ast);
	}
};
//#endregion
//#region src/processors/identifiers.ts
function nodeArray$1(value) {
	return Array.isArray(value) ? value : [];
}
function nodeFields$1(node) {
	return node;
}
function childNode$1(node, key) {
	const value = nodeFields$1(node)[key];
	return estest_default.isNode(value) ? value : null;
}
function setChildNode(node, key, value) {
	nodeFields$1(node)[key] = value;
}
function nodeName$2(node) {
	const name = node?.name;
	return typeof name == "string" ? name : null;
}
function setNodeName(node, name) {
	node.name = name;
}
function nodeValue$1(node) {
	return node?.value;
}
function setNodeComputed(node, computed) {
	node.computed = computed;
}
function nodeComputed(node) {
	return node.computed === true;
}
function nodeOperator$1(node) {
	const operator = node.operator;
	return typeof operator == "string" ? operator : null;
}
function mutableBody$1(node) {
	const body = nodeFields$1(node).body;
	if (Array.isArray(body)) return body;
	const nextBody = [];
	nodeFields$1(node).body = nextBody;
	return nextBody;
}
function scopeList(scopeManager) {
	const scopes = scopeManager.scopes;
	return Array.isArray(scopes) ? scopes : [];
}
function literal$1(value) {
	return {
		type: "Literal",
		value
	};
}
function encodeObjectKey(key, salt, index) {
	const encoded = [key.length ^ salt + index * 131 & 65535];
	for (let i = 0; i < key.length; i += 1) encoded.push(key.charCodeAt(i) ^ salt + index * 257 + i * 17 & 65535);
	return encoded;
}
function objectKey(prop) {
	const key = childNode$1(prop, "key");
	return nodeName$2(key) || String(nodeValue$1(key));
}
function propertyValue(prop) {
	return childNode$1(prop, "value") || {
		type: "Identifier",
		name: "undefined"
	};
}
function canPackObjectExpression(node) {
	return nodeArray$1(nodeFields$1(node).properties).every((prop) => prop.type != "SpreadElement" && childNode$1(prop, "key") !== null);
}
function isBigIntLiteral(node) {
	return node.type == "Literal" && typeof nodeValue$1(node) == "bigint";
}
function canMoveLiteral(node) {
	if (node.type != "Literal" || isBigIntLiteral(node) || nodeFields$1(node).regex) return false;
	return typeof nodeValue$1(node) == "string";
}
function isNumericVmInternalFunction$1(stack) {
	return stack.some((frame) => frame.node.toildefender$numericVmInternal === true);
}
var Identifiers = class {
	logger;
	esutils;
	constructor(logger) {
		this.logger = logger;
		this.esutils = new ESUtils(logger);
	}
	/**
	* This checks whether the given node has a parent that
	* accepts undefined children without throwing errors.
	* Those cannot be moved to separate variables without
	* causing errors by assigning undefined variables
	* to new variables.
	* @param {Node} node
	* @returns {boolean}
	*/
	hasParentAcceptingUndefined(node) {
		const parent = this.esutils.getParent(node);
		return Boolean(parent && parent.type == "UnaryExpression" && ["typeof", "delete"].includes(nodeOperator$1(parent) || ""));
	}
	/**
	* Replace property references like obj.prop with obj["prop"].
	* @param {Node} ast Root node
	* @returns {Node}
	*/
	computeProperties(ast) {
		assert.ok(estest_default.isNode(ast));
		ast = traverser_default.traverse(ast, [], (node, stack) => {
			if (isNumericVmInternalFunction$1(stack)) return node;
			if (node.type == "MemberExpression" && !nodeComputed(node)) {
				const property = childNode$1(node, "property");
				assert(property?.type == "Identifier");
				setChildNode(node, "property", {
					type: "Literal",
					value: nodeName$2(property) || ""
				});
				setNodeComputed(node, true);
			}
			return node;
		});
		return ast;
	}
	/**
	* Replace objects with an array via toildefender$toObject.
	* @param {Node} ast Root node
	* @returns {Node}
	*/
	arrayizeObjects(ast, options = {}) {
		assert.ok(estest_default.isNode(ast));
		ast = traverser_default.traverse(ast, [], (node, stack) => {
			if (isNumericVmInternalFunction$1(stack)) return node;
			if (node.type == "ObjectExpression") {
				if (options.objectPacking === false) return node;
				if (!canPackObjectExpression(node)) return node;
				const properties = nodeArray$1(nodeFields$1(node).properties);
				const salt = utils_default.random(1, 65535);
				const schema = [salt, properties.length];
				const values = [];
				properties.forEach((prop) => {
					encodeObjectKey(objectKey(prop), salt, values.length).forEach((value) => schema.push(value));
					values.push(propertyValue(prop));
				});
				return {
					type: "CallExpression",
					callee: {
						type: "Identifier",
						name: "toildefender$toObject"
					},
					arguments: [
						literal$1(utils_default.hash(schema.join(","))),
						{
							type: "ArrayExpression",
							elements: schema.map(literal$1)
						},
						{
							type: "ArrayExpression",
							elements: values
						}
					]
				};
			}
			return node;
		});
		return ast;
	}
	moveIdentifiers(ast, scopeManager) {
		assert.ok(estest_default.isNode(ast));
		const rng = new utils_default.UniqueRandomAlpha(3);
		this.esutils.setParentsRecursive(ast);
		scopeList(scopeManager).forEach((scope) => {
			/**
			* That could cause problems if there are multiple unresolved
			* references with the same name. (is that even possible?)
			*/
			const replaced = new utils_default.HashMap();
			scope.references.filter((reference) => !utils_default.isResolvedReference(reference)).forEach((reference) => {
				const identifierName = nodeName$2(reference.identifier);
				if (!identifierName) return;
				const previous = replaced.get(identifierName);
				if (previous) setNodeName(reference.identifier, previous);
				else if (!this.hasParentAcceptingUndefined(reference.identifier)) {
					const name = "$$ident$" + rng.get();
					replaced.set(identifierName, name);
					let init;
					if (identifierName == "undefined") init = {
						type: "Identifier",
						name: "undefined"
					};
					else init = {
						type: "ConditionalExpression",
						test: {
							type: "BinaryExpression",
							operator: "!==",
							left: {
								type: "UnaryExpression",
								operator: "typeof",
								prefix: true,
								argument: {
									type: "Identifier",
									name: identifierName
								}
							},
							right: {
								type: "Literal",
								value: "undefined"
							}
						},
						consequent: {
							type: "Identifier",
							name: identifierName
						},
						alternate: {
							type: "Identifier",
							name: "undefined"
						}
					};
					this.esutils.insertIntoScope(scope, {
						type: "VariableDeclaration",
						kind: "var",
						declarations: [{
							type: "VariableDeclarator",
							id: {
								type: "Identifier",
								name
							},
							init
						}]
					});
					setNodeName(reference.identifier, name);
				}
			});
		});
		return ast;
	}
	/**
	* Move all literals into the toildefender$literals array.
	* @param {Node} ast Root node
	* @param {ScopeManager} scopeManager Scope manager
	* @returns {Node} Root node
	*/
	moveLiterals(ast, _scopeManager) {
		assert.ok(estest_default.isNode(ast));
		const vars = [];
		ast = traverser_default.traverse(ast, [], (node, stack) => {
			if (isNumericVmInternalFunction$1(stack)) return node;
			const parentFrame = stack[1];
			if (canMoveLiteral(node) && stack.length > 0 && parentFrame?.node.type != "Property") {
				const value = String(nodeValue$1(node));
				let idx = vars.indexOf(value);
				if (idx == -1) {
					idx = vars.length;
					vars.push(value);
				}
				return {
					type: "MemberExpression",
					object: {
						type: "Identifier",
						name: "toildefender$literals"
					},
					property: {
						type: "Literal",
						value: idx
					},
					computed: true
				};
			}
			return node;
		});
		mutableBody$1(ast).splice(0, 0, {
			type: "VariableDeclaration",
			kind: "var",
			declarations: [{
				type: "VariableDeclarator",
				id: {
					type: "Identifier",
					name: "toildefender$literals"
				},
				init: {
					type: "ArrayExpression",
					elements: vars.map((x) => ({
						type: "Literal",
						value: x
					}))
				}
			}]
		});
		return ast;
	}
};
//#endregion
//#region src/processors/literals.ts
function astArray(value) {
	return Array.isArray(value) ? value : [];
}
function mutableBody(node) {
	const body = node.body;
	if (Array.isArray(body)) return body;
	const nextBody = [];
	node.body = nextBody;
	return nextBody;
}
function literalStringValue(node) {
	const value = node.value;
	return typeof value == "string" ? value : null;
}
function isComputed(node) {
	return node.computed === true;
}
function isNumericVmInternalFunction(stack) {
	return stack.some((frame) => frame.node.toildefender$numericVmInternal === true);
}
function isUnencodedPropertyKey(stack) {
	const parentFrame = stack[1];
	if (!parentFrame || parentFrame.node.type != "Property") return false;
	return parentFrame.key == "key" && !isComputed(parentFrame.node);
}
function templateCookedValue(quasi) {
	const value = quasi.value;
	if (typeof value == "object" && value !== null) {
		const cooked = value.cooked;
		return typeof cooked == "string" ? cooked : "";
	}
	return "";
}
function regexInfo(node) {
	const regex = node.regex;
	if (typeof regex != "object" || regex === null) return null;
	const pattern = regex.pattern;
	const flags = regex.flags;
	return {
		pattern: typeof pattern == "string" ? pattern : "",
		flags: typeof flags == "string" ? flags : ""
	};
}
/**
* Generate string generator from string.
* @param {string} str
* @returns {Node}
*/
function makeStringGenerator(str) {
	assert.equal(typeof str, "string");
	const fragments = [];
	while (str.length > 0) {
		const len = utils_default.random(1, 5);
		fragments.push(str.substring(0, len));
		str = str.substring(len);
	}
	const body = [{
		type: "VariableDeclaration",
		kind: "var",
		declarations: [{
			type: "VariableDeclarator",
			id: {
				type: "Identifier",
				name: "str"
			},
			init: {
				type: "Literal",
				value: ""
			}
		}]
	}];
	const block = {
		type: "BlockStatement",
		body
	};
	fragments.forEach((fragment) => {
		const decoded = makeStringByteArrayCall(fragment);
		body.push({
			type: "ExpressionStatement",
			expression: {
				type: "BinaryExpression",
				operator: "+=",
				left: {
					type: "Identifier",
					name: "str"
				},
				right: decoded
			}
		});
	});
	body.push({
		type: "ReturnStatement",
		argument: {
			type: "Identifier",
			name: "str"
		}
	});
	return {
		type: "CallExpression",
		arguments: [],
		callee: {
			type: "FunctionExpression",
			params: [],
			body: block
		}
	};
}
/**
* Generate char-code-escaped string generator from string.
* @param {string} str
* @returns {Node}
*/
function makeStringByteArrayCall(str) {
	assert.equal(typeof str, "string");
	return {
		type: "CallExpression",
		callee: {
			type: "Identifier",
			name: "toildefender$fromCharCodes"
		},
		arguments: str.split("").map((x) => ({
			type: "Literal",
			value: x.charCodeAt(0)
		}))
	};
}
function makeStringExpression(str) {
	if (str.length == 0) return {
		type: "Literal",
		value: ""
	};
	return makeStringGenerator(str);
}
function makeStringCallExpression(expr) {
	return {
		type: "CallExpression",
		callee: {
			type: "Identifier",
			name: "String"
		},
		arguments: [expr]
	};
}
function concatExpressions(left, right) {
	return {
		type: "BinaryExpression",
		operator: "+",
		left,
		right
	};
}
function makeTemplateExpression(node) {
	assert.equal(node.type, "TemplateLiteral");
	const quasis = astArray(node.quasis);
	const expressions = astArray(node.expressions);
	let expression = null;
	for (let i = 0; i < quasis.length; i += 1) {
		const quasiExpression = makeStringExpression(templateCookedValue(quasis[i]));
		expression = expression ? concatExpressions(expression, quasiExpression) : quasiExpression;
		const templateExpression = expressions[i];
		if (templateExpression) expression = concatExpressions(expression, makeStringCallExpression(templateExpression));
	}
	return expression || {
		type: "Literal",
		value: ""
	};
}
function makeRegexExpression(node) {
	assert.equal(node.type, "Literal");
	const regex = regexInfo(node);
	assert.ok(regex);
	return {
		type: "NewExpression",
		callee: {
			type: "Identifier",
			name: "RegExp"
		},
		arguments: [makeStringExpression(regex.pattern), makeStringExpression(regex.flags)]
	};
}
var Literals = class {
	logger;
	constructor(logger) {
		this.logger = logger;
	}
	/**
	* Move strings into $$strings array
	* @param {Node} ast Root node
	* @returns {Node} Root node
	*/
	extractStrings(ast) {
		assert.ok(estest_default.isNode(ast));
		const global = {
			type: "Identifier",
			name: "$$strings"
		};
		const strings = [];
		const stringMap = {};
		ast = traverser_default.traverse(ast, [], (node, stack) => {
			if (isNumericVmInternalFunction(stack)) return node;
			const value = literalStringValue(node);
			if (node.type == "Literal" && value !== null) {
				let idx = stringMap["_" + value];
				if (!idx) {
					stringMap["_" + value] = idx = strings.length;
					strings.push(node);
				}
				return {
					type: "MemberExpression",
					computed: true,
					object: global,
					property: {
						type: "Literal",
						value: idx
					}
				};
			}
			return node;
		});
		mutableBody(ast).splice(0, 0, {
			type: "VariableDeclaration",
			kind: "var",
			declarations: [{
				type: "VariableDeclarator",
				id: global,
				init: {
					type: "ArrayExpression",
					elements: strings
				}
			}]
		});
		return ast;
	}
	/**
	* Replace string literals with string generators.
	* @param {Node} ast Root node
	* @returns {Node} Root node
	*/
	generateStrings(ast) {
		assert.ok(estest_default.isNode(ast));
		ast = traverser_default.traverse(ast, [], (node, stack) => {
			if (isNumericVmInternalFunction(stack)) return node;
			if (node.type == "TemplateLiteral") return makeTemplateExpression(node);
			if (node.type == "Literal" && regexInfo(node)) return makeRegexExpression(node);
			const value = literalStringValue(node);
			if (node.type == "Literal" && value !== null && stack.length > 1 && !isUnencodedPropertyKey(stack)) return makeStringGenerator(value);
			return node;
		});
		return ast;
	}
};
//#endregion
//#region src/processors/numericVm.ts
var RUNTIME = `
function toildefender$numericVmString(program, length, salt) {
    var out = "";
    var i = 0;
    var base = BigInt(65537);
    while (i < length) {
        var encoded = Number(program % base);
        program = program / base;
        out += String.fromCharCode(encoded ^ ((salt + i * 97) & 65535));
        i += 1;
    }
    return out;
}

function toildefender$numericVmPow(a, b) {
    if (typeof a === "bigint" && typeof b === "bigint") {
        if (b < BigInt(0)) throw new RangeError("BigInt exponent must be positive");
        var out = BigInt(1);
        var base = a;
        var exp = b;
        while (exp > BigInt(0)) {
            if (exp % BigInt(2) === BigInt(1)) out *= base;
            base *= base;
            exp = exp / BigInt(2);
        }
        return out;
    }
    return Math.pow(a, b);
}

function toildefender$numericVmDigit(program, baseBig, index, powers) {
    if (powers) {
        while (powers.length <= index) {
            powers[powers.length] = powers[powers.length - 1] * baseBig;
        }
        return Number((program / powers[index]) % baseBig);
    }
    var pow = BigInt(1);
    while (index > 0) {
        pow *= baseBig;
        index -= 1;
    }
    return Number((program / pow) % baseBig);
}

function toildefender$hashMeshMix(current, value) {
    var h = (current ^ value) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

function toildefender$hashMeshValue(hash, value) {
    if (typeof value === "number") return toildefender$hashMeshMix(hash, value >>> 0);
    if (typeof value === "string") {
        hash = toildefender$hashMeshMix(hash, value.length >>> 0);
        var j = 0;
        while (j < value.length) {
            hash = toildefender$hashMeshMix(hash, value.charCodeAt(j));
            j += 1;
        }
        return hash;
    }
    if (value && typeof value.length === "number") {
        hash = toildefender$hashMeshMix(hash, value.length >>> 0);
        var i = 0;
        while (i < value.length) {
            hash = toildefender$hashMeshValue(hash, value[i]);
            i += 1;
        }
        return hash;
    }
    return toildefender$hashMeshMix(hash, 3735928559);
}

function toildefender$hashMeshKey(mesh, base, tokenCount, seed, tag, ops) {
    var hash = 2166136261;
    hash = toildefender$hashMeshMix(hash, 1145713480);
    hash = toildefender$hashMeshMix(hash, 1296388936);
    hash = toildefender$hashMeshValue(hash, mesh);
    hash = toildefender$hashMeshMix(hash, base >>> 0);
    hash = toildefender$hashMeshMix(hash, tokenCount >>> 0);
    hash = toildefender$hashMeshMix(hash, seed >>> 0);
    hash = toildefender$hashMeshMix(hash, tag >>> 0);
    hash = toildefender$hashMeshValue(hash, ops);
    return hash >>> 0;
}

function toildefender$hashMeshStream(key, index, base, salt) {
    var hash = toildefender$hashMeshMix(key >>> 0, 1398035796);
    hash = toildefender$hashMeshMix(hash, salt >>> 0);
    hash = toildefender$hashMeshMix(hash, index >>> 0);
    hash = toildefender$hashMeshMix(hash, Math.imul(index + 1, 2654435761) >>> 0);
    return hash % base;
}

function toildefender$hashMeshUnlock(program, base, baseBig, index, key, salt, powers) {
    var cipher = toildefender$numericVmDigit(program, baseBig, index, powers);
    return (cipher - toildefender$hashMeshStream(key, index, base, salt) + base) % base;
}

function toildefender$numericVmRun(program, base, tokenCount, seed, tag, constants, argsLike, self, ops, mesh, refs, cache) {
    var baseBig = BigInt(base);
    var meshKey = 0;
    var meshSalt = 0;
    if (mesh) {
        meshKey = toildefender$hashMeshKey(mesh, base, tokenCount, seed, tag, ops);
        meshSalt = mesh[5] >>> 0;
    }
    var encryptedCache = cache && cache[0] || null;
    var stateCache = [seed >>> 0];
    var plainCache = new Array(tokenCount);
    var inverseCache = cache && cache[1] || null;
    if (inverseCache === null) {
        inverseCache = [];
        if (cache) cache[1] = inverseCache;
    }

    function inverse(value, modulo) {
        if (inverseCache[value] !== undefined) return inverseCache[value];
        var t = 0, nt = 1;
        var r = modulo, nr = value % modulo;
        while (nr !== 0) {
            var q = Math.floor(r / nr);
            var ot = t;
            t = nt;
            nt = ot - q * nt;
            var or = r;
            r = nr;
            nr = or - q * nr;
        }
        var out = t < 0 ? t + modulo : t;
        inverseCache[value] = out;
        return out;
    }

    function mix(current, encrypted, index) {
        var mixed = (current ^ (encrypted + 2654435769 + ((current << 6) >>> 0) + (current >>> 2) + index)) >>> 0;
        mixed = Math.imul(mixed ^ (mixed >>> 16), 2246822507) >>> 0;
        return (mixed ^ (mixed >>> 13)) >>> 0;
    }

    function unpackEncrypted() {
        if (encryptedCache !== null) return;
        encryptedCache = new Array(tokenCount);
        var work = program;
        var index = 0;
        while (index < tokenCount) {
            var cipher = Number(work % baseBig);
            work = work / baseBig;
            encryptedCache[index] = mesh ? (cipher - toildefender$hashMeshStream(meshKey, index, base, meshSalt) + base) % base : cipher;
            index += 1;
        }
        if (cache) cache[0] = encryptedCache;
    }

    function encryptedAt(index) {
        unpackEncrypted();
        return encryptedCache[index];
    }

    var i = 0;
    var seen = seed >>> 0;
    while (i < tokenCount) {
        var encrypted = encryptedAt(i);
        seen = mix(seen, encrypted, i);
        stateCache[i + 1] = seen;
        i += 1;
    }

    if ((seen >>> 0) !== (tag >>> 0)) throw new Error("invalid numeric vm program");

    function stateBefore(index) {
        if (stateCache[index] !== undefined) return stateCache[index];
        var cursor = index - 1;
        while (cursor > 0 && stateCache[cursor] === undefined) cursor -= 1;
        var current = stateCache[cursor] === undefined ? seed >>> 0 : stateCache[cursor];
        while (cursor < index) {
            current = mix(current, encryptedAt(cursor), cursor);
            cursor += 1;
            stateCache[cursor] = current;
        }
        return current;
    }

    function decodeAt(index) {
        if (plainCache[index] !== undefined) return plainCache[index];
        var state = stateBefore(index);
        var encrypted = encryptedAt(index);
        var mul = 1 + ((state >>> 5) % (base - 1));
        var add = state % base;
        var plain = (((encrypted - add + base) % base) * inverse(mul, base)) % base;
        plainCache[index] = plain;
        return plain;
    }

    var layout = seed & 1;
    var stack = layout ? null : [];
    var locals = layout ? null : [];
    var cells = layout ? { s: [], l: Object.create(null) } : null;
    var frameArgs = Array.prototype.slice.call(argsLike);
    var ip = 0;

    function push(value) {
        if (layout) cells.s[cells.s.length] = value;
        else stack.push(value);
    }

    function pop() {
        return layout ? cells.s.pop() : stack.pop();
    }

    function peek() {
        var current = layout ? cells.s : stack;
        return current[current.length - 1];
    }

    function loadLocal(slot) {
        return layout ? cells.l["$" + slot] : locals[slot];
    }

    function storeLocal(slot, value) {
        if (layout) cells.l["$" + slot] = value;
        else locals[slot] = value;
        return value;
    }

    function readConstant(index) {
        var cell = constants[index];
        if (cell && cell[0] === 0 && typeof cell[1] === "function") {
            cell[1] = cell[1]();
            cell[0] = 1;
        }
        if (cell && cell[0] === 2 && typeof cell[1] === "function") return cell[1]();
        if (cell && cell[0] === 3) return refs[cell[1]];
        return cell && cell[0] === 1 ? cell[1] : cell;
    }

    function read() {
        if (ip < 0 || ip >= tokenCount) throw new Error("invalid virtual opcode");
        var value = decodeAt(ip);
        ip += 1;
        return value;
    }

    function readUnsigned() {
        var shift = 0;
        var value = 0;
        for (;;) {
            var part = read();
            value += (part & 127) * Math.pow(2, shift);
            if ((part & 128) === 0) return value;
            shift += 7;
        }
    }

    function readSigned() {
        var raw = readUnsigned();
        return (raw & 1) === 0 ? raw / 2 : -((raw + 1) / 2);
    }

    function popArgs(count) {
        var out = new Array(count);
        var i = count;
        while (i > 0) {
            i -= 1;
            out[i] = pop();
        }
        return out;
    }

    while (true) {
        var op = read();
        if (op === ops[0]) continue;
        if (op === ops[1]) { push(undefined); continue; }
        if (op === ops[2]) { push(null); continue; }
        if (op === ops[3]) { push(true); continue; }
        if (op === ops[4]) { push(false); continue; }
        if (op === ops[5]) { push(readUnsigned()); continue; }
        if (op === ops[6]) { push(readConstant(readUnsigned())); continue; }
        if (op === ops[7]) { push(frameArgs[readUnsigned()]); continue; }
        if (op === ops[8]) { push(loadLocal(readUnsigned())); continue; }
        if (op === ops[9]) { storeLocal(readUnsigned(), pop()); continue; }
        if (op === ops[10]) { push(peek()); continue; }
        if (op === ops[11]) { pop(); continue; }
        if (op === ops[12]) { var addB = pop(); var addA = pop(); push(addA + addB); continue; }
        if (op === ops[13]) { var subB = pop(); var subA = pop(); push(subA - subB); continue; }
        if (op === ops[14]) { var mulB = pop(); var mulA = pop(); push(mulA * mulB); continue; }
        if (op === ops[15]) { var divB = pop(); var divA = pop(); push(divA / divB); continue; }
        if (op === ops[16]) { var modB = pop(); var modA = pop(); push(modA % modB); continue; }
        if (op === ops[17]) { var powB = pop(); var powA = pop(); push(toildefender$numericVmPow(powA, powB)); continue; }
        if (op === ops[18]) { push(-pop()); continue; }
        if (op === ops[19]) { push(!pop()); continue; }
        if (op === ops[20]) { push(~pop()); continue; }
        if (op === ops[21]) { var eqB = pop(); var eqA = pop(); push(eqA == eqB); continue; }
        if (op === ops[22]) { var neqB = pop(); var neqA = pop(); push(neqA != neqB); continue; }
        if (op === ops[23]) { var seqB = pop(); var seqA = pop(); push(seqA === seqB); continue; }
        if (op === ops[24]) { var sneB = pop(); var sneA = pop(); push(sneA !== sneB); continue; }
        if (op === ops[25]) { var ltB = pop(); var ltA = pop(); push(ltA < ltB); continue; }
        if (op === ops[26]) { var lteB = pop(); var lteA = pop(); push(lteA <= lteB); continue; }
        if (op === ops[27]) { var gtB = pop(); var gtA = pop(); push(gtA > gtB); continue; }
        if (op === ops[28]) { var gteB = pop(); var gteA = pop(); push(gteA >= gteB); continue; }
        if (op === ops[29]) { var jmp = readSigned(); ip += jmp; continue; }
        if (op === ops[30]) { var jf = readSigned(); if (!pop()) ip += jf; continue; }
        if (op === ops[31]) { var jt = readSigned(); if (pop()) ip += jt; continue; }
        if (op === ops[32]) { readUnsigned(); var argc = readUnsigned(); var ca = popArgs(argc); var fn = pop(); push(fn.apply(undefined, ca)); continue; }
        if (op === ops[33]) { readUnsigned(); var largc = readUnsigned(); var la = popArgs(largc); var lfn = readConstant(readUnsigned()); push(lfn.apply(undefined, la)); continue; }
        if (op === ops[34]) { var gpKey = pop(); var gpObj = pop(); push(gpObj[gpKey]); continue; }
        if (op === ops[35]) { var spValue = pop(); var spKey = pop(); var spObj = pop(); spObj[spKey] = spValue; push(spValue); continue; }
        if (op === ops[36]) { var ac = readUnsigned(); var arr = new Array(ac); var ai = ac; while (ai > 0) { ai -= 1; arr[ai] = pop(); } push(arr); continue; }
        if (op === ops[37]) { var oc = readUnsigned(); var pairs = new Array(oc); var oi = oc; while (oi > 0) { oi -= 1; var ov = pop(); var ok = pop(); pairs[oi] = [ok, ov]; } var obj = {}; var pi = 0; while (pi < oc) { obj[pairs[pi][0]] = pairs[pi][1]; pi += 1; } push(obj); continue; }
        if (op === ops[38]) return pop();
        if (op === ops[39]) throw pop();
        if (op === ops[40]) { push(self); continue; }
        if (op === ops[41]) { push(argsLike); continue; }
        if (op === ops[42]) { push(typeof pop()); continue; }
        if (op === ops[43]) { var mc = readUnsigned(); var ma = popArgs(mc); var mk = pop(); var mo = pop(); push(mo[mk].apply(mo, ma)); continue; }
        if (op === ops[44]) { var cgpKey = readConstant(readUnsigned()); var cgpObj = pop(); push(cgpObj[cgpKey]); continue; }
        if (op === ops[45]) { storeLocal(readUnsigned(), pop()); continue; }
        if (op === ops[46]) { var jn = readSigned(); var nv = pop(); if (nv === null || nv === undefined) ip += jn; continue; }
        if (op === ops[47]) { push(Number(pop())); continue; }
        throw new Error("invalid virtual opcode");
    }
}
`;
var OP_NAMES = [
	"NOP",
	"PUSH_UNDEFINED",
	"PUSH_NULL",
	"PUSH_TRUE",
	"PUSH_FALSE",
	"PUSH_SMALL",
	"PUSH_CONST",
	"LOAD_ARG",
	"LOAD_LOCAL",
	"STORE_LOCAL",
	"DUP",
	"POP",
	"ADD",
	"SUB",
	"MUL",
	"DIV",
	"MOD",
	"POW",
	"NEG",
	"NOT",
	"BIT_NOT",
	"EQ",
	"NEQ",
	"STRICT_EQ",
	"STRICT_NEQ",
	"LT",
	"LTE",
	"GT",
	"GTE",
	"JMP",
	"JMP_FALSE",
	"JMP_TRUE",
	"CALL_EXT",
	"CALL_LOCAL",
	"GET_PROP",
	"SET_PROP",
	"MAKE_ARRAY",
	"MAKE_OBJECT",
	"RETURN",
	"THROW",
	"PUSH_THIS",
	"PUSH_ARGUMENTS",
	"TYPEOF",
	"CALL_METHOD",
	"GET_CONST_PROP",
	"STORE_LOCAL_POP",
	"JMP_NULLISH",
	"TO_NUMBER"
];
var BASES = [
	257,
	263,
	269,
	521,
	1031,
	4099,
	65537
];
var SMALL_LIMIT = 128;
function nodeFields(node) {
	return node;
}
function nodeArray(value) {
	return Array.isArray(value) ? value : [];
}
function childNode(node, key) {
	const value = nodeFields(node)[key];
	return estest_default.isNode(value) ? value : null;
}
function requiredChild(node, key) {
	const child = childNode(node, key);
	assert.ok(child, `Missing ${node.type}.${key}`);
	return child;
}
function setNodeField(node, key, value) {
	nodeFields(node)[key] = value;
}
function nodeName$1(node) {
	const name = node?.name;
	return typeof name == "string" ? name : null;
}
function nodeValue(node) {
	return node?.value;
}
function nodeOperator(node) {
	const operator = node.operator;
	return typeof operator == "string" ? operator : null;
}
function nodeKind(node) {
	const kind = node.kind;
	return typeof kind == "string" ? kind : null;
}
function nodeFlag(node, key) {
	return node[key] === true;
}
function bodyArray(node) {
	return nodeArray(nodeFields(node).body);
}
function nodeParams$1(node) {
	return nodeArray(nodeFields(node).params);
}
function nodeDeclarations(node) {
	return nodeArray(nodeFields(node).declarations);
}
function nodeElements(node) {
	const elements = nodeFields(node).elements;
	return Array.isArray(elements) ? elements.map((element) => estest_default.isNode(element) ? element : null) : [];
}
function nodeProperties(node) {
	return nodeArray(nodeFields(node).properties);
}
function nodeExpressions(node) {
	return nodeArray(nodeFields(node).expressions);
}
function nodeArguments(node) {
	return nodeArray(nodeFields(node).arguments);
}
function literal(value) {
	return {
		type: "Literal",
		value
	};
}
function identifier(name) {
	return {
		type: "Identifier",
		name
	};
}
function call(callee, args) {
	return {
		type: "CallExpression",
		callee,
		arguments: args
	};
}
function binary(operator, left, right) {
	return {
		type: "BinaryExpression",
		operator,
		left,
		right
	};
}
function unary(operator, argument) {
	return {
		type: "UnaryExpression",
		operator,
		prefix: true,
		argument
	};
}
function member(object, property) {
	return {
		type: "MemberExpression",
		object,
		property,
		computed: true
	};
}
function arrayExpression(values) {
	return {
		type: "ArrayExpression",
		elements: values
	};
}
function returnStatement(argument) {
	return {
		type: "ReturnStatement",
		argument
	};
}
function functionExpression(body) {
	return {
		type: "FunctionExpression",
		id: null,
		params: [],
		body: {
			type: "BlockStatement",
			body
		},
		generator: false,
		expression: false,
		async: false
	};
}
function variableDeclaration(name, init) {
	return {
		type: "VariableDeclaration",
		kind: "var",
		declarations: [{
			type: "VariableDeclarator",
			id: identifier(name),
			init
		}]
	};
}
function functionName(node) {
	return nodeName$1(childNode(node, "id")) || "";
}
function markNumericVmInternal(ast) {
	return traverser_default.traverse(ast, [], function(node) {
		if (estest_default.isFunction(node)) setNodeField(node, "toildefender$numericVmInternal", true);
		return node;
	});
}
function hashSeed(seed) {
	return crypto.createHash("sha256").update(String(seed)).digest().readUInt32LE(0) || 1;
}
function makeRng(seed) {
	let state = seed >>> 0;
	return function() {
		state ^= state << 13;
		state >>>= 0;
		state ^= state >>> 17;
		state >>>= 0;
		state ^= state << 5;
		state >>>= 0;
		return state >>> 0;
	};
}
function shuffle(values, next) {
	const copy = values.slice();
	for (let i = copy.length - 1; i > 0; i -= 1) {
		const j = next() % (i + 1);
		const tmp = copy[i];
		copy[i] = copy[j];
		copy[j] = tmp;
	}
	return copy;
}
function bigintLiteral(value) {
	const bigint = typeof value === "bigint" ? value : BigInt(value);
	const raw = bigint.toString();
	return {
		type: "Literal",
		value: bigint,
		bigint: raw,
		raw: raw + "n"
	};
}
function replaceStaticBigIntCalls(ast) {
	return traverser_default.traverse(ast, [], function(node) {
		const callee = childNode(node, "callee");
		const args = nodeArguments(node);
		const firstArg = args[0];
		const firstValue = nodeValue(firstArg);
		if (node.type === "CallExpression" && callee?.type === "Identifier" && nodeName$1(callee) === "BigInt" && args.length === 1 && firstArg?.type === "Literal" && typeof firstValue === "number" && Number.isInteger(firstValue)) return bigintLiteral(firstValue);
		return node;
	});
}
function bigintExpression(value, next) {
	const radixBits = 26n;
	const radix = 1n << radixBits;
	const chunks = [];
	let work = value < 0n ? -value : value;
	if (work === 0n) chunks.push(0n);
	while (work > 0n) {
		chunks.push(work % radix);
		work = work / radix;
	}
	let expr = bigintLiteral(chunks[chunks.length - 1]);
	for (let i = chunks.length - 2; i >= 0; i -= 1) expr = binary("+", binary("<<", expr, bigintLiteral(radixBits)), bigintLiteral(chunks[i]));
	if (value < 0n) expr = {
		type: "UnaryExpression",
		operator: "-",
		prefix: true,
		argument: expr
	};
	const xorKey = BigInt((next() & 65535) + 1);
	const addKey = BigInt((next() & 65535) + 1);
	return binary("^", binary("-", binary("+", binary("^", expr, bigintLiteral(xorKey)), bigintLiteral(addKey)), bigintLiteral(addKey)), bigintLiteral(xorKey));
}
function stringBlob(value, salt) {
	const base = 65537n;
	let pow = 1n;
	let out = 0n;
	for (let i = 0; i < value.length; i += 1) {
		out += BigInt(value.charCodeAt(i) ^ salt + i * 97 & 65535) * pow;
		pow *= base;
	}
	return out;
}
function encodeUnsigned(value) {
	const out = [];
	let current = value >>> 0;
	do {
		const part = current & 127;
		current = Math.floor(current / 128);
		out.push(current > 0 ? part | 128 : part);
	} while (current > 0);
	return out;
}
function encodeSigned(value) {
	return encodeUnsigned(value >= 0 ? value * 2 : -value * 2 - 1);
}
function signedLengthFor(target, start, beforeOperand) {
	let len = 1;
	for (;;) {
		const next = encodeSigned(target - (start + beforeOperand + len)).length;
		if (next === len) return len;
		len = next;
	}
}
function mix(current, encrypted, index) {
	let mixed = (current ^ encrypted + 2654435769 + (current << 6 >>> 0) + (current >>> 2) + index) >>> 0;
	mixed = Math.imul(mixed ^ mixed >>> 16, 2246822507) >>> 0;
	return (mixed ^ mixed >>> 13) >>> 0;
}
function meshMix(current, value) {
	let h = (current ^ value) >>> 0;
	h = Math.imul(h ^ h >>> 16, 2246822507) >>> 0;
	h = Math.imul(h ^ h >>> 13, 3266489909) >>> 0;
	return (h ^ h >>> 16) >>> 0;
}
function meshValue(hash, value) {
	if (typeof value === "number") return meshMix(hash, value >>> 0);
	if (Array.isArray(value)) {
		hash = meshMix(hash, value.length >>> 0);
		for (let i = 0; i < value.length; i += 1) hash = meshValue(hash, value[i]);
		return hash;
	}
	return meshMix(hash, 3735928559);
}
function meshKey(mesh, base, tokenCount, seed, tag, ops) {
	let hash = 2166136261;
	hash = meshMix(hash, 1145713480);
	hash = meshMix(hash, 1296388936);
	hash = meshValue(hash, mesh);
	hash = meshMix(hash, base >>> 0);
	hash = meshMix(hash, tokenCount >>> 0);
	hash = meshMix(hash, seed >>> 0);
	hash = meshMix(hash, tag >>> 0);
	hash = meshValue(hash, ops);
	return hash >>> 0;
}
function meshStream(key, index, base, salt) {
	let hash = meshMix(key >>> 0, 1398035796);
	hash = meshMix(hash, salt >>> 0);
	hash = meshMix(hash, index >>> 0);
	hash = meshMix(hash, Math.imul(index + 1, 2654435761) >>> 0);
	return hash % base;
}
function textDigest(value) {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i += 1) hash = meshMix(hash, value.charCodeAt(i));
	return hash >>> 0;
}
function normalizeRatio(value) {
	const ratio = Number(value);
	if (!Number.isFinite(ratio)) return 1;
	if (ratio < 0) return 0;
	if (ratio > 1) return 1;
	return ratio;
}
function normalizeMaxFunctions(value) {
	if (value === void 0 || value === null) return Infinity;
	const max = Number(value);
	if (!Number.isFinite(max)) return Infinity;
	return Math.max(0, Math.floor(max));
}
function selectionScore(options, node, index) {
	const name = functionName(node);
	const body = childNode(node, "body");
	const bodySize = body ? bodyArray(body).length : 0;
	return textDigest(`${options.seed}:${index}:${name}:${bodySize}`) / 4294967296;
}
function constantDigest(constants) {
	let hash = textDigest("DJS-HMESH/constants/v1");
	for (let i = 0; i < constants.length; i += 1) {
		const constant = constants[i];
		hash = meshMix(hash, textDigest(constant.kind));
		hash = meshMix(hash, textDigest(String(constant.value)));
	}
	return hash >>> 0;
}
function meshExpression(value) {
	if (Array.isArray(value)) return arrayExpression(value.map(meshExpression));
	return literal(value >>> 0);
}
function encryptedStream(tokens, base, seed) {
	let state = seed >>> 0;
	let tag = seed >>> 0;
	const encrypted = [];
	for (let i = 0; i < tokens.length; i += 1) {
		const mul = 1 + (state >>> 5) % (base - 1);
		const add = state % base;
		const value = (tokens[i] * mul + add) % base;
		encrypted.push(value);
		state = mix(state, value, i);
		tag = mix(tag, value, i);
	}
	return {
		encrypted,
		tag: tag >>> 0
	};
}
function packTokens(tokens, base) {
	let out = 0n;
	let pow = 1n;
	const bigBase = BigInt(base);
	tokens.forEach(function(token) {
		out += BigInt(token) * pow;
		pow *= bigBase;
	});
	return out;
}
function makeChaff(next, tokenCount, ratio) {
	const length = Math.max(4, Math.min(32, Math.ceil(tokenCount * ratio / 16)));
	const chaff = [];
	for (let i = 0; i < length; i += 1) chaff.push(next() >>> 0);
	return chaff;
}
function buildHashMeshRecord(record, encryptedTokens, opValues, constants, dialect, options) {
	const ratio = typeof options.chaffRatio === "number" ? options.chaffRatio : .55;
	const buildSalt = hashSeed(`${options.seed || "toildefender-hmesh"}:DJS-HMESH/build/v1`);
	const functionId = meshMix(buildSalt, dialect.seed);
	const chunkId = dialect.next() >>> 0;
	const constDigest = constantDigest(constants);
	const previousDigest = meshMix(meshMix(buildSalt, functionId), chunkId);
	const streamSalt = dialect.next() >>> 0;
	let flags = 0;
	if (options.bindToVmState !== false) flags |= 1;
	if (options.deriveDialectFromMesh) flags |= 2;
	if (options.encodeChaff !== false) flags |= 4;
	const chaff = options.encodeChaff === false ? [] : makeChaff(dialect.next, record.tokenCount, ratio);
	const mesh = [
		buildSalt >>> 0,
		functionId >>> 0,
		chunkId >>> 0,
		constDigest >>> 0,
		previousDigest >>> 0,
		streamSalt >>> 0,
		flags >>> 0,
		textDigest("DJS-HMESH/chunk-key/v1") >>> 0,
		chaff
	];
	const key = meshKey(mesh, record.base, record.tokenCount, record.seed, record.tag, opValues);
	record.blob = packTokens(encryptedTokens.map(function(token, index) {
		return (token + meshStream(key, index, record.base, streamSalt)) % record.base;
	}), record.base);
	record.mesh = mesh;
}
function isSimplePattern(node) {
	return node?.type === "Identifier";
}
function containsNestedFunction(node) {
	let found = false;
	traverser_default.traverseEx(node, [], function(child) {
		if (child !== node && estest_default.isFunction(child)) {
			found = true;
			this.abort();
		}
		return child;
	});
	return found;
}
var Compiler = class {
	fn;
	dialect;
	options;
	instructions = [];
	labelId = 0;
	params = {};
	functionScope = Object.create(null);
	scopeStack = [];
	localCount = 0;
	constants = [];
	constantKeys = Object.create(null);
	references = [];
	referenceKeys = Object.create(null);
	constructor(fn, dialect, options) {
		this.fn = fn;
		this.dialect = dialect;
		this.options = options;
	}
	label() {
		return `L${this.labelId++}`;
	}
	mark(name) {
		this.instructions.push({
			label: name,
			args: []
		});
	}
	emit(op, ...args) {
		this.instructions.push({
			op,
			args
		});
	}
	pushScope() {
		const scope = Object.create(null);
		this.scopeStack.push(scope);
		return scope;
	}
	popScope() {
		this.scopeStack.pop();
	}
	currentScope() {
		if (this.scopeStack.length === 0) return this.pushScope();
		return this.scopeStack[this.scopeStack.length - 1];
	}
	declareLocal(name, functionScoped) {
		const scope = functionScoped ? this.functionScope : this.currentScope();
		if (!Object.prototype.hasOwnProperty.call(scope, name)) scope[name] = this.localCount++;
		return scope[name];
	}
	resolveLocal(name) {
		for (let i = this.scopeStack.length - 1; i >= 0; i -= 1) {
			const scope = this.scopeStack[i];
			if (Object.prototype.hasOwnProperty.call(scope, name)) return scope[name];
		}
		if (Object.prototype.hasOwnProperty.call(this.functionScope, name)) return this.functionScope[name];
		return null;
	}
	addConstant(kind, value) {
		const key = kind + ":" + String(value);
		if (Object.prototype.hasOwnProperty.call(this.constantKeys, key)) return this.constantKeys[key];
		const index = this.constants.length;
		this.constantKeys[key] = index;
		this.constants.push({
			kind,
			value
		});
		return index;
	}
	addReference(value) {
		const key = String(value);
		if (Object.prototype.hasOwnProperty.call(this.referenceKeys, key)) return this.referenceKeys[key];
		const index = this.references.length;
		this.referenceKeys[key] = index;
		this.references.push(key);
		return index;
	}
	validateBindings() {
		nodeParams$1(this.fn).forEach((param, index) => {
			if (!isSimplePattern(param)) throw new Error("unsupported parameter pattern");
			this.params[nodeName$1(param) || ""] = index;
		});
		const body = requiredChild(this.fn, "body");
		traverser_default.traverseEx(body, [], function(node) {
			if (node !== body && estest_default.isFunction(node)) {
				this.abort();
				return node;
			}
			if (node.type === "VariableDeclarator" && !isSimplePattern(childNode(node, "id"))) throw new Error("unsupported declaration pattern");
			return node;
		});
	}
	compile() {
		const body = requiredChild(this.fn, "body");
		if (body.type !== "BlockStatement") throw new Error("unsupported function body");
		if (containsNestedFunction(body)) throw new Error("nested functions are not virtualized");
		this.validateBindings();
		this.pushScope();
		this.compileBlock(body, false);
		this.popScope();
		this.emit("PUSH_UNDEFINED");
		this.emit("RETURN");
		return this.finish();
	}
	compileBlock(block, createScope) {
		if (createScope) this.pushScope();
		bodyArray(block).forEach((stmt) => {
			this.compileStatement(stmt);
		});
		if (createScope) this.popScope();
	}
	compileStatement(stmt) {
		switch (stmt.type) {
			case "BlockStatement":
				this.compileBlock(stmt, true);
				return;
			case "VariableDeclaration":
				for (let i = 0; i < nodeDeclarations(stmt).length; i += 1) {
					const decl = nodeDeclarations(stmt)[i];
					const id = requiredChild(decl, "id");
					const slot = this.declareLocal(nodeName$1(id) || "", nodeKind(stmt) === "var");
					const init = childNode(decl, "init");
					if (init) this.compileExpression(init);
					else this.emit("PUSH_UNDEFINED");
					this.emit("STORE_LOCAL", slot);
				}
				return;
			case "ExpressionStatement":
				this.compileExpression(requiredChild(stmt, "expression"));
				this.emit("POP");
				return;
			case "ReturnStatement": {
				const argument = childNode(stmt, "argument");
				if (argument) this.compileExpression(argument);
				else this.emit("PUSH_UNDEFINED");
				this.emit("RETURN");
				return;
			}
			case "IfStatement": {
				const elseLabel = this.label();
				const endLabel = this.label();
				this.compileExpression(requiredChild(stmt, "test"));
				this.emit("JMP_FALSE", elseLabel);
				this.compileStatement(requiredChild(stmt, "consequent"));
				this.emit("JMP", endLabel);
				this.mark(elseLabel);
				const alternate = childNode(stmt, "alternate");
				if (alternate) this.compileStatement(alternate);
				this.mark(endLabel);
				return;
			}
			case "WhileStatement": {
				const start = this.label();
				const end = this.label();
				this.mark(start);
				this.compileExpression(requiredChild(stmt, "test"));
				this.emit("JMP_FALSE", end);
				this.compileStatement(requiredChild(stmt, "body"));
				this.emit("JMP", start);
				this.mark(end);
				return;
			}
			case "EmptyStatement": return;
			default: throw new Error("unsupported statement " + stmt.type);
		}
	}
	compileExpression(expr) {
		switch (expr.type) {
			case "Literal":
				this.compileLiteral(expr);
				return;
			case "Identifier":
				this.compileIdentifier(nodeName$1(expr) || "");
				return;
			case "ThisExpression":
				this.emit("PUSH_THIS");
				return;
			case "ArrayExpression":
				this.compileArray(expr);
				return;
			case "ObjectExpression":
				this.compileObject(expr);
				return;
			case "UnaryExpression":
				this.compileUnary(expr);
				return;
			case "BinaryExpression":
				this.compileBinary(expr);
				return;
			case "LogicalExpression":
				this.compileLogical(expr);
				return;
			case "AssignmentExpression":
				this.compileAssignment(expr);
				return;
			case "MemberExpression":
				this.compileMember(expr);
				return;
			case "CallExpression":
				this.compileCall(expr);
				return;
			case "ConditionalExpression":
				this.compileConditional(expr);
				return;
			case "SequenceExpression":
				for (let i = 0; i < nodeExpressions(expr).length; i += 1) {
					this.compileExpression(nodeExpressions(expr)[i]);
					if (i + 1 < nodeExpressions(expr).length) this.emit("POP");
				}
				return;
			default: throw new Error("unsupported expression " + expr.type);
		}
	}
	compileLiteral(expr) {
		const value = nodeValue(expr);
		if (nodeFields(expr).regex) throw new Error("regex literals are unsupported");
		if (value === null) this.emit("PUSH_NULL");
		else if (value === true) this.emit("PUSH_TRUE");
		else if (value === false) this.emit("PUSH_FALSE");
		else if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < SMALL_LIMIT) this.emit("PUSH_SMALL", value);
		else this.emit("PUSH_CONST", this.addConstant(typeof value, value));
	}
	compileIdentifier(name) {
		if (name === "undefined") this.emit("PUSH_UNDEFINED");
		else if (name === "arguments") this.emit("PUSH_ARGUMENTS");
		else {
			const slot = this.resolveLocal(name);
			if (slot !== null) this.emit("LOAD_LOCAL", slot);
			else if (Object.prototype.hasOwnProperty.call(this.params, name)) this.emit("LOAD_ARG", this.params[name]);
			else this.emit("PUSH_CONST", this.addConstant("reference", name));
		}
	}
	compileArray(expr) {
		const elements = nodeElements(expr);
		for (let i = 0; i < elements.length; i += 1) {
			const element = elements[i];
			if (element === null) this.emit("PUSH_UNDEFINED");
			else this.compileExpression(element);
		}
		this.emit("MAKE_ARRAY", elements.length);
	}
	compileObject(expr) {
		const properties = nodeProperties(expr);
		for (let i = 0; i < properties.length; i += 1) {
			const prop = properties[i];
			const kind = nodeKind(prop);
			if (kind && kind !== "init") throw new Error("unsupported object property kind");
			if (prop.type === "SpreadElement") throw new Error("unsupported object spread");
			const keyNode = requiredChild(prop, "key");
			const key = nodeFlag(prop, "computed") ? null : nodeName$1(keyNode) || nodeValue(keyNode);
			if (key === null) this.compileExpression(keyNode);
			else this.emit("PUSH_CONST", this.addConstant("string", String(key)));
			this.compileExpression(requiredChild(prop, "value"));
		}
		this.emit("MAKE_OBJECT", properties.length);
	}
	compileUnary(expr) {
		const operator = nodeOperator(expr);
		if (operator === "void") {
			this.compileExpression(requiredChild(expr, "argument"));
			this.emit("POP");
			this.emit("PUSH_UNDEFINED");
			return;
		}
		this.compileExpression(requiredChild(expr, "argument"));
		if (operator === "-") this.emit("NEG");
		else if (operator === "!") this.emit("NOT");
		else if (operator === "~") this.emit("BIT_NOT");
		else if (operator === "typeof") this.emit("TYPEOF");
		else if (operator === "+") this.emit("TO_NUMBER");
		else throw new Error("unsupported unary operator " + String(operator));
	}
	compileBinary(expr) {
		this.compileExpression(requiredChild(expr, "left"));
		this.compileExpression(requiredChild(expr, "right"));
		const map = {
			"+": "ADD",
			"-": "SUB",
			"*": "MUL",
			"/": "DIV",
			"%": "MOD",
			"**": "POW",
			"==": "EQ",
			"!=": "NEQ",
			"===": "STRICT_EQ",
			"!==": "STRICT_NEQ",
			"<": "LT",
			"<=": "LTE",
			">": "GT",
			">=": "GTE"
		};
		const operator = nodeOperator(expr) || "";
		if (!map[operator]) throw new Error("unsupported binary operator " + operator);
		this.emit(map[operator]);
	}
	compileLogical(expr) {
		const end = this.label();
		const operator = nodeOperator(expr);
		if (operator === "??") {
			const right = this.label();
			this.compileExpression(requiredChild(expr, "left"));
			this.emit("DUP");
			this.emit("JMP_NULLISH", right);
			this.emit("JMP", end);
			this.mark(right);
			this.emit("POP");
			this.compileExpression(requiredChild(expr, "right"));
			this.mark(end);
			return;
		}
		if (operator !== "&&" && operator !== "||") throw new Error("unsupported logical operator " + String(operator));
		this.compileExpression(requiredChild(expr, "left"));
		this.emit("DUP");
		this.emit(operator === "&&" ? "JMP_FALSE" : "JMP_TRUE", end);
		this.emit("POP");
		this.compileExpression(requiredChild(expr, "right"));
		this.mark(end);
	}
	compileAssignment(expr) {
		const left = requiredChild(expr, "left");
		const operator = nodeOperator(expr);
		if (left.type === "Identifier") {
			const name = nodeName$1(left) || "";
			const slot = this.resolveLocal(name);
			if (slot === null) throw new Error("unsupported assignment target " + name);
			if (operator === "=") this.compileExpression(requiredChild(expr, "right"));
			else {
				const map = {
					"+=": "ADD",
					"-=": "SUB",
					"*=": "MUL",
					"/=": "DIV",
					"%=": "MOD"
				};
				if (!operator || !map[operator]) throw new Error("unsupported assignment operator " + String(operator));
				this.compileIdentifier(name);
				this.compileExpression(requiredChild(expr, "right"));
				this.emit(map[operator]);
			}
			this.emit("DUP");
			this.emit("STORE_LOCAL", slot);
			return;
		}
		if (left.type === "MemberExpression" && operator === "=") {
			this.compileExpression(requiredChild(left, "object"));
			this.compilePropertyKey(left);
			this.compileExpression(requiredChild(expr, "right"));
			this.emit("SET_PROP");
			return;
		}
		throw new Error("unsupported assignment expression");
	}
	compilePropertyKey(expr) {
		if (nodeFlag(expr, "computed")) this.compileExpression(requiredChild(expr, "property"));
		else this.emit("PUSH_CONST", this.addConstant("string", nodeName$1(requiredChild(expr, "property")) || ""));
	}
	compileMember(expr) {
		this.compileExpression(requiredChild(expr, "object"));
		this.compilePropertyKey(expr);
		this.emit("GET_PROP");
	}
	compileCall(expr) {
		const callee = requiredChild(expr, "callee");
		const args = nodeArguments(expr);
		if (callee.type === "MemberExpression") {
			this.compileExpression(requiredChild(callee, "object"));
			this.compilePropertyKey(callee);
			for (let i = 0; i < args.length; i += 1) this.compileExpression(args[i]);
			this.emit("CALL_METHOD", args.length);
			return;
		}
		this.compileExpression(callee);
		for (let j = 0; j < args.length; j += 1) this.compileExpression(args[j]);
		this.emit("CALL_EXT", 0, args.length);
	}
	compileConditional(expr) {
		const alternate = this.label();
		const end = this.label();
		this.compileExpression(requiredChild(expr, "test"));
		this.emit("JMP_FALSE", alternate);
		this.compileExpression(requiredChild(expr, "consequent"));
		this.emit("JMP", end);
		this.mark(alternate);
		this.compileExpression(requiredChild(expr, "alternate"));
		this.mark(end);
	}
	instructionSize(instr, positions) {
		if (instr.label) return 0;
		const start = positions.get(instr) || 0;
		let size = 1;
		for (let i = 0; i < instr.args.length; i += 1) {
			const arg = instr.args[i];
			if (typeof arg === "string") size += signedLengthFor(positions.get(arg) || 0, start, size);
			else size += encodeUnsigned(arg).length;
		}
		return size;
	}
	isInstruction(instr, op) {
		return Boolean(instr && !instr.label && instr.op === op);
	}
	fuseSuperinstructions() {
		const out = [];
		for (let i = 0; i < this.instructions.length; i += 1) {
			const one = this.instructions[i];
			const two = this.instructions[i + 1];
			const three = this.instructions[i + 2];
			if (this.isInstruction(one, "PUSH_CONST") && this.isInstruction(two, "GET_PROP")) {
				out.push({
					op: "GET_CONST_PROP",
					args: [one.args[0]]
				});
				i += 1;
				continue;
			}
			if (this.isInstruction(one, "DUP") && this.isInstruction(two, "STORE_LOCAL") && this.isInstruction(three, "POP")) {
				out.push({
					op: "STORE_LOCAL_POP",
					args: [two.args[0]]
				});
				i += 2;
				continue;
			}
			out.push(one);
		}
		this.instructions = out;
	}
	assemble() {
		const positions = /* @__PURE__ */ new Map();
		let stable = false;
		while (!stable) {
			stable = true;
			let cursor = 0;
			for (let i = 0; i < this.instructions.length; i += 1) {
				const instr = this.instructions[i];
				if (instr.label) {
					if (positions.get(instr.label) !== cursor) stable = false;
					positions.set(instr.label, cursor);
				} else {
					positions.set(instr, cursor);
					cursor += this.instructionSize(instr, positions);
				}
			}
		}
		const tokens = [];
		for (let j = 0; j < this.instructions.length; j += 1) {
			const op = this.instructions[j];
			if (op.label) continue;
			assert.ok(op.op);
			const start = tokens.length;
			tokens.push(this.dialect.opcodes[op.op]);
			for (let k = 0; k < op.args.length; k += 1) {
				const arg = op.args[k];
				if (typeof arg === "string") {
					const before = tokens.length - start;
					const target = positions.get(arg) || 0;
					const len = signedLengthFor(target, start, before);
					encodeSigned(target - (start + before + len)).forEach(function(value) {
						tokens.push(value);
					});
				} else encodeUnsigned(arg).forEach(function(value) {
					tokens.push(value);
				});
			}
		}
		return tokens;
	}
	constantExpression(constant) {
		const next = this.dialect.next;
		if (constant.kind === "number") {
			const value = Number(constant.value);
			if (Number.isNaN(value)) return binary("/", literal(0), literal(0));
			if (value === Infinity) return binary("/", literal(1), literal(0));
			if (value === -Infinity) return {
				type: "UnaryExpression",
				operator: "-",
				prefix: true,
				argument: binary("/", literal(1), literal(0))
			};
			return literal(value);
		}
		if (constant.kind === "string" || constant.kind === "reference") {
			const value = String(constant.value);
			const salt = next() & 65535 || 1;
			const decoded = call(identifier("toildefender$numericVmString"), [
				bigintExpression(stringBlob(value, salt), next),
				literal(value.length),
				literal(salt)
			]);
			if (constant.kind === "reference") return {
				type: "ConditionalExpression",
				test: binary("===", unary("typeof", identifier(value)), literal("undefined")),
				consequent: member(identifier("globalThis"), decoded),
				alternate: identifier(value)
			};
			return decoded;
		}
		if (constant.kind === "boolean") return literal(Boolean(constant.value));
		if (constant.kind === "undefined") return {
			type: "UnaryExpression",
			operator: "void",
			prefix: true,
			argument: literal(0)
		};
		throw new Error("unsupported constant " + constant.kind);
	}
	referenceExpression(value) {
		const next = this.dialect.next;
		const name = String(value);
		const salt = next() & 65535 || 1;
		const decoded = call(identifier("toildefender$numericVmString"), [
			bigintExpression(stringBlob(name, salt), next),
			literal(name.length),
			literal(salt)
		]);
		return {
			type: "ConditionalExpression",
			test: binary("===", unary("typeof", identifier(name)), literal("undefined")),
			consequent: member(identifier("globalThis"), decoded),
			alternate: identifier(name)
		};
	}
	constantCellExpression(constant) {
		if (constant.kind === "reference") return arrayExpression([literal(3), literal(this.addReference(constant.value))]);
		if (constant.kind !== "string" && constant.kind !== "reference") return this.constantExpression(constant);
		const lazy = functionExpression([returnStatement(this.constantExpression(constant))]);
		setNodeField(lazy, "toildefender$numericVmInternal", true);
		return arrayExpression([literal(constant.kind === "reference" ? 2 : 0), lazy]);
	}
	finish() {
		this.fuseSuperinstructions();
		const tokens = this.assemble();
		const encrypted = encryptedStream(tokens, this.dialect.base, this.dialect.seed);
		const opValues = OP_NAMES.map((name) => this.dialect.opcodes[name]);
		const record = {
			base: this.dialect.base,
			blob: packTokens(encrypted.encrypted, this.dialect.base),
			constants: this.constants.map(this.constantCellExpression.bind(this)),
			opValues: opValues.map(literal),
			references: this.references.map(this.referenceExpression.bind(this)),
			seed: this.dialect.seed,
			tag: encrypted.tag,
			tokenCount: tokens.length
		};
		if (this.options.hashMesh.enabled) buildHashMeshRecord(record, encrypted.encrypted, opValues, this.constants, this.dialect, Object.assign({}, this.options.hashMesh, { seed: this.options.seed }));
		return record;
	}
};
function makeDialect(seedText) {
	const seed = hashSeed(seedText);
	const next = makeRng(seed);
	const values = shuffle(Array.from({ length: OP_NAMES.length }, function(_, index) {
		return index + 1;
	}), next);
	const opcodes = Object.create(null);
	OP_NAMES.forEach(function(name, index) {
		opcodes[name] = values[index];
	});
	return {
		base: BASES[next() % BASES.length],
		next,
		opcodes,
		seed
	};
}
function vmCall(record, next, refs = {}) {
	return call(identifier("toildefender$numericVmRun"), [
		bigintExpression(record.blob, next),
		literal(record.base),
		literal(record.tokenCount),
		literal(record.seed),
		literal(record.tag),
		refs.constants || arrayExpression(record.constants),
		identifier("arguments"),
		{ type: "ThisExpression" },
		refs.ops || arrayExpression(record.opValues),
		refs.mesh || (record.mesh ? meshExpression(record.mesh) : literal(null)),
		arrayExpression(record.references || []),
		refs.cache || arrayExpression([])
	]);
}
function objectOptions(value) {
	return typeof value == "object" && value !== null ? value : {};
}
function resolveOptions(options) {
	const input = objectOptions(options);
	const hashMeshInput = objectOptions(input.hashMesh);
	return {
		enabled: input.enabled === true,
		excludeNames: Array.isArray(input.excludeNames) ? input.excludeNames.map(String) : [],
		maxFunctionSize: typeof input.maxFunctionSize == "number" ? input.maxFunctionSize : 120,
		maxFunctions: normalizeMaxFunctions(input.maxFunctions ?? Infinity),
		minFunctionSize: typeof input.minFunctionSize == "number" ? input.minFunctionSize : 1,
		mode: typeof input.mode == "string" ? input.mode : "balanced",
		ratio: normalizeRatio(input.ratio ?? 1),
		seed: typeof input.seed == "string" ? input.seed : "toildefender-numeric-vm",
		hashMesh: {
			bindToVmState: hashMeshInput.bindToVmState !== false,
			chaffRatio: typeof hashMeshInput.chaffRatio == "number" ? hashMeshInput.chaffRatio : .55,
			deriveDialectFromMesh: hashMeshInput.deriveDialectFromMesh === true,
			enabled: hashMeshInput.enabled === true,
			encodeChaff: hashMeshInput.encodeChaff !== false,
			mode: typeof hashMeshInput.mode == "string" ? hashMeshInput.mode : "balanced",
			serverBound: hashMeshInput.serverBound === true,
			unlock: typeof hashMeshInput.unlock == "string" ? hashMeshInput.unlock : "per-function"
		},
		virtualize: typeof input.virtualize == "string" ? input.virtualize : "marked"
	};
}
var NumericVm = class {
	logger;
	options;
	count;
	constructor(logger, options) {
		this.logger = logger;
		this.options = resolveOptions(options);
		this.count = 0;
	}
	shouldTry(node) {
		if (!this.options.enabled || !estest_default.isFunction(node) || nodeFlag(node, "generator") || nodeFlag(node, "async")) return false;
		const body = childNode(node, "body");
		if (!body || body.type !== "BlockStatement") return false;
		if (nodeFlag(node, "toildefender$noNumericVm")) return false;
		const name = functionName(node);
		if (name.indexOf("toildefender$numericVm") === 0) return false;
		if (this.options.excludeNames.indexOf(name) >= 0) return false;
		const bodySize = bodyArray(body).length;
		if (bodySize < this.options.minFunctionSize || bodySize > this.options.maxFunctionSize) return false;
		if (this.options.virtualize === "all-supported") return true;
		if (this.options.virtualize === "heuristic") return bodySize >= this.options.minFunctionSize;
		return false;
	}
	apply(ast) {
		assert.ok(estest_default.isNode(ast));
		if (!this.options.enabled) return ast;
		const runtime = markNumericVmInternal(replaceStaticBigIntCalls(esprima.parseScript(RUNTIME)));
		let transformed = 0;
		let candidateIndex = 0;
		const dataDeclarations = [];
		const trace = typeof process !== "undefined" && process.env && process.env.TOILDEFENDER_NUMERIC_VM_TRACE === "1";
		ast = traverser_default.traverse(ast, [], (node) => {
			if (!this.shouldTry(node)) return node;
			const currentIndex = candidateIndex;
			candidateIndex += 1;
			if (transformed >= this.options.maxFunctions) return node;
			if (this.options.ratio <= 0 || selectionScore(this.options, node, currentIndex) >= this.options.ratio) return node;
			try {
				const body = childNode(node, "body");
				const originalBodySize = body ? bodyArray(body).length : 0;
				const dialect = makeDialect(`${this.options.seed}:${transformed}:${functionName(node)}`);
				const record = new Compiler(node, dialect, this.options).compile();
				const dataName = `toildefender$numericVmData$${transformed}`;
				const opsName = `toildefender$numericVmOps$${transformed}`;
				const meshName = `toildefender$numericVmMesh$${transformed}`;
				const cacheName = `toildefender$numericVmCache$${transformed}`;
				[
					variableDeclaration(dataName, arrayExpression(record.constants)),
					variableDeclaration(opsName, arrayExpression(record.opValues)),
					variableDeclaration(meshName, record.mesh ? meshExpression(record.mesh) : literal(null)),
					variableDeclaration(cacheName, arrayExpression([]))
				].forEach(function(declaration) {
					setNodeField(declaration, "toildefender$numericVmInternal", true);
					dataDeclarations.push(declaration);
				});
				setNodeField(node, "body", {
					type: "BlockStatement",
					body: [returnStatement(vmCall(record, dialect.next, {
						cache: identifier(cacheName),
						constants: identifier(dataName),
						mesh: identifier(meshName),
						ops: identifier(opsName)
					}))]
				});
				transformed += 1;
				if (trace) console.error(JSON.stringify({
					event: "numeric_vm_transformed",
					index: transformed,
					candidateIndex: currentIndex,
					name: functionName(node),
					bodySize: originalBodySize
				}));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (this.options.virtualize === "all-supported") this.logger.warn("numeric_vm skipped " + functionName(node) + ": " + message);
			}
			return node;
		});
		if (transformed > 0) setNodeField(ast, "body", bodyArray(runtime).concat(dataDeclarations).concat(bodyArray(ast)));
		this.count = transformed;
		return ast;
	}
};
//#endregion
//#region src/processors/health.ts
function bodyStatements(node) {
	const body = node.body;
	return Array.isArray(body) ? body : [];
}
var Health = class {
	logger;
	strict;
	constructor(logger) {
		this.logger = logger;
		this.strict = false;
	}
	throwError(msg) {
		if (this.strict) throw new Error(msg);
		else this.logger.warn(msg);
	}
	/**
	* Perform various health checks on the AST without modifying it.
	* @param {Node} ast Root node
	* @returns {Node} Root node
	*/
	check(ast) {
		const visited = /* @__PURE__ */ new Set();
		traverser_default.traverse(ast, [], (node, stack) => {
			if (visited.has(node)) this.throwError("Node has multiple parents: " + JSON.stringify(node));
			else visited.add(node);
			if (node.type == "BlockStatement") bodyStatements(node).forEach((stmt) => {
				if (!estest_default.isStatement(stmt)) this.throwError(JSON.stringify(stack[1], null, 2));
			});
			return node;
		});
		return ast;
	}
};
//#endregion
//#region src/obfuscator.ts
var NO_NUMERIC_VM_DIRECTIVE = "toildefender:no-numeric-vm";
function requireBase() {
	if (typeof import.meta.url == "string" && import.meta.url.length > 0) return import.meta.url;
	if (typeof __filename == "string" && path.isAbsolute(__filename)) return __filename;
	return path.join(process.cwd(), "toildefender.js");
}
var optionalRequire = createRequire(requireBase());
function requireOptional(name) {
	try {
		return optionalRequire(name);
	} catch {
		return null;
	}
}
var defaultOptions = {
	babel: false,
	babelTarget: "ie 11",
	babelPreserveAsync: true,
	runtimeHelpers: true,
	simplify: true,
	features: {
		dead_code: true,
		scope: true,
		control_flow: true,
		identifiers: true,
		numeric_vm: false,
		object_packing: true,
		literals: true,
		mangle: true,
		compress: true
	},
	logLevel: "warn",
	modulesCode: {},
	numericVm: {
		enabled: false,
		maxFunctionSize: 120,
		minFunctionSize: 1,
		mode: "balanced",
		perFunctionDialect: true,
		seed: "toildefender-numeric-vm",
		hashMesh: {
			bindToVmState: true,
			chaffRatio: .55,
			deriveDialectFromMesh: false,
			enabled: false,
			encodeChaff: true,
			mode: "balanced",
			serverBound: false,
			unlock: "per-function"
		},
		virtualize: "marked"
	},
	controlFlow: {
		ratio: 1,
		seed: "toildefender-control-flow"
	},
	scope: {
		ratio: 1,
		seed: "toildefender-scope"
	},
	protections: {
		virtualMachine: {
			bigintBytecode: true,
			enabled: false,
			encodeConstants: true,
			mode: "balanced",
			perFunctionDialect: true,
			randomizedOpcodes: true,
			virtualize: "marked"
		},
		hashMesh: {
			bindToVmState: true,
			chaffRatio: .55,
			deriveDialectFromMesh: false,
			enabled: false,
			encodeChaff: true,
			mode: "balanced",
			serverBound: false,
			unlock: "per-function"
		}
	},
	preprocessorVariables: {}
};
var featureDeps = {
	dead_code: ["control_flow"],
	scope: ["mangle"],
	control_flow: ["scope", "mangle"],
	identifiers: ["mangle"],
	numeric_vm: [],
	object_packing: ["identifiers"],
	literals: ["scope", "mangle"],
	mangle: [],
	compress: ["mangle"]
};
function isRecord(value) {
	return typeof value == "object" && value !== null;
}
function asAstNode(value) {
	return value;
}
function asAstNodeArray(value) {
	return Array.isArray(value) ? value : [];
}
function asStringArray(value) {
	return Array.isArray(value) ? value.filter((item) => typeof item == "string") : [];
}
function nodeName(node) {
	const name = node.name;
	return typeof name == "string" ? name : "";
}
function nodeBody(node) {
	const body = node.body;
	return isRecord(body) && typeof body.type == "string" ? body : {
		type: "BlockStatement",
		body: []
	};
}
function nodeBodyArray(node) {
	const body = node.body;
	return asAstNodeArray(body);
}
function nodeParams(node) {
	const params = node.params;
	return asAstNodeArray(params);
}
function methodIdName(method) {
	const id = method.id;
	if (isRecord(id) && typeof id.name == "string") return id.name;
	return null;
}
function methodFlag(method, key) {
	return method[key] === true;
}
function isNumericVmInternalNode(node) {
	return isRecord(node) && node.toildefender$numericVmInternal === true;
}
function expressionStringValue(node) {
	if (!isRecord(node)) return null;
	if (typeof node.value == "string") return node.value;
	const expression = node.expression;
	if (isRecord(expression) && typeof expression.value == "string") return expression.value;
	return null;
}
function hasNoNumericVmDirective(node) {
	const bodyNode = nodeBody(node);
	if (bodyNode.type != "BlockStatement") return false;
	for (const statement of nodeBodyArray(bodyNode)) {
		if (statement.type != "ExpressionStatement") return false;
		if (statement.directive === NO_NUMERIC_VM_DIRECTIVE || expressionStringValue(statement) === NO_NUMERIC_VM_DIRECTIVE) return true;
	}
	return false;
}
function markNoNumericVmDirectives(ast) {
	return traverser_default.traverse(ast, [], (node) => {
		if ((node.type == "FunctionDeclaration" || node.type == "FunctionExpression" || node.type == "ArrowFunctionExpression") && hasNoNumericVmDirective(node)) node.toildefender$noNumericVm = true;
		return node;
	});
}
function takeNumericVmInternalStatements(ast) {
	if (ast.type != "Program") return [];
	const retained = [];
	ast.body = nodeBodyArray(ast).filter((statement) => {
		if (isNumericVmInternalNode(statement)) {
			retained.push(statement);
			return false;
		}
		return true;
	});
	return retained;
}
var featureDescs = {
	dead_code: { en: "Insert dead code" },
	scope: { en: "Flatten the scope (method) structure to obfuscate application structure" },
	control_flow: { en: "Flatten control flow (if, while, for, etc...) structure to obfuscate control flow" },
	identifiers: { en: "Obfuscate identifiers (variable, object and property names)" },
	numeric_vm: { en: "Virtualize selected functions into BigInt-packed numeric VM programs" },
	object_packing: { en: "Pack object literal keys into numeric schemas instead of alternating key/value arrays" },
	literals: { en: "Obfuscate literals (numbers, strings)" },
	mangle: { en: "Shorten identifiers (variable names, function names)" },
	compress: { en: "Remove unneeded whitespace" }
};
var features = Object.fromEntries(Object.keys(defaultOptions.features).map((feature) => [feature, {
	dependencies: featureDeps[feature] || [],
	descriptions: featureDescs[feature] || {},
	default: defaultOptions.features[feature]
}]));
/**
* Logs informational and diagnostic messages onto an output device or object.
* 
* @callback logAdapterCallback
* @param {string} level - Message level.
* @param {string} data - Message data.
*/
/**
* Obfuscates a project.
* @param {Object} options - Configuration.
* @param {string} options.code - Code of entry point file to be obfuscated.
* @param {Object.<string, string>} options.modulesCode - Code of all of options.code's depedencies.
* @param {boolean} [options.babel = false] - Whether to run the optional Babel transform before obfuscating.
* @param {boolean} [options.babelPreserveAsync = true] - Whether Babel should leave async/generator syntax for async-aware flattening instead of emitting regenerator helpers.
* @param {Object.<string, boolean>} [options.features = All enabled] - Feature configuration.
* @param {logAdapterCallback} [options.logAdapter = Console] - Logging adapter.
* @param {string} [options.logLevel = "warn"] - Minimum level of shown log messages.
* @param {Object.<string, boolean>} [options.preprocessorVariables] - Preprocessor variables.
* @example
* toildefender.do({
*     code: "...",
*     modulesCode: {
*         depA: "...",
*         depB: "..."
*     },
*     features: {
*         scope: true,
*         control_flow: true,
*         identifiers: true,
*         literals: true,
*         mangle: true,
*         compress: true
*      }
* });
*/
function protect(inputOptions) {
	/**
	* Annotates potentially thrown errors with a label
	*/
	function tryTag(label, task) {
		try {
			return task();
		} catch (e) {
			const error = e instanceof Error ? e : new Error(String(e));
			throw new Error(`[${label}]\t${error.stack || error.message}`, { cause: e });
		}
	}
	/**
	* Adapter for Logger
	*/
	function createConsoleLoggingAdapter(logLevel) {
		const LEVELS = [
			"log",
			"error",
			"warn",
			"info",
			"debug"
		];
		const allowedLevels = [];
		for (const level of LEVELS) {
			allowedLevels.push(level);
			if (level == logLevel) break;
		}
		return (level, data) => {
			if (allowedLevels.includes(level)) {
				const prefix = "[task]" + Array(taskIndent).join("	");
				console.log(`${prefix}[${level}]\t${data.join("	")}`);
			}
		};
	}
	const options = _.merge({}, defaultOptions, inputOptions);
	if (options.protections.virtualMachine.enabled) {
		options.numericVm = _.merge({}, options.numericVm, options.protections.virtualMachine, { enabled: true });
		options.features.numeric_vm = true;
	}
	if (options.protections.hashMesh.enabled) {
		options.numericVm = _.merge({}, options.numericVm, options.protections.virtualMachine, {
			enabled: true,
			hashMesh: options.protections.hashMesh
		});
		options.features.numeric_vm = true;
	}
	if (!options.logAdapter) options.logAdapter = createConsoleLoggingAdapter(options.logLevel);
	if (!options.forceFeatures) _.map(featureDeps, (deps, feature) => {
		if (options.features[feature]) deps.forEach((dep) => {
			options.features[dep] = true;
		});
	});
	else options.features = options.forceFeatures;
	const logger = new Logger(options.logAdapter);
	let taskIndent = 1;
	/**
	* Wraps a task, indents its output and measures its duration
	*/
	function doTask(label, condition, task) {
		return tryTag(label, () => {
			taskIndent++;
			const prefix = "[task]" + Array(taskIndent).join("	");
			try {
				if (condition) {
					logger.info(`${prefix}${label} ...`);
					const start = Date.now();
					task();
					const duration = Date.now() - start;
					logger.info(`${prefix}${label}: ${duration}ms`);
					return { otherwise: () => void 0 };
				} else return { otherwise: (task) => {
					task?.();
				} };
			} finally {
				taskIndent--;
			}
		});
	}
	function transformModernSyntax(code, label) {
		const modernBabel = requireOptional("@babel/core");
		if (modernBabel) {
			let presetEnvPath;
			try {
				presetEnvPath = optionalRequire.resolve("@babel/preset-env");
			} catch (e) {
				throw new Error("Babel transform requested, but @babel/preset-env is not installed", { cause: e });
			}
			const presetOptions = {
				modules: "commonjs",
				targets: options.babelTarget,
				useBuiltIns: false
			};
			if (options.babelPreserveAsync) presetOptions.exclude = ["@babel/plugin-transform-async-to-generator", "@babel/plugin-transform-regenerator"];
			const result = modernBabel.transformSync(code, {
				babelrc: false,
				comments: false,
				compact: false,
				configFile: false,
				sourceType: "unambiguous",
				presets: [[presetEnvPath, presetOptions]]
			});
			return result && result.code || code;
		}
		const legacyBabel = requireOptional("babel-core");
		if (!legacyBabel) throw new Error("Babel transform requested, but neither @babel/core nor babel-core is installed");
		const babelOptions = { "plugins": [
			"babel-plugin-transform-es2015-arrow-functions",
			"babel-plugin-transform-es2015-block-scoping",
			"babel-plugin-transform-es2015-classes",
			"babel-plugin-transform-es2015-computed-properties",
			"babel-plugin-transform-es2015-destructuring",
			"babel-plugin-transform-es2015-duplicate-keys",
			"babel-plugin-transform-es2015-for-of",
			"babel-plugin-transform-es2015-function-name",
			"babel-plugin-transform-es2015-literals",
			"babel-plugin-transform-es2015-object-super",
			"babel-plugin-transform-es2015-parameters",
			"babel-plugin-transform-es2015-shorthand-properties",
			"babel-plugin-transform-es2015-spread",
			"babel-plugin-transform-es2015-sticky-regex",
			"babel-plugin-transform-es2015-template-literals",
			"babel-plugin-transform-es2015-unicode-regex"
		].map((plugin) => optionalRequire.resolve(plugin)) };
		return legacyBabel.transform(code, babelOptions).code || code;
	}
	function parseSource(code, options) {
		try {
			return esprima.parseScript(code, options);
		} catch (esprimaError) {
			if (!modernParser) throw esprimaError;
			const parsed = modernParser.parse(code, {
				sourceType: "unambiguous",
				plugins: [
					"estree",
					"classProperties",
					"classPrivateProperties",
					"classPrivateMethods",
					"optionalChaining",
					"nullishCoalescingOperator",
					"objectRestSpread"
				]
			});
			return {
				type: "Program",
				body: parsed.program.body,
				sourceType: parsed.program.sourceType
			};
		}
	}
	function hasMangleUnsupportedSyntax(root) {
		return false;
	}
	function dispatcherForMethod(method) {
		if (methodFlag(method, "async") && methodFlag(method, "generator")) return "main$asyncGenerator";
		if (methodFlag(method, "async")) return "main$async";
		if (methodFlag(method, "generator")) return "main$generator";
		return "main";
	}
	function normalizeRatio(value) {
		const ratio = Number(value);
		if (!Number.isFinite(ratio)) return 1;
		if (ratio < 0) return 0;
		if (ratio > 1) return 1;
		return ratio;
	}
	function hashString32(value) {
		let h = 2166136261;
		for (let i = 0; i < value.length; i += 1) {
			h ^= value.charCodeAt(i);
			h = Math.imul(h, 16777619) >>> 0;
		}
		return h >>> 0;
	}
	function methodControlFlowScore(method, index) {
		const name = methodIdName(method) || "";
		return hashString32(`${options.controlFlow.seed || ""}:${index}:${name}`) / 4294967296;
	}
	const controlFlowRatio = normalizeRatio(options.controlFlow.ratio);
	const controlFlowActive = options.features.control_flow === true && controlFlowRatio > 0;
	const scopeRatio = normalizeRatio(options.scope.ratio);
	const parseOptions = {};
	const scopeOptions = { optimistic: true };
	const lexicalScopeOptions = {
		ecmaVersion: 6,
		optimistic: true,
		sourceType: "script"
	};
	let customBindAdded = false;
	const start = Date.now();
	doTask("preprocessing", true, () => {
		const preprocessor = new Preprocessing(logger);
		const modulesCode = {};
		for (const [key, code] of Object.entries(options.modulesCode)) modulesCode[key] = tryTag(key, () => preprocessor.process(code, options.preprocessorVariables));
		options.modulesCode = modulesCode;
		options.code = tryTag("app", () => preprocessor.process(options.code, options.preprocessorVariables));
	});
	doTask("babel", options.babel, () => {
		const modulesCode = {};
		for (const [key, moduleCode] of Object.entries(options.modulesCode)) modulesCode[key] = tryTag(key, () => transformModernSyntax(moduleCode, key));
		options.modulesCode = modulesCode;
		options.code = tryTag("app", () => transformModernSyntax(options.code, "app"));
	});
	let ast = {
		type: "Program",
		body: []
	};
	let modulesAST = {};
	function addCustomBindOnce() {
		if (!customBindAdded) {
			new Methods(logger).addCustomBind(ast);
			customBindAdded = true;
		}
	}
	doTask("parse", true, () => {
		const parsedModules = {};
		for (const [key, code] of Object.entries(options.modulesCode)) parsedModules[key] = tryTag(key, () => parseSource(code, parseOptions));
		modulesAST = parsedModules;
		modulesAST.app = tryTag("app", () => parseSource(options.code, parseOptions));
	});
	doTask("merge", true, () => {
		ast = asAstNode(new Modules(logger).merge(modulesAST, "app", null));
	});
	doTask("dead_code", options.features.dead_code, () => {
		ast = asAstNode(new DeadCode(logger).insert(ast, 1));
	});
	doTask("numeric_vm_markers", true, () => {
		ast = asAstNode(markNoNumericVmDirectives(ast));
	});
	doTask("simplify", options.simplify, () => {
		ast = asAstNode(new Normalizer(logger).simplify(ast));
	});
	doTask("numeric_vm", options.features.numeric_vm || options.numericVm.enabled, () => {
		ast = asAstNode(new NumericVm(logger, _.merge({}, options.numericVm, { enabled: options.features.numeric_vm || options.numericVm.enabled })).apply(ast));
	});
	doTask("identifiers", options.features.identifiers, () => {
		const identifiers = new Identifiers(logger);
		ast = asAstNode(identifiers.computeProperties(ast));
		ast = asAstNode(identifiers.arrayizeObjects(ast, { objectPacking: options.features.object_packing !== false }));
		ast = asAstNode(identifiers.moveLiterals(ast, escope.analyze(ast, scopeOptions)));
	});
	doTask("literals", options.features.literals, () => {
		new Literals(logger).generateStrings(ast);
	});
	doTask("scope", options.features.scope, () => {
		const scopes = new Scopes(logger);
		const methods = new Methods(logger);
		const rng = new utils_default.UniqueRandom(32768);
		doTask("obfuscate_identifiers", true, () => {
			const variables = new Variables(logger);
			variables.removeFunctionExpressionIds(ast);
			variables.functionDeclarationToExpression(ast, escope.analyze(ast, scopeOptions));
			variables.obfuscateIdentifiers(ast, escope.analyze(ast, lexicalScopeOptions));
			variables.redefineParameters(ast, escope.analyze(ast, scopeOptions));
		});
		doTask("create_scope_objects", true, () => {
			scopes.createScopeObjects(ast, escope.analyze(ast, lexicalScopeOptions), {
				ratio: scopeRatio,
				seed: options.scope.seed || "toildefender-scope",
				forceProgram: controlFlowActive
			});
		});
		const methodEntryPoints = {};
		const entryPointFor = (method) => {
			const name = methodIdName(method);
			return name ? methodEntryPoints[name] : void 0;
		};
		doTask("list_methods", true, () => {
			for (const methodName of asStringArray(methods.listMethods(ast))) methodEntryPoints[methodName] = { entry: rng.get() };
		});
		let fns = [];
		doTask("extract_methods", true, () => {
			const scopeManager = escope.analyze(ast, lexicalScopeOptions);
			fns = asAstNodeArray(methods.extractMethods(ast));
			fns = fns.map((method) => {
				const scopeArgumentCount = methods.methodRefersToArguments(method, scopeManager) ? nodeParams(method).filter((param) => nodeName(param).indexOf("$$scope") == 0).length : 0;
				methods.removeFirstArguments(method, scopeArgumentCount);
				return asAstNode(methods.replaceArgumentReferences(method, true));
			});
			fns.forEach((method) => {
				const entryPoint = entryPointFor(method);
				if (entryPoint) entryPoint.dispatcher = dispatcherForMethod(method);
			});
			const selectedMethodEntryPoints = {};
			fns.forEach((method, index) => {
				const name = methodIdName(method);
				if (!name || !methodEntryPoints[name]) return;
				if (controlFlowRatio >= 1 || methodControlFlowScore(method, index) < controlFlowRatio) selectedMethodEntryPoints[name] = methodEntryPoints[name];
			});
			if (controlFlowActive) {
				methods.replaceFunctionCalls(ast, selectedMethodEntryPoints);
				fns.forEach((method) => {
					methods.replaceFunctionCalls(nodeBody(method), selectedMethodEntryPoints);
				});
			}
		});
		doTask("control_flow", controlFlowActive, () => {
			const flattener = new Flattener(logger, rng);
			const entry = rng.get(), exit = rng.get();
			const dispatcherGroups = {
				"main$async": {
					async: true,
					fns: []
				},
				"main$generator": {
					generator: true,
					fns: []
				},
				"main$asyncGenerator": {
					async: true,
					generator: true,
					fns: []
				}
			};
			const syncFns = [];
			const retainedFns = [];
			const retainedInternalFns = takeNumericVmInternalStatements(ast);
			fns.forEach((method, index) => {
				if (!(controlFlowRatio >= 1 || methodControlFlowScore(method, index) < controlFlowRatio)) {
					retainedFns.push(method);
					return;
				}
				const dispatcher = dispatcherForMethod(method);
				if (dispatcher == "main") syncFns.push(method);
				else dispatcherGroups[dispatcher].fns.push(method);
			});
			flattener.addMethod(ast, entry, exit);
			syncFns.forEach((method) => {
				methods.bumpArgumentsIndices(method, 1);
				const methodEntry = entryPointFor(method);
				if (!methodEntry) return;
				flattener.addMethod(nodeBody(method), methodEntry.entry, exit);
			});
			let syncAst = asAstNode(flattener.getProgram(entry, exit, {
				name: "main",
				invoke: true
			}));
			syncAst = asAstNode(flattener.unifyPrefixStatements(syncAst));
			const asyncPrograms = [];
			for (const [name, group] of Object.entries(dispatcherGroups)) {
				if (group.fns.length == 0) continue;
				const groupFlattener = new Flattener(logger, rng);
				const firstMethodEntry = entryPointFor(group.fns[0]);
				if (!firstMethodEntry) continue;
				const groupExit = rng.get();
				group.fns.forEach((method) => {
					methods.bumpArgumentsIndices(method, 1);
					const methodEntry = entryPointFor(method);
					if (!methodEntry) return;
					groupFlattener.addMethod(nodeBody(method), methodEntry.entry, groupExit);
				});
				let groupAst = asAstNode(groupFlattener.getProgram(firstMethodEntry.entry, groupExit, {
					name,
					async: Boolean(group.async),
					generator: Boolean(group.generator),
					invoke: false
				}));
				groupAst = asAstNode(groupFlattener.unifyPrefixStatements(groupAst));
				asyncPrograms.push(groupAst);
			}
			if (asyncPrograms.length > 0) ast = {
				type: "Program",
				body: retainedInternalFns.concat(retainedFns).concat(asyncPrograms.flatMap((program) => nodeBodyArray(program))).concat(nodeBodyArray(syncAst))
			};
			else ast = {
				type: "Program",
				body: retainedInternalFns.concat(retainedFns).concat(nodeBodyArray(syncAst))
			};
		}).otherwise(() => {
			const retainedInternalFns = takeNumericVmInternalStatements(ast);
			if (ast.type == "Program") ast.type = "BlockStatement";
			ast = {
				type: "Program",
				body: retainedInternalFns.concat(fns).concat([ast])
			};
		});
	});
	doTask("add_runtime_helpers", options.runtimeHelpers && (Boolean(options.features.scope || options.features.object_packing || options.features.literals) || !options.babel), () => {
		addCustomBindOnce();
	});
	doTask("postprocessing", true, () => {
		ast = asAstNode(new Postprocessing(logger).do(ast));
	});
	doTask("health", options.features.health, () => {
		ast = asAstNode(new Health(logger).check(ast));
	});
	doTask("mangle", options.features.mangle, () => {
		if (hasMangleUnsupportedSyntax(ast)) {
			logger.warn("Skipping mangle because native modern syntax is not supported by the legacy mangler");
			return;
		}
		const uglifier = new Uglifier(logger);
		if (ast.type == "Program") ast.type = "BlockStatement";
		ast = asAstNode(uglifier.uglify({
			type: "Program",
			body: [{
				type: "CallExpression",
				arguments: [],
				callee: {
					type: "FunctionExpression",
					params: [],
					body: ast
				}
			}]
		}));
	});
	const codegenOptions = { sourceMapWithCode: false };
	doTask("compress", options.features.compress, () => {
		codegenOptions.format = {
			renumber: true,
			hexadecimal: true,
			quotes: "auto",
			compact: true
		};
	});
	const code = escodegen.generate(ast, codegenOptions);
	Date.now() - start;
	return { code };
}
var api = {
	features,
	protect,
	do: protect
};
//#endregion
export { features as n, protect as r, api as t };
