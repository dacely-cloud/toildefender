import assert from "assert";
import type { AstNode } from "./types.js";

const EXPRESSIONS = [
    "Identifier"
];

const COMPOUND_STATEMENTS = [
    "BlockStatement",
    "WithStatement",
    "IfStatement",
    "SwitchStatement",
    "TryStatement",
    "WhileStatement",
    "DoWhileStatement",
    "ForStatement",
    "ForInStatement"
];

function record(value: unknown): Record<string, unknown> | null {
    return typeof value == "object" && value !== null
        ? value as Record<string, unknown>
        : null;
}

export function isNode(x: unknown): x is AstNode {
    return typeof record(x)?.type == "string";
}

export function isStatement(x: unknown): boolean {
    assert.ok(isNode(x));
    
    return x.type == "Program" || x.type.endsWith("Statement") || x.type.endsWith("Declaration");
}

export function isCompoundStatement(x: unknown): boolean {
    assert.ok(isNode(x));

    return false;
}

export function isExpression(x: unknown): boolean {
    assert.ok(isNode(x));
    
    return EXPRESSIONS.includes(x.type) || x.type.endsWith("Expression");
}

export function isFunction(x: unknown): boolean {
    assert.ok(isNode(x));
    
    return x.type.startsWith("Function");
}

export default {
    isNode,
    isStatement,
    isCompoundStatement,
    isExpression,
    isFunction
};
