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
import * as esprima from "esprima";
import estest from "../estest.js";
import traverser from "../traverser.js";
import utils from "../utils.js";
import type { AstNode, AstStackFrame, LoggerLike, ReferenceLike } from "../types.js";

const ANON_METHOD_ID = "toildefender$anonymousMethodId";

interface MethodReference extends ReferenceLike {
    identifier: AstNode;
}

interface MethodScope {
    references: MethodReference[];
}

interface MethodScopeManager {
    acquire(method: AstNode): MethodScope | null;
}

interface MethodEntryPoint {
    dispatcher?: string;
    entry: number;
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

function nodeFlag(node: AstNode, key: "async" | "expression" | "generator" | "toildefender$numericVmInternal" | "toildefender$rawArguments" | "toildefender$removeFirstArguments"): boolean {
    return (node as Record<string, unknown>)[key] === true;
}

function nodeValue(node: AstNode): unknown {
    return nodeFields(node).value;
}

function setNodeValue(node: AstNode, value: unknown): void {
    nodeFields(node).value = value;
}

function nodeParams(node: AstNode): AstNode[] {
    return astArray(nodeFields(node).params);
}

function setNodeParams(node: AstNode, params: AstNode[]): void {
    nodeFields(node).params = params;
}

function mutableBody(node: AstNode): AstNode[] {
    const body = nodeFields(node).body;
    if (Array.isArray(body)) {
        return body as AstNode[];
    }
    const nextBody: AstNode[] = [];
    nodeFields(node).body = nextBody;
    return nextBody;
}

function functionBody(method: AstNode): AstNode {
    return childNode(method, "body") || { type: "BlockStatement", body: [] };
}

function anonName(node: AstNode): string | null {
    const value = nodeFields(node)[ANON_METHOD_ID];
    return typeof value == "string" ? value : null;
}

function defineAnonName(node: AstNode): string {
    const existing = anonName(node);
    if (existing) {
        return existing;
    }
    const value = `toildefender$anon$${utils.hash(node)}`;
    Object.defineProperty(node, ANON_METHOD_ID, {
        configurable: false,
        enumerable: false,
        value
    });
    return value;
}

/**
 * Wrap function with toildefender$bind.
 * @param {Identifier} Function identifier
 * @returns {Node} Wrapped function
 */
function createMethodStub(id: AstNode): AstNode {
    assert.equal(id.type, "Identifier");
    
    return {
        type: "CallExpression",
        callee: { type: "Identifier", name: "toildefender$bind" },
        arguments: [
            id
        ]
    };
}

function anonymousMethodName(node: AstNode): string {
    assert.equal(node.type, "FunctionExpression");
    return defineAnonName(node);
}

function functionDeclarationName(node: AstNode): string {
    assert.equal(node.type, "FunctionDeclaration");

    let id = childNode(node, "id");
    const name = nodeName(id);
    if (!id || !name) {
        const generated = defineAnonName(node);
        id = { type: "Identifier", name: generated };
        setChildValue(node, "id", id);
        return generated;
    }

    return name;
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
    if ((parent.type == "LabeledStatement" || parent.type == "BreakStatement" || parent.type == "ContinueStatement") && key == "label") {
        return false;
    }

    return true;
}

function renameFunctionExpressionSelfReferences(node: AstNode, name: string): void {
    assert.equal(node.type, "FunctionExpression");

    const id = childNode(node, "id");
    const oldName = nodeName(id);
    if (!oldName || oldName == name) {
        return;
    }

    traverser.traverse(functionBody(node), [], (child: AstNode, stack: AstStackFrame[]) => {
        if (child.type == "Identifier" && nodeName(child) == oldName && isReferenceIdentifier(child, stack)) {
            setNodeName(child, name);
        }
        return child;
    });
}

function isClassMethodFunction(stack: AstStackFrame[]): boolean {
    return stack.some((frame: AstStackFrame) => frame.node.type == "MethodDefinition" || frame.node.type == "ClassBody");
}

function isNumericVmInternalFunction(node: AstNode, stack: AstStackFrame[]): boolean {
    return nodeFlag(node, "toildefender$numericVmInternal")
        || stack.some((frame: AstStackFrame) => nodeFlag(frame.node, "toildefender$numericVmInternal"));
}

/**
 * Get index of argument in function.
 * @param {Function} method Function
 * @param {Identifier} identifier} Argument identifier
 * @returns {number} Index of argument
 */
function getArgumentIndex(method: AstNode, identifier: AstNode): number {
    assert.ok(estest.isFunction(method));
    assert.equal(identifier.type, "Identifier");
    
    const name = nodeName(identifier);
    return nodeParams(method).findIndex((param: AstNode) => nodeName(param) == name);
}

function rawArgumentsIdentifier(): AstNode {
    return {
        type: "Identifier",
        name: "arguments",
        toildefender$rawArguments: true
    };
}

function acquiredReferences(scopeManager: unknown, method: AstNode): MethodReference[] {
    const manager = scopeManager as Partial<MethodScopeManager>;
    if (typeof manager.acquire != "function") {
        return [];
    }
    const scope = manager.acquire(method);
    return scope ? scope.references : [];
}

export default class Methods {
    logger: LoggerLike;

    constructor (logger: LoggerLike) {
        this.logger = logger;
    }
    
    /**
     * Adds helper methods to the beginning of the app.
     * @param {Node} Root node
     */
    addCustomBind (ast: AstNode): void {
        assert.ok(estest.isNode(ast));
        
        const code = esprima.parseScript(METHODS_INJECT) as unknown as AstNode;
        mutableBody(ast).splice(0, 0, ...mutableBody(code));
    }
    
    /**
     * Checks whether a method refers to the "arguments" array.
     * @param {Function} method
     * @param {ScopeManager} scopeManager
     * @returns {boolean}
     */
    methodRefersToArguments (method: AstNode, scopeManager: unknown): boolean {
        assert.ok(estest.isFunction(method));
        assert.ok(scopeManager);
        
        return acquiredReferences(scopeManager, method)
        .some((reference: MethodReference) => !utils.isResolvedReference(reference) && nodeName(reference.identifier) == "arguments");
    }
    
    /**
     * Inserts code to copy/slice arguments from the arguments array like
     * function () { ... }
     * to
     * function () { var toildefender$arguments = toildefender$sliceArguments(arguments, 1); ... }
     * @param {Function} method
     * @param {number} num Number of arguments to be sliced off. 0 if none.
     */
    removeFirstArguments (method: AstNode, num: number): void {
        assert.ok(estest.isFunction(method));
        assert.equal(typeof num, "number");
        
        mutableBody(functionBody(method)).splice(0, 0, {
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
    listMethods (ast: AstNode): string[] {
        assert.ok(estest.isNode(ast));
        
        const methods: string[] = [];
        
        traverser.traverse(ast, [], (node: AstNode, stack: AstStackFrame[]) => {
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
    extractMethods (ast: AstNode): AstNode[] {
        assert.ok(estest.isNode(ast));
        
        const methods: AstNode[] = [];
        
        traverser.traverse(ast, [], (node: AstNode, stack: AstStackFrame[]) => {
            if (isNumericVmInternalFunction(node, stack)) {
                return node;
            }
            if (node.type == "FunctionDeclaration") { // Statement
                functionDeclarationName(node);
                methods.push(node);
                return { type: "ExpressionStatement", expression: createMethodStub(childNode(node, "id") || { type: "Identifier", name: functionDeclarationName(node) }) }; // This is not ideal
            } else if (node.type == "FunctionExpression" && !isClassMethodFunction(stack)) { // Expression
                const id = anonymousMethodName(node);
                renameFunctionExpressionSelfReferences(node, id);
                // Merge into old object instead of creating a new one to preserve object references
                Object.assign(node, {
                    type: "FunctionDeclaration",
                    id: { type: "Identifier", name: id }
                });
                methods.push(node);
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
    replaceArgumentReferences (method: AstNode, useReassignedVariable: boolean): AstNode {
        assert.ok(estest.isFunction(method));
        
        traverser.traverse(functionBody(method), [], (node: AstNode, stack: AstStackFrame[]) => {
            if (node.type == "Identifier") {
                const nestedFunction = stack.some((frame: AstStackFrame) => estest.isFunction(frame.node));
                if (useReassignedVariable && nodeName(node) == "arguments" && !nodeFlag(node, "toildefender$rawArguments") && !nestedFunction) {
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
        
        setNodeParams(method, []);
        
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
    replaceFunctionCalls (ast: AstNode, methodEntryExitPoints: Record<string, MethodEntryPoint>): void {
        assert.ok(estest.isNode(ast));
        assert.equal(typeof methodEntryExitPoints, "object");
        
        traverser.traverse(ast, [], (node: AstNode, stack: AstStackFrame[]) => {
            if (isNumericVmInternalFunction(node, stack)) {
                return node;
            }
            const name = nodeName(node);
            const entryPoint = name ? methodEntryExitPoints[name] : undefined;
            if (node.type == "Identifier" && entryPoint?.entry) {
                const dispatcher = entryPoint.dispatcher || "main";
                return {
                    type: "CallExpression",
                    callee: { type: "Identifier", name: "toildefender$bind" },
                    arguments: [
                        { type: "Identifier", name: dispatcher },
                        { type: "Identifier", name: entryPoint.entry }
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
    bumpArgumentsIndices (method: AstNode, inc: number): void {
        assert.ok(estest.isFunction(method));
        assert.equal(typeof inc, "number");
        
        traverser.traverse(functionBody(method), [], (node: AstNode) => {
            const object = childNode(node, "object");
            if (node.type == "MemberExpression" && object?.type == "Identifier" && nodeName(object) == "toildefender$arguments") {
                const property = childNode(node, "property");
                const value = property ? nodeValue(property) : null;
                if (typeof value == "number" && property) {
                    setNodeValue(property, value + inc);
                }
            }
            if (nodeFlag(node, "toildefender$removeFirstArguments")) {
                const value = nodeValue(node);
                if (typeof value == "number") {
                    setNodeValue(node, value + inc);
                }
            }
            return node;
        });
    }
    
};
