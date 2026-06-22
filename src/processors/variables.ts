import assert from "assert";
import _ from "lodash";
import estest from "../estest.js";
import ESUtils from "../esutils.js";
import traverser from "../traverser.js";
import utils from "../utils.js";
import type { Loose } from "../types.js";

function isReferenceIdentifier(node: Loose, stack: Loose) {
    const parentFrame = stack[1];
    if (!parentFrame) {
        return true;
    }

    const parent = parentFrame.node;
    const key = parentFrame.key;

    if ((parent.type == "FunctionDeclaration" || parent.type == "FunctionExpression") && (key == "id" || key == "params")) {
        return false;
    }
    if ((parent.type == "ClassDeclaration" || parent.type == "ClassExpression") && key == "id") {
        return false;
    }
    if (parent.type == "VariableDeclarator" && key == "id") {
        return false;
    }
    if (parent.type == "CatchClause" && key == "param") {
        return false;
    }
    if ((parent.type == "MemberExpression" || parent.type == "Property") && key == "property" && parent.computed === false) {
        return false;
    }
    if (parent.type == "Property" && key == "key" && parent.computed === false) {
        return false;
    }
    if ((parent.type == "MethodDefinition" || parent.type == "PropertyDefinition" || parent.type == "FieldDefinition") && key == "key" && parent.computed === false) {
        return false;
    }
    if ((parent.type == "LabeledStatement" || parent.type == "BreakStatement" || parent.type == "ContinueStatement") && key == "label") {
        return false;
    }

    return true;
}

function functionExpressionUsesOwnName(node: Loose) {
    assert.equal(node.type, "FunctionExpression");

    if (!node.id) {
        return false;
    }

    const name = node.id.name;
    let used = false;

    traverser.traverse(node.body, [], (child: Loose, stack: Loose) => {
        if (child.type == "Identifier" && child.name == name && isReferenceIdentifier(child, stack)) {
            used = true;
        }
        return child;
    });

    return used;
}

function isClassMethodScope(scope: Loose) {
    let node = scope && scope.block;
    while (node) {
        if (node.type == "MethodDefinition" || node.type == "ClassBody") {
            return true;
        }
        node = node.toildefender$parent;
    }
    return false;
}

function isNumericVmInternalNode(node: Loose) {
    while (node) {
        if (node.toildefender$numericVmInternal === true) {
            return true;
        }
        node = node.toildefender$parent;
    }
    return false;
}

function isNumericVmInternalScope(scope: Loose) {
    return isNumericVmInternalNode(scope && scope.block);
}

function isNumericVmInternalVariable(variable: Loose) {
    return variable.defs.some((def: Loose) => isNumericVmInternalNode(def.node));
}

export default class Variables {
    logger: Loose;
    esutils: Loose;

    constructor (logger: Loose) {
        this.logger = logger;
        this.esutils = new ESUtils(logger);
    }
    
    /**
     * Removes the id property from FunctionExpressions.
     * They trip up functionDeclarationToExpression and escope (?),
     * causing scopes.js to incorrectly rename some references.
     * @param {Node} ast Root node
     * @returns {Node} Root node
     */
    removeFunctionExpressionIds (ast: Loose) {
        return traverser.traverse(ast, [], (node: Loose, stack: Loose) => {
            if (isNumericVmInternalNode(node)) {
                return node;
            }
            if (node.type == "FunctionExpression" && node.id && !functionExpressionUsesOwnName(node)) {
                node.id = null;
            }
            return node;
        });
    }

    /**
     * Converts function declarations like
     * function test() { ... }
     * to function expression variables like
     * var test = function() { ... };
     * @param {Node} ast Root node
     * @param {ScopeManager} scopeManager Scope manager
     */
    functionDeclarationToExpression (ast: Loose, scopeManager: Loose) {
        assert.ok(estest.isNode(ast));
        
        this.esutils.setParentsRecursive(ast);
        
        scopeManager.scopes.forEach((scope: Loose) => {
            if (!this.esutils.canInsertIntoScope(scope) || isClassMethodScope(scope) || isNumericVmInternalScope(scope)) {
                return;
            }
            scope.variables.forEach((variable: Loose) => {
                variable.defs.forEach((def: Loose) => {
                    if (def.type == "FunctionName") {
                        assert(estest.isFunction(def.node));
                        /**
                         * Here you have to ensure that def.node is statement.
                         * Expressions like { foo: function() { ... }} are parsed
                         * as a FunctionExpression with an id, which are then
                         * mistakingly replaced with EmptyStatements.
                         */
                        if (estest.isStatement(def.node) && !isNumericVmInternalNode(def.node)) {
                            this.esutils.replaceNode(ast, def.node, { type: "EmptyStatement" });
                            this.esutils.insertIntoScope(scope, {
                                type: "VariableDeclaration",
                                kind: "var",
                                declarations: [
                                    {
                                        type: "VariableDeclarator",
                                        id: def.node.id,
                                        init: {
                                            type: "FunctionExpression",
                                            params: def.node.params,
                                            body: def.node.body,
                                            generator: def.node.generator === true,
                                            expression: def.node.expression === true,
                                            async: def.node.async === true,
                                            toildefender$numericVmInternal: def.node.toildefender$numericVmInternal === true
                                        }
                                    }
                                ]
                            });
                        }
                    }
                });
            });
        });
    }

    /**
     * Renames identifiers with unique names, e.g.
     * var a, b = 5;
     * to
     * var $$var$123$a, $$var$123$b = 5;
     * @param {Node} ast Root node
     * @param {ScopeManager} scopeManager Scope manager
     */
    obfuscateIdentifiers (ast: Loose, scopeManager: Loose) {
        const usedNames = new Set();

        function uniqueName(variable: Loose) {
            const base = "$$var$" + utils.hash(variable);
            let name = base + "$" + variable.name;
            let counter = 0;
            while (usedNames.has(name)) {
                counter += 1;
                name = base + counter.toString(36) + "$" + variable.name;
            }
            usedNames.add(name);
            return name;
        }

        scopeManager.scopes.forEach((scope: Loose) => {
            if (isClassMethodScope(scope) || isNumericVmInternalScope(scope)) {
                return;
            }
            if (scope.isStatic()) {
                scope.variables.sort((a: Loose, b: Loose) => {
                    if (a.tainted) {
                        return 1;
                    }
                    if (b.tainted) {
                        return -1;
                    }
                    return (b.identifiers.length + b.references.length) - (a.identifiers.length + a.references.length);
                });

                for (const variable of scope.variables) {
                    if (isNumericVmInternalVariable(variable)) {
                        continue;
                    }

                    const name = uniqueName(variable);

                    if (variable.defs.some((def: Loose) => def.type == "ClassName")) {
                        continue;
                    }

                    if (variable.tainted) {
                        continue;
                    }

                    if (variable.identifiers.length === 0) {
                        // do not change names since this is a special name
                        continue;
                    }

                    for (const def of variable.identifiers) {
                        // change definition's name
                        def.name = name;
                    }

                    for (const ref of variable.references.filter((ref: Loose) => ref.resolved === variable)) {
                        // change reference's name
                        ref.identifier.name = name;
                    }
                }
            }
        });
    }

    /**
     * Replaces direct parameter references like
     * function (a) {
     *     return a;
     * }
     * to copys like
     * function (a) {
     *     var $$arg$abc = a;
     *     return $$arg$abc;
     * }
     * @param {Node} ast Root node
     * @param {ScopeManager} scopeManager Scope manager
     */
    redefineParameters (ast: Loose, scopeManager: Loose) {
        function getArgumentIndex(method: Loose, identifier: Loose) {
            assert(method.type == "FunctionDeclaration" || method.type == "FunctionExpression");
            assert(identifier.type == "Identifier");
            for (let i = 0; i < method.params.length; ++i) {
                if (method.params[i].name == identifier.name) {
                    return i;
                }
            }
            return -1;
        }
        
        const rng = new utils.UniqueRandomAlpha(3);
        
        scopeManager.scopes.forEach((scope: Loose) => {
            if (!this.esutils.canInsertIntoScope(scope) || isClassMethodScope(scope) || isNumericVmInternalScope(scope)) {
                return;
            }
            scope.variables.forEach((variable: Loose) => {
                if (isNumericVmInternalVariable(variable)) {
                    return;
                }
                variable.defs.forEach((def: Loose) => {
                    if (def.type == "Parameter") {
                        assert(def.name.type == "Identifier");
                        const name = "$$arg$" + rng.get();
                        
                        this.esutils.insertIntoScope(scope, {
                            type: "VariableDeclaration",
                            kind: "var",
                            declarations: [
                                {
                                    type: "VariableDeclarator",
                                    id: { type: "Identifier", name: name },
                                    init: def.name
                                }
                            ]
                        });
                        
                        variable.references.forEach((reference: Loose) => {
                            reference.identifier.name = name;
                        });
                    }
                });
            });
        });
    }

};
