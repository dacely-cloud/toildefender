"use strict";

var assert = require("assert");

var _ = require("lodash");

var estest = require("../estest");
var ESUtils = require("../esutils");
var traverser = require("../traverser");
var utils = require("../utils");

function isClassMethodFunction(stack) {
    return stack.some(frame => frame.node.type == "MethodDefinition" || frame.node.type == "ClassBody");
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

function isNumericVmInternalFunction(stack) {
    return stack.some(frame => frame.node && isNumericVmInternalNode(frame.node));
}

function isNumericVmInternalScope(scope) {
    return isNumericVmInternalNode(scope && scope.block);
}

function scopeReference(scopeVarName, index) {
    return {
        type: "MemberExpression",
        object: { type: "Identifier", name: scopeVarName },
        property: { type: "Literal", value: index },
        computed: true,
        toildefender$scopeObjectReference: true
    };
}

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

function isInsideNestedScope(stack, root, scopeBlocks) {
    return stack.some(frame => frame.node != root && scopeBlocks.has(frame.node));
}

function isMovableVariable(variable) {
    return variable.defs.some(def => {
        if (isNumericVmInternalNode(def.node)) {
            return false;
        }
        if (def.type == "Variable" || def.type == "CatchClause") {
            return true;
        }
        return def.type == "FunctionName" && def.node.type != "FunctionExpression";
    });
}

function markPropertyValueReplacement(stack) {
    var parentFrame = stack[1];
    if (!parentFrame) {
        return;
    }
    var parent = parentFrame.node;
    if (parent.type == "Property" && parent.shorthand === true && parentFrame.key == "value") {
        parent.shorthand = false;
    }
}

function isReferenceInsideNestedFunction(scopeBlock, identifier) {
    var current = identifier && identifier.toildefender$parent;
    while (current && current != scopeBlock) {
        if (estest.isFunction(current)) {
            return true;
        }
        current = current.toildefender$parent;
    }
    return false;
}

function normalizeRatio(value) {
    var ratio = Number(value);
    if (!Number.isFinite(ratio)) {
        return 1;
    }
    if (ratio < 0) {
        return 0;
    }
    if (ratio > 1) {
        return 1;
    }
    return ratio;
}

function hashString32(value) {
    var h = 0x811c9dc5;
    for (var i = 0; i < value.length; i += 1) {
        h ^= value.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

module.exports = class Scopes {

    constructor (logger) {
        this.logger = logger;
        this.esutils = new ESUtils(logger);
    }

    /**
     * Moves all variables to scope arrays like
     * var a = 1, b = 2;
     * to
     * var $$scope$abc = [];
     * $$scope$abc[0] = 1;
     * $$scope$abc[1] = 2;
     * @param {Node} ast Root node
     * @param {ScopeManager} scopeManager Scope manager
     */
    createScopeObjects (ast, scopeManager, options) {
        assert.ok(estest.isNode(ast));
        
        this.esutils.setParentsRecursive(ast);
        options = options || {};
        var ratio = normalizeRatio(options.ratio);
        var seed = options.seed || "toildefender-scope";
        var forceProgram = options.forceProgram === true;
        var scopes = scopeManager.acquireAll(ast);
        var rngAlpha = new utils.UniqueRandomAlpha(3);
        var replacements = new WeakMap();
        var referencesByVariable = new Map();
        var fallbackReplacementsByName = new Map();
        var scopeBlocks = new WeakSet();
        scopes.forEach(scope => {
            if (scope && scope.block) {
                scopeBlocks.add(scope.block);
            }
        });

        function cloneReplacement(node) {
            return utils.cloneISwearIKnowWhatImDoing(node);
        }

        function addFallbackReplacement(name, replacement, block, scopeDecl) {
            var entries = fallbackReplacementsByName.get(name);
            if (!entries) {
                entries = [];
                fallbackReplacementsByName.set(name, entries);
            }
            entries.push({
                block: block,
                scopeDecl: scopeDecl,
                replacement: replacement
            });
        }

        function ancestorDistance(ancestor, node) {
            var distance = 0;
            var current = node;
            while (current) {
                if (current == ancestor) {
                    return distance;
                }
                current = current.toildefender$parent;
                distance += 1;
            }
            return -1;
        }

        function fallbackReplacementForName(name, node) {
            var entries = fallbackReplacementsByName.get(name);
            if (!entries) {
                return null;
            }

            var best = null;
            var bestDistance = Infinity;
            entries.forEach(entry => {
                var liveBlock = entry.scopeDecl && entry.scopeDecl.toildefender$parent;
                var distance = liveBlock ? ancestorDistance(liveBlock, node) : -1;
                if (distance < 0) {
                    distance = ancestorDistance(entry.block, node);
                }
                if (distance >= 0 && distance < bestDistance) {
                    best = entry.replacement;
                    bestDistance = distance;
                }
            });
            if (best) {
                return best;
            }
            return null;
        }

        function addResolvedReference(variable, reference) {
            if (!variable || !reference || !reference.identifier) {
                return;
            }
            var references = referencesByVariable.get(variable);
            if (!references) {
                references = new Set();
                referencesByVariable.set(variable, references);
            }
            references.add(reference);
        }

        scopeManager.scopes.forEach(scope => {
            scope.variables.forEach(variable => {
                variable.references.forEach(reference => addResolvedReference(variable, reference));
            });

            scope.references.forEach(reference => {
                addResolvedReference(reference.resolved, reference);
            });

            scope.through.forEach(reference => {
                addResolvedReference(reference.resolved, reference);
            });
        });

        function referencesFor(variable) {
            var references = referencesByVariable.get(variable);
            references = references ? Array.from(references) : variable.references;
            return references.filter(reference => reference.resolved === variable);
        }

        function shouldFlattenScope(scope, movableVariables, index) {
            if (forceProgram && scope && scope.block && scope.block.type == "Program") {
                return true;
            }
            if (movableVariables.some(variable => referencesFor(variable).some(reference => isReferenceInsideNestedFunction(scope.block, reference.identifier)))) {
                return true;
            }
            if (ratio >= 1) {
                return true;
            }
            if (ratio <= 0) {
                return false;
            }
            var blockType = scope && scope.block && scope.block.type || "";
            var variableNames = movableVariables.map(variable => variable.name).sort().join(",");
            var score = hashString32(`${seed}:${index}:${scope.type}:${blockType}:${variableNames}`) / 0x100000000;
            return score < ratio;
        }

        function rewriteKnownReferences(node) {
            if (!node) {
                return node;
            }
            return traverser.traverse(node, [], (child, stack) => {
                if (isNumericVmInternalFunction(stack)) {
                    return child;
                }
                if (child.type == "Identifier" && replacements.has(child)) {
                    markPropertyValueReplacement(stack);
                    return cloneReplacement(replacements.get(child));
                }
                return child;
            });
        }

        scopeManager.scopes.forEach((scope, scopeIndex) => {
            if (!this.esutils.canInsertIntoScope(scope) || isClassMethodScope(scope) || isNumericVmInternalScope(scope)) {
                return;
            }
            var movableVariables = scope.variables.filter(isMovableVariable);
            if (movableVariables.length == 0) {
                return;
            }
            if (!shouldFlattenScope(scope, movableVariables, scopeIndex)) {
                return;
            }
            var scopeVarName = `$$scope$${rngAlpha.get()}`;
            
            var counter = 0;
            var indexes = new Map();
            var localReplacementsByName = new Map();
            movableVariables.forEach(variable => {
                indexes.set(variable, counter++);
            });

            movableVariables.forEach(variable => {
                var index = indexes.get(variable);
                variable.defs.forEach(def => {
                    if (def.type == "Variable") {
                        var replacement = scopeReference(scopeVarName, index);
                        localReplacementsByName.set(variable.name, replacement);
                        referencesFor(variable).forEach(reference => {
                            replacements.set(reference.identifier, scopeReference(scopeVarName, index));
                        });
                    } else if (def.type == "CatchClause") {
                        referencesFor(variable).forEach(reference => {
                            replacements.set(reference.identifier, scopeReference(scopeVarName, index));
                        });
                    } else if (def.type == "FunctionName" && def.node.type != "FunctionExpression") {
                        referencesFor(variable).forEach(reference => {
                            replacements.set(reference.identifier, {
                                type: "CallExpression",
                                callee: { type: "Identifier", name: "toildefender$bind" },
                                arguments: [
                                    { type: "Identifier", name: reference.identifier.name },
                                    { type: "Identifier", name: scopeVarName }
                                ]
                            });
                        });
                    }
                });
            });

            var rewriteLocalReferencesByName = () => {
                this.esutils.setParentsRecursive(scope.block);
                traverser.traverse(scope.block, [], (node, stack) => {
                    if (isNumericVmInternalFunction(stack)) {
                        return node;
                    }
                    if (isInsideNestedScope(stack, scope.block, scopeBlocks)) {
                        return node;
                    }
                    if (node.type == "Identifier" && isReferenceIdentifier(node, stack)) {
                        var replacement = localReplacementsByName.get(node.name);
                        if (replacement) {
                            markPropertyValueReplacement(stack);
                            return cloneReplacement(replacement);
                        }
                    }
                    return node;
                });
            };

            var scopeDecl = {
                type: "VariableDeclaration",
                kind: "var",
                declarations: [
                    {
                        type: "VariableDeclarator",
                        id: { type: "Identifier", name: scopeVarName },
                        init: { type: "ArrayExpression", elements: [] }
                    }
                ],
                toildefender$scopeObject: true
            };
            
            this.esutils.insertIntoScope(scope, scopeDecl);
            localReplacementsByName.forEach((replacement, name) => {
                addFallbackReplacement(name, replacement, scope.block, scopeDecl);
            });
            
            movableVariables.forEach(variable => {
                var index = indexes.get(variable);
                
                variable.defs.forEach(def => {
                    if (def.type == "Variable") {
                        assert(def.parent.type == "VariableDeclaration");
                        def.parent.declarations = def.parent.declarations.filter(x => x != def.node);
                        var replacement = [];
                        if (def.node.init) {
                            replacement.push({
                                type: "ExpressionStatement",
                                expression: {
                                    type: "AssignmentExpression",
                                    operator: "=",
                                    left: {
                                        type: "MemberExpression",
                                        object: { type: "Identifier", name: scopeVarName },
                                        property: { type: "Literal", value: index },
                                        computed: true,
                                        toildefender$scopeObjectReference: true
                                    },
                                    right: rewriteKnownReferences(def.node.init)
                                }
                            });
                        }
                        if (def.parent.declarations.length > 0) {
                            replacement.push(def.parent);
                        }
                        if (replacement.length == 0) {
                            this.esutils.replaceNode(scope.block, def.parent, { type: "EmptyStatement" });
                        } else if (replacement.length == 1) {
                            this.esutils.replaceNode(scope.block, def.parent, replacement[0] );
                        } else {
                            this.esutils.replaceNode(scope.block, def.parent, { type: "BlockStatement", body: replacement });
                        }
                        referencesFor(variable).forEach(reference => {
                            // References can not be replaced via replaceNodeEx for whatever reason
                            this.esutils.replaceNode(scope.block, reference.identifier, cloneReplacement(replacements.get(reference.identifier) || scopeReference(scopeVarName, index)));
                        });
                    } else if (def.type == "CatchClause") {
                        Object.defineProperty(scope.block, "toildefender$exception", {
                            value: scopeReference(scopeVarName, index),
                            configurable: true
                        });
                        this.esutils.insertIntoScope(scope, {
                            type: "ExpressionStatement",
                            expression: {
                                type: "AssignmentExpression",
                                operator: "=",
                                left: scopeReference(scopeVarName, index),
                                right: def.name
                            }
                        }, 1);
                        referencesFor(variable).forEach(reference => {
                            this.esutils.replaceNode(scope.block, reference.identifier, cloneReplacement(replacements.get(reference.identifier) || scopeReference(scopeVarName, index)));
                        });
                    } else if (def.type == "FunctionName") {
                        if (def.node.type == "FunctionExpression") {
                            return;
                        }
                        referencesFor(variable).forEach(reference => {
                            this.esutils.replaceNode(scope.block, reference.identifier, cloneReplacement(replacements.get(reference.identifier)));
                        });
                    }
                });
            });

            rewriteLocalReferencesByName();
            
            traverser.traverse(scope.block, [], (node, stack) => {
                if (scope.block == node) {
                    return node;
                }

                if (isClassMethodFunction(stack) || isNumericVmInternalFunction(stack)) {
                    return node;
                }
                
                if (node.type.indexOf("Function") == 0) {
                    node.params.unshift({
                        type: "Identifier",
                        name: scopeVarName
                    });
                }
                
                if (node.type == "FunctionExpression") {
                    return {
                        type: "CallExpression",
                        callee: { type: "Identifier", name: "toildefender$bind" },
                        arguments: [
                            node,
                            { type: "Identifier", name: scopeVarName }
                        ]
                    };
                }
                
                return node;
            });
        });

        this.esutils.setParentsRecursive(ast);
        traverser.traverse(ast, [], (node, stack) => {
            var parentFrame = stack[1];
            if (
                node.type == "Identifier" &&
                node.name.indexOf("$$var$") == 0 &&
                parentFrame &&
                parentFrame.node.type == "CallExpression" &&
                parentFrame.key == "callee" &&
                isReferenceIdentifier(node, stack)
            ) {
                var replacement = fallbackReplacementForName(node.name, node);
                if (replacement) {
                    return cloneReplacement(replacement);
                }
            }
            return node;
        });
    }

};
