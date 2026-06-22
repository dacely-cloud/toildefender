const METHODS_INJECT = `
function toildefender$mergeArguments(a, b) {
    return Array.prototype.slice.call(a).concat(Array.prototype.slice.call(b));
}

function toildefender$bind() {
    var fn = arguments[0], prepend = Array.prototype.slice.call(arguments, 1);
    var wrapper = function() {
        return fn.apply(this, prepend.concat(Array.prototype.slice.call(arguments)));
    };
    wrapper.prototype = fn.prototype;
    return wrapper;
}

function toildefender$sliceArguments(args, num) {
    return Array.prototype.slice.call(args, num);
}

var toildefender$objectKeys = {};

function toildefender$toObject(cacheKey, schema, values) {
    if (values === undefined && Array.isArray(cacheKey)) {
        values = schema;
        schema = cacheKey;
        cacheKey = "";
    }
    var obj = {};
    if (values === undefined) {
        for (var legacy = 0; legacy < schema.length; legacy += 2) {
            obj[schema[legacy]] = schema[legacy + 1];
        }
        return obj;
    }
    var decoded = cacheKey ? toildefender$objectKeys[cacheKey] : null;
    if (decoded) {
        for (var cached = 0; cached < decoded.length; cached += 1) {
            obj[decoded[cached]] = values[cached];
        }
        return obj;
    }
    var cursor = 2;
    var salt = schema[0];
    var count = schema[1];
    var keys = new Array(count);
    for (var i = 0; i < count; i += 1) {
        var len = schema[cursor++] ^ ((salt + i * 131) & 65535);
        var key = "";
        for (var j = 0; j < len; j += 1) {
            key += String.fromCharCode(schema[cursor++] ^ ((salt + i * 257 + j * 17) & 65535));
        }
        keys[i] = key;
        obj[key] = values[i];
    }
    if (cacheKey) {
        toildefender$objectKeys[cacheKey] = keys;
    }
    return obj;
}

function toildefender$objectWithoutKeys(source, excluded) {
    var target = {};
    if (source == null) {
        return target;
    }
    for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key) && excluded.indexOf(key) < 0) {
            target[key] = source[key];
        }
    }
    return target;
}

function toildefender$decodeString(arr) {
    return arr.map(function(x) { return String.fromCharCode(x & ~0 >>> 16) + String.fromCharCode(x >> 16); }).join("");
}

function toildefender$fromCharCodes() {
    return String.fromCharCode.apply(null, arguments);
}

`;

import assert from "assert";
import fs from "fs";
import _ from "lodash";
import escope from "escope";
import * as esprima from "esprima";
import estest from "../estest.js";
import traverser from "../traverser.js";
import utils from "../utils.js";
import type { Loose } from "../types.js";

const ANON_METHOD_ID = "toildefender$anonymousMethodId";

/**
 * Wrap function with toildefender$bind.
 * @param {Identifier} Function identifier
 * @returns {Node} Wrapped function
 */
function createMethodStub(id: Loose) {
    assert.equal(id.type, "Identifier");
    
    return {
        type: "CallExpression",
        callee: { type: "Identifier", name: "toildefender$bind" },
        arguments: [
            id
        ]
    };
}

function anonymousMethodName(node: Loose) {
    assert.equal(node.type, "FunctionExpression");

    if (!node[ANON_METHOD_ID]) {
        Object.defineProperty(node, ANON_METHOD_ID, {
            configurable: false,
            enumerable: false,
            value: `toildefender$anon$${utils.hash(node)}`
        });
    }

    return node[ANON_METHOD_ID];
}

function functionDeclarationName(node: Loose) {
    assert.equal(node.type, "FunctionDeclaration");

    if (!node.id || !node.id.name) {
        if (!node[ANON_METHOD_ID]) {
            Object.defineProperty(node, ANON_METHOD_ID, {
                configurable: false,
                enumerable: false,
                value: `toildefender$anon$${utils.hash(node)}`
            });
        }
        node.id = { type: "Identifier", name: node[ANON_METHOD_ID] };
    }

    return node.id.name;
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
    if ((parent.type == "LabeledStatement" || parent.type == "BreakStatement" || parent.type == "ContinueStatement") && key == "label") {
        return false;
    }

    return true;
}

function renameFunctionExpressionSelfReferences(node: Loose, name: Loose) {
    assert.equal(node.type, "FunctionExpression");

    if (!node.id || !node.id.name || node.id.name == name) {
        return;
    }

    const oldName = node.id.name;
    traverser.traverse(node.body, [], (child: Loose, stack: Loose) => {
        if (child.type == "Identifier" && child.name == oldName && isReferenceIdentifier(child, stack)) {
            child.name = name;
        }
        return child;
    });
}

function isClassMethodFunction(stack: Loose) {
    return stack.some((frame: Loose) => frame.node.type == "MethodDefinition" || frame.node.type == "ClassBody");
}

function isNumericVmInternalFunction(node: Loose, stack: Loose) {
    return node.toildefender$numericVmInternal === true || stack.some((frame: Loose) => frame.node && frame.node.toildefender$numericVmInternal === true);
}

/**
 * Get index of argument in function.
 * @param {Function} method Function
 * @param {Identifier} identifier} Argument identifier
 * @returns {number} Index of argument
 */
function getArgumentIndex(method: Loose, identifier: Loose) {
    assert.ok(estest.isFunction(method));
    assert.equal(identifier.type, "Identifier");
    
    return _.findIndex(method.params, (x: Loose) => x.name == identifier.name);
}

function rawArgumentsIdentifier() {
    return {
        type: "Identifier",
        name: "arguments",
        toildefender$rawArguments: true
    };
}

export default class Methods {
    logger: Loose;

    constructor (logger: Loose) {
        this.logger = logger;
    }
    
    /**
     * Adds helper methods to the beginning of the app.
     * @param {Node} Root node
     */
    addCustomBind (ast: Loose) {
        assert.ok(estest.isNode(ast));
        
        const code = esprima.parseScript(METHODS_INJECT) as Loose;
        ast.body.splice.apply(ast.body, [0, 0].concat(code.body));
    }
    
    /**
     * Checks whether a method refers to the "arguments" array.
     * @param {Function} method
     * @param {ScopeManager} scopeManager
     * @returns {boolean}
     */
    methodRefersToArguments (method: Loose, scopeManager: Loose) {
        assert.ok(estest.isFunction(method));
        assert.ok(scopeManager);
        
        return scopeManager
        .acquire(method)
        .references
        .some((reference: Loose) => !utils.isResolvedReference(reference) && reference.identifier.name == "arguments");
    }
    
    /**
     * Inserts code to copy/slice arguments from the arguments array like
     * function () { ... }
     * to
     * function () { var toildefender$arguments = toildefender$sliceArguments(arguments, 1); ... }
     * @param {Function} method
     * @param {number} num Number of arguments to be sliced off. 0 if none.
     */
    removeFirstArguments (method: Loose, num: Loose) {
        assert.ok(estest.isFunction(method));
        assert.equal(typeof num, "number");
        
        method.body.body.splice(0, 0, {
            type: "VariableDeclaration",
            kind: "var",
            declarations: [
                {
                    type: "VariableDeclarator",
                    id: { type: "Identifier", name: "toildefender$arguments" },
                    init: rawArgumentsIdentifier()
                },
                {
                    type: "VariableDeclarator",
                    id: { type: "Identifier", name: "toildefender$bareArguments" },
                    init: num > 0 ? {
                        type: "CallExpression",
                        callee: { type: "Identifier", name: "toildefender$sliceArguments" },
                        arguments: [
                            rawArgumentsIdentifier(),
                            { type: "Literal", value: num, toildefender$removeFirstArguments: true }
                        ]
                    } : rawArgumentsIdentifier()
                }
            ],
            toildefender$reassigningArguments: true,
            toildefender$followsSlicingArguments: num > 0
        });
    }

    /**
     * Lists all methods.
     * @param {Node} ast Root node
     * @returns {string[]} Method names
     */
    listMethods (ast: Loose) {
        assert.ok(estest.isNode(ast));
        
        const methods: Loose[] = [];
        
        traverser.traverse(ast, [], (node: Loose, stack: Loose) => {
            if (isNumericVmInternalFunction(node, stack)) {
                return node;
            }
            if (node.type == "FunctionDeclaration") { // Statement
                methods.push(functionDeclarationName(node));
            } else if (node.type == "FunctionExpression" && !isClassMethodFunction(stack)) { // Expression
                methods.push(anonymousMethodName(node));
            }
            
            return node;
        });
        
        return methods;
    }

    /**
     * Extracts all methods from the AST.
     * @param {Node} ast Root node
     * @returns {Function[]}
     */
    extractMethods (ast: Loose) {
        assert.ok(estest.isNode(ast));
        
        const methods: Loose[] = [];
        
        traverser.traverse(ast, [], (node: Loose, stack: Loose) => {
            if (isNumericVmInternalFunction(node, stack)) {
                return node;
            }
            if (node.type == "FunctionDeclaration") { // Statement
                functionDeclarationName(node);
                methods.push(node);
                return { type: "ExpressionStatement", expression: createMethodStub(node.id) }; // This is not ideal
            } else if (node.type == "FunctionExpression" && !isClassMethodFunction(stack)) { // Expression
                const id = anonymousMethodName(node);
                renameFunctionExpressionSelfReferences(node, id);
                // Merge into old object instead of creating a new one to preserve object references
                methods.push(_.assign(node, {
                    type: "FunctionDeclaration",
                    id: { type: "Identifier", name: id }
                }));
                return createMethodStub({ type: "Identifier", name: id });
            }
            
            return node;
        });
        
        return methods;
    }

    /**
     * Replaces direct argument references with arguments references like
     * function (a) { return a; }
     * to
     * function (a) { return toildefender$arguments[0]; }
     * @param {Function} method Function whose body will be transformed
     * @param {boolean} useReassignedVariable Use toildefender$arguments instead of arguments
     * @returns {Function} Function from method parameter
     */
    replaceArgumentReferences (method: Loose, useReassignedVariable: Loose) {
        assert.ok(estest.isFunction(method));
        
        traverser.traverse(method.body, [], (node: Loose, stack: Loose) => {
            if (node.type == "Identifier") {
                const nestedFunction = stack.some((frame: Loose) => estest.isFunction(frame.node));
                if (useReassignedVariable && node.name == "arguments" && !node.toildefender$rawArguments && !nestedFunction) {
                    return { type: "Identifier", name: "toildefender$bareArguments" };
                }
                const index = getArgumentIndex(method, node);
                if (index != -1) {
                    return {
                        type: "MemberExpression",
                        object: { type: "Identifier", name: useReassignedVariable ? "toildefender$arguments" : "arguments" },
                        property: { type: "Literal", value: index },
                        computed: true
                    };
                }
            }
            
            return node;
        });
        
        method.params = [];
        
        return method;
    }

    /**
     * Replaces function calls with main calls like
     * test()
     * to
     * toildefender$bind(main, 1234)()
     * @param {Node} ast Root node
     * @param {Object[]} methodEntryExitPoints Method entry point table
     * @param {number} methodEntryExitPoints[].entry Entry point
     */
    replaceFunctionCalls (ast: Loose, methodEntryExitPoints: Loose) {
        assert.ok(estest.isNode(ast));
        assert.equal(typeof methodEntryExitPoints, "object");
        
        traverser.traverse(ast, [], (node: Loose, stack: Loose) => {
            if (isNumericVmInternalFunction(node, stack)) {
                return node;
            }
            if (node.type == "Identifier" && methodEntryExitPoints[node.name] && methodEntryExitPoints[node.name].entry) {
                const dispatcher = methodEntryExitPoints[node.name].dispatcher || "main";
                return {
                    type: "CallExpression",
                    callee: { type: "Identifier", name: "toildefender$bind" },
                    arguments: [
                        { type: "Identifier", name: dispatcher },
                        { type: "Identifier", name: methodEntryExitPoints[node.name].entry }
                    ]
                };
            }
            return node;
        });
    }

    /**
     * Bumps all arguments indices like
     * toildefender$arguments[0]
     * to
     * toildefender$arguments[1]
     * @param {Function} method Function whose body will be transformed
     * @param {number} inc Number to be added to all argument indices
     */
    bumpArgumentsIndices (method: Loose, inc: Loose) {
        assert.ok(estest.isFunction(method));
        assert.equal(typeof inc, "number");
        
        traverser.traverse(method.body, [], (node: Loose, stack: Loose) => {
            if (node.type == "MemberExpression" && node.object.type == "Identifier" && node.object.name == "toildefender$arguments") {
                node.property.value += inc;
            }
            if (node.toildefender$removeFirstArguments) {
                node.value += inc;
            }
            return node;
        });
    }
    
};
