import assert from "assert";
import estest from "../estest.js";
import traverser from "../traverser.js";
import utils from "../utils.js";
import type { AstNode, AstStackFrame, LoggerLike } from "../types.js";

const KEYWORDS = ["await","break","case","catch","class","const","continue","debugger","default","delete","do","else","enum","export","extends","finally","for","function","if","implements","import","in","instanceof","interface","let","new","package","private","protected","public","return","static","super","switch","this","throw","try","typeof","var","void","while","with","yield"];

function isClassMethodBody(stack: AstStackFrame[]): boolean {
    return stack.some((frame: AstStackFrame) => frame.node.type == "MethodDefinition" || frame.node.type == "ClassBody");
}

function blockBody(node: AstNode): AstNode[] {
    const body = (node as { body?: unknown }).body;
    return Array.isArray(body) ? (body as AstNode[]) : [];
}

function containsLexicalDeclaration(node: AstNode): boolean {
    if (
        node.type == "ClassDeclaration" ||
        node.type == "FunctionDeclaration" ||
        (node.type == "VariableDeclaration" && node.kind != "var")
    ) {
        return true;
    }

    let found = false;
    traverser.traverseEx(node, [], function (this: { abort(): void }, child: AstNode) {
        if (child != node && estest.isFunction(child)) {
            return child;
        }
        if (
            child.type == "ClassDeclaration" ||
            child.type == "FunctionDeclaration" ||
            (child.type == "VariableDeclaration" && child.kind != "var")
        ) {
            found = true;
            this.abort();
        }
        return child;
    });
    return found;
}

export default class DeadCode {
    logger: LoggerLike;

    constructor (logger: LoggerLike) {
        this.logger = logger;
    }
    
    /**
     * Insert dead code
     * @param {Node} ast
     * @returns {Node}
     */
    insert (ast: AstNode, probability: number): AstNode {
        assert.ok(estest.isNode(ast));

        const rngAlpha = new utils.UniqueRandomAlpha(3);

        return traverser.traverse(ast, [], (node: AstNode, stack: AstStackFrame[]) => {
            if (node.type == "BlockStatement" && !isClassMethodBody(stack)) {
                const body = blockBody(node);
                if (body.length == 0) {
                    return node;
                }

                for (let i = 0; i < probability; ++i) {
                    if (probability - i < Math.random()) {
                        continue;
                    }

                    const pos = utils.random(0, body.length - 1);
                    const len = utils.random(1, body.length - pos);

                    const varValue = KEYWORDS[utils.random(0, KEYWORDS.length)] || KEYWORDS[0];

                    const selected = body.slice(pos, pos + len);
                    if (selected.some(containsLexicalDeclaration)) {
                        continue;
                    }

                    const spliced = body.splice(pos, len);
                    body.splice(pos, 0,
                        {
                            type: "IfStatement",
                            test: {
                                type: "BinaryExpression",
                                operator: "==",
                                left: { type: "Literal", value: varValue },
                                right: { type: "Literal", value: varValue }
                            },
                            consequent: {
                                type: "BlockStatement",
                                body: spliced
                            }
                        }
                    );
                }
            }
            return node;
        });
    }
    
};
