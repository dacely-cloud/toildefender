import assert from "assert";
import _ from "lodash";
import escodegen from "escodegen";
import estest from "../estest.js";
import traverser from "../traverser.js";
import type { AstNode, AstStackFrame, LoggerLike } from "../types.js";
import type { Loose } from "../types.js";

export default class Health {
    logger: LoggerLike;
    strict: boolean;

    constructor (logger: LoggerLike) {
        this.logger = logger;
        this.strict = false;
    }
    
    throwError (msg: string): void {
        if (this.strict) {
            throw new Error(msg);
        } else {
            this.logger.warn(msg);
        }
    }
    
    /**
     * Perform various health checks on the AST without modifying it.
     * @param {Node} ast Root node
     * @returns {Node} Root node
     */
    check (ast: AstNode): AstNode {
        const visited: Loose[] = [];
        
        traverser.traverse(ast, [], (node: AstNode, stack: AstStackFrame[]) => {
            if (_.includes(visited, node)) {
                this.throwError("Node has multiple parents: " + JSON.stringify(node));
            } else {
                visited.push(node);
            }
            
            if (node.type == "BlockStatement") {
                node.body.forEach((stmt: AstNode) => {
                    if (!estest.isStatement(stmt)) {
                        this.throwError(JSON.stringify(stack[1], null, 2));
                    }
                });
            }
            
            return node;
        });
        
        return ast;
    }
};
