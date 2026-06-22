import estest from "../estest.js";
import traverser from "../traverser.js";
import type { AstNode, AstStackFrame, LoggerLike } from "../types.js";

function bodyStatements(node: AstNode): AstNode[] {
    const body = (node as { body?: unknown }).body;
    return Array.isArray(body) ? (body as AstNode[]) : [];
}

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
        const visited = new Set<AstNode>();
        
        traverser.traverse(ast, [], (node: AstNode, stack: AstStackFrame[]) => {
            if (visited.has(node)) {
                this.throwError("Node has multiple parents: " + JSON.stringify(node));
            } else {
                visited.add(node);
            }
            
            if (node.type == "BlockStatement") {
                bodyStatements(node).forEach((stmt: AstNode) => {
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
