import assert from "assert";
import esshorten from "esshorten";
import escope from "escope";
import estest from "../estest.js";
import traverser from "../traverser.js";

var RESERVED_WORDS = new Set([
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

var FIRST_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
var REST_CHARS = FIRST_CHARS + "0123456789";

function containsModernBindings(ast) {
    var found = false;
    traverser.traverseEx(ast, [], function (node) {
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

function shortName(index) {
    var name = FIRST_CHARS[index % FIRST_CHARS.length];
    index = Math.floor(index / FIRST_CHARS.length);
    while (index > 0) {
        index -= 1;
        name += REST_CHARS[index % REST_CHARS.length];
        index = Math.floor(index / REST_CHARS.length);
    }
    return name;
}

function collectUnresolvedNames(scopeManager) {
    var names = new Set();
    scopeManager.scopes.forEach(scope => {
        scope.through.forEach(reference => {
            if (!reference.resolved) {
                names.add(reference.identifier.name);
            }
        });
    });
    return names;
}

function isRenamableVariable(scope, variable, unresolvedNames) {
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
    if (variable.defs && variable.defs.some(def => def.type == "ClassName")) {
        return false;
    }
    return true;
}

function reserveUnrenamedNames(scopeManager, renamable) {
    var reserved = new Set(RESERVED_WORDS);
    scopeManager.scopes.forEach(scope => {
        scope.variables.forEach(variable => {
            if (!renamable.has(variable)) {
                reserved.add(variable.name);
            }
        });
        scope.through.forEach(reference => {
            if (!reference.resolved) {
                reserved.add(reference.identifier.name);
            }
        });
    });
    return reserved;
}

function buildParentMap(ast) {
    var parents = new WeakMap();
    traverser.traverse(ast, [], function (node, stack) {
        var parentFrame = stack[1];
        if (parentFrame) {
            parents.set(node, parentFrame.node);
        }
        return node;
    });
    return parents;
}

function renameIdentifier(identifier, name, parents) {
    var parent = parents.get(identifier);
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

function modernMangle(ast) {
    var scopeManager = escope.analyze(ast, {
        ecmaVersion: 6,
        optimistic: true,
        sourceType: "script"
    });

    var unresolvedNames = collectUnresolvedNames(scopeManager);
    var variables = [];
    scopeManager.scopes.forEach(scope => {
        scope.variables.forEach(variable => {
            if (isRenamableVariable(scope, variable, unresolvedNames)) {
                variables.push({ scope: scope, variable: variable });
            }
        });
    });

    variables.sort((left, right) => {
        var leftWeight = left.variable.references.length + left.variable.identifiers.length;
        var rightWeight = right.variable.references.length + right.variable.identifiers.length;
        return rightWeight - leftWeight;
    });

    var renamable = new Set(variables.map(entry => entry.variable));
    var used = reserveUnrenamedNames(scopeManager, renamable);
    var parents = buildParentMap(ast);
    var next = 0;

    variables.forEach(entry => {
        var name;
        do {
            name = shortName(next);
            next += 1;
        } while (used.has(name) || RESERVED_WORDS.has(name));
        used.add(name);

        entry.variable.identifiers.forEach(identifier => {
            renameIdentifier(identifier, name, parents);
        });
        entry.variable.references.forEach(reference => {
            renameIdentifier(reference.identifier, name, parents);
        });
    });

    return ast;
}

export default class Uglifier {

    constructor (logger) {
        this.logger = logger;
    }

    /**
     * Uglifies tree.
     * @param {Node} ast Root node
     * @returns {Node} Root node
     */
    uglify (ast) {
        assert.ok(estest.isNode(ast));

        if (containsModernBindings(ast)) {
            return modernMangle(ast);
        }
        return esshorten.mangle(ast);
    }

};
