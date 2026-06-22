import assert from "assert";
import estest from "../estest.js";
import traverser from "../traverser.js";
import type { AstNode, AstStackFrame, LoggerLike } from "../types.js";

function astNodeArray(value: unknown): AstNode[] {
    return Array.isArray(value) ? (value as AstNode[]) : [];
}

function nodeArguments(node: AstNode): AstNode[] {
    return astNodeArray((node as { arguments?: unknown }).arguments);
}

function setNodeArguments(node: AstNode, args: AstNode[]): void {
    (node as { arguments?: AstNode[] }).arguments = args;
}

function nodeBody(node: AstNode): AstNode[] {
    return astNodeArray((node as { body?: unknown }).body);
}

function setNodeBody(node: AstNode, body: AstNode[]): void {
    (node as { body?: AstNode[] }).body = body;
}

function nodeConsequent(node: AstNode): AstNode[] {
    return astNodeArray((node as { consequent?: unknown }).consequent);
}

function setNodeConsequent(node: AstNode, consequent: AstNode[]): void {
    (node as { consequent?: AstNode[] }).consequent = consequent;
}

function isIdentifierNamed(value: unknown, name: string): boolean {
    return typeof value == "object"
        && value !== null
        && (value as { type?: unknown }).type == "Identifier"
        && (value as { name?: unknown }).name == name;
}

/**
 * Merges nested bind calls like
 * toildefender$bind(toildefender$bind(main, 1234), 5678)
 * to
 * toildefender$bind(main, 1234, 5678)
 * @param {Node} node
 * @returns {Node}
 */
function mergeNestedBinds(node: AstNode): AstNode[] {
    assert.ok(estest.isNode(node));
    
    if (isBindCall(node)) {
        const args = nodeArguments(node);
        const first = args[0];
        return first ? mergeNestedBinds(first).concat(args.slice(1)) : [];
    } else {
        return [ node ];
    }
}

/**
 * Checks whether node is a call to toildefender$bind.
 * @param {Node} node
 * @returns {boolean}
 */
function isBindCall(node: AstNode): boolean {
    assert.ok(estest.isNode(node));
    
    return node.type == "CallExpression"
        && isIdentifierNamed((node as { callee?: unknown }).callee, "toildefender$bind");
}

export default class Postprocessing {
    logger: LoggerLike;

    constructor (logger: LoggerLike) {
        this.logger = logger;
    }

    /**
     * Does postprocessing.
     * @param {Node} ast Root node
     * @return {Node} Root node
     */
    do (ast: AstNode): AstNode {
        assert.ok(estest.isNode(ast));
        
        return traverser.traverse(ast, [], (node: AstNode, stack: AstStackFrame[]) => {
            if (isBindCall(node)) {
                setNodeArguments(node, mergeNestedBinds(node));
            } else if (node.type == "BlockStatement" || node.type == "Program") {
                setNodeBody(node, nodeBody(node).filter((x: AstNode) => estest.isNode(x) && x.type != "EmptyStatement"));
            } else if (node.type == "SwitchCase") {
                setNodeConsequent(node, nodeConsequent(node).filter((x: AstNode) => estest.isNode(x) && x.type != "EmptyStatement"));
            }
            
            return node;
        });
    }

};
