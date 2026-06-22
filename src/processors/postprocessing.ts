import assert from "assert";
import _ from "lodash";
import estest from "../estest.js";
import traverser from "../traverser.js";
import utils from "../utils.js";
import type { AstNode, AstStackFrame, LoggerLike } from "../types.js";

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
        return mergeNestedBinds(node.arguments[0]).concat(node.arguments.slice(1)); 
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
        && node.callee.type == "Identifier"
        && node.callee.name == "toildefender$bind";
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
                node.arguments = mergeNestedBinds(node);
            } else if (node.type == "BlockStatement" || node.type == "Program") {
                node.body = node.body.filter((x: AstNode) => estest.isNode(x) && x.type != "EmptyStatement");
            } else if (node.type == "SwitchCase") {
                node.consequent = node.consequent.filter((x: AstNode) => estest.isNode(x) && x.type != "EmptyStatement");
            }
            
            return node;
        });
    }

};
