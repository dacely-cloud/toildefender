import assert from "assert";
import esshorten from "esshorten";
import escope from "escope";
import estest from "../estest.js";
import traverser from "../traverser.js";
import type { Loose } from "../types.js";

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

function containsModernBindings(ast: Loose) {
    let found = false;
    traverser.traverseEx(ast, [], function (this: { abort(): void }, node: Loose) {
        if (
            (node.type == "VariableDeclaration" && node.kind != "var")
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

function shortName(index: Loose) {
    let name = FIRST_CHARS[index % FIRST_CHARS.length];
    index = Math.floor(index / FIRST_CHARS.length);
    while (index > 0) {
        index -= 1;
        name += REST_CHARS[index % REST_CHARS.length];
        index = Math.floor(index / REST_CHARS.length);
    }
    return name;
}

function collectUnresolvedNames(scopeManager: Loose) {
    const names = new Set();
    scopeManager.scopes.forEach((scope: Loose) => {
        scope.through.forEach((reference: Loose) => {
            if (!reference.resolved) {
                names.add(reference.identifier.name);
            }
        });
    });
    return names;
}

function isRenamableVariable(scope: Loose, variable: Loose, unresolvedNames: Loose) {
    if (scope.type == "global") {
        return false;
    }
    if (
        typeof variable.name == "string"
        && variable.name.indexOf("toildefender$anon$") === 0
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
    if (!variable.identifiers || variable.identifiers.length == 0) {
        return false;
    }
    if (variable.defs && variable.defs.some((def: Loose) => def.type == "ClassName")) {
        return false;
    }
    return true;
}

function reserveUnrenamedNames(scopeManager: Loose, renamable: Loose) {
    const reserved = new Set(RESERVED_WORDS);
    scopeManager.scopes.forEach((scope: Loose) => {
        scope.variables.forEach((variable: Loose) => {
            if (!renamable.has(variable)) {
                reserved.add(variable.name);
            }
        });
        scope.through.forEach((reference: Loose) => {
            if (!reference.resolved) {
                reserved.add(reference.identifier.name);
            }
        });
    });
    return reserved;
}

function buildParentMap(ast: Loose) {
    const parents = new WeakMap();
    traverser.traverse(ast, [], function (node: Loose, stack: Loose) {
        const parentFrame = stack[1];
        if (parentFrame) {
            parents.set(node, parentFrame.node);
        }
        return node;
    });
    return parents;
}

function renameIdentifier(identifier: Loose, name: Loose, parents: Loose) {
    const parent = parents.get(identifier);
    if (
        parent
        && parent.type == "Property"
        && parent.shorthand === true
        && (parent.key === identifier || parent.value === identifier)
    ) {
        parent.shorthand = false;
        parent.key = {
            type: "Identifier",
            name: identifier.name
        };
        parent.value = {
            type: "Identifier",
            name: name
        };
        parents.set(parent.key, parent);
        parents.set(parent.value, parent);
        return;
    }

    identifier.name = name;
}

function modernMangle(ast: Loose) {
    const scopeManager = escope.analyze(ast, {
        ecmaVersion: 6,
        optimistic: true,
        sourceType: "script"
    });

    const unresolvedNames = collectUnresolvedNames(scopeManager);
    const variables: Loose[] = [];
    scopeManager.scopes.forEach((scope: Loose) => {
        scope.variables.forEach((variable: Loose) => {
            if (isRenamableVariable(scope, variable, unresolvedNames)) {
                variables.push({ scope: scope, variable: variable });
            }
        });
    });

    variables.sort((left: Loose, right: Loose) => {
        const leftWeight = left.variable.references.length + left.variable.identifiers.length;
        const rightWeight = right.variable.references.length + right.variable.identifiers.length;
        return rightWeight - leftWeight;
    });

    const renamable = new Set(variables.map((entry: Loose) => entry.variable));
    const used = reserveUnrenamedNames(scopeManager, renamable);
    const parents = buildParentMap(ast);
    let next = 0;

    variables.forEach((entry: Loose) => {
        let name: string;
        do {
            name = shortName(next);
            next += 1;
        } while (used.has(name) || RESERVED_WORDS.has(name));
        used.add(name);

        entry.variable.identifiers.forEach((identifier: Loose) => {
            renameIdentifier(identifier, name, parents);
        });
        entry.variable.references.forEach((reference: Loose) => {
            renameIdentifier(reference.identifier, name, parents);
        });
    });

    return ast;
}

export default class Uglifier {
    logger: Loose;

    constructor (logger: Loose) {
        this.logger = logger;
    }

    /**
     * Uglifies tree.
     * @param {Node} ast Root node
     * @returns {Node} Root node
     */
    uglify (ast: Loose) {
        assert.ok(estest.isNode(ast));

        if (containsModernBindings(ast)) {
            return modernMangle(ast);
        }
        return esshorten.mangle(ast);
    }

};
