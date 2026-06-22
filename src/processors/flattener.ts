import assert from "assert";
import { EventEmitter } from "events";
import estest from "../estest.js";
import traverser from "../traverser.js";
import utils from "../utils.js";
import type { AstNode, AstStackFrame, LoggerLike } from "../types.js";

interface RandomLike {
    get(): number;
}

interface JumpTarget {
    id: number;
    label: string | null;
}

interface ProgramOptions {
    async?: boolean;
    generator?: boolean;
    invoke?: boolean;
    name?: string;
}

interface ScopeObjectInfo {
    max: number;
    offset: number;
}

function nodeFields(node: AstNode): Record<string, unknown> {
    return node as unknown as Record<string, unknown>;
}

function nodeArray(value: unknown): AstNode[] {
    return Array.isArray(value) ? (value as AstNode[]) : [];
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

function setNodeName(node: AstNode, name: string): void {
    (node as { name?: string }).name = name;
}

function nodeValue(node: AstNode | null): unknown {
    return (node as { value?: unknown } | null)?.value;
}

function setNodeValue(node: AstNode, value: unknown): void {
    (node as { value?: unknown }).value = value;
}

function nodeFlag(node: AstNode, key: "toildefender$followsSlicingArguments" | "toildefender$reassigningArguments" | "toildefender$scopeObject" | "toildefender$scopeObjectReference"): boolean {
    return (node as Record<string, unknown>)[key] === true;
}

function nodeDeclarations(node: AstNode): AstNode[] {
    return nodeArray(nodeFields(node).declarations);
}

function switchCases(node: AstNode): AstNode[] {
    return nodeArray(nodeFields(node).cases);
}

function labelName(node: AstNode): string | null {
    return nodeName(childNode(node, "label"));
}

function last<T>(items: T[]): T | undefined {
    return items[items.length - 1];
}

function shuffled<T>(items: T[]): T[] {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = result[i];
        result[i] = result[j];
        result[j] = tmp;
    }
    return result;
}

function switchCaseTestValue(node: AstNode): unknown {
    return nodeValue(childNode(node, "test"));
}

/**
 * Push a SwitchCase onto an array while removing all identical SwitchCases
 * @param {SwitchCase[]} arr
 * @param {SwitchCase} elem
 */
function pushUniqSwitchCase(arr: AstNode[], elem: AstNode): void {
    const value = switchCaseTestValue(elem);
    for (let i = arr.length - 1; i >= 0; i -= 1) {
        if (switchCaseTestValue(arr[i]) == value) {
            arr.splice(i, 1);
        }
    }
    arr.push(elem);
}

/**
 * Shuffle SwitchCase statements while respecting fall troughs.
 * @param entries {SwitchCase[]} Array of the unshuffled cases
 * @returns {SwitchCase[]} New array of the shuffled cases
 */
function shuffleSwitchCases(entries: AstNode[]): AstNode[] {
    const groups: AstNode[][] = [];
    let stack: AstNode[] = [];

    function clearStack(): void {
        if (stack.length > 0) {
            groups.push(stack);
            stack = [];
        }
    }

    entries.forEach((entry: AstNode) => {
        const breaks = bodyArray(entry).some((x: AstNode) => x.type == "BreakStatement");
        if (breaks) {
            clearStack();
            groups.push([ entry ]);
        } else {
            stack.push(entry);
        }
    });
    clearStack();
    return shuffled(groups).flat();
}

/**
 * Merge nested BlockStatements (BlockStatements containing other BlockStatements)
 * @param {BlockStatement} node Root BlockStatement
 * @returns {BlockStatement} Merged BlockStatement
 */
function mergeNestedBlocks(node: AstNode): AstNode {
    assert(estest.isNode(node));
    
    function getBlockBodies(child: AstNode): AstNode[] {
        if (child.type == "Program" || child.type == "BlockStatement") {
            const stmts: AstNode[] = [];
            bodyArray(child).forEach((stmt: AstNode) => {
                stmts.push(...getBlockBodies(stmt));
            });
            return stmts;
        }
        return [ child ];
    }
    
    return {
        type: node.type,
        body: getBlockBodies(node)
    };
}

/**
 * Split array of statements into array of compound statements and BlockStatements containing an array of non-compound statements
 * @param {Node[]} nodes Array of statements
 * @returns {Statement[]} Array of Statements
 */
function splitBlocks(nodes: AstNode[]): AstNode[] {
    let stack: AstNode[] = [];
    const output: AstNode[] = [];
    for (let i = 0; i < nodes.length; ++i) {
        if (estest.isCompoundStatement(nodes[i])) {
            if (stack.length > 0) {
                output.push({
                    type: "BlockStatement",
                    body: stack
                });
                stack = [];
            }
            output.push(nodes[i]);
        } else if (estest.isStatement(nodes[i])) {
            stack.push(nodes[i]);
        } else if (estest.isExpression(nodes[i])) {
            console.warn("Unexpected expression " + nodes[i].type);
            stack.push(nodes[i]);
        } else {
            throw new Error("Illegal statement type " + nodes[i].type);
        }
    }
    if (stack.length > 0) {
        output.push({
            type: "BlockStatement",
            body: stack
        });
    }
    return output;
}

function targetFor(targets: JumpTarget[], label: string | null): JumpTarget | undefined {
    if (label) {
        return targets.find((target: JumpTarget) => target.label == label);
    }
    return last(targets);
}

function memberScopeName(node: AstNode): string | null {
    if (node.type != "MemberExpression") {
        return null;
    }
    const object = childNode(node, "object");
    const property = childNode(node, "property");
    const objectName = nodeName(object);
    if (
        object?.type == "Identifier" &&
        objectName?.startsWith("$$scope") &&
        property?.type == "Literal" &&
        typeof nodeValue(property) == "number"
    ) {
        return objectName;
    }
    return null;
}

function expressionStatement(expression: AstNode): AstNode {
    return {
        type: "ExpressionStatement",
        expression: expression
    };
}

function stateAssignment(value: number): AstNode {
    return expressionStatement({
        type: "AssignmentExpression",
        operator: "=",
        left: { type: "Identifier", name: "state" },
        right: { type: "Literal", value: value }
    });
}

function switchCase(entry: number, consequent: AstNode[]): AstNode {
    return {
        type: "SwitchCase",
        test: { type: "Literal", value: entry },
        consequent: consequent
    };
}

export default class Flattener {
    logger: LoggerLike;
    rng: RandomLike;
    emitter: EventEmitter;
    output: AstNode[];
    handlers: AstNode[];
    breaks: JumpTarget[];
    continues: JumpTarget[];

    constructor (logger: LoggerLike, rng: RandomLike) {
        this.logger = logger;
        this.rng = rng;
        this.emitter = new EventEmitter();
        this.output = [];
        this.handlers = [];
        this.breaks = [];
        this.continues = [];
    }
    
    /**
     * Transform method
     * @param {Statement} input Method body
     * @param {number} entry Entry point
     * @param {number} exit Exit point
     */
    addMethod (input: AstNode, entry: number, exit: number): void {
        assert.ok(estest.isStatement(input));
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");
        
        this.transformStatement(input, entry, exit);
    }
    
    /**
     * Get output switch construct
     * @param {number} entry Entry point
     * @param {number} exit Exit point
     * @returns {Statement} Switch construct
     */
    getCases (entry: number, exit: number): AstNode {
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");
        
        return {
            type: "TryStatement",
            block: {
                type: "BlockStatement",
                body: [
                    {
                        type: "SwitchStatement",
                        discriminant: { type: "Identifier", name: "state" },
                        cases: shuffleSwitchCases(this.output.concat([
                            {
                                type: "SwitchCase",
                                test: { type: "Literal", value: exit },
                                consequent: [
                                    {
                                        type: "ReturnStatement"
                                    }
                                ]
                            }
                        ]))
                    }
                ]
            },
            handler: {
                type: "CatchClause",
                param: { type: "Identifier", name: "e" },
                body: {
                    type: "BlockStatement",
                    body: [
                        {
                            type: "ExpressionStatement",
                            expression: {
                                type: "AssignmentExpression",
                                operator: "=",
                                left: { type: "Identifier", name: "toildefender$tobethrown" },
                                right: { type: "Literal", value: null }
                            }
                        },
                        {
                            type: "SwitchStatement",
                            discriminant: { type: "Identifier", name: "state" },
                            cases: this.handlers.concat({
                                type: "SwitchCase",
                                test: null,
                                consequent: [
                                    {
                                        type: "ThrowStatement",
                                        argument: { type: "Identifier", name: "e" }
                                    }
                                ]
                            })
                        }
                    ]
                }
            }
        };
    }
    
    /**
     * Get output switch construct program
     * @param {number} entry Entry point
     * @param {number} exit Exit point
     * @param {Object} options Program options
     * @returns {Program} Switch construct program
     */
    getProgram (entry: number, exit: number, options: ProgramOptions = {}): AstNode {
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");

        const name = options.name || "main";
        const invoke = options.invoke !== false;
        
        const body: AstNode[] = [
            {
                type: "FunctionDeclaration",
                id: { type: "Identifier", name: name },
                params: [
                    { type: "Identifier", name: "state" },
                    { type: "Identifier", name: "scope" }
                ],
                body: {
                    type: "BlockStatement",
                    body: [
                        {
                            type: "VariableDeclaration",
                            kind: "var",
                            declarations: [
                                {
                                    type: "VariableDeclarator",
                                    id: { type: "Identifier", name: "toildefender$tobethrown" },
                                    init: null
                                }
                            ]
                        },
                        {
                            type: "WhileStatement",
                            test: { type: "Literal", value: true },
                            body: this.getCases(entry, exit)
                        }
                    ]
                },
                generator: options.generator === true,
                expression: false,
                async: options.async === true
            }
        ];

        if (invoke) {
            body.push({
                type: "ExpressionStatement",
                expression: {
                    type: "CallExpression",
                    callee: { type: "Identifier", name: name },
                    arguments: [
                        { type: "Literal", value: entry },
                        { type: "ObjectExpression", properties: [] }
                    ]
                }
            });
        }

        return {
            type: "Program",
            body: body
        };
    }
    
    /**
     * Import statement into control flow table
     * @param {Statement} node
     * @param {number} entry Entry point
     * @param {number} exit Exit point
     */
    transformStatement (node: AstNode, entry: number, exit: number): void {
        assert(estest.isStatement(node));
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");
        
        switch (node.type) {
            case "Program":
            case "BlockStatement": {
                this.transformBlock(node, entry, exit);
                break;
            }
            case "IfStatement": {
                this.transformIf(node, entry, exit);
                break;
            }
            case "WhileStatement": {
                this.transformWhile(node, entry, exit);
                break;
            }
            case "DoWhileStatement": {
                this.transformDoWhile(node, entry, exit);
                break;
            }
            case "SwitchStatement": {
                this.transformSwitch(node, entry, exit);
                break;
            }
            case "TryStatement": {
                if (childNode(node, "handler") && !childNode(node, "finalizer")) {
                    this.transformTryCatch(node, entry, exit);
                } else {
                    throw new Error("Not normalized");
                }
                break;
            }
            case "EmptyStatement": {
                break;
            }
            default: {
                this.logger.warn("Unsupported type " + node.type);
                // This caused an infinite loop when SwitchStatement was not handled separately.
                this.transformBlock({ type: "BlockStatement", body: [ node ] }, entry, exit);
                break;
            }
        }
    }
    
    /**
     * Import BlockStatement into control flow table
     * @param {BlockStatement} node
     * @param {number} entry Entry point
     * @param {number} exit Exit point
     */
    transformBlock (node: AstNode, entry: number, exit: number): void {
        assert.ok(node.type == "Program" || node.type == "BlockStatement");
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");
        
        node = mergeNestedBlocks(node);
        const blocks = splitBlocks(bodyArray(node));

        for (let i = 0; i < blocks.length; ++i) {
            if (blocks[i].type == "LabeledStatement") {
                const body = requiredChild(blocks[i], "body");
                setNodeField(body, "label", childNode(blocks[i], "label"));
                blocks[i] = body;
            }
            
            if (!estest.isStatement(blocks[i])) {
                console.warn(blocks[i].type + " is not a statement");
            }
            
            const partExit = i != blocks.length - 1 ? this.rng.get() : exit;
            if (blocks[i].type == "BlockStatement") {
                this.transformSequence(blocks[i], entry, partExit);
            } else {
                this.transformStatement(blocks[i], entry, partExit);
            }
            entry = partExit;
        }
    }
    
    /**
     * Import sequence from splitBlocks into control flow table
     * @param {BlockStatement} node
     * @param {number} entry Entry point
     * @param {number} exit Exit point
     */
    transformSequence (node: AstNode, entry: number, exit: number): void {
        assert.equal(node.type, "BlockStatement");
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");
        
        const stmts: AstNode[] = [];
        
        const aborted = !bodyArray(node).every((stmt: AstNode) => {
            assert(estest.isStatement(stmt), stmt.type + " is not a statement");
            
            switch (stmt.type) {
                case "BreakStatement": {
                    const breakTarget = targetFor(this.breaks, labelName(stmt));
                    assert(breakTarget, "No break target");
                    
                    stmts.push(stateAssignment(breakTarget.id));
                    stmts.push({ type: "BreakStatement" });
                    
                    return false;
                }
                case "ContinueStatement": {
                    const continueTarget = targetFor(this.continues, labelName(stmt));
                    assert(continueTarget, "No continue target");
                    
                    stmts.push(stateAssignment(continueTarget.id));
                    stmts.push({ type: "BreakStatement" });
                    
                    return false;
                }
                case "ReturnStatement": {
                    stmts.push(stmt);
                    
                    return false;
                }
                case "EmptyStatement": {
                    return true;
                }
                default: {
                    stmts.push(stmt);
                    
                    return true;
                }
            }
        });
        
        if (!aborted) {
            stmts.push(stateAssignment(exit));
            stmts.push({ type: "BreakStatement" });
        }
        
        this.output.push(switchCase(entry, stmts));
        this.emitter.emit("branch", entry);
    }
    
    /**
     * Import IfStatement into control flow table
     * @param {IfStatement} node
     * @param {number} entry Entry point
     * @param {number} exit Exit point
     */
    transformIf (node: AstNode, entry: number, exit: number): void {
        assert.equal(node.type, "IfStatement");
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");
        
        const thenEntry = this.rng.get();
        const alternate = childNode(node, "alternate");
        const elseEntry = alternate ? this.rng.get() : exit;
        this.output.push(switchCase(entry, [
            {
                type: "ExpressionStatement",
                expression: {
                    type: "AssignmentExpression",
                    operator: "=",
                    left: { type: "Identifier", name: "state" },
                    right: {
                        type: "ConditionalExpression",
                        test: requiredChild(node, "test"),
                        consequent:  { type: "Literal", value: thenEntry },
                        alternate: { type: "Literal", value: elseEntry }
                    }
                }
            },
            {
                type: "BreakStatement"
            }
        ]));
        this.emitter.emit("branch", entry);
        this.transformStatement(requiredChild(node, "consequent"), thenEntry, exit);
        if (alternate) {
            this.transformStatement(alternate, elseEntry, exit);
        }
    }
    
    /**
     * Import WhileStatement into control flow table
     * @param {WhileStatement} node
     * @param {number} entry Entry point
     * @param {number} exit Exit point
     */
    transformWhile (node: AstNode, entry: number, exit: number): void {
        assert.equal(node.type, "WhileStatement");
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");
        
        const bodyEntry = this.rng.get();
        this.output.push(switchCase(entry, [
            {
                type: "ExpressionStatement",
                expression: {
                    type: "AssignmentExpression",
                    operator: "=",
                    left: { type: "Identifier", name: "state" },
                    right: {
                        type: "ConditionalExpression",
                        test: requiredChild(node, "test"),
                        consequent:  { type: "Literal", value: bodyEntry },
                        alternate: { type: "Literal", value: exit }
                    }
                }
            },
            {
                type: "BreakStatement"
            }
        ]));
        this.emitter.emit("branch", entry);
        
        this.breaks.push({
            label: labelName(node),
            id: exit
        });
        this.continues.push({
            label: labelName(node),
            id: entry
        });
        this.transformBlock(requiredChild(node, "body"), bodyEntry, entry);
        this.breaks.pop();
        this.continues.pop();
    }
    
    /**
     * Import DoWhileStatement into control flow table
     * @param {DoWhileStatement} node
     * @param {number} entry Entry point
     * @param {number} exit Exit point
     */
    transformDoWhile (node: AstNode, entry: number, exit: number): void {
        assert.equal(node.type, "DoWhileStatement");
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");
        
        const testEntry = this.rng.get();
        this.output.push(switchCase(testEntry, [
            {
                type: "ExpressionStatement",
                expression: {
                    type: "AssignmentExpression",
                    operator: "=",
                    left: { type: "Identifier", name: "state" },
                    right: {
                        type: "ConditionalExpression",
                        test: requiredChild(node, "test"),
                        consequent:  { type: "Literal", value: entry },
                        alternate: { type: "Literal", value: exit }
                    }
                }
            },
            {
                type: "BreakStatement"
            }
        ]));
        this.emitter.emit("branch", testEntry);
        
        this.breaks.push({
            label: labelName(node),
            id: exit
        });
        this.continues.push({
            label: labelName(node),
            id: entry
        });
        this.transformBlock(requiredChild(node, "body"), entry, testEntry);
        this.breaks.pop();
        this.continues.pop();
    }
    
    /**
     * Import SwitchStatement into control flow table
     * @param {SwitchStatement} node
     * @param {number} entry Entry point
     * @param {number} exit Exit point
     */
    transformSwitch (node: AstNode, entry: number, exit: number): void {
        assert.equal(node.type, "SwitchStatement");
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");
        
        const comps: AstNode[] = [];
        const cases = switchCases(node);
        
        this.breaks.push({
            label: null,
            id: exit
        });
        let nextCaseEntry = this.rng.get();
        cases.forEach((caseNode: AstNode, index: number) => {
            const isLast = index == cases.length - 1;
            
            const caseEntry = nextCaseEntry;
            nextCaseEntry = this.rng.get();
            
            const consequent = nodeArray(nodeFields(caseNode).consequent);
            if (consequent.length > 0) {
                this.transformBlock({
                    type: "BlockStatement",
                    body: consequent
                }, caseEntry, isLast ? exit : nextCaseEntry);
            } else {
                nextCaseEntry = caseEntry;
            }
            
            const test = childNode(caseNode, "test");
            if (test) {
                comps.push({
                    type: "IfStatement",
                    test: {
                        type: "BinaryExpression",
                        operator: "==",
                        left: utils.cloneISwearIKnowWhatImDoing(requiredChild(node, "discriminant")),
                        right: test
                    },
                    consequent: {
                        type: "BlockStatement",
                        body: [
                            stateAssignment(caseEntry),
                            {
                                type: "BreakStatement"
                            }
                        ]
                    }
                });
            } else {
                comps.push({
                    type: "BlockStatement",
                    body: [
                        stateAssignment(caseEntry),
                        {
                            type: "BreakStatement"
                        }
                    ]
                });
            }
        });
        this.breaks.pop();
            
        this.output.push(switchCase(entry, comps));
    }
    
    /**
     * Import TryStatement into control flow table
     * @param {TryStatement} node
     * @param {number} entry Entry point
     * @param {number} exit Exit point
     */
    transformTryCatch (node: AstNode, entry: number, exit: number): void {
        assert.equal(node.type, "TryStatement");
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");

        const handler = requiredChild(node, "handler");
        assert.ok(!childNode(node, "finalizer"));
        
        const catchEntry = this.rng.get();
        const handlerBody = mutableBody(requiredChild(handler, "body"));
        const scopeDef = handlerBody.splice(0, 2);
        const scopeDeclaration = scopeDef[0];
        const exceptionAssignment = scopeDef[1];
        const declarator = nodeDeclarations(scopeDeclaration)[0];
        const scopeName = nodeName(childNode(declarator, "id")) || "";
        const assignmentExpression = childNode(exceptionAssignment, "expression");
        const assignmentLeft = assignmentExpression ? childNode(assignmentExpression, "left") : null;
        const assignmentRight = assignmentExpression ? childNode(assignmentExpression, "right") : null;
        const exceptionReference = nodeFields(handler)["toildefender$exception"];

        assert(
            scopeDeclaration?.type == "VariableDeclaration" &&
            nodeDeclarations(scopeDeclaration).length == 1 &&
            scopeName.indexOf("$$scope") == 0,
            "First element of node.handler.body isn't a VariableDeclaration of a scope object");
        assert(
            exceptionAssignment?.type == "ExpressionStatement" &&
            assignmentExpression?.type == "AssignmentExpression" &&
            assignmentLeft?.type == "MemberExpression" &&
            (nodeName(childNode(assignmentLeft, "object")) || "").indexOf("$$scope") == 0 &&
            (nodeName(assignmentRight) || "").indexOf("$$var") == 0,
            "Second element of node.handler.body is not a e assignment");
        assert(estest.isNode(exceptionReference));

        const createHandler = (branchEntry: number): void => {
            pushUniqSwitchCase(this.handlers, {
                type: "SwitchCase",
                test: { type: "Literal", value: branchEntry },
                consequent: [
                    scopeDeclaration,
                    {
                        type: "ExpressionStatement",
                        expression: {
                            type: "AssignmentExpression",
                            operator: "=",
                            left: exceptionReference,
                            right: { type: "Identifier", name: "e" }
                        }
                    },
                    stateAssignment(catchEntry),
                    {
                        type: "BreakStatement"
                    }
                ]
            });
        };
        this.emitter.on("branch", createHandler);
        this.transformBlock(requiredChild(node, "block"), entry, exit);
        this.emitter.removeListener("branch", createHandler);
        
        this.transformBlock(requiredChild(handler, "body"), catchEntry, exit);
    }
    
    /**
     * Transform duplicate scope and arguments into single unified declarations
     * @params {Node} ast Root node
     * @returns {Node}
     */
    unifyPrefixStatements (ast: AstNode): AstNode {
        const scopeObjects = new Map<string, ScopeObjectInfo>();
        let maximumScopeIndex = 0;

        function ensureScopeObject(name: string): ScopeObjectInfo {
            let info = scopeObjects.get(name);
            if (!info) {
                info = {
                    max: -1,
                    offset: 0
                };
                scopeObjects.set(name, info);
            }
            return info;
        }

        traverser.traverse(ast, [], (node: AstNode) => {
            if (nodeFlag(node, "toildefender$scopeObject")) {
                const declaration = nodeDeclarations(node)[0];
                const name = nodeName(childNode(declaration, "id"));
                if (name) {
                    ensureScopeObject(name);
                }
            } else if (nodeFlag(node, "toildefender$scopeObjectReference")) {
                const name = memberScopeName(node);
                if (name) {
                    const property = requiredChild(node, "property");
                    const value = nodeValue(property);
                    if (typeof value == "number") {
                        ensureScopeObject(name).max = Math.max(ensureScopeObject(name).max, value);
                    }
                }
            }
            return node;
        });

        if (scopeObjects.size > 1) {
            return ast;
        }

        let nextScopeOffset = 0;
        scopeObjects.forEach((info: ScopeObjectInfo) => {
            info.offset = nextScopeOffset;
            nextScopeOffset += info.max + 1;
        });
        
        ast = traverser.traverse(ast, [], (node: AstNode, stack: AstStackFrame[]) => {
            if (nodeFlag(node, "toildefender$reassigningArguments") && !nodeFlag(node, "toildefender$followsSlicingArguments")) {
                node = { type: "EmptyStatement" };
            } else if (nodeFlag(node, "toildefender$scopeObject")) {
                node = { type: "EmptyStatement" };
            } else if (nodeFlag(node, "toildefender$scopeObjectReference")) {
                const name = memberScopeName(node);
                const info = name ? scopeObjects.get(name) : null;
                const property = childNode(node, "property");
                const value = nodeValue(property);
                if (info && property && typeof value == "number") {
                    const shifted = value + info.offset;
                    setNodeValue(property, shifted);
                    maximumScopeIndex = Math.max(maximumScopeIndex, shifted);
                }
                const object = childNode(node, "object");
                if (object?.type == "Identifier") {
                    setNodeName(object, "$$unifiedScope");
                }
            } else if (node.type == "Identifier" && (nodeName(node) || "").startsWith("$$scope")) {
                const parent = stack[1]?.node;
                if (parent && nodeFlag(parent, "toildefender$scopeObjectReference")) {
                    return node;
                }
                setNodeName(node, "$$unifiedScope");
            }
            return node;
        });

        const programBody = bodyArray(ast);
        const first = programBody[0];
        if (!first) {
            return ast;
        }
        const firstBody = childNode(first, "body");
        if (!firstBody) {
            return ast;
        }
        mutableBody(firstBody).splice(0, 0,
            {
                type: "ExpressionStatement",
                expression: {
                    type: "VariableDeclaration",
                    kind: "var",
                    declarations: [
                        {
                            type: "VariableDeclarator",
                            id: { type: "Identifier", name: "$$unifiedScope" },
                            init: {
                                type: "NewExpression",
                                callee: { type: "Identifier", name: "Array" },
                                arguments: [
                                    { type: "Literal", value: maximumScopeIndex }
                                ]
                            }
                        }
                    ]
                }
            },
            {
                type: "VariableDeclaration",
                kind: "var",
                declarations: [
                    {
                        type: "VariableDeclarator",
                        id: { type: "Identifier", name: "toildefender$arguments" },
                        init: { type: "Identifier", name: "arguments" }
                    }
                ]
            }
        );
        
        return ast;
    }
}
