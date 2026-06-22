import assert from "assert";
import _ from "lodash";
import estest from "../estest.js";
import ESUtils from "../esutils.js";
import traverser from "../traverser.js";
import utils from "../utils.js";

function isReferenceIdentifier(node, stack) {
    var parentFrame = stack[1];
    if (!parentFrame) {
        return true;
    }

    var parent = parentFrame.node;
    var key = parentFrame.key;

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

function functionExpressionUsesOwnName(node) {
    assert.equal(node.type, "FunctionExpression");

    if (!node.id) {
        return false;
    }

    var name = node.id.name;
    var used = false;

    traverser.traverse(node.body, [], (child, stack) => {
        if (child.type == "Identifier" && child.name == name && isReferenceIdentifier(child, stack)) {
            used = true;
        }
        return child;
    });

    return used;
}

function isClassMethodScope(scope) {
    var node = scope && scope.block;
    while (node) {
        if (node.type == "MethodDefinition" || node.type == "ClassBody") {
            return true;
        }
        node = node.toildefender$parent;
    }
    return false;
}

function isNumericVmInternalNode(node) {
    while (node) {
        if (node.toildefender$numericVmInternal === true) {
            return true;
        }
        node = node.toildefender$parent;
    }
    return false;
}

function isNumericVmInternalScope(scope) {
    return isNumericVmInternalNode(scope && scope.block);
}

function isNumericVmInternalVariable(variable) {
    return variable.defs.some(def => isNumericVmInternalNode(def.node));
}

export default class Variables {

    constructor (logger) {
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
    removeFunctionExpressionIds (ast) {
        return traverser.traverse(ast, [], (node, stack) => {
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
    functionDeclarationToExpression (ast, scopeManager) {
        assert.ok(estest.isNode(ast));
        
        this.esutils.setParentsRecursive(ast);
        
        scopeManager.scopes.forEach(scope => {
            if (!this.esutils.canInsertIntoScope(scope) || isClassMethodScope(scope) || isNumericVmInternalScope(scope)) {
                return;
            }
            scope.variables.forEach(variable => {
                variable.defs.forEach(def => {
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
    obfuscateIdentifiers (ast, scopeManager) {
        var usedNames = new Set();

        function uniqueName(variable) {
            var base = "$$var$" + utils.hash(variable);
            var name = base + "$" + variable.name;
            var counter = 0;
            while (usedNames.has(name)) {
                counter += 1;
                name = base + counter.toString(36) + "$" + variable.name;
            }
            usedNames.add(name);
            return name;
        }

        scopeManager.scopes.forEach(scope => {
            if (isClassMethodScope(scope) || isNumericVmInternalScope(scope)) {
                return;
            }
            if (scope.isStatic()) {
                scope.variables.sort((a, b) => {
                    if (a.tainted) {
                        return 1;
                    }
                    if (b.tainted) {
                        return -1;
                    }
                    return (b.identifiers.length + b.references.length) - (a.identifiers.length + a.references.length);
                });

                for (let variable of scope.variables) {
                    if (isNumericVmInternalVariable(variable)) {
                        continue;
                    }

                    var name = uniqueName(variable);

                    if (variable.defs.some(def => def.type == "ClassName")) {
                        continue;
                    }

                    if (variable.tainted) {
                        continue;
                    }

                    if (variable.identifiers.length === 0) {
                        // do not change names since this is a special name
                        continue;
                    }

                    for (let def of variable.identifiers) {
                        // change definition's name
                        def.name = name;
                    }

                    for (let ref of variable.references.filter(ref => ref.resolved === variable)) {
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
    redefineParameters (ast, scopeManager) {
        function getArgumentIndex(method, identifier) {
            assert(method.type == "FunctionDeclaration" || method.type == "FunctionExpression");
            assert(identifier.type == "Identifier");
            for (var i = 0; i < method.params.length; ++i) {
                if (method.params[i].name == identifier.name) {
                    return i;
                }
            }
            return -1;
        }
        
        var rng = new utils.UniqueRandomAlpha(3);
        
        scopeManager.scopes.forEach(scope => {
            if (!this.esutils.canInsertIntoScope(scope) || isClassMethodScope(scope) || isNumericVmInternalScope(scope)) {
                return;
            }
            scope.variables.forEach(variable => {
                if (isNumericVmInternalVariable(variable)) {
                    return;
                }
                variable.defs.forEach(def => {
                    if (def.type == "Parameter") {
                        assert(def.name.type == "Identifier");
                        var name = "$$arg$" + rng.get();
                        
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
                        
                        variable.references.forEach(reference => {
                            reference.identifier.name = name;
                        });
                    }
                });
            });
        });
    }

};
