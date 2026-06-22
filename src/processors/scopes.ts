import assert from "assert";
import estest from "../estest.js";
import ESUtils from "../esutils.js";
import traverser from "../traverser.js";
import utils from "../utils.js";
import type { AstNode, AstStackFrame, LoggerLike, ScopeLike } from "../types.js";

interface ScopeReference {
    identifier: AstNode;
    resolved?: ScopeVariable | null;
}

interface ScopeDef {
    name?: AstNode;
    node: AstNode;
    parent: AstNode;
    type: string;
}

interface ScopeVariable {
    defs: ScopeDef[];
    name: string;
    references: ScopeReference[];
}

interface ScopeObject extends ScopeLike {
    references: ScopeReference[];
    through: ScopeReference[];
    type?: string;
    variables: ScopeVariable[];
}

interface ScopeManagerObject {
    acquireAll?: (node: AstNode) => ScopeObject[];
    scopes: ScopeObject[];
}

interface ScopeOptions {
    forceProgram?: boolean;
    ratio?: unknown;
    seed?: string;
}

interface FallbackReplacement {
    block: AstNode;
    replacement: AstNode;
    scopeDecl: AstNode;
}

function nodeFields(node: AstNode): Record<string, unknown> {
    return node as unknown as Record<string, unknown>;
}

function nodeArray(value: unknown): AstNode[] {
    return Array.isArray(value) ? (value as AstNode[]) : [];
}

function childNode(node: AstNode, key: string): AstNode | null {
    const value = nodeFields(node)[key];
    return estest.isNode(value) ? value : null;
}

function setNodeField(node: AstNode, key: string, value: unknown): void {
    nodeFields(node)[key] = value;
}

function nodeName(node: AstNode | null): string | null {
    const name = (node as { name?: unknown } | null)?.name;
    return typeof name == "string" ? name : null;
}

function nodeComputed(node: AstNode): boolean {
    return (node as { computed?: unknown }).computed === true;
}

function nodeFlag(node: AstNode, key: "shorthand" | "toildefender$numericVmInternal"): boolean {
    return (node as Record<string, unknown>)[key] === true;
}

function nodeParams(node: AstNode): AstNode[] {
    return nodeArray(nodeFields(node).params);
}

function parentOf(node: AstNode | null): AstNode | null {
    const parent = (node as { toildefender$parent?: unknown } | null)?.toildefender$parent;
    return estest.isNode(parent) ? parent : null;
}

function scopeManagerObject(scopeManager: unknown): ScopeManagerObject {
    const manager = scopeManager as Partial<ScopeManagerObject>;
    if (Array.isArray(manager.scopes)) {
        return manager as ScopeManagerObject;
    }
    return { scopes: [] };
}

function scopeReference(scopeVarName: string, index: number): AstNode {
    return {
        type: "MemberExpression",
        object: { type: "Identifier", name: scopeVarName },
        property: { type: "Literal", value: index },
        computed: true,
        toildefender$scopeObjectReference: true
    };
}

function isClassMethodFunction(stack: AstStackFrame[]): boolean {
    return stack.some((frame: AstStackFrame) => frame.node.type == "MethodDefinition" || frame.node.type == "ClassBody");
}

function isClassMethodScope(scope: ScopeObject): boolean {
    let node: AstNode | null = scope.block;
    while (node) {
        if (node.type == "MethodDefinition" || node.type == "ClassBody") {
            return true;
        }
        node = parentOf(node);
    }
    return false;
}

function isNumericVmInternalNode(node: AstNode | null): boolean {
    while (node) {
        if (nodeFlag(node, "toildefender$numericVmInternal")) {
            return true;
        }
        node = parentOf(node);
    }
    return false;
}

function isNumericVmInternalFunction(stack: AstStackFrame[]): boolean {
    return stack.some((frame: AstStackFrame) => isNumericVmInternalNode(frame.node));
}

function isNumericVmInternalScope(scope: ScopeObject): boolean {
    return isNumericVmInternalNode(scope.block);
}

function isReferenceIdentifier(node: AstNode, stack: AstStackFrame[]): boolean {
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
    if ((parent.type == "MemberExpression" || parent.type == "Property") && key == "property" && !nodeComputed(parent)) {
        return false;
    }
    if (parent.type == "Property" && key == "key" && !nodeComputed(parent)) {
        return false;
    }
    if ((parent.type == "MethodDefinition" || parent.type == "PropertyDefinition" || parent.type == "FieldDefinition") && key == "key" && !nodeComputed(parent)) {
        return false;
    }
    if ((parent.type == "LabeledStatement" || parent.type == "BreakStatement" || parent.type == "ContinueStatement") && key == "label") {
        return false;
    }

    return true;
}

function isInsideNestedScope(stack: AstStackFrame[], root: AstNode, scopeBlocks: WeakSet<AstNode>): boolean {
    return stack.some((frame: AstStackFrame) => frame.node != root && scopeBlocks.has(frame.node));
}

function isMovableVariable(variable: ScopeVariable): boolean {
    return variable.defs.some((def: ScopeDef) => {
        if (isNumericVmInternalNode(def.node)) {
            return false;
        }
        if (def.type == "Variable" || def.type == "CatchClause") {
            return true;
        }
        return def.type == "FunctionName" && def.node.type != "FunctionExpression";
    });
}

function markPropertyValueReplacement(stack: AstStackFrame[]): void {
    const parentFrame = stack[1];
    if (!parentFrame) {
        return;
    }
    const parent = parentFrame.node;
    if (parent.type == "Property" && nodeFlag(parent, "shorthand") && parentFrame.key == "value") {
        setNodeField(parent, "shorthand", false);
    }
}

function isReferenceInsideNestedFunction(scopeBlock: AstNode, identifier: AstNode): boolean {
    let current = parentOf(identifier);
    while (current && current != scopeBlock) {
        if (estest.isFunction(current)) {
            return true;
        }
        current = parentOf(current);
    }
    return false;
}

function normalizeRatio(value: unknown): number {
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

function hashString32(value: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < value.length; i += 1) {
        h ^= value.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

function cloneReplacement(node: AstNode | undefined): AstNode {
    assert.ok(node);
    return utils.cloneISwearIKnowWhatImDoing(node);
}

function ancestorDistance(ancestor: AstNode, node: AstNode): number {
    let distance = 0;
    let current: AstNode | null = node;
    while (current) {
        if (current == ancestor) {
            return distance;
        }
        current = parentOf(current);
        distance += 1;
    }
    return -1;
}

function variableIndex(indexes: Map<ScopeVariable, number>, variable: ScopeVariable): number {
    const index = indexes.get(variable);
    if (typeof index != "number") {
        throw new Error(`Missing scope index for ${variable.name}`);
    }
    return index;
}

export default class Scopes {
    logger: LoggerLike;
    esutils: ESUtils;

    constructor (logger: LoggerLike) {
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
    createScopeObjects (ast: AstNode, scopeManager: unknown, options: ScopeOptions = {}): void {
        assert.ok(estest.isNode(ast));
        
        this.esutils.setParentsRecursive(ast);
        const ratio = normalizeRatio(options.ratio);
        const seed = options.seed || "toildefender-scope";
        const forceProgram = options.forceProgram === true;
        const manager = scopeManagerObject(scopeManager);
        const scopes = typeof manager.acquireAll == "function" ? manager.acquireAll(ast) : manager.scopes;
        const rngAlpha = new utils.UniqueRandomAlpha(3);
        const replacements = new WeakMap<AstNode, AstNode>();
        const referencesByVariable = new Map<ScopeVariable, Set<ScopeReference>>();
        const fallbackReplacementsByName = new Map<string, FallbackReplacement[]>();
        const scopeBlocks = new WeakSet<AstNode>();

        scopes.forEach((scope: ScopeObject) => {
            scopeBlocks.add(scope.block);
        });

        const addFallbackReplacement = (name: string, replacement: AstNode, block: AstNode, scopeDecl: AstNode): void => {
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
        };

        const fallbackReplacementForName = (name: string, node: AstNode): AstNode | null => {
            const entries = fallbackReplacementsByName.get(name);
            if (!entries) {
                return null;
            }

            let best: AstNode | null = null;
            let bestDistance = Infinity;
            entries.forEach((entry: FallbackReplacement) => {
                const liveBlock = parentOf(entry.scopeDecl);
                let distance = liveBlock ? ancestorDistance(liveBlock, node) : -1;
                if (distance < 0) {
                    distance = ancestorDistance(entry.block, node);
                }
                if (distance >= 0 && distance < bestDistance) {
                    best = entry.replacement;
                    bestDistance = distance;
                }
            });
            return best;
        };

        const addResolvedReference = (variable: ScopeVariable | null | undefined, reference: ScopeReference): void => {
            if (!variable) {
                return;
            }
            let references = referencesByVariable.get(variable);
            if (!references) {
                references = new Set();
                referencesByVariable.set(variable, references);
            }
            references.add(reference);
        };

        manager.scopes.forEach((scope: ScopeObject) => {
            scope.variables.forEach((variable: ScopeVariable) => {
                variable.references.forEach((reference: ScopeReference) => addResolvedReference(variable, reference));
            });

            scope.references.forEach((reference: ScopeReference) => {
                addResolvedReference(reference.resolved, reference);
            });

            scope.through.forEach((reference: ScopeReference) => {
                addResolvedReference(reference.resolved, reference);
            });
        });

        const referencesFor = (variable: ScopeVariable): ScopeReference[] => {
            const references = referencesByVariable.get(variable);
            const list = references ? Array.from(references) : variable.references;
            return list.filter((reference: ScopeReference) => reference.resolved === variable);
        };

        const shouldFlattenScope = (scope: ScopeObject, movableVariables: ScopeVariable[], index: number): boolean => {
            if (forceProgram && scope.block.type == "Program") {
                return true;
            }
            if (movableVariables.some((variable: ScopeVariable) => referencesFor(variable).some((reference: ScopeReference) => isReferenceInsideNestedFunction(scope.block, reference.identifier)))) {
                return true;
            }
            if (ratio >= 1) {
                return true;
            }
            if (ratio <= 0) {
                return false;
            }
            const variableNames = movableVariables.map((variable: ScopeVariable) => variable.name).sort().join(",");
            const score = hashString32(`${seed}:${index}:${scope.type || ""}:${scope.block.type}:${variableNames}`) / 0x100000000;
            return score < ratio;
        };

        const rewriteKnownReferences = (node: AstNode): AstNode => {
            return traverser.traverse(node, [], (child: AstNode, stack: AstStackFrame[]) => {
                if (isNumericVmInternalFunction(stack)) {
                    return child;
                }
                const replacement = replacements.get(child);
                if (child.type == "Identifier" && replacement) {
                    markPropertyValueReplacement(stack);
                    return cloneReplacement(replacement);
                }
                return child;
            });
        };

        manager.scopes.forEach((scope: ScopeObject, scopeIndex: number) => {
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
            const indexes = new Map<ScopeVariable, number>();
            const localReplacementsByName = new Map<string, AstNode>();
            movableVariables.forEach((variable: ScopeVariable) => {
                indexes.set(variable, counter++);
            });

            movableVariables.forEach((variable: ScopeVariable) => {
                const index = variableIndex(indexes, variable);
                variable.defs.forEach((def: ScopeDef) => {
                    if (def.type == "Variable") {
                        const replacement = scopeReference(scopeVarName, index);
                        localReplacementsByName.set(variable.name, replacement);
                        referencesFor(variable).forEach((reference: ScopeReference) => {
                            replacements.set(reference.identifier, scopeReference(scopeVarName, index));
                        });
                    } else if (def.type == "CatchClause") {
                        referencesFor(variable).forEach((reference: ScopeReference) => {
                            replacements.set(reference.identifier, scopeReference(scopeVarName, index));
                        });
                    } else if (def.type == "FunctionName" && def.node.type != "FunctionExpression") {
                        referencesFor(variable).forEach((reference: ScopeReference) => {
                            replacements.set(reference.identifier, {
                                type: "CallExpression",
                                callee: { type: "Identifier", name: "toildefender$bind" },
                                arguments: [
                                    { type: "Identifier", name: nodeName(reference.identifier) || variable.name },
                                    { type: "Identifier", name: scopeVarName }
                                ]
                            });
                        });
                    }
                });
            });

            const rewriteLocalReferencesByName = (): void => {
                this.esutils.setParentsRecursive(scope.block);
                traverser.traverse(scope.block, [], (node: AstNode, stack: AstStackFrame[]) => {
                    if (isNumericVmInternalFunction(stack)) {
                        return node;
                    }
                    if (isInsideNestedScope(stack, scope.block, scopeBlocks)) {
                        return node;
                    }
                    if (node.type == "Identifier" && isReferenceIdentifier(node, stack)) {
                        const replacement = localReplacementsByName.get(nodeName(node) || "");
                        if (replacement) {
                            markPropertyValueReplacement(stack);
                            return cloneReplacement(replacement);
                        }
                    }
                    return node;
                });
            };

            const scopeDecl: AstNode = {
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
            localReplacementsByName.forEach((replacement: AstNode, name: string) => {
                addFallbackReplacement(name, replacement, scope.block, scopeDecl);
            });
            
            movableVariables.forEach((variable: ScopeVariable) => {
                const index = variableIndex(indexes, variable);
                variable.defs.forEach((def: ScopeDef) => {
                    if (def.type == "Variable") {
                        const parent = def.parent;
                        assert(parent.type == "VariableDeclaration");
                        const declarations = nodeArray(nodeFields(parent).declarations).filter((declarator: AstNode) => declarator != def.node);
                        setNodeField(parent, "declarations", declarations);

                        const replacement: AstNode[] = [];
                        const init = childNode(def.node, "init");
                        if (init) {
                            replacement.push({
                                type: "ExpressionStatement",
                                expression: {
                                    type: "AssignmentExpression",
                                    operator: "=",
                                    left: scopeReference(scopeVarName, index),
                                    right: rewriteKnownReferences(init)
                                }
                            });
                        }
                        if (declarations.length > 0) {
                            replacement.push(parent);
                        }
                        if (replacement.length == 0) {
                            this.esutils.replaceNode(scope.block, parent, { type: "EmptyStatement" });
                        } else if (replacement.length == 1) {
                            this.esutils.replaceNode(scope.block, parent, replacement[0]);
                        } else {
                            this.esutils.replaceNode(scope.block, parent, { type: "BlockStatement", body: replacement });
                        }
                        referencesFor(variable).forEach((reference: ScopeReference) => {
                            // References can not be replaced via replaceNodeEx for whatever reason.
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
                                right: def.name || { type: "Identifier", name: variable.name }
                            }
                        }, 1);
                        referencesFor(variable).forEach((reference: ScopeReference) => {
                            this.esutils.replaceNode(scope.block, reference.identifier, cloneReplacement(replacements.get(reference.identifier) || scopeReference(scopeVarName, index)));
                        });
                    } else if (def.type == "FunctionName") {
                        if (def.node.type == "FunctionExpression") {
                            return;
                        }
                        referencesFor(variable).forEach((reference: ScopeReference) => {
                            this.esutils.replaceNode(scope.block, reference.identifier, cloneReplacement(replacements.get(reference.identifier)));
                        });
                    }
                });
            });

            rewriteLocalReferencesByName();
            
            traverser.traverse(scope.block, [], (node: AstNode, stack: AstStackFrame[]) => {
                if (scope.block == node) {
                    return node;
                }

                if (isClassMethodFunction(stack) || isNumericVmInternalFunction(stack)) {
                    return node;
                }
                
                if (node.type.indexOf("Function") == 0) {
                    nodeParams(node).unshift({
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
        traverser.traverse(ast, [], (node: AstNode, stack: AstStackFrame[]) => {
            const parentFrame = stack[1];
            if (
                node.type == "Identifier" &&
                (nodeName(node) || "").indexOf("$$var$") == 0 &&
                parentFrame &&
                parentFrame.node.type == "CallExpression" &&
                parentFrame.key == "callee" &&
                isReferenceIdentifier(node, stack)
            ) {
                const replacement = fallbackReplacementForName(nodeName(node) || "", node);
                if (replacement) {
                    return cloneReplacement(replacement);
                }
            }
            return node;
        });
    }
}
