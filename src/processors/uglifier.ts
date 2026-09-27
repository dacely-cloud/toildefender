import assert from "assert";
import esshorten from "esshorten";
import escope from "escope";
import { analyze as analyzeNative } from "eslint-scope";
import { generate } from "astring";
import { parse } from "@babel/parser";
import type { Program as EstreeProgram } from "estree";
import estest from "../estest.js";
import traverser from "../traverser.js";
import type { AstNode, AstStackFrame, LoggerLike } from "../types.js";

const RESERVED_WORDS = new Set([
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "new",
    "null",
    "return",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
    "arguments",
    "undefined"
]);

const FIRST_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
const REST_CHARS = FIRST_CHARS + "0123456789";

interface ScopeReference {
    identifier: AstNode;
    resolved?: unknown;
}

interface ScopeVariable {
    defs?: Array<{ type?: string }>;
    identifiers: AstNode[];
    name: string;
    references: ScopeReference[];
    tainted?: boolean;
}

interface MangleScope {
    through: ScopeReference[];
    type?: string;
    variables: ScopeVariable[];
}

interface MangleScopeManager {
    scopes: MangleScope[];
}

interface VariableEntry {
    scope: MangleScope;
    variable: ScopeVariable;
}

function nodeKind(node: AstNode): string | undefined {
    const kind = (node as { kind?: unknown }).kind;
    return typeof kind == "string" ? kind : undefined;
}

function nodeName(node: AstNode | undefined): string | undefined {
    const name = (node as { name?: unknown } | undefined)?.name;
    return typeof name == "string" ? name : undefined;
}

function containsModernBindings(ast: AstNode): boolean {
    let found = false;
    traverser.traverseEx(ast, [], function (this: { abort(): void }, node: AstNode) {
        if (
            (node.type == "VariableDeclaration" && nodeKind(node) != "var")
            || node.type == "ClassDeclaration"
            || node.type == "ClassExpression"
        ) {
            found = true;
            this.abort();
        }
        return node;
    });
    return found;
}

function shortName(index: number): string {
    let name = FIRST_CHARS[index % FIRST_CHARS.length] || "";
    index = Math.floor(index / FIRST_CHARS.length);
    while (index > 0) {
        index -= 1;
        name += REST_CHARS[index % REST_CHARS.length] || "";
        index = Math.floor(index / REST_CHARS.length);
    }
    return name;
}

function collectUnresolvedNames(scopeManager: MangleScopeManager): Set<string> {
    const names = new Set<string>();
    scopeManager.scopes.forEach((scope: MangleScope) => {
        scope.through.forEach((reference: ScopeReference) => {
            const name = nodeName(reference.identifier);
            if (!reference.resolved && name) {
                names.add(name);
            }
        });
    });
    return names;
}

function isRenamableVariable(scope: MangleScope, variable: ScopeVariable, unresolvedNames: Set<string>, nativeSyntax: boolean = false): boolean {
    if (scope.type == "global") {
        return false;
    }
    if (
        variable.name.indexOf("toildefender$anon$") === 0
        && unresolvedNames.has(variable.name)
    ) {
        return false;
    }
    if (variable.name == "arguments" || variable.name == "undefined") {
        return false;
    }
    if (variable.tainted) {
        return false;
    }
    if (variable.identifiers.length == 0) {
        return false;
    }
    if (!nativeSyntax && variable.defs?.some((def) => def.type == "ClassName")) {
        return false;
    }
    return true;
}

function reserveUnrenamedNames(scopeManager: MangleScopeManager, renamable: Set<ScopeVariable>): Set<string> {
    const reserved = new Set(RESERVED_WORDS);
    scopeManager.scopes.forEach((scope: MangleScope) => {
        scope.variables.forEach((variable: ScopeVariable) => {
            if (!renamable.has(variable)) {
                reserved.add(variable.name);
            }
        });
        scope.through.forEach((reference: ScopeReference) => {
            const name = nodeName(reference.identifier);
            if (!reference.resolved && name) {
                reserved.add(name);
            }
        });
    });
    return reserved;
}

function buildParentMap(ast: AstNode): WeakMap<AstNode, AstNode> {
    const parents = new WeakMap<AstNode, AstNode>();
    traverser.traverse(ast, [], (node: AstNode, stack: AstStackFrame[]) => {
        const parentFrame = stack[1];
        if (parentFrame) {
            parents.set(node, parentFrame.node);
        }
        return node;
    });
    return parents;
}

function renameIdentifier(identifier: AstNode, name: string, parents: WeakMap<AstNode, AstNode>): void {
    const parent = parents.get(identifier);
    const parentFields = parent as { key?: unknown; shorthand?: unknown; value?: unknown } | undefined;
    if (
        parent
        && parent.type == "Property"
        && parentFields?.shorthand === true
        && (parentFields.key === identifier || parentFields.value === identifier)
    ) {
        parentFields.shorthand = false;
        const key: AstNode = {
            type: "Identifier",
            name: nodeName(identifier) || ""
        };
        const value: AstNode = {
            type: "Identifier",
            name
        };
        parentFields.key = key;
        parentFields.value = value;
        parents.set(key, parent);
        parents.set(value, parent);
        return;
    }

    (identifier as { name?: string }).name = name;
}

function modernMangle(ast: AstNode, nativeSyntax: boolean = false): AstNode {
    if (nativeSyntax) {
        /** Generated helpers need consistent ranges for lexical resolution of default parameters. */
        ast = parse(generate(ast as unknown as EstreeProgram), {
            sourceType: "unambiguous", plugins: ["estree"], ranges: true
        }).program as unknown as AstNode;
    }
    const scopeManager = (nativeSyntax ? analyzeNative(ast as unknown as EstreeProgram, {
        ecmaVersion: 2022,
        optimistic: true,
        sourceType: ast.sourceType === "module" ? "module" : "script"
    }) : escope.analyze(ast, {
        ecmaVersion: 6,
        optimistic: true,
        sourceType: "script"
    })) as unknown as MangleScopeManager;

    const unresolvedNames = collectUnresolvedNames(scopeManager);
    const variables: VariableEntry[] = [];
    scopeManager.scopes.forEach((scope: MangleScope) => {
        scope.variables.forEach((variable: ScopeVariable) => {
            if (isRenamableVariable(scope, variable, unresolvedNames, nativeSyntax)) {
                variables.push({ scope, variable });
            }
        });
    });

    variables.sort((left: VariableEntry, right: VariableEntry) => {
        const leftWeight = left.variable.references.length + left.variable.identifiers.length;
        const rightWeight = right.variable.references.length + right.variable.identifiers.length;
        return rightWeight - leftWeight;
    });

    const renamable = new Set(variables.map((entry: VariableEntry) => entry.variable));
    const used = reserveUnrenamedNames(scopeManager, renamable);
    const parents = buildParentMap(ast);
    let next = 0;
    const declarationNames = new WeakMap<AstNode, string>();

    variables.forEach((entry: VariableEntry) => {
        let name: string | undefined = entry.variable.identifiers
            .map((identifier: AstNode): string | undefined => declarationNames.get(identifier))
            .find((candidate: string | undefined): candidate is string => candidate !== undefined);
        if (name === undefined) {
            do {
                name = shortName(next);
                next += 1;
            } while (used.has(name) || RESERVED_WORDS.has(name));
            used.add(name);
        }
        const resolvedName: string = name;
        entry.variable.identifiers.forEach((identifier: AstNode): void => {
            declarationNames.set(identifier, resolvedName);
        });

        entry.variable.identifiers.forEach((identifier: AstNode) => {
            renameIdentifier(identifier, resolvedName, parents);
        });
        entry.variable.references.forEach((reference: ScopeReference) => {
            renameIdentifier(reference.identifier, resolvedName, parents);
        });
    });

    if (nativeSyntax) {
        const privateNames: Map<string, string> = new Map<string, string>();
        traverser.traverse(ast, [], (node: AstNode): AstNode => {
            if (node.type !== "PrivateIdentifier") return node;
            const original: string = nodeName(node) || "";
            let replacement: string | undefined = privateNames.get(original);
            if (replacement === undefined) {
                replacement = shortName(privateNames.size);
                privateNames.set(original, replacement);
            }
            renameIdentifier(node, replacement, parents);
            return node;
        });
    }
    return ast;
}

export default class Uglifier {
    logger: LoggerLike;

    constructor (logger: LoggerLike) {
        this.logger = logger;
    }

    /**
     * Uglifies tree.
     * @param {Node} ast Root node
     * @returns {Node} Root node
     */
    uglify (ast: AstNode, nativeSyntax: boolean = false): AstNode {
        assert.ok(estest.isNode(ast));

        if (nativeSyntax || containsModernBindings(ast)) {
            return modernMangle(ast, nativeSyntax);
        }
        return esshorten.mangle(ast);
    }

};
