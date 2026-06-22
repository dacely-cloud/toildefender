import {Parser} from "expr-eval-fork";
import type { Value, Values } from "expr-eval-fork";
import type { LoggerLike } from "../types.js";

type PreprocessorDefines = Record<string, string | number | boolean | null | undefined>;

const DEFAULT_PREPROCESSOR_VARIABLES: PreprocessorDefines = {
    "true": 1,
    "false": 0
};

function normalizeConditionSyntax(condition: string): string {
    return condition
        .replace(/&&/g, " and ")
        .replace(/\|\|/g, " or ")
        .replace(/!(?!=)/g, " not ");
}

/**
 * Generates code from an array of text nodes.
 * @param {TextNode[]} nodes
 * @returns {string}
 */
function codeFromNodeArray(nodes: TextNode[]): string {
    const lines: string[] = [];
    for (const node of nodes) {
        lines[node.line] = node.text;
    }
    return lines.join("\n");
}

/**
 * Removes shebang from beginning of code.
 * @param {string} code
 * @returns {string}
 */
function removeShebangs(code: string): string {
    if (code.startsWith("#!")) {
        code = code.split(/\r?\n/).slice(1).join("\n");
    }

    return code;
}

function toExpressionValue(value: string | number | boolean | null | undefined): Value {
    if (typeof value == "number" || typeof value == "string") {
        return value;
    }
    return value === true ? 1 : 0;
}

function toExpressionValues(defines: PreprocessorDefines): Values {
    const values: Values = {};
    for (const [key, value] of Object.entries(defines)) {
        values[key] = toExpressionValue(value);
    }
    return values;
}

class ArrayUtils {
    /**
     * Replaces all occurences of an object in an array with an other object in place.
     * @param {Array} arr
     * @param {Object} oldElem
     * @param {Object} newElem 
     */
    static replace<T>(arr: T[], oldElem: T, newElem: T): void {
        for (let i = 0; i < arr.length; ++i) {
            if (arr[i] == oldElem) {
                arr[i] = newElem;
            }
        }
    }
}

class Node {
    line = 0;

    /**
     * Evaluates tree into an array of TextNodes.
     * @param {Object.<string, string>} defines Preprocessor variables
     * @returns {TextNode[]}
     */
    eval(defines: PreprocessorDefines): TextNode[] {
        throw new Error("Node.eval() can not be called directly");
    }
}

class BlockNode extends Node {
    children: Node[];

    constructor() {
        super();
        this.children = [];
    }
    eval(defines: PreprocessorDefines): TextNode[] {
        return this.children.flatMap((child) => child.eval(defines));
    }
}

class TextNode extends Node {
    text: string;

    constructor(text: string) {
        super();
        this.text = text;
    }
    eval(defines: PreprocessorDefines): TextNode[] {
        return [this];
    }
}

class DefineNode extends Node {
    left: string;
    right: string | null;

    constructor(left: string, right: string | null) {
        super();
        this.left = left;
        this.right = right;
    }
    eval(defines: PreprocessorDefines): TextNode[] {
        defines[this.left] = this.right;
        return [];
    }
}

class ErrorNode extends Node {
    message: string;

    constructor(message: string) {
        super();
        this.message = message;
    }
    eval(defines: PreprocessorDefines): TextNode[] {
        throw new Error(this.message);
    }
}

class IfBlockNode extends BlockNode {
    condition: string;

    constructor(condition: string) {
        super();
        this.condition = condition;
    }
    /**
     * Evaluates condition.
     * @param {Object.<string, string>} defines Preprocessor variables
     * @returns {boolean}
     */
    evalCond(defines: PreprocessorDefines): boolean {
        let condition = this.condition;
        condition = condition.replace(/!defined\(([\w\d]+)\)/g, (_match: string, p1: string) => Object.hasOwn(defines, p1) ? "false" : "true");
        condition = condition.replace(/defined\(([\w\d]+)\)/g, (_match: string, p1: string) => Object.hasOwn(defines, p1) ? "true" : "false");
        condition = normalizeConditionSyntax(condition);
        return Boolean(Parser.evaluate(condition, toExpressionValues(defines)));
    }
    /**
     * Evaluates node with given condition result.
     * @param {Object.<string, string>} defines Preprocessor variables
     * @returns {boolean}
     */
    evalWith(defines: PreprocessorDefines, result: boolean): TextNode[] {
        if (result) {
            return super.eval(defines);
        } else {
            return [];
        }
    }
    eval(defines: PreprocessorDefines): TextNode[] {
        return this.evalWith(defines, this.evalCond(defines));
    }
}

class ElseBlockNode extends BlockNode {
    ifNode: IfBlockNode;

    constructor(ifNode: IfBlockNode) {
        super();
        this.ifNode = ifNode;
    }
    eval(defines: PreprocessorDefines): TextNode[] {
        if (this.ifNode.evalCond(defines)) {
            return this.ifNode.evalWith(defines, true);
        } else {
            return super.eval(defines);
        }
    }
}

export default class Preprocessing {
    logger: LoggerLike;

    constructor (logger: LoggerLike) {
        this.logger = logger;
    }
    
    /**
     * Processes preprocessor directives.
     * @param {string} code
     * @param {Object.<string, string>} preprocessorVariables
     * @returns {string} Processed code
     */
    processDirectives (code: string, preprocessorVariables: PreprocessorDefines = {}): string {
        const lines = code.split(/\r?\n/), stack = [new BlockNode()];
        const currentBlock = (): BlockNode => {
            const block = stack[stack.length - 1];
            if (!block) {
                throw new Error("preprocessor stack underflow");
            }
            return block;
        };

        const defines: PreprocessorDefines = {
            ...DEFAULT_PREPROCESSOR_VARIABLES,
            ...preprocessorVariables
        };

        for (let i = 0; i < lines.length; ++i) {
            const line = lines[i];
            const [, directive, parameters] = /^\s*\/\/\s*#(\w+)\s*(.+)?$/.exec(line) || [];
            switch (directive) {
                case undefined: {
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
                    const elem =
                        directive == "if" ? new IfBlockNode(parameters || "") :
                        directive == "ifdef" ? new IfBlockNode(`defined(${parameters})`) :
                        directive == "ifndef" ? new IfBlockNode(`!defined(${parameters})`) :
                        new IfBlockNode(parameters || "");
                    elem.line = i;
                    currentBlock().children.push(elem);
                    stack.push(elem);
                    break;
                }
                case "else": {
                    const popped = stack.pop();
                    if (!(popped instanceof IfBlockNode)) {
                        throw new Error("#else without matching #if");
                    }
                    const elem = new ElseBlockNode(popped);
                    elem.line = i;
                    ArrayUtils.replace(currentBlock().children, elem.ifNode, elem);
                    stack.push(elem);
                    break;
                }
                case "endif": {
                    stack.pop();
                    break;
                }
                default: {
                    this.logger.warn(`Unknown preprocessor directive #${directive}`);
                }
            }
        }

        if (stack.length > 1) {
            this.logger.warn("stack.length != 1 (preprocessor directive closing tag missing?)");
        }

        return codeFromNodeArray(stack[0].eval(defines));
    }

    /**
     * Does preprocessing.
     * @param {string} code
     * @param {Object.<string, string>} preprocessorVariables
     * @returns {string}
     */
    process (code: string, preprocessorVariables: PreprocessorDefines = {}): string {
        code = this.processDirectives(code, preprocessorVariables);
        code = removeShebangs(code);
        return code;
    }
    
};
