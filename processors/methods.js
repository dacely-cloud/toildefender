"use strict";

const METHODS_INJECT = `
function veilmark$mergeArguments(a, b) {
    return Array.prototype.slice.call(a).concat(Array.prototype.slice.call(b));
}

function veilmark$bind() {
    var fn = arguments[0], prepend = Array.prototype.slice.call(arguments, 1);
    var wrapper = function() {
        return fn.apply(this, prepend.concat(Array.prototype.slice.call(arguments)));
    };
    wrapper.prototype = fn.prototype;
    return wrapper;
}

function veilmark$sliceArguments(args, num) {
    return Array.prototype.slice.call(args, num);
}

var veilmark$objectKeys = {};

function veilmark$toObject(cacheKey, schema, values) {
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
    var decoded = cacheKey ? veilmark$objectKeys[cacheKey] : null;
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
        veilmark$objectKeys[cacheKey] = keys;
    }
    return obj;
}

function veilmark$objectWithoutKeys(source, excluded) {
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

function veilmark$decodeString(arr) {
    return arr.map(function(x) { return String.fromCharCode(x & ~0 >>> 16) + String.fromCharCode(x >> 16); }).join("");
}

function veilmark$fromCharCodes() {
    return String.fromCharCode.apply(null, arguments);
}

`;

var assert = require("assert");
var fs = require("fs");

var _ = require("lodash");
var escope = require("escope");
var esprima = require("esprima");

var estest = require("../estest");
var traverser = require("../traverser");
var utils = require("../utils");

const ANON_METHOD_ID = "veilmark$anonymousMethodId";

/**
 * Wrap function with veilmark$bind.
 * @param {Identifier} Function identifier
 * @returns {Node} Wrapped function
 */
function createMethodStub(id) {
    assert.equal(id.type, "Identifier");
    
    return {
        type: "CallExpression",
        callee: { type: "Identifier", name: "veilmark$bind" },
        arguments: [
            id
        ]
    };
}

function anonymousMethodName(node) {
    assert.equal(node.type, "FunctionExpression");

    if (!node[ANON_METHOD_ID]) {
        Object.defineProperty(node, ANON_METHOD_ID, {
            configurable: false,
            enumerable: false,
            value: `veilmark$anon$${utils.hash(node)}`
        });
    }

    return node[ANON_METHOD_ID];
}

function functionDeclarationName(node) {
    assert.equal(node.type, "FunctionDeclaration");

    if (!node.id || !node.id.name) {
        if (!node[ANON_METHOD_ID]) {
            Object.defineProperty(node, ANON_METHOD_ID, {
                configurable: false,
                enumerable: false,
                value: `veilmark$anon$${utils.hash(node)}`
            });
        }
        node.id = { type: "Identifier", name: node[ANON_METHOD_ID] };
    }

    return node.id.name;
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

function renameFunctionExpressionSelfReferences(node, name) {
    assert.equal(node.type, "FunctionExpression");

    if (!node.id || !node.id.name || node.id.name == name) {
        return;
    }

    var oldName = node.id.name;
    traverser.traverse(node.body, [], (child, stack) => {
        if (child.type == "Identifier" && child.name == oldName && isReferenceIdentifier(child, stack)) {
            child.name = name;
        }
        return child;
    });
}

function isClassMethodFunction(stack) {
    return stack.some(frame => frame.node.type == "MethodDefinition" || frame.node.type == "ClassBody");
}

function isNumericVmInternalFunction(node, stack) {
    return node.veilmark$numericVmInternal === true || stack.some(frame => frame.node && frame.node.veilmark$numericVmInternal === true);
}

/**
 * Get index of argument in function.
 * @param {Function} method Function
 * @param {Identifier} identifier} Argument identifier
 * @returns {number} Index of argument
 */
function getArgumentIndex(method, identifier) {
    assert.ok(estest.isFunction(method));
    assert.equal(identifier.type, "Identifier");
    
    return _.findIndex(method.params, x => x.name == identifier.name);
}

function rawArgumentsIdentifier() {
    return {
        type: "Identifier",
        name: "arguments",
        veilmark$rawArguments: true
    };
}

module.exports = class Methods {

    constructor (logger) {
        this.logger = logger;
    }
    
    /**
     * Adds helper methods to the beginning of the app.
     * @param {Node} Root node
     */
    addCustomBind (ast) {
        assert.ok(estest.isNode(ast));
        
        var code = esprima.parse(METHODS_INJECT);
        ast.body.splice.apply(ast.body, [0, 0].concat(code.body));
    }
    
    /**
     * Checks whether a method refers to the "arguments" array.
     * @param {Function} method
     * @param {ScopeManager} scopeManager
     * @returns {boolean}
     */
    methodRefersToArguments (method, scopeManager) {
        assert.ok(estest.isFunction(method));
        assert.ok(scopeManager);
        
        return scopeManager
        .acquire(method)
        .references
        .some(reference => !utils.isResolvedReference(reference) && reference.identifier.name == "arguments");
    }
    
    /**
     * Inserts code to copy/slice arguments from the arguments array like
     * function () { ... }
     * to
     * function () { var veilmark$arguments = veilmark$sliceArguments(arguments, 1); ... }
     * @param {Function} method
     * @param {number} num Number of arguments to be sliced off. 0 if none.
     */
    removeFirstArguments (method, num) {
        assert.ok(estest.isFunction(method));
        assert.equal(typeof num, "number");
        
        method.body.body.splice(0, 0, {
            type: "VariableDeclaration",
            kind: "var",
            declarations: [
                {
                    type: "VariableDeclarator",
                    id: { type: "Identifier", name: "veilmark$arguments" },
                    init: rawArgumentsIdentifier()
                },
                {
                    type: "VariableDeclarator",
                    id: { type: "Identifier", name: "veilmark$bareArguments" },
                    init: num > 0 ? {
                        type: "CallExpression",
                        callee: { type: "Identifier", name: "veilmark$sliceArguments" },
                        arguments: [
                            rawArgumentsIdentifier(),
                            { type: "Literal", value: num, veilmark$removeFirstArguments: true }
                        ]
                    } : rawArgumentsIdentifier()
                }
            ],
            veilmark$reassigningArguments: true,
            veilmark$followsSlicingArguments: num > 0
        });
    }

    /**
     * Lists all methods.
     * @param {Node} ast Root node
     * @returns {string[]} Method names
     */
    listMethods (ast) {
        assert.ok(estest.isNode(ast));
        
        var methods = [];
        
        traverser.traverse(ast, [], (node, stack) => {
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
    extractMethods (ast) {
        assert.ok(estest.isNode(ast));
        
        var methods = [];
        
        traverser.traverse(ast, [], (node, stack) => {
            if (isNumericVmInternalFunction(node, stack)) {
                return node;
            }
            if (node.type == "FunctionDeclaration") { // Statement
                functionDeclarationName(node);
                methods.push(node);
                return { type: "ExpressionStatement", expression: createMethodStub(node.id) }; // This is not ideal
            } else if (node.type == "FunctionExpression" && !isClassMethodFunction(stack)) { // Expression
                var id = anonymousMethodName(node);
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
     * function (a) { return veilmark$arguments[0]; }
     * @param {Function} method Function whose body will be transformed
     * @param {boolean} useReassignedVariable Use veilmark$arguments instead of arguments
     * @returns {Function} Function from method parameter
     */
    replaceArgumentReferences (method, useReassignedVariable) {
        assert.ok(estest.isFunction(method));
        
        traverser.traverse(method.body, [], (node, stack) => {
            if (node.type == "Identifier") {
                var nestedFunction = stack.some(frame => estest.isFunction(frame.node));
                if (useReassignedVariable && node.name == "arguments" && !node.veilmark$rawArguments && !nestedFunction) {
                    return { type: "Identifier", name: "veilmark$bareArguments" };
                }
                var index = getArgumentIndex(method, node);
                if (index != -1) {
                    return {
                        type: "MemberExpression",
                        object: { type: "Identifier", name: useReassignedVariable ? "veilmark$arguments" : "arguments" },
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
     * veilmark$bind(main, 1234)()
     * @param {Node} ast Root node
     * @param {Object[]} methodEntryExitPoints Method entry point table
     * @param {number} methodEntryExitPoints[].entry Entry point
     */
    replaceFunctionCalls (ast, methodEntryExitPoints) {
        assert.ok(estest.isNode(ast));
        assert.equal(typeof methodEntryExitPoints, "object");
        
        traverser.traverse(ast, [], (node, stack) => {
            if (isNumericVmInternalFunction(node, stack)) {
                return node;
            }
            if (node.type == "Identifier" && methodEntryExitPoints[node.name] && methodEntryExitPoints[node.name].entry) {
                var dispatcher = methodEntryExitPoints[node.name].dispatcher || "main";
                return {
                    type: "CallExpression",
                    callee: { type: "Identifier", name: "veilmark$bind" },
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
     * veilmark$arguments[0]
     * to
     * veilmark$arguments[1]
     * @param {Function} method Function whose body will be transformed
     * @param {number} inc Number to be added to all argument indices
     */
    bumpArgumentsIndices (method, inc) {
        assert.ok(estest.isFunction(method));
        assert.equal(typeof inc, "number");
        
        traverser.traverse(method.body, [], (node, stack) => {
            if (node.type == "MemberExpression" && node.object.type == "Identifier" && node.object.name == "veilmark$arguments") {
                node.property.value += inc;
            }
            if (node.veilmark$removeFirstArguments) {
                node.value += inc;
            }
            return node;
        });
    }
    
};
