import assert from "assert";
import _ from "lodash";
import escodegen from "escodegen";
import estest from "../estest.js";
import traverser from "../traverser.js";

export default class Health {

    constructor (logger) {
        this.logger = logger;
        this.strict = false;
    }
    
    throwError (msg) {
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
    check (ast) {
        var visited = [];
        
        traverser.traverse(ast, [], (node, stack) => {
            if (_.includes(visited, node)) {
                this.throwError("Node has multiple parents: " + JSON.stringify(node));
            } else {
                visited.push(node);
            }
            
            if (node.type == "BlockStatement") {
                node.body.forEach(stmt => {
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
