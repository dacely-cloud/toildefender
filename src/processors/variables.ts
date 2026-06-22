import assert from "assert";
import estest from "../estest.js";
import ESUtils from "../esutils.js";
import traverser from "../traverser.js";
import utils from "../utils.js";
import type { AstNode, AstStackFrame, LoggerLike, ScopeLike } from "../types.js";

interface VariableReference {
    identifier: AstNode;
    resolved?: ScopeVariable | null;
}

interface VariableDef {
    name?: AstNode;
    node: AstNode;
    type: string;
}

interface ScopeVariable {
    defs: VariableDef[];
    identifiers: AstNode[];
    name: string;
    references: VariableReference[];
    tainted?: boolean;
}

interface VariableScope extends ScopeLike {
    isStatic?: () => boolean;
    references: VariableReference[];
    variables: ScopeVariable[];
}

interface VariableScopeManager {
    scopes: VariableScope[];
}

function nodeFields(node: AstNode): Record<string, unknown> {
    return node as unknown as Record<string, unknown>;
}

function astArray(value: unknown): AstNode[] {
    return Array.isArray(value) ? (value as AstNode[]) : [];
}

function childNode(node: AstNode, key: string): AstNode | null {
    const value = nodeFields(node)[key];
    return estest.isNode(value) ? value : null;
}

function setChildValue(node: AstNode, key: string, value: unknown): void {
    nodeFields(node)[key] = value;
}

function nodeName(node: AstNode | null): string | null {
    const name = (node as { name?: unknown } | null)?.name;
    return typeof name == "string" ? name : null;
}

function setNodeName(node: AstNode, name: string): void {
    (node as { name?: string }).name = name;
}

function nodeComputed(node: AstNode): boolean {
    return (node as { computed?: unknown }).computed === true;
}

function nodeFlag(node: AstNode, key: "async" | "expression" | "generator" | "toildefender$numericVmInternal"): boolean {
    return (node as Record<string, unknown>)[key] === true;
}

function nodeParams(node: AstNode): AstNode[] {
    return astArray(nodeFields(node).params);
}

function parentOf(node: AstNode): AstNode | null {
    const parent = (node as { toildefender$parent?: unknown }).toildefender$parent;
    return estest.isNode(parent) ? parent : null;
}

function scopeList(scopeManager: unknown): VariableScope[] {
    const scopes = (scopeManager as { scopes?: unknown }).scopes;
    return Array.isArray(scopes) ? (scopes as VariableScope[]) : [];
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

function functionExpressionUsesOwnName(node: AstNode): boolean {
    assert.equal(node.type, "FunctionExpression");

    const id = childNode(node, "id");
    const name = nodeName(id);
    if (!name) {
        return false;
    }

    const body = childNode(node, "body");
    if (!body) {
        return false;
    }

    let used = false;

    traverser.traverse(body, [], (child: AstNode, stack: AstStackFrame[]) => {
        if (child.type == "Identifier" && nodeName(child) == name && isReferenceIdentifier(child, stack)) {
            used = true;
        }
        return child;
    });

    return used;
}

function isClassMethodScope(scope: VariableScope): boolean {
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

function isNumericVmInternalScope(scope: VariableScope): boolean {
    return isNumericVmInternalNode(scope.block);
}

function isNumericVmInternalVariable(variable: ScopeVariable): boolean {
    return variable.defs.some((def: VariableDef) => isNumericVmInternalNode(def.node));
}

export default class Variables {
    logger: LoggerLike;
    esutils: ESUtils;

    constructor (logger: LoggerLike) {
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
    removeFunctionExpressionIds (ast: AstNode): AstNode {
        return traverser.traverse(ast, [], (node: AstNode) => {
            if (isNumericVmInternalNode(node)) {
                return node;
            }
            if (node.type == "FunctionExpression" && childNode(node, "id") && !functionExpressionUsesOwnName(node)) {
                setChildValue(node, "id", null);
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
    functionDeclarationToExpression (ast: AstNode, scopeManager: unknown): void {
        assert.ok(estest.isNode(ast));
        
        this.esutils.setParentsRecursive(ast);
        
        scopeList(scopeManager).forEach((scope: VariableScope) => {
            if (!this.esutils.canInsertIntoScope(scope) || isClassMethodScope(scope) || isNumericVmInternalScope(scope)) {
                return;
            }
            scope.variables.forEach((variable: ScopeVariable) => {
                variable.defs.forEach((def: VariableDef) => {
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
                                        id: childNode(def.node, "id"),
                                        init: {
                                            type: "FunctionExpression",
                                            params: nodeParams(def.node),
                                            body: childNode(def.node, "body"),
                                            generator: nodeFlag(def.node, "generator"),
                                            expression: nodeFlag(def.node, "expression"),
                                            async: nodeFlag(def.node, "async"),
                                            toildefender$numericVmInternal: nodeFlag(def.node, "toildefender$numericVmInternal")
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
    obfuscateIdentifiers (ast: AstNode, scopeManager: unknown): void {
        const usedNames = new Set<string>();

        function uniqueName(variable: ScopeVariable): string {
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

        scopeList(scopeManager).forEach((scope: VariableScope) => {
            if (isClassMethodScope(scope) || isNumericVmInternalScope(scope)) {
                return;
            }
            if (scope.isStatic?.()) {
                scope.variables.sort((a: ScopeVariable, b: ScopeVariable) => {
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

                    if (variable.defs.some((def: VariableDef) => def.type == "ClassName")) {
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
                        setNodeName(def, name);
                    }

                    for (const ref of variable.references.filter((ref: VariableReference) => ref.resolved === variable)) {
                        // change reference's name
                        setNodeName(ref.identifier, name);
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
    redefineParameters (ast: AstNode, scopeManager: unknown): void {
        const rng = new utils.UniqueRandomAlpha(3);
        
        scopeList(scopeManager).forEach((scope: VariableScope) => {
            if (!this.esutils.canInsertIntoScope(scope) || isClassMethodScope(scope) || isNumericVmInternalScope(scope)) {
                return;
            }
            scope.variables.forEach((variable: ScopeVariable) => {
                if (isNumericVmInternalVariable(variable)) {
                    return;
                }
                variable.defs.forEach((def: VariableDef) => {
                    if (def.type == "Parameter") {
                        assert(def.name?.type == "Identifier");
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
                        
                        variable.references.forEach((reference: VariableReference) => {
                            setNodeName(reference.identifier, name);
                        });
                    }
                });
            });
        });
    }

};
