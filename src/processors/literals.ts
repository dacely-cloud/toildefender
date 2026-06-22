import assert from "assert";
import estest from "../estest.js";
import traverser from "../traverser.js";
import utils from "../utils.js";
import type { AstNode, AstStackFrame, LoggerLike } from "../types.js";

function astArray(value: unknown): AstNode[] {
    return Array.isArray(value) ? (value as AstNode[]) : [];
}

function mutableBody(node: AstNode): AstNode[] {
    const body = (node as { body?: unknown }).body;
    if (Array.isArray(body)) {
        return body as AstNode[];
    }

    const nextBody: AstNode[] = [];
    (node as { body?: AstNode[] }).body = nextBody;
    return nextBody;
}

function literalStringValue(node: AstNode): string | null {
    const value = (node as { value?: unknown }).value;
    return typeof value == "string" ? value : null;
}

function isComputed(node: AstNode): boolean {
    return (node as { computed?: unknown }).computed === true;
}

function isNumericVmInternalFunction(stack: AstStackFrame[]): boolean {
    return stack.some((frame) => (frame.node as { toildefender$numericVmInternal?: unknown }).toildefender$numericVmInternal === true);
}

function isUnencodedPropertyKey(stack: AstStackFrame[]): boolean {
    const parentFrame = stack[1];
    if (!parentFrame || parentFrame.node.type != "Property") {
        return false;
    }
    return parentFrame.key == "key" && !isComputed(parentFrame.node);
}

function templateCookedValue(quasi: AstNode): string {
    const value = (quasi as { value?: unknown }).value;
    if (typeof value == "object" && value !== null) {
        const cooked = (value as { cooked?: unknown }).cooked;
        return typeof cooked == "string" ? cooked : "";
    }
    return "";
}

function regexInfo(node: AstNode): { flags: string; pattern: string } | null {
    const regex = (node as { regex?: unknown }).regex;
    if (typeof regex != "object" || regex === null) {
        return null;
    }
    const pattern = (regex as { pattern?: unknown }).pattern;
    const flags = (regex as { flags?: unknown }).flags;
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
function makeStringGenerator(str: string): AstNode {
    assert.equal(typeof str, "string");
    
    const fragments: string[] = [];
    
    while (str.length > 0) {
        const len = utils.random(1, 5);
        fragments.push(str.substring(0, len));
        str = str.substring(len);
    }
    
    const body: AstNode[] = [
        {
            type: "VariableDeclaration",
            kind: "var",
            declarations: [
                {
                    type: "VariableDeclarator",
                    id: { type: "Identifier", name: "str" },
                    init: { type: "Literal", value: "" }
                }
            ]
        }
    ];
    const block: AstNode = {
        type: "BlockStatement",
        body
    };
    
    fragments.forEach((fragment: string) => {
        const decoded = makeStringByteArrayCall(fragment);
        
        body.push({
            type: "ExpressionStatement",
            expression: {
                type: "BinaryExpression",
                operator: "+=",
                left: { type: "Identifier", name: "str" },
                right: decoded
            }
        });
    });
    
    body.push({
        type: "ReturnStatement",
        argument: { type: "Identifier", name: "str" }
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
 * Generate unicode-escaped string generator from string.
 * @param {string} str
 * @returns {Node}
 */
function makeStringUnicode(str: string): AstNode {
    assert.equal(typeof str, "string");
    
    return {
        type: "CallExpression",
        callee: { type: "Identifier", name: "eval" },
        arguments: [
            {
                type: "Literal",
                value: "\"" + str.split("").map((x: string) => "\\x" + x.charCodeAt(0).toString(16)).join("") + "\""
            }
        ]
    };
}

/**
 * Generate URL-escaped string generator from string.
 * @param {string} str
 * @returns {Node}
 */
function makeStringUnescape(str: string): AstNode {
    assert.equal(typeof str, "string");
    
    return {
        type: "CallExpression",
        callee: { type: "Identifier", name: "unescape" },
        arguments: [
            {
                type: "Literal",
                value: str.split("").map((x: string) => "%" + x.charCodeAt(0).toString(16)).join("")
            }
        ]
    };
}

/**
 * Generate char-code-escaped char generator from char.
 * @param {string} cha
 * @returns {Node}
 */
function makeCharByte(cha: string): AstNode {
    assert.equal(typeof cha, "string");
    assert.equal(cha.length, 1);
    
    return {
        type: "CallExpression",
        callee: {
            type: "MemberExpression",
            computed: false,
            object: { type: "Identifier", name: "String" },
            property: { type: "Identifier", name: "fromCharCode" }
        },
        arguments: [
            {
                type: "Literal",
                value: cha.charCodeAt(0)
            }
        ]
    };
}

/**
 * Generate char-code-escaped string generator from string.
 * @param {string} str
 * @returns {Node}
 */
function makeStringByteArrayCall(str: string): AstNode {
    assert.equal(typeof str, "string");
    
    return {
        type: "CallExpression",
        callee: { type: "Identifier", name: "toildefender$fromCharCodes" },
        arguments: str.split("").map((x: string) => ({ type: "Literal", value: x.charCodeAt(0) }))
    };
}

function makeStringExpression(str: string): AstNode {
    if (str.length == 0) {
        return { type: "Literal", value: "" };
    }
    return makeStringGenerator(str);
}

function makeStringCallExpression(expr: AstNode): AstNode {
    return {
        type: "CallExpression",
        callee: { type: "Identifier", name: "String" },
        arguments: [expr]
    };
}

function concatExpressions(left: AstNode, right: AstNode): AstNode {
    return {
        type: "BinaryExpression",
        operator: "+",
        left,
        right
    };
}

function makeTemplateExpression(node: AstNode): AstNode {
    assert.equal(node.type, "TemplateLiteral");

    const quasis = astArray((node as { quasis?: unknown }).quasis);
    const expressions = astArray((node as { expressions?: unknown }).expressions);
    let expression: AstNode | null = null;
    for (let i = 0; i < quasis.length; i += 1) {
        const quasiExpression = makeStringExpression(templateCookedValue(quasis[i]));
        expression = expression ? concatExpressions(expression, quasiExpression) : quasiExpression;

        const templateExpression = expressions[i];
        if (templateExpression) {
            expression = concatExpressions(expression, makeStringCallExpression(templateExpression));
        }
    }

    return expression || { type: "Literal", value: "" };
}

function makeRegexExpression(node: AstNode): AstNode {
    assert.equal(node.type, "Literal");
    const regex = regexInfo(node);
    assert.ok(regex);

    return {
        type: "NewExpression",
        callee: { type: "Identifier", name: "RegExp" },
        arguments: [
            makeStringExpression(regex.pattern),
            makeStringExpression(regex.flags)
        ]
    };
}

export default class Literals {
    logger: LoggerLike;

    constructor (logger: LoggerLike) {
        this.logger = logger;
    }
    
    /**
     * Move strings into $$strings array
     * @param {Node} ast Root node
     * @returns {Node} Root node
     */
    extractStrings (ast: AstNode): AstNode {
        assert.ok(estest.isNode(ast));
        
        const global: AstNode = { type: "Identifier", name: "$$strings" };
        
        const strings: AstNode[] = [];
        const stringMap: Record<string, number> = {};
        
        ast = traverser.traverse(ast, [], (node: AstNode, stack: AstStackFrame[]) => {
            if (isNumericVmInternalFunction(stack)) {
                return node;
            }
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
                    property: { type: "Literal", value: idx }
                };
            }
            
            return node;
        });
        
        mutableBody(ast).splice(0, 0, {
            type: "VariableDeclaration",
            kind: "var",
            declarations: [
                {
                    type: "VariableDeclarator",
                    id: global,
                    init: {
                        type: "ArrayExpression",
                        elements: strings
                    }
                }
            ]
        });
        
        return ast;
    }

    /**
     * Replace string literals with string generators.
     * @param {Node} ast Root node
     * @returns {Node} Root node
     */
    generateStrings (ast: AstNode): AstNode {
        assert.ok(estest.isNode(ast));
        
        ast = traverser.traverse(ast, [], (node: AstNode, stack: AstStackFrame[]) => {
            if (isNumericVmInternalFunction(stack)) {
                return node;
            }
            if (node.type == "TemplateLiteral") {
                return makeTemplateExpression(node);
            }
            if (node.type == "Literal" && regexInfo(node)) {
                return makeRegexExpression(node);
            }
            const value = literalStringValue(node);
            if (node.type == "Literal"
                && value !== null
                && stack.length > 1
                && !isUnencodedPropertyKey(stack)) {
                return makeStringGenerator(value);
            }
            
            return node;
        });
        
        return ast;
    }
    
};
