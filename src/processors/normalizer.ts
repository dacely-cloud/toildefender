import assert from "assert";
import utils from "../utils.js";
import traverser from "../traverser.js";
import estest from "../estest.js";
import type { AstNode, AstStackFrame, LoggerLike } from "../types.js";

interface RandomAlphaLike {
    get(): string;
}

interface SwitchCaseDetails {
    breaks: boolean;
    statements: AstNode[];
    test: AstNode | null;
}

type PrivateStores = Record<string, string>;

function nodeFields(node: AstNode): Record<string, unknown> {
    return node as unknown as Record<string, unknown>;
}

function nodeArray(value: unknown): AstNode[] {
    return Array.isArray(value) ? (value as AstNode[]) : [];
}

function rawArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function childNode(node: AstNode, key: string): AstNode | null {
    const value = nodeFields(node)[key];
    return estest.isNode(value) ? value : null;
}

function requiredChild(node: AstNode, key: string): AstNode {
    const child = childNode(node, key);
    assert.ok(child, `Missing ${node.type}.${key}`);
    return child;
}

function setNodeField(node: AstNode, key: string, value: unknown): void {
    nodeFields(node)[key] = value;
}

function nodeName(node: AstNode | null): string | null {
    const name = (node as { name?: unknown } | null)?.name;
    return typeof name == "string" ? name : null;
}

function nodeValue(node: AstNode | null): unknown {
    return (node as { value?: unknown } | null)?.value;
}

function nodeKind(node: AstNode): string {
    const kind = (node as { kind?: unknown }).kind;
    return typeof kind == "string" ? kind : "var";
}

function nodeOperator(node: AstNode): string | null {
    const operator = (node as { operator?: unknown }).operator;
    return typeof operator == "string" ? operator : null;
}

function nodeComputed(node: AstNode): boolean {
    return (node as { computed?: unknown }).computed === true;
}

function nodeFlag(node: AstNode, key: "async" | "optional" | "static" | "toildefender$noNumericVm"): boolean {
    return (node as Record<string, unknown>)[key] === true;
}

function bodyArray(node: AstNode): AstNode[] {
    return nodeArray(nodeFields(node).body);
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

function nodeArguments(node: AstNode): AstNode[] {
    return nodeArray(nodeFields(node).arguments);
}

function nodeParams(node: AstNode): AstNode[] {
    return nodeArray(nodeFields(node).params);
}

function nodeDeclarations(node: AstNode): AstNode[] {
    return nodeArray(nodeFields(node).declarations);
}

function nodeProperties(node: AstNode): AstNode[] {
    return nodeArray(nodeFields(node).properties);
}

function nodeElements(node: AstNode): Array<AstNode | null> {
    return rawArray(nodeFields(node).elements).map((element: unknown) => estest.isNode(element) ? element : null);
}

function undefinedExpression(): AstNode {
    return { type: "Identifier", name: "undefined" };
}

function fallbackExpression(node: AstNode | null, fallback: AstNode): AstNode {
    return node || fallback;
}

/**
 * Chain an array of expressions with an operator.
 * @param {Expression[]} expressions
 * @param {BinaryOperator} operator
 * @returns {Expression}
 */
function chain (expressions: AstNode[], operator: string): AstNode {
    assert.ok(Array.isArray(expressions));
    assert.equal(typeof operator, "string");
    
    if (expressions.length == 0) {
        return { type: "Literal", value: true };
    } else if (expressions.length == 1) {
        return expressions[0];
    } else {
        let result = expressions[0];
        for (let i = 1; i < expressions.length; ++i) {
            result = {
                type: "BinaryExpression",
                operator: operator,
                left: result,
                right: expressions[i]
            };
        }
        return result;
    }
}

/**
 * Return node body as an array.
 * @param {Node} node
 * @returns {Node[]}
 */
function blockToArray (node: AstNode): AstNode[] {
    assert.ok(estest.isNode(node));

    const body = nodeFields(node).body;
    if (Array.isArray(body)) {
        return body as AstNode[];
    } else if (estest.isNode(body)) {
        return [ body ];
    } else {
        return [ node ];
    }
}

function hasSpreadElement(nodes: AstNode[]): boolean {
    return nodes.some((node: AstNode) => node.type == "SpreadElement");
}

function isSimpleThisReceiver(node: AstNode): boolean {
    return node.type == "Identifier" || node.type == "ThisExpression";
}

function buildArrayConcat(parts: AstNode[]): AstNode {
    if (parts.length == 0) {
        return { type: "ArrayExpression", elements: [] };
    }
    if (parts.length == 1) {
        return parts[0];
    }
    return {
        type: "CallExpression",
        callee: {
            type: "MemberExpression",
            object: parts[0],
            property: { type: "Identifier", name: "concat" },
            computed: false
        },
        arguments: parts.slice(1)
    };
}

function spreadArgumentsToArray(args: AstNode[]): AstNode {
    const parts: AstNode[] = [];
    let pending: AstNode[] = [];

    function flushPending(): void {
        if (pending.length > 0) {
            parts.push({ type: "ArrayExpression", elements: pending });
            pending = [];
        }
    }

    args.forEach((arg: AstNode) => {
        if (arg.type == "SpreadElement") {
            flushPending();
            parts.push(requiredChild(arg, "argument"));
        } else {
            pending.push(arg);
        }
    });
    flushPending();

    return buildArrayConcat(parts);
}

function isLoopOrSwitch(node: AstNode): boolean {
    return node.type == "WhileStatement"
        || node.type == "DoWhileStatement"
        || node.type == "ForStatement"
        || node.type == "ForInStatement"
        || node.type == "ForOfStatement"
        || node.type == "SwitchStatement";
}

function exitsCurrentTry(node: AstNode, stack: AstStackFrame[]): boolean {
    if (node.type == "ReturnStatement") {
        return true;
    }

    if (node.type == "BreakStatement" || node.type == "ContinueStatement") {
        return !stack.some((frame: AstStackFrame) => isLoopOrSwitch(frame.node));
    }

    return false;
}

function withFinalizerBefore(node: AstNode, finalizer: AstNode): AstNode {
    const body: AstNode[] = [];

    if (node.type == "ReturnStatement") {
        body.push({
            type: "VariableDeclaration",
            kind: "var",
            declarations: [
                {
                    type: "VariableDeclarator",
                    id: { type: "Identifier", name: "toildefender$return" },
                    init: childNode(node, "argument")
                }
            ]
        });
        body.push(utils.cloneISwearIKnowWhatImDoing(finalizer));
        body.push({
            type: "ReturnStatement",
            argument: { type: "Identifier", name: "toildefender$return" }
        });
    } else {
        body.push(utils.cloneISwearIKnowWhatImDoing(finalizer));
        body.push(node);
    }

    return {
        type: "BlockStatement",
        body: body
    };
}

function methodDefinitionName(method: AstNode | null): string {
    const key = method ? childNode(method, "key") : null;
    if (!key) {
        return "";
    }
    if (key.type == "Identifier" || key.type == "PrivateIdentifier") {
        return nodeName(key) || "";
    }
    if (key.type == "Literal") {
        return String(nodeValue(key));
    }
    return "";
}

function isConstructorMethod(method: AstNode): boolean {
    return method.type == "MethodDefinition" && nodeKind(method) == "constructor" && methodDefinitionName(method) == "constructor";
}

function privateStoreName(className: string, privateName: string): string {
    return `$$private$${className}$${privateName}`;
}

function classFieldKey(field: AstNode): AstNode {
    const key = requiredChild(field, "key");
    if (key.type == "Identifier") {
        return {
            type: "Identifier",
            name: nodeName(key) || ""
        };
    }
    if (key.type == "PrivateIdentifier") {
        return {
            type: "Literal",
            value: nodeName(key) || ""
        };
    }
    return key;
}

function assignmentStatement(left: AstNode, right: AstNode | null): AstNode {
    return {
        type: "ExpressionStatement",
        expression: {
            type: "AssignmentExpression",
            operator: "=",
            left: left,
            right: fallbackExpression(right, undefinedExpression())
        }
    };
}

function weakMapSetStatement(storeName: string, object: AstNode, value: AstNode | null): AstNode {
    return {
        type: "ExpressionStatement",
        expression: {
            type: "CallExpression",
            callee: {
                type: "MemberExpression",
                object: { type: "Identifier", name: storeName },
                property: { type: "Identifier", name: "set" },
                computed: false
            },
            arguments: [
                object,
                fallbackExpression(value, undefinedExpression())
            ]
        }
    };
}

function weakMapGetExpression(storeName: string, object: AstNode): AstNode {
    return {
        type: "CallExpression",
        callee: {
            type: "MemberExpression",
            object: { type: "Identifier", name: storeName },
            property: { type: "Identifier", name: "get" },
            computed: false
        },
        arguments: [ object ]
    };
}

function nullishTest(expression: AstNode): AstNode {
    return {
        type: "BinaryExpression",
        operator: "==",
        left: expression,
        right: { type: "Literal", value: null }
    };
}

function notNullishTest(expression: AstNode): AstNode {
    return {
        type: "BinaryExpression",
        operator: "!=",
        left: expression,
        right: { type: "Literal", value: null }
    };
}

function propertyKeyValue(property: AstNode): string | number | null {
    const key = requiredChild(property, "key");
    if (key.type == "Identifier") {
        return nodeName(key) || "";
    }
    if (key.type == "Literal") {
        const value = nodeValue(key);
        return typeof value == "string" || typeof value == "number" ? value : String(value);
    }
    return null;
}

function propertyMemberExpression(object: AstNode, property: AstNode): AstNode {
    const key = requiredChild(property, "key");
    return {
        type: "MemberExpression",
        object: object,
        property: key.type == "Identifier"
            ? { type: "Identifier", name: nodeName(key) || "" }
            : utils.cloneISwearIKnowWhatImDoing(key),
        computed: nodeComputed(property) || key.type == "Literal"
    };
}

function hasObjectRest(pattern: AstNode): boolean {
    return pattern.type == "ObjectPattern" && nodeProperties(pattern).some((prop: AstNode) => prop.type == "RestElement");
}

function hasObjectPattern(pattern: AstNode | null): boolean {
    return pattern?.type == "ObjectPattern";
}

function hasArrayPattern(pattern: AstNode | null): boolean {
    return pattern?.type == "ArrayPattern";
}

function canLowerArrayPattern(pattern: AstNode): boolean {
    return pattern.type == "ArrayPattern" && nodeElements(pattern).every((element: AstNode | null) => {
        if (element == null) {
            return true;
        }
        if (element.type == "Identifier") {
            return true;
        }
        if (element.type == "RestElement") {
            return requiredChild(element, "argument").type == "Identifier";
        }
        return element.type == "AssignmentPattern" && requiredChild(element, "left").type == "Identifier";
    });
}

function canLowerObjectRest(pattern: AstNode): boolean {
    return pattern.type == "ObjectPattern" && nodeProperties(pattern).every((prop: AstNode) => {
        if (prop.type == "RestElement") {
            return requiredChild(prop, "argument").type == "Identifier";
        }
        const value = childNode(prop, "value");
        if (prop.type != "Property" || nodeComputed(prop) || propertyKeyValue(prop) == null || !value) {
            return false;
        }
        if (value.type == "Identifier") {
            return true;
        }
        return value.type == "AssignmentPattern" && requiredChild(value, "left").type == "Identifier";
    });
}

function hasObjectSpread(node: AstNode): boolean {
    return nodeProperties(node).some((prop: AstNode) => prop.type == "SpreadElement");
}

function objectAssignCall(parts: AstNode[]): AstNode {
    return {
        type: "CallExpression",
        callee: {
            type: "MemberExpression",
            object: { type: "Identifier", name: "Object" },
            property: { type: "Identifier", name: "assign" },
            computed: false
        },
        arguments: parts
    };
}

function objectWithoutKeysCall(source: AstNode, keys: string[]): AstNode {
    return {
        type: "CallExpression",
        callee: { type: "Identifier", name: "toildefender$objectWithoutKeys" },
        arguments: [
            source,
            {
                type: "ArrayExpression",
                elements: keys.map((key: string) => ({ type: "Literal", value: key }))
            }
        ]
    };
}

function arrayElementExpression(sourceName: string, index: number): AstNode {
    return {
        type: "MemberExpression",
        object: { type: "Identifier", name: sourceName },
        property: { type: "Literal", value: index },
        computed: true
    };
}

function arrayRestExpression(sourceName: string, index: number): AstNode {
    return {
        type: "CallExpression",
        callee: {
            type: "MemberExpression",
            object: { type: "Identifier", name: sourceName },
            property: { type: "Identifier", name: "slice" },
            computed: false
        },
        arguments: [
            { type: "Literal", value: index }
        ]
    };
}

function arrayPatternElementDeclaration(kind: string, sourceName: string, element: AstNode | null, index: number): AstNode | null {
    if (element == null) {
        return null;
    }

    if (element.type == "RestElement") {
        return {
            type: "VariableDeclaration",
            kind: kind,
            declarations: [
                {
                    type: "VariableDeclarator",
                    id: requiredChild(element, "argument"),
                    init: arrayRestExpression(sourceName, index)
                }
            ]
        };
    }

    let id = element;
    let init = arrayElementExpression(sourceName, index);
    if (element.type == "AssignmentPattern") {
        id = requiredChild(element, "left");
        init = {
            type: "ConditionalExpression",
            test: {
                type: "BinaryExpression",
                operator: "===",
                left: arrayElementExpression(sourceName, index),
                right: undefinedExpression()
            },
            consequent: requiredChild(element, "right"),
            alternate: arrayElementExpression(sourceName, index)
        };
    }

    return {
        type: "VariableDeclaration",
        kind: kind,
        declarations: [
            {
                type: "VariableDeclarator",
                id: id,
                init: init
            }
        ]
    };
}

function arrayPatternStatements(kind: string, pattern: AstNode, init: AstNode | null, rngAlpha: RandomAlphaLike): AstNode[] {
    const sourceName = `$$destructure$arr$${rngAlpha.get()}`;
    const statements: AstNode[] = [
        {
            type: "VariableDeclaration",
            kind: "var",
            declarations: [
                {
                    type: "VariableDeclarator",
                    id: { type: "Identifier", name: sourceName },
                    init: fallbackExpression(init, { type: "ArrayExpression", elements: [] })
                }
            ]
        }
    ];

    nodeElements(pattern).forEach((element: AstNode | null, index: number) => {
        const lowered = arrayPatternElementDeclaration(kind, sourceName, element, index);
        if (lowered) {
            statements.push(lowered);
        }
    });

    return statements;
}

function arrayPatternAssignmentStatement(sourceName: string, element: AstNode | null, index: number): AstNode | null {
    if (element == null) {
        return null;
    }

    let left: AstNode;
    let right: AstNode;
    if (element.type == "RestElement") {
        left = requiredChild(element, "argument");
        right = arrayRestExpression(sourceName, index);
    } else if (element.type == "AssignmentPattern") {
        left = requiredChild(element, "left");
        right = {
            type: "ConditionalExpression",
            test: {
                type: "BinaryExpression",
                operator: "===",
                left: arrayElementExpression(sourceName, index),
                right: undefinedExpression()
            },
            consequent: requiredChild(element, "right"),
            alternate: arrayElementExpression(sourceName, index)
        };
    } else {
        left = element;
        right = arrayElementExpression(sourceName, index);
    }

    return assignmentStatement(left, right);
}

function arrayPatternAssignmentStatements(pattern: AstNode, init: AstNode | null, rngAlpha: RandomAlphaLike): AstNode[] {
    const sourceName = `$$destructure$arr$${rngAlpha.get()}`;
    const statements: AstNode[] = [
        {
            type: "VariableDeclaration",
            kind: "var",
            declarations: [
                {
                    type: "VariableDeclarator",
                    id: { type: "Identifier", name: sourceName },
                    init: fallbackExpression(init, { type: "ArrayExpression", elements: [] })
                }
            ]
        }
    ];

    nodeElements(pattern).forEach((element: AstNode | null, index: number) => {
        const lowered = arrayPatternAssignmentStatement(sourceName, element, index);
        if (lowered) {
            statements.push(lowered);
        }
    });

    return statements;
}

function objectPatternPropertyDeclaration(kind: string, sourceName: string, prop: AstNode): AstNode {
    const member = propertyMemberExpression(
        { type: "Identifier", name: sourceName },
        prop
    );
    const value = requiredChild(prop, "value");
    let id = value;
    let init = member;

    if (value.type == "AssignmentPattern") {
        id = requiredChild(value, "left");
        init = {
            type: "ConditionalExpression",
            test: {
                type: "BinaryExpression",
                operator: "===",
                left: utils.cloneISwearIKnowWhatImDoing(member),
                right: undefinedExpression()
            },
            consequent: requiredChild(value, "right"),
            alternate: member
        };
    }

    return {
        type: "VariableDeclaration",
        kind: kind,
        declarations: [
            {
                type: "VariableDeclarator",
                id: id,
                init: init
            }
        ]
    };
}

function containsThisExpression(node: AstNode): boolean {
    let found = false;
    traverser.traverseEx(node, [], function (this: { abort(): void }, child: AstNode) {
        if (child.type == "ThisExpression") {
            found = true;
            this.abort();
        }
        return child;
    });
    return found;
}

function defaultParameterStatement(param: AstNode): AstNode {
    const left = requiredChild(param, "left");
    return {
        type: "IfStatement",
        test: {
            type: "BinaryExpression",
            operator: "===",
            left: utils.cloneISwearIKnowWhatImDoing(left),
            right: undefinedExpression()
        },
        consequent: {
            type: "BlockStatement",
            body: [
                {
                    type: "ExpressionStatement",
                    expression: {
                        type: "AssignmentExpression",
                        operator: "=",
                        left: utils.cloneISwearIKnowWhatImDoing(left),
                        right: requiredChild(param, "right")
                    }
                }
            ]
        }
    };
}

function restParameterStatement(param: AstNode, index: number): AstNode {
    return {
        type: "VariableDeclaration",
        kind: "var",
        declarations: [
            {
                type: "VariableDeclarator",
                id: requiredChild(param, "argument"),
                init: {
                    type: "CallExpression",
                    callee: {
                        type: "MemberExpression",
                        object: {
                            type: "MemberExpression",
                            object: {
                                type: "MemberExpression",
                                object: { type: "Identifier", name: "Array" },
                                property: { type: "Identifier", name: "prototype" },
                                computed: false
                            },
                            property: { type: "Identifier", name: "slice" },
                            computed: false
                        },
                        property: { type: "Identifier", name: "call" },
                        computed: false
                    },
                    arguments: [
                        { type: "Identifier", name: "arguments" },
                        { type: "Literal", value: index }
                    ]
                }
            }
        ]
    };
}

function lowerFunctionParameters(node: AstNode): AstNode {
    if (!estest.isFunction(node)) {
        return node;
    }

    const prefix: AstNode[] = [];
    const params: AstNode[] = [];
    nodeParams(node).forEach((param: AstNode, index: number) => {
        if (param.type == "AssignmentPattern" && requiredChild(param, "left").type == "Identifier") {
            prefix.push(defaultParameterStatement(param));
            params.push(requiredChild(param, "left"));
            return;
        }
        if (param.type == "RestElement" && requiredChild(param, "argument").type == "Identifier") {
            prefix.push(restParameterStatement(param, index));
            return;
        }
        params.push(param);
    });
    setNodeField(node, "params", params);

    if (prefix.length == 0) {
        return node;
    }

    const body = requiredChild(node, "body");
    if (body.type != "BlockStatement") {
        setNodeField(node, "body", {
            type: "BlockStatement",
            body: [
                {
                    type: "ReturnStatement",
                    argument: body
                }
            ]
        });
    }
    const nextBody = requiredChild(node, "body");
    setNodeField(nextBody, "body", prefix.concat(bodyArray(nextBody)));
    return node;
}

function blockNeedsLexicalScope(node: AstNode): boolean {
    if (node.type != "BlockStatement") {
        return false;
    }

    let needsScope = false;
    traverser.traverseEx(node, [], function (this: { abort(): void }, child: AstNode) {
        if (child != node && estest.isFunction(child)) {
            return child;
        }
        if (
            (child.type == "VariableDeclaration" && nodeKind(child) != "var")
            || child.type == "ClassDeclaration"
        ) {
            needsScope = true;
            this.abort();
        }
        return child;
    });
    return needsScope;
}

export default class Normalizer {
    logger: LoggerLike;
    rngAlpha: RandomAlphaLike;

    constructor (logger: LoggerLike) {
        this.logger = logger;
        this.rngAlpha = new utils.UniqueRandomAlpha(3);
    }

    /**
     * Simplify AST.
     * @param {Node} ast Root node
     * @returns {Node}
     */
    simplify (ast: AstNode): AstNode {
        assert.ok(estest.isNode(ast));
        
        return traverser.traverse(ast, [], (node: AstNode, stack: AstStackFrame[]) => {
            switch (node.type) {
                case "Program":
                case "BlockStatement":
                    return this.simplifyBlockStatement(node);
                case "ForStatement":
                    return this.simplifyForStatement(node);
                case "ForInStatement":
                    return this.simplifyForStatement(this.simplifyForInStatement(node));
                case "ForOfStatement":
                    return this.simplifyForOfStatement(node);
                case "TryStatement":
                    return this.simplifyTryStatement(node);
                case "CallExpression":
                    return this.simplifyCallExpression(node);
                case "ExpressionStatement":
                    return this.simplifyExpressionStatement(node);
                case "ChainExpression":
                    return this.simplifyChainExpression(node);
                case "LogicalExpression":
                    return this.simplifyLogicalExpression(node);
                case "ObjectExpression":
                    return this.simplifyObjectExpression(node);
                case "VariableDeclaration":
                    return this.simplifyVariableDeclaration(node, stack);
                case "FunctionDeclaration":
                case "FunctionExpression":
                    return lowerFunctionParameters(node);
                case "ArrowFunctionExpression":
                    return this.simplifyArrowFunctionExpression(node);
                case "ClassDeclaration":
                    return this.simplifyClassDeclaration(node);
                default:
                    return node;
            }
        });

    }

    /**
     * Simplify BlockStatement.
     * @param {BlockStatement} node
     * @return {Node}
     */
    simplifyBlockStatement (node: AstNode): AstNode {
        assert.ok(estest.isNode(node));
    
        function getBlockBodies(child: AstNode, isRoot: boolean): AstNode[] {
            if (child.type == "Program" || child.type == "BlockStatement") {
                if (!isRoot && blockNeedsLexicalScope(child)) {
                    return [ child ];
                }
                const stmts: AstNode[] = [];
                bodyArray(child).forEach((stmt: AstNode) => {
                    stmts.push(...getBlockBodies(stmt, false));
                });
                return stmts;
            }
            return [ child ];
        }
        
        return {
            type: node.type,
            body: getBlockBodies(node, true)
        };
    }

    /**
     * Simplify WhileStatement.
     * @param {WhileStatement} node
     * @return {Node}
     */
    simplifyWhileStatement (node: AstNode): AstNode {
        assert.ok(estest.isNode(node));
        
        return {
            type: "WhileStatement",
            test: childNode(node, "test"),
            body: {
                type: "IfStatement",
                test: childNode(node, "test"),
                consequent: requiredChild(node, "body"),
                alternate: { type: "BreakStatement" }
            }
        };
    }

    /**
     * Simplify DoWhileStatement.
     * @param {DoWhileStatement} node
     * @return {Node}
     */
    simplifyDoWhileStatement (node: AstNode): AstNode {
        assert.ok(estest.isNode(node));
        
        return {
            type: "WhileStatement",
            test: { type: "Literal", value: true },
            body: {
                type: "BlockStatement",
                body: [
                    requiredChild(node, "body"),
                    {
                        type: "IfStatement",
                        test: requiredChild(node, "test"),
                        consequent: { type: "EmptyStatement" },
                        alternate: { type: "BreakStatement" }
                    }
                ]
            }
        };
    }

    /**
     * Simplify ForStatement.
     * @param {ForStatement} node
     * @return {Node}
     */
    simplifyForStatement (node: AstNode): AstNode {
        assert.ok(estest.isNode(node));
        
        const body: AstNode[] = [];
        const init = childNode(node, "init");
        if (init) {
            if (estest.isStatement(init)) {
                body.push(init);
            } else if (estest.isExpression(init)) {
                body.push({
                    type: "ExpressionStatement",
                    expression: init
                });
            } else {
                throw new Error("Invalid node.init type " + init.type);
            }
        }
        const update = childNode(node, "update");
        body.push({
            type: "WhileStatement",
            test: childNode(node, "test"),
            body: {
                type: "BlockStatement",
                body: blockToArray(requiredChild(node, "body")).concat(update ? [
                    {
                        type: "ExpressionStatement",
                        expression: update
                    }
                ] : [])
            }
        });
        return {
            type: "BlockStatement",
            body: body
        };
    }

    /**
     * Simplify ForInStatement.
     * @param {ForInStatement} node
     * @return {Node}
     */
    simplifyForInStatement (node: AstNode): AstNode {
        assert.ok(estest.isNode(node));
        
        const propsName = `$$forin$props$${this.rngAlpha.get()}`;
        const iterName = `$$forin$iter$${this.rngAlpha.get()}`;
        const left = requiredChild(node, "left");
        const valueAtIndex: AstNode = {
            type: "MemberExpression",
            object: { type: "Identifier", name: propsName },
            property: { type: "Identifier", name: iterName },
            computed: true
        };
        let assignStatements: AstNode[];
        if (left.type == "VariableDeclaration") {
            const declaration = nodeDeclarations(left)[0];
            const id = requiredChild(declaration, "id");
            if (hasArrayPattern(id) && canLowerArrayPattern(id)) {
                assignStatements = arrayPatternStatements(
                    nodeKind(left) == "const" ? "let" : nodeKind(left),
                    id,
                    valueAtIndex,
                    this.rngAlpha
                );
            } else {
                assignStatements = [
                    {
                        type: "VariableDeclaration",
                        kind: "var",
                        declarations: [
                            {
                                type: "VariableDeclarator",
                                id: id,
                                init: valueAtIndex
                            }
                        ]
                    }
                ];
            }
        } else if (hasArrayPattern(left) && canLowerArrayPattern(left)) {
            assignStatements = arrayPatternAssignmentStatements(
                left,
                valueAtIndex,
                this.rngAlpha
            );
        } else {
            assignStatements = [
                assignmentStatement(left, valueAtIndex)
            ];
        }
        
        return {
            type: "ForStatement",
            init: {
                type: "VariableDeclaration",
                kind: "var",
                declarations: [
                    {
                        type: "VariableDeclarator",
                        id: { type: "Identifier", name: propsName },
                        init: {
                            type: "CallExpression",
                            callee: {
                                type: "MemberExpression",
                                object: { type: "Identifier", name: "Object" },
                                property: { type: "Identifier", name: "keys" },
                                computed: false
                            },
                            arguments: [
                                requiredChild(node, "right")
                            ]
                        }
                    },
                    {
                        type: "VariableDeclarator",
                        id: { type: "Identifier", name: iterName },
                        init: { type: "Literal", value: 0 }
                    }
                ]
            },
            test: {
                type: "BinaryExpression",
                operator: "<",
                left: { type: "Identifier", name: iterName },
                right: {
                    type: "MemberExpression",
                    object: { type: "Identifier", name: propsName },
                    property: { type: "Identifier", name: "length" },
                    computed: false
                }
            },
            update: {
                type: "UpdateExpression",
                operator: "++",
                argument: { type: "Identifier", name: iterName },
                prefix: true
            },
            body: {
                type: "BlockStatement",
                body: assignStatements.concat([ requiredChild(node, "body") ])
            }
        };
    }

    /**
     * Simplify ForOfStatement to an index-based ForStatement.
     * @param {ForOfStatement} node
     * @return {Node}
     */
    simplifyForOfStatement (node: AstNode): AstNode {
        assert.ok(estest.isNode(node));

        const valuesName = `$$forof$values$${this.rngAlpha.get()}`;
        const iterName = `$$forof$iter$${this.rngAlpha.get()}`;
        const left = requiredChild(node, "left");
        const valueAtIndex: AstNode = {
            type: "MemberExpression",
            object: { type: "Identifier", name: valuesName },
            property: { type: "Identifier", name: iterName },
            computed: true
        };
        let assignStatements: AstNode[];
        if (left.type == "VariableDeclaration") {
            const declaration = nodeDeclarations(left)[0];
            const id = requiredChild(declaration, "id");
            if (hasArrayPattern(id) && canLowerArrayPattern(id)) {
                assignStatements = arrayPatternStatements(
                    nodeKind(left) == "const" ? "let" : nodeKind(left),
                    id,
                    valueAtIndex,
                    this.rngAlpha
                );
            } else {
                assignStatements = [
                    {
                        type: "VariableDeclaration",
                        kind: nodeKind(left) == "const" ? "let" : nodeKind(left),
                        declarations: [
                            {
                                type: "VariableDeclarator",
                                id: id,
                                init: valueAtIndex
                            }
                        ]
                    }
                ];
            }
        } else if (hasArrayPattern(left) && canLowerArrayPattern(left)) {
            assignStatements = arrayPatternAssignmentStatements(
                left,
                valueAtIndex,
                this.rngAlpha
            );
        } else {
            assignStatements = [
                assignmentStatement(left, valueAtIndex)
            ];
        }

        return {
            type: "BlockStatement",
            body: [
                {
                    type: "VariableDeclaration",
                    kind: "var",
                    declarations: [
                        {
                            type: "VariableDeclarator",
                            id: { type: "Identifier", name: valuesName },
                            init: requiredChild(node, "right")
                        },
                        {
                            type: "VariableDeclarator",
                            id: { type: "Identifier", name: iterName },
                            init: { type: "Literal", value: 0 }
                        }
                    ]
                },
                {
                    type: "ForStatement",
                    init: null,
                    test: {
                        type: "BinaryExpression",
                        operator: "<",
                        left: { type: "Identifier", name: iterName },
                        right: {
                            type: "MemberExpression",
                            object: { type: "Identifier", name: valuesName },
                            property: { type: "Identifier", name: "length" },
                            computed: false
                        }
                    },
                    update: {
                        type: "UpdateExpression",
                        operator: "++",
                        argument: { type: "Identifier", name: iterName },
                        prefix: false
                    },
                    body: {
                        type: "BlockStatement",
                        body: assignStatements.concat(blockToArray(requiredChild(node, "body")))
                    }
                }
            ]
        };
    }

    /**
     * Simplify SwitchStatement.
     * @param {SwitchStatement} node
     * @return {Node}
     */
    simplifySwitchStatement (node: AstNode): AstNode {
        assert.ok(estest.isNode(node));
        
        const cases = nodeArray(nodeFields(node).cases).map((caseNode: AstNode): SwitchCaseDetails => {
            const consequent = nodeArray(nodeFields(caseNode).consequent);
            const breakIndex = consequent.findIndex((child: AstNode) => child.type == "BreakStatement");
            return {
                test: childNode(caseNode, "test"),
                statements: breakIndex != -1 ? consequent.slice(0, breakIndex) : consequent,
                breaks: breakIndex != -1
            };
        });
        
        let stack: SwitchCaseDetails[] = [];
        const ifStmts: AstNode[] = [];
        for (let i = 0; i < cases.length; ++i) {
            stack.push(cases[i]);
            if (cases[i].breaks) {
                let ifStmt: AstNode | null = null;
                
                for (let j = 0; j < stack.length; ++j) {
                    const sliced = stack.slice(0, j + 1);
                    if (sliced.every((entry: SwitchCaseDetails) => entry.test)) {
                        ifStmt = {
                            type: "IfStatement",
                            test: chain(sliced.map((entry: SwitchCaseDetails) => {
                                return {
                                    type: "BinaryExpression",
                                    operator: "==",
                                    left: entry.test || { type: "Literal", value: null },
                                    right: requiredChild(node, "discriminant")
                                };
                            }), "||"),
                            consequent: {
                                type: "BlockStatement",
                                body: [
                                    ...(ifStmt ? [ ifStmt ] : []),
                                    ...stack[j].statements
                                ]
                            }
                        };
                    } else {
                        ifStmt = {
                            type: "BlockStatement",
                            body: [
                                ...(ifStmt ? [ ifStmt ] : []),
                                ...stack[j].statements
                            ]
                        };
                    }
                }
                if (ifStmt) {
                    ifStmts.push(ifStmt);
                }
                
                stack = [];
            }
        }
        this.logger.log(ifStmts);
        let combinedIfStmt = ifStmts[ifStmts.length - 1] || { type: "EmptyStatement" };
        for (let i = ifStmts.length - 2; i >= 0; --i) {
            combinedIfStmt = {
                type: "IfStatement",
                test: requiredChild(ifStmts[i], "test"),
                consequent: requiredChild(ifStmts[i], "consequent"),
                alternate: combinedIfStmt
            };
        }
        return combinedIfStmt;
    }

    /**
     * Simplify TryStatement.
     * @param {TryStatement} node
     * @return {Node}
     */
    simplifyTryStatement (node: AstNode): AstNode {
        assert.ok(estest.isNode(node));
        
        const finalizer = childNode(node, "finalizer");
        const handler = childNode(node, "handler");
        if (finalizer) {
            if (handler) {
                return this.simplifyTryStatement({
                    type: "TryStatement",
                    block: {
                        type: "BlockStatement",
                        body: [
                            {
                                type: "TryStatement",
                                block: requiredChild(node, "block"),
                                handler: handler
                            }
                        ]
                    },
                    finalizer: finalizer
                });
            }

            const block = requiredChild(node, "block");
            traverser.traverseEx(block, [], function (this: { abort(): void }, child: AstNode, stack: AstStackFrame[]) {
                if (stack.some((x: AstStackFrame) => estest.isFunction(x.node))) {
                    this.abort();
                    return child;
                } else if (exitsCurrentTry(child, stack)) {
                    return withFinalizerBefore(child, finalizer);
                }
                return child;
            });
            
            return {
                type: "BlockStatement",
                body: [
                    {
                        type: "TryStatement",
                        block: block,
                        handler: {
                            type: "CatchClause",
                            param: { type: "Identifier", name: "toildefender$e" },
                            body: {
                                type: "BlockStatement",
                                body: [
                                    {
                                        type: "VariableDeclaration",
                                        kind: "var",
                                        declarations: [
                                            {
                                                type: "VariableDeclarator",
                                                id: { type: "Identifier", name: "toildefender$_e" },
                                                init: { type: "Identifier", name: "toildefender$e" }
                                            }
                                        ]
                                    }
                                ]
                            }
                        }
                    },
                    finalizer,
                    {
                        type: "IfStatement",
                        test: { type: "Identifier", name: "toildefender$_e" },
                        consequent: {
                            type: "ThrowStatement",
                            argument: { type: "Identifier", name: "toildefender$_e" }
                        }
                    }
                ]
            };
        }
        return node;
    }

    /**
     * Lower simple spread calls like target.push(...items) to
     * target.push.apply(target, items). This keeps append-style calls stable
     * even when Babel is disabled.
     * @param {CallExpression} node
     * @return {Node}
     */
    simplifyCallExpression (node: AstNode): AstNode {
        assert.ok(estest.isNode(node));

        const args = nodeArguments(node);
        if (!hasSpreadElement(args)) {
            return node;
        }

        const callee = requiredChild(node, "callee");
        let thisArg: AstNode = { type: "Literal", value: null };
        if (callee.type == "MemberExpression") {
            const object = requiredChild(callee, "object");
            if (!isSimpleThisReceiver(object)) {
                return node;
            }
            thisArg = utils.cloneISwearIKnowWhatImDoing(object);
        }

        return {
            type: "CallExpression",
            callee: {
                type: "MemberExpression",
                object: callee,
                property: { type: "Identifier", name: "apply" },
                computed: false
            },
            arguments: [
                thisArg,
                spreadArgumentsToArray(args)
            ]
        };
    }

    simplifyExpressionStatement (node: AstNode): AstNode {
        assert.ok(estest.isNode(node));

        const expression = requiredChild(node, "expression");
        const left = childNode(expression, "left");
        if (
            expression.type == "AssignmentExpression" &&
            nodeOperator(expression) == "=" &&
            hasArrayPattern(left) &&
            left &&
            canLowerArrayPattern(left)
        ) {
            return {
                type: "BlockStatement",
                body: arrayPatternAssignmentStatements(
                    left,
                    childNode(expression, "right"),
                    this.rngAlpha
                )
            };
        }

        return node;
    }

    /**
     * Lower optional chains to conditional expressions before legacy passes.
     * This intentionally targets deterministic AST compatibility rather than
     * Babel-perfect single-evaluation semantics for every exotic receiver.
     * @param {ChainExpression} node
     * @return {Node}
     */
    simplifyChainExpression (node: AstNode): AstNode {
        assert.ok(estest.isNode(node));

        return this.lowerOptionalChain(requiredChild(node, "expression"));
    }

    lowerOptionalChain (node: AstNode): AstNode {
        if (node.type == "MemberExpression") {
            const object = this.lowerOptionalChain(requiredChild(node, "object"));
            const member: AstNode = {
                type: "MemberExpression",
                object: utils.cloneISwearIKnowWhatImDoing(object),
                property: requiredChild(node, "property"),
                computed: nodeComputed(node)
            };
            if (nodeFlag(node, "optional")) {
                return {
                    type: "ConditionalExpression",
                    test: nullishTest(utils.cloneISwearIKnowWhatImDoing(object)),
                    consequent: undefinedExpression(),
                    alternate: member
                };
            }
            return member;
        }

        if (node.type == "CallExpression") {
            const calleeNode = requiredChild(node, "callee");
            if (calleeNode.type == "MemberExpression") {
                return this.lowerOptionalMemberCall(node);
            }

            const callee = this.lowerOptionalChain(calleeNode);
            const call: AstNode = {
                type: "CallExpression",
                callee: utils.cloneISwearIKnowWhatImDoing(callee),
                arguments: nodeArguments(node),
                optional: false
            };
            if (nodeFlag(node, "optional")) {
                return {
                    type: "ConditionalExpression",
                    test: nullishTest(utils.cloneISwearIKnowWhatImDoing(callee)),
                    consequent: undefinedExpression(),
                    alternate: call
                };
            }
            return call;
        }

        return node;
    }

    lowerOptionalMemberCall (node: AstNode): AstNode {
        const member = requiredChild(node, "callee");
        const object = this.lowerOptionalChain(requiredChild(member, "object"));
        const directMember: AstNode = {
            type: "MemberExpression",
            object: utils.cloneISwearIKnowWhatImDoing(object),
            property: requiredChild(member, "property"),
            computed: nodeComputed(member)
        };

        let alternate: AstNode;
        if (nodeFlag(node, "optional")) {
            alternate = {
                type: "CallExpression",
                callee: {
                    type: "MemberExpression",
                    object: utils.cloneISwearIKnowWhatImDoing(directMember),
                    property: { type: "Identifier", name: "call" },
                    computed: false
                },
                arguments: [ utils.cloneISwearIKnowWhatImDoing(object) ].concat(nodeArguments(node)),
                optional: false
            };
            alternate = {
                type: "ConditionalExpression",
                test: nullishTest(utils.cloneISwearIKnowWhatImDoing(directMember)),
                consequent: undefinedExpression(),
                alternate: alternate
            };
        } else {
            alternate = {
                type: "CallExpression",
                callee: directMember,
                arguments: nodeArguments(node),
                optional: false
            };
        }

        if (nodeFlag(member, "optional")) {
            return {
                type: "ConditionalExpression",
                test: nullishTest(utils.cloneISwearIKnowWhatImDoing(object)),
                consequent: undefinedExpression(),
                alternate: alternate
            };
        }

        return alternate;
    }

    /**
     * Lower nullish coalescing to an ES5-compatible conditional expression.
     * @param {LogicalExpression} node
     * @return {Node}
     */
    simplifyLogicalExpression (node: AstNode): AstNode {
        assert.ok(estest.isNode(node));

        if (nodeOperator(node) != "??") {
            return node;
        }

        return {
            type: "ConditionalExpression",
            test: notNullishTest(utils.cloneISwearIKnowWhatImDoing(requiredChild(node, "left"))),
            consequent: requiredChild(node, "left"),
            alternate: requiredChild(node, "right")
        };
    }

    /**
     * Lower object spread to Object.assign({}, ...parts).
     * @param {ObjectExpression} node
     * @return {Node}
     */
    simplifyObjectExpression (node: AstNode): AstNode {
        assert.ok(estest.isNode(node));

        if (!hasObjectSpread(node)) {
            return node;
        }

        const parts: AstNode[] = [
            {
                type: "ObjectExpression",
                properties: []
            }
        ];
        let pending: AstNode[] = [];

        function flushPending(): void {
            if (pending.length > 0) {
                parts.push({
                    type: "ObjectExpression",
                    properties: pending
                });
                pending = [];
            }
        }

        nodeProperties(node).forEach((prop: AstNode) => {
            if (prop.type == "SpreadElement") {
                flushPending();
                parts.push(requiredChild(prop, "argument"));
            } else {
                pending.push(prop);
            }
        });
        flushPending();

        return objectAssignCall(parts);
    }

    /**
     * Lower simple object rest declarations:
     *   const { a, ...rest } = source
     * becomes:
     *   var tmp = source; var a = tmp.a; var rest = withoutKeys(tmp, ["a"])
     * @param {VariableDeclaration} node
     * @param {Node[]} stack
     * @return {Node}
     */
    simplifyVariableDeclaration (node: AstNode, stack: AstStackFrame[]): AstNode {
        assert.ok(estest.isNode(node));

        const declarations = nodeDeclarations(node);
        const needsLowering = declarations.some((decl: AstNode) => hasObjectPattern(childNode(decl, "id")) || hasArrayPattern(childNode(decl, "id")));
        if (!needsLowering) {
            return node;
        }
        if (declarations.some((decl: AstNode) => {
            const id = childNode(decl, "id");
            return hasObjectPattern(id) && id !== null && !canLowerObjectRest(id);
        })) {
            return node;
        }
        if (declarations.some((decl: AstNode) => {
            const id = childNode(decl, "id");
            return hasArrayPattern(id) && id !== null && !canLowerArrayPattern(id);
        })) {
            return node;
        }

        const parentFrame = stack[1];
        if (parentFrame && parentFrame.node.type == "ForStatement" && parentFrame.key == "init") {
            return node;
        }
        if (
            parentFrame &&
            (parentFrame.node.type == "ForOfStatement" || parentFrame.node.type == "ForInStatement") &&
            parentFrame.key == "left"
        ) {
            return node;
        }

        let statements: AstNode[] = [];
        let normalDeclarations: AstNode[] = [];
        const declarationKind = "var";

        function flushNormalDeclarations(): void {
            if (normalDeclarations.length > 0) {
                statements.push({
                    type: "VariableDeclaration",
                    kind: declarationKind,
                    declarations: normalDeclarations
                });
                normalDeclarations = [];
            }
        }

        declarations.forEach((decl: AstNode) => {
            const id = requiredChild(decl, "id");
            if (!hasObjectPattern(id) && !hasArrayPattern(id)) {
                normalDeclarations.push(decl);
                return;
            }

            flushNormalDeclarations();

            if (hasArrayPattern(id)) {
                statements = statements.concat(arrayPatternStatements(
                    "var",
                    id,
                    childNode(decl, "init"),
                    this.rngAlpha
                ));
                return;
            }

            const sourceName = `$$destructure$obj$${this.rngAlpha.get()}`;
            statements.push({
                type: "VariableDeclaration",
                kind: "var",
                declarations: [
                    {
                        type: "VariableDeclarator",
                        id: { type: "Identifier", name: sourceName },
                        init: fallbackExpression(childNode(decl, "init"), { type: "ObjectExpression", properties: [] })
                    }
                ]
            });

            const excluded: string[] = [];
            nodeProperties(id).forEach((prop: AstNode) => {
                if (prop.type == "RestElement") {
                    statements.push({
                        type: "VariableDeclaration",
                        kind: declarationKind,
                        declarations: [
                            {
                                type: "VariableDeclarator",
                                id: requiredChild(prop, "argument"),
                                init: objectWithoutKeysCall(
                                    { type: "Identifier", name: sourceName },
                                    excluded
                                )
                            }
                        ]
                    });
                    return;
                }

                const key = propertyKeyValue(prop);
                excluded.push(String(key));
                statements.push(objectPatternPropertyDeclaration(declarationKind, sourceName, prop));
            });
        });

        flushNormalDeclarations();

        return {
            type: "BlockStatement",
            body: statements
        };
    }

    /**
     * Lower arrows so scope/control-flow passes do not leave callback bodies
     * inside an outer flattened frame. Bind lexical this only when needed.
     * @param {ArrowFunctionExpression} node
     * @return {Node}
     */
    simplifyArrowFunctionExpression (node: AstNode): AstNode {
        assert.ok(estest.isNode(node));

        const body = requiredChild(node, "body");
        let fn: AstNode = {
            type: "FunctionExpression",
            id: null,
            params: nodeParams(node),
            body: body.type == "BlockStatement" ? body : {
                type: "BlockStatement",
                body: [
                    {
                        type: "ReturnStatement",
                        argument: body
                    }
                ]
            },
            generator: false,
            expression: false,
            async: nodeFlag(node, "async")
        };
        if (nodeFlag(node, "toildefender$noNumericVm")) {
            setNodeField(fn, "toildefender$noNumericVm", true);
        }
        fn = lowerFunctionParameters(fn);

        if (!containsThisExpression(requiredChild(fn, "body"))) {
            return fn;
        }

        return {
            type: "CallExpression",
            callee: {
                type: "MemberExpression",
                object: fn,
                property: { type: "Identifier", name: "bind" },
                computed: false
            },
            arguments: [
                { type: "ThisExpression" }
            ]
        };
    }

    /**
     * Lower class fields/private fields to older ESTree nodes that escodegen
     * and the classic passes can handle.
     * @param {ClassDeclaration} node
     * @return {Node}
     */
    simplifyClassDeclaration (node: AstNode): AstNode {
        assert.ok(estest.isNode(node));

        const className = nodeName(childNode(node, "id")) || `$$class$${this.rngAlpha.get()}`;
        const privateStores: PrivateStores = {};
        const instanceInitializers: AstNode[] = [];
        const staticAssignments: AstNode[] = [];
        const methods: AstNode[] = [];
        const classBody = requiredChild(node, "body");

        bodyArray(classBody).forEach((element: AstNode) => {
            if (element.type != "PropertyDefinition" && element.type != "FieldDefinition") {
                methods.push(element);
                return;
            }

            const key = requiredChild(element, "key");
            if (key.type == "PrivateIdentifier") {
                const keyName = nodeName(key) || "";
                const storeName = privateStoreName(className, keyName);
                privateStores[keyName] = storeName;
                if (nodeFlag(element, "static")) {
                    staticAssignments.push(weakMapSetStatement(
                        storeName,
                        { type: "Identifier", name: className },
                        childNode(element, "value")
                    ));
                } else {
                    instanceInitializers.push(weakMapSetStatement(
                        storeName,
                        { type: "ThisExpression" },
                        childNode(element, "value")
                    ));
                }
                return;
            }

            const target: AstNode = {
                type: "MemberExpression",
                object: nodeFlag(element, "static") ? { type: "Identifier", name: className } : { type: "ThisExpression" },
                property: classFieldKey(element),
                computed: nodeComputed(element) || key.type == "Literal"
            };
            if (nodeFlag(element, "static")) {
                staticAssignments.push(assignmentStatement(target, childNode(element, "value")));
            } else {
                instanceInitializers.push(assignmentStatement(target, childNode(element, "value")));
            }
        });

        methods.forEach((method: AstNode) => {
            this.lowerPrivateMembers(method, privateStores);
        });

        if (instanceInitializers.length > 0) {
            let constructor = methods.find(isConstructorMethod);
            if (!constructor) {
                constructor = {
                    type: "MethodDefinition",
                    key: { type: "Identifier", name: "constructor" },
                    computed: false,
                    value: {
                        type: "FunctionExpression",
                        id: null,
                        params: [],
                        body: {
                            type: "BlockStatement",
                            body: childNode(node, "superClass") ? [
                                {
                                    type: "ExpressionStatement",
                                    expression: {
                                        type: "CallExpression",
                                        callee: { type: "Super" },
                                        arguments: []
                                    }
                                }
                            ] : []
                        },
                        generator: false,
                        expression: false,
                        async: false
                    },
                    kind: "constructor",
                    static: false
                };
                methods.unshift(constructor);
            }

            const constructorValue = requiredChild(constructor, "value");
            const constructorBody = requiredChild(constructorValue, "body");
            const body = mutableBody(constructorBody);
            let insertAt = 0;
            if (childNode(node, "superClass")) {
                const superIndex = body.findIndex((stmt: AstNode) => {
                    const expression = childNode(stmt, "expression");
                    const callee = expression ? childNode(expression, "callee") : null;
                    return stmt.type == "ExpressionStatement" && expression?.type == "CallExpression" && callee?.type == "Super";
                });
                insertAt = superIndex == -1 ? 0 : superIndex + 1;
            }
            body.splice(insertAt, 0, ...instanceInitializers);
        }

        setNodeField(classBody, "body", methods);

        const privateDeclarations: AstNode[] = Object.keys(privateStores).map((name: string) => {
            return {
                type: "VariableDeclaration",
                kind: "var",
                declarations: [
                    {
                        type: "VariableDeclarator",
                        id: { type: "Identifier", name: privateStores[name] },
                        init: {
                            type: "NewExpression",
                            callee: { type: "Identifier", name: "WeakMap" },
                            arguments: []
                        }
                    }
                ]
            };
        });

        if (privateDeclarations.length == 0 && staticAssignments.length == 0) {
            return node;
        }

        return {
            type: "BlockStatement",
            body: [
                ...privateDeclarations,
                node,
                ...staticAssignments
            ]
        };
    }

    lowerPrivateMembers (node: AstNode, privateStores: PrivateStores): void {
        traverser.traverse(node, [], (child: AstNode, stack: AstStackFrame[]) => {
            const parentFrame = stack[1];
            if (child.type == "MemberExpression"
                && parentFrame
                && parentFrame.node.type == "AssignmentExpression"
                && parentFrame.key == "left") {
                return child;
            }
            const left = childNode(child, "left");
            if (child.type == "AssignmentExpression" && left?.type == "MemberExpression") {
                const property = childNode(left, "property");
                const storeName = property?.type == "PrivateIdentifier" ? privateStores[nodeName(property) || ""] : undefined;
                if (storeName) {
                    return {
                        type: "CallExpression",
                        callee: {
                            type: "MemberExpression",
                            object: { type: "Identifier", name: storeName },
                            property: { type: "Identifier", name: "set" },
                            computed: false
                        },
                        arguments: [
                            requiredChild(left, "object"),
                            requiredChild(child, "right")
                        ]
                    };
                }
            }
            if (child.type == "MemberExpression") {
                const property = childNode(child, "property");
                const storeName = property?.type == "PrivateIdentifier" ? privateStores[nodeName(property) || ""] : undefined;
                if (storeName) {
                    return weakMapGetExpression(storeName, requiredChild(child, "object"));
                }
            }
            return child;
        });
    }
}
