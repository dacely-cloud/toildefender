import assert from "assert";
import _ from "lodash";
import estest from "../estest.js";
import ESUtils from "../esutils.js";
import traverser from "../traverser.js";
import utils from "../utils.js";
import type { Loose } from "../types.js";

function isClassMethodFunction(stack: Loose) {
    return stack.some((frame: Loose) => frame.node.type == "MethodDefinition" || frame.node.type == "ClassBody");
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

function isNumericVmInternalFunction(stack: Loose) {
    return stack.some((frame: Loose) => frame.node && isNumericVmInternalNode(frame.node));
}

function isNumericVmInternalScope(scope: Loose) {
    return isNumericVmInternalNode(scope && scope.block);
}

function scopeReference(scopeVarName: Loose, index: Loose) {
    return {
        type: "MemberExpression",
        object: { type: "Identifier", name: scopeVarName },
        property: { type: "Literal", value: index },
        computed: true,
        toildefender$scopeObjectReference: true
    };
}

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

function isInsideNestedScope(stack: Loose, root: Loose, scopeBlocks: Loose) {
    return stack.some((frame: Loose) => frame.node != root && scopeBlocks.has(frame.node));
}

function isMovableVariable(variable: Loose) {
    return variable.defs.some((def: Loose) => {
        if (isNumericVmInternalNode(def.node)) {
            return false;
        }
        if (def.type == "Variable" || def.type == "CatchClause") {
            return true;
        }
        return def.type == "FunctionName" && def.node.type != "FunctionExpression";
    });
}

function markPropertyValueReplacement(stack: Loose) {
    const parentFrame = stack[1];
    if (!parentFrame) {
        return;
    }
    const parent = parentFrame.node;
    if (parent.type == "Property" && parent.shorthand === true && parentFrame.key == "value") {
        parent.shorthand = false;
    }
}

function isReferenceInsideNestedFunction(scopeBlock: Loose, identifier: Loose) {
    let current = identifier && identifier.toildefender$parent;
    while (current && current != scopeBlock) {
        if (estest.isFunction(current)) {
            return true;
        }
        current = current.toildefender$parent;
    }
    return false;
}

function normalizeRatio(value: Loose) {
    const ratio = Number(value);
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

function hashString32(value: Loose) {
    let h = 0x811c9dc5;
    for (let i = 0; i < value.length; i += 1) {
        h ^= value.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

export default class Scopes {
    logger: Loose;
    esutils: Loose;

    constructor (logger: Loose) {
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
    createScopeObjects (ast: Loose, scopeManager: Loose, options: Loose) {
        assert.ok(estest.isNode(ast));
        
        this.esutils.setParentsRecursive(ast);
        options = options || {};
        const ratio = normalizeRatio(options.ratio);
        const seed = options.seed || "toildefender-scope";
        const forceProgram = options.forceProgram === true;
        const scopes = scopeManager.acquireAll(ast);
        const rngAlpha = new utils.UniqueRandomAlpha(3);
        const replacements = new WeakMap();
        const referencesByVariable = new Map();
        const fallbackReplacementsByName = new Map();
        const scopeBlocks = new WeakSet();
        scopes.forEach((scope: Loose) => {
            if (scope && scope.block) {
                scopeBlocks.add(scope.block);
            }
        });

        function cloneReplacement(node: Loose) {
            return utils.cloneISwearIKnowWhatImDoing(node);
        }

        function addFallbackReplacement(name: Loose, replacement: Loose, block: Loose, scopeDecl: Loose) {
            let entries = fallbackReplacementsByName.get(name);
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

        function ancestorDistance(ancestor: Loose, node: Loose) {
            let distance = 0;
            let current = node;
            while (current) {
                if (current == ancestor) {
                    return distance;
                }
                current = current.toildefender$parent;
                distance += 1;
            }
            return -1;
        }

        function fallbackReplacementForName(name: Loose, node: Loose) {
            const entries = fallbackReplacementsByName.get(name);
            if (!entries) {
                return null;
            }

            let best = null;
            let bestDistance = Infinity;
            entries.forEach((entry: Loose) => {
                const liveBlock = entry.scopeDecl && entry.scopeDecl.toildefender$parent;
                let distance = liveBlock ? ancestorDistance(liveBlock, node) : -1;
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

        function addResolvedReference(variable: Loose, reference: Loose) {
            if (!variable || !reference || !reference.identifier) {
                return;
            }
            let references = referencesByVariable.get(variable);
            if (!references) {
                references = new Set();
                referencesByVariable.set(variable, references);
            }
            references.add(reference);
        }

        scopeManager.scopes.forEach((scope: Loose) => {
            scope.variables.forEach((variable: Loose) => {
                variable.references.forEach((reference: Loose) => addResolvedReference(variable, reference));
            });

            scope.references.forEach((reference: Loose) => {
                addResolvedReference(reference.resolved, reference);
            });

            scope.through.forEach((reference: Loose) => {
                addResolvedReference(reference.resolved, reference);
            });
        });

        function referencesFor(variable: Loose) {
            let references = referencesByVariable.get(variable);
            references = references ? Array.from(references) : variable.references;
            return references.filter((reference: Loose) => reference.resolved === variable);
        }

        function shouldFlattenScope(scope: Loose, movableVariables: Loose, index: Loose) {
            if (forceProgram && scope && scope.block && scope.block.type == "Program") {
                return true;
            }
            if (movableVariables.some((variable: Loose) => referencesFor(variable).some((reference: Loose) => isReferenceInsideNestedFunction(scope.block, reference.identifier)))) {
                return true;
            }
            if (ratio >= 1) {
                return true;
            }
            if (ratio <= 0) {
                return false;
            }
            const blockType = scope && scope.block && scope.block.type || "";
            const variableNames = movableVariables.map((variable: Loose) => variable.name).sort().join(",");
            const score = hashString32(`${seed}:${index}:${scope.type}:${blockType}:${variableNames}`) / 0x100000000;
            return score < ratio;
        }

        function rewriteKnownReferences(node: Loose) {
            if (!node) {
                return node;
            }
            return traverser.traverse(node, [], (child: Loose, stack: Loose) => {
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

        scopeManager.scopes.forEach((scope: Loose, scopeIndex: Loose) => {
            if (!this.esutils.canInsertIntoScope(scope) || isClassMethodScope(scope) || isNumericVmInternalScope(scope)) {
                return;
            }
            const movableVariables = scope.variables.filter(isMovableVariable);
            if (movableVariables.length == 0) {
                return;
            }
            if (!shouldFlattenScope(scope, movableVariables, scopeIndex)) {
                return;
            }
            const scopeVarName = `$$scope$${rngAlpha.get()}`;
            
            let counter = 0;
            const indexes = new Map();
            const localReplacementsByName = new Map();
            movableVariables.forEach((variable: Loose) => {
                indexes.set(variable, counter++);
            });

            movableVariables.forEach((variable: Loose) => {
                const index = indexes.get(variable);
                variable.defs.forEach((def: Loose) => {
                    if (def.type == "Variable") {
                        const replacement = scopeReference(scopeVarName, index);
                        localReplacementsByName.set(variable.name, replacement);
                        referencesFor(variable).forEach((reference: Loose) => {
                            replacements.set(reference.identifier, scopeReference(scopeVarName, index));
                        });
                    } else if (def.type == "CatchClause") {
                        referencesFor(variable).forEach((reference: Loose) => {
                            replacements.set(reference.identifier, scopeReference(scopeVarName, index));
                        });
                    } else if (def.type == "FunctionName" && def.node.type != "FunctionExpression") {
                        referencesFor(variable).forEach((reference: Loose) => {
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

            const rewriteLocalReferencesByName = () => {
                this.esutils.setParentsRecursive(scope.block);
                traverser.traverse(scope.block, [], (node: Loose, stack: Loose) => {
                    if (isNumericVmInternalFunction(stack)) {
                        return node;
                    }
                    if (isInsideNestedScope(stack, scope.block, scopeBlocks)) {
                        return node;
                    }
                    if (node.type == "Identifier" && isReferenceIdentifier(node, stack)) {
                        const replacement = localReplacementsByName.get(node.name);
                        if (replacement) {
                            markPropertyValueReplacement(stack);
                            return cloneReplacement(replacement);
                        }
                    }
                    return node;
                });
            };

            const scopeDecl = {
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
            localReplacementsByName.forEach((replacement: Loose, name: Loose) => {
                addFallbackReplacement(name, replacement, scope.block, scopeDecl);
            });
            
            movableVariables.forEach((variable: Loose) => {
                const index = indexes.get(variable);
                
                variable.defs.forEach((def: Loose) => {
                    if (def.type == "Variable") {
                        assert(def.parent.type == "VariableDeclaration");
                        def.parent.declarations = def.parent.declarations.filter((x: Loose) => x != def.node);
                        const replacement: Loose[] = [];
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
                        referencesFor(variable).forEach((reference: Loose) => {
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
                        referencesFor(variable).forEach((reference: Loose) => {
                            this.esutils.replaceNode(scope.block, reference.identifier, cloneReplacement(replacements.get(reference.identifier) || scopeReference(scopeVarName, index)));
                        });
                    } else if (def.type == "FunctionName") {
                        if (def.node.type == "FunctionExpression") {
                            return;
                        }
                        referencesFor(variable).forEach((reference: Loose) => {
                            this.esutils.replaceNode(scope.block, reference.identifier, cloneReplacement(replacements.get(reference.identifier)));
                        });
                    }
                });
            });

            rewriteLocalReferencesByName();
            
            traverser.traverse(scope.block, [], (node: Loose, stack: Loose) => {
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
        traverser.traverse(ast, [], (node: Loose, stack: Loose) => {
            const parentFrame = stack[1];
            if (
                node.type == "Identifier" &&
                node.name.indexOf("$$var$") == 0 &&
                parentFrame &&
                parentFrame.node.type == "CallExpression" &&
                parentFrame.key == "callee" &&
                isReferenceIdentifier(node, stack)
            ) {
                const replacement = fallbackReplacementForName(node.name, node);
                if (replacement) {
                    return cloneReplacement(replacement);
                }
            }
            return node;
        });
    }

};
