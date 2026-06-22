//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let lodash = require("lodash");
lodash = __toESM(lodash, 1);
let expr_eval_fork = require("expr-eval-fork");
//#region src/processors/preprocessing.ts
var DEFAULT_PREPROCESSOR_VARIABLES = {
	"true": 1,
	"false": 0
};
function normalizeConditionSyntax(condition) {
	return condition.replace(/&&/g, " and ").replace(/\|\|/g, " or ").replace(/!(?!=)/g, " not ");
}
/**
* Generates code from an array of text nodes.
* @param {TextNode[]} nodes
* @returns {string}
*/
function codeFromNodeArray(nodes) {
	const lines = [];
	for (const node of nodes) lines[node.line] = node.text;
	return lines.join("\n");
}
/**
* Removes shebang from beginning of code.
* @param {string} code
* @returns {string}
*/
function removeShebangs(code) {
	if (lodash.default.startsWith(code, "#!")) code = code.split(/\r?\n/).slice(1).join("\n");
	return code;
}
var ArrayUtils = class {
	/**
	* Replaces all occurences of an object in an array with an other object in place.
	* @param {Array} arr
	* @param {Object} oldElem
	* @param {Object} newElem 
	*/
	static replace(arr, oldElem, newElem) {
		for (let i = 0; i < arr.length; ++i) if (arr[i] == oldElem) arr[i] = newElem;
	}
};
var Node = class {
	line = 0;
	constructor() {}
	/**
	* Evaluates tree into an array of TextNodes.
	* @param {Object.<string, string>} defines Preprocessor variables
	* @returns {TextNode[]}
	*/
	eval(defines) {
		throw new Error("Node.eval() can not be called directly");
	}
};
var BlockNode = class extends Node {
	children;
	constructor() {
		super();
		this.children = [];
	}
	eval(defines) {
		return lodash.default.flatten(this.children.map((x) => x.eval(defines)));
	}
};
var TextNode = class extends Node {
	text;
	constructor(text) {
		super();
		this.text = text;
	}
	eval(defines) {
		return [this];
	}
};
var DefineNode = class extends Node {
	left;
	right;
	constructor(left, right) {
		super();
		this.left = left;
		this.right = right;
	}
	eval(defines) {
		defines[this.left] = this.right;
		return [];
	}
};
var ErrorNode = class extends Node {
	message;
	constructor(message) {
		super();
		this.message = message;
	}
	eval(defines) {
		throw new Error(this.message);
	}
};
var IfBlockNode = class extends BlockNode {
	condition;
	constructor(condition) {
		super();
		this.condition = condition;
	}
	/**
	* Evaluates condition.
	* @param {Object.<string, string>} defines Preprocessor variables
	* @returns {boolean}
	*/
	evalCond(defines) {
		let condition = this.condition;
		condition = condition.replace(/!defined\(([\w\d]+)\)/g, (match, p1) => !defines.hasOwnProperty(p1) ? "true" : "false");
		condition = condition.replace(/defined\(([\w\d]+)\)/g, (match, p1) => defines.hasOwnProperty(p1) ? "true" : "false");
		condition = normalizeConditionSyntax(condition);
		return Boolean(expr_eval_fork.Parser.evaluate(condition, defines));
	}
	/**
	* Evaluates node with given condition result.
	* @param {Object.<string, string>} defines Preprocessor variables
	* @returns {boolean}
	*/
	evalWith(defines, result) {
		if (result) return super.eval(defines);
		else return [];
	}
	eval(defines) {
		return this.evalWith(defines, this.evalCond(defines));
	}
};
var ElseBlockNode = class extends BlockNode {
	ifNode;
	constructor(ifNode) {
		super();
		this.ifNode = ifNode;
	}
	eval(defines) {
		if (this.ifNode.evalCond(defines)) return this.ifNode.evalWith(defines, true);
		else return super.eval(defines);
	}
};
var Preprocessing = class {
	logger;
	constructor(logger) {
		this.logger = logger;
	}
	/**
	* Processes preprocessor directives.
	* @param {string} code
	* @param {Object.<string, string>} preprocessorVariables
	* @returns {string} Processed code
	*/
	processDirectives(code, preprocessorVariables = {}) {
		const lines = code.split(/\r?\n/), stack = [new BlockNode()];
		const currentBlock = () => {
			const block = stack[stack.length - 1];
			if (!block) throw new Error("preprocessor stack underflow");
			return block;
		};
		const defines = {};
		lodash.default.merge(defines, DEFAULT_PREPROCESSOR_VARIABLES);
		lodash.default.merge(defines, preprocessorVariables);
		for (let i = 0; i < lines.length; ++i) {
			const line = lines[i];
			const [, directive, parameters] = /^\s*\/\/\s*#(\w+)\s*(.+)?$/.exec(line) || [];
			switch (directive) {
				case void 0: {
					const elem = new TextNode(line);
					elem.line = i;
					currentBlock().children.push(elem);
					break;
				}
				case "define": {
					const [, left, right] = /^\s*([\w\d]+)\s*(?:=\s*([\w\d]+))?\s*$/.exec(parameters) || [];
					const elem = new DefineNode(left || "", right || null);
					elem.line = i;
					currentBlock().children.push(elem);
					break;
				}
				case "error": {
					const elem = new ErrorNode(parameters || "");
					elem.line = i;
					currentBlock().children.push(elem);
					break;
				}
				case "if":
				case "ifdef":
				case "ifndef": {
					const elem = directive == "if" ? new IfBlockNode(parameters) : directive == "ifdef" ? new IfBlockNode(`defined(${parameters})`) : directive == "ifndef" ? new IfBlockNode(`!defined(${parameters})`) : new IfBlockNode(parameters || "");
					elem.line = i;
					currentBlock().children.push(elem);
					stack.push(elem);
					break;
				}
				case "else": {
					const popped = stack.pop();
					if (!(popped instanceof IfBlockNode)) throw new Error("#else without matching #if");
					const elem = new ElseBlockNode(popped);
					elem.line = i;
					ArrayUtils.replace(currentBlock().children, elem.ifNode, elem);
					stack.push(elem);
					break;
				}
				case "endif":
					stack.pop();
					break;
				default: this.logger.warn(`Unknown preprocessor directive #${directive}`);
			}
		}
		if (stack.length > 1) this.logger.warn("stack.length != 1 (preprocessor directive closing tag missing?)");
		return codeFromNodeArray(stack[0].eval(defines));
	}
	/**
	* Does preprocessing.
	* @param {string} code
	* @param {Object.<string, string>} preprocessorVariables
	* @returns {string}
	*/
	process(code, preprocessorVariables = {}) {
		code = this.processDirectives(code, preprocessorVariables);
		code = removeShebangs(code);
		return code;
	}
};
//#endregion
Object.defineProperty(exports, "Preprocessing", {
	enumerable: true,
	get: function() {
		return Preprocessing;
	}
});
Object.defineProperty(exports, "__toESM", {
	enumerable: true,
	get: function() {
		return __toESM;
	}
});
