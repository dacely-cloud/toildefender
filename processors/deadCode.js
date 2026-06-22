import assert from "assert";
import _ from "lodash";
import estest from "../estest.js";
import traverser from "../traverser.js";
import utils from "../utils.js";

const KEYWORDS = ["await","break","case","catch","class","const","continue","debugger","default","delete","do","else","enum","export","extends","finally","for","function","if","implements","import","in","instanceof","interface","let","new","package","private","protected","public","return","static","super","switch","this","throw","try","typeof","var","void","while","with","yield"];

function isClassMethodBody(stack) {
    return stack.some(frame => frame.node.type == "MethodDefinition" || frame.node.type == "ClassBody");
}

function containsLexicalDeclaration(node) {
    if (
        node.type == "ClassDeclaration" ||
        node.type == "FunctionDeclaration" ||
        (node.type == "VariableDeclaration" && node.kind != "var")
    ) {
        return true;
    }

    var found = false;
    traverser.traverseEx(node, [], function (child) {
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

    constructor (logger) {
        this.logger = logger;
    }
    
    /**
     * Insert dead code
     * @param {Node} ast
     * @returns {Node}
     */
    insert (ast, probability) {
        assert.ok(estest.isNode(ast));

        var rngAlpha = new utils.UniqueRandomAlpha(3);

        return traverser.traverse(ast, [], (node, stack) => {
            if (node.type == "BlockStatement" && !isClassMethodBody(stack)) {
                for (var i = 0; i < probability; ++i) {
                    if (probability - i < Math.random()) {
                        continue;
                    }

                    var pos = utils.random(0, node.body.length - 1);
                    var len = utils.random(1, node.body.length - pos);

                    var varValue = _.sample(KEYWORDS);

                    var selected = node.body.slice(pos, pos + len);
                    if (selected.some(containsLexicalDeclaration)) {
                        continue;
                    }

                    var spliced = node.body.splice(pos, len);
                    node.body.splice(pos, 0,
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
