import assert from "assert";
import events from "events";
import _ from "lodash";
import estest from "../estest.js";
import traverser from "../traverser.js";
import utils from "../utils.js";
import type { Loose } from "../types.js";

/**
 * Push a SwitchCase onto an array while removing all identical SwitchCases
 * @param {SwitchCase[]} arr
 * @param {SwitchCase} elem
 */
function pushUniqSwitchCase(arr: Loose, elem: Loose) {
    _.remove(arr, (x: Loose) => x.test.value == elem.test.value);
    arr.push(elem);
}

/**
 * Shuffle SwitchCase statements while respecting fall troughs.
 * @param entries {SwitchCase[]} Array of the unshuffled cases
 * @returns {SwitchCase[]} New array of the shuffled cases
 */
function shuffleSwitchCases(entries: Loose) {
    let groups: Loose[] = [], stack: Loose[] = [];
    function clearStack() {
        if (stack.length > 0) {
            groups.push(stack);
            stack = [];
        }
    }
    entries.forEach((entry: Loose) => {
        const breaks = entry.consequent.some((x: Loose) => x.type == "BreakStatement");
        if (breaks) {
            clearStack();
            groups.push([ entry ]);
        } else {
            stack.push(entry);
        }
    });
    clearStack();
    return Array.prototype.concat.apply([], _.shuffle(groups));
}

/**
 * Merge nested BlockStatements (BlockStatements containing other BlockStatements)
 * @param {BlockStatement} node Root BlockStatement
 * @returns {BlockStatement} Merged BlockStatement
 */
function mergeNestedBlocks(node: Loose) {
    assert(estest.isNode(node));
    
    function getBlockBodys(node: Loose) {
        if (node.type == "Program" || node.type == "BlockStatement") {
            const stmts: Loose[] = [];
            node.body.forEach((stmt: Loose) => utils.push(stmts, getBlockBodys(stmt)));
            return stmts;
        } else {
            return [ node ];
        }
    }
    
    return {
        type: node.type,
        body: getBlockBodys(node)
    };
}

/**
 * Split array of statements into array of compound statements and BlockStatements containing an array of non-compound statements
 * @param {Node[]} nodes Array of statements
 * @returns {Statement[]} Array of Statements
 */
function splitBlocks(nodes: Loose) {
    let stack: Loose[] = [], output: Loose[] = [];
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

export default class Flattener {
    logger: Loose;
    rng: Loose;
    emitter: Loose;
    output: Loose;
    handlers: Loose;
    breaks: Loose;
    continues: Loose;

    constructor (logger: Loose, rng: Loose) {
        this.logger = logger;
        this.rng = rng;
        this.emitter = new events.EventEmitter();
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
    addMethod (input: Loose, entry: Loose, exit: Loose) {
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
    getCases (entry: Loose, exit: Loose) {
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
    getProgram (entry: Loose, exit: Loose, options: Loose) {
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");

        options = options || {};
        const name = options.name || "main";
        const invoke = options.invoke !== false;
        
        let body: Loose[];
        body = [
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
    transformStatement (node: Loose, entry: Loose, exit: Loose) {
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
                if (node.handler && !node.finalizer) {
                    this.transformTryCatch(node, entry, exit);
                } else {
                    throw new Error("Not normalized");
                }
                break;
            }
            case "EmptyStatement": {
                // Empty
                break;
            }
            default: {
                this.logger.warn("Unsupported type " + node.type);
                // This might be not the most elegant solution (TODO?)
                // This caused an infinite loop when SwitchStatement was not handled separately
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
    transformBlock (node: Loose, entry: Loose, exit: Loose) {
        assert.ok(node.type == "Program" || node.type == "BlockStatement");
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");
        
        assert(node.type == "Program" || node.type == "BlockStatement");
        
        node = mergeNestedBlocks(node);
        let blocks;
        blocks = splitBlocks(node.body);

        for (let i = 0; i < blocks.length; ++i) {
            if (blocks[i].type == "LabeledStatement") {
                blocks[i].body.label = blocks[i].label;
                blocks[i] = blocks[i].body;
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
    transformSequence (node: Loose, entry: Loose, exit: Loose) {
        assert.equal(node.type, "BlockStatement");
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");
        
        const stmts: Loose[] = [];
        
        const aborted = !node.body.every((stmt: Loose) => {
            assert(estest.isStatement(stmt), stmt.type + " is not a statement");
            
            switch (stmt.type) {
                case "BreakStatement": {
                    let break_;
                    if (stmt.label) {
                        break_ = _.find(this.breaks, (x: Loose) => x.label.name == stmt.label.name);
                    } else {
                        break_ = _.last(this.breaks);
                    }
                    assert(break_ && break_.id, "No break target");
                    
                    stmts.push({
                        type: "ExpressionStatement",
                        expression: {
                            type: "AssignmentExpression",
                            operator: "=",
                            left: { type: "Identifier", name: "state" },
                            right: { type: "Literal", value: break_.id }
                        }
                    });
                    stmts.push({
                        type: "BreakStatement"
                    });
                    
                    return false;
                }
                case "ContinueStatement": {
                    let continue_;
                    if (stmt.label) {
                        continue_ = _.find(this.continues, (x: Loose) => x.label.name == stmt.label.name);
                    } else {
                        continue_ = _.last(this.continues);
                    }
                    assert(continue_ && continue_.id, "No continue target");
                    
                    stmts.push({
                        type: "ExpressionStatement",
                        expression: {
                            type: "AssignmentExpression",
                            operator: "=",
                            left: { type: "Identifier", name: "state" },
                            right: { type: "Literal", value: continue_.id }
                        }
                    });
                    stmts.push({
                        type: "BreakStatement"
                    });
                    
                    return false;
                }
                case "ReturnStatement": {
                    stmts.push(stmt);
                    
                    return false;
                }
                case "EmptyStatement": {
                    // Empty
                    
                    return true;
                }
                default: {
                    stmts.push(stmt);
                    
                    return true;
                }
            }
        });
        
        if (!aborted) {
            stmts.push({
                type: "ExpressionStatement",
                expression: {
                    type: "AssignmentExpression",
                    operator: "=",
                    left: { type: "Identifier", name: "state" },
                    right: { type: "Literal", value: exit }
                }
            });
            stmts.push({
                type: "BreakStatement"
            });
        }
        
        this.output.push({
            type: "SwitchCase",
            test: { type: "Literal", value: entry },
            consequent: stmts
        });
        this.emitter.emit("branch", entry);
    }
    
    /**
     * Import IfStatement into control flow table
     * @param {IfStatement} node
     * @param {number} entry Entry point
     * @param {number} exit Exit point
     */
    transformIf (node: Loose, entry: Loose, exit: Loose) {
        assert.equal(node.type, "IfStatement");
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");
        
        const thenEntry = this.rng.get();
        const elseEntry = node.alternate ? this.rng.get() : exit;
        this.output.push({
            type: "SwitchCase",
            test: { type: "Literal", value: entry },
            consequent: [
                {
                    type: "ExpressionStatement",
                    expression: {
                        type: "AssignmentExpression",
                        operator: "=",
                        left: { type: "Identifier", name: "state" },
                        right: {
                            type: "ConditionalExpression",
                            test: node.test,
                            consequent:  { type: "Literal", value: thenEntry },
                            alternate: { type: "Literal", value: elseEntry }
                        }
                    }
                },
                {
                    type: "BreakStatement"
                }
            ]
        });
        this.emitter.emit("branch", entry);
        this.transformStatement(node.consequent, thenEntry, exit);
        if (node.alternate) {
            this.transformStatement(node.alternate, elseEntry, exit);
        }
    }
    
    /**
     * Import WhileStatement into control flow table
     * @param {WhileStatement} node
     * @param {number} entry Entry point
     * @param {number} exit Exit point
     */
    transformWhile (node: Loose, entry: Loose, exit: Loose) {
        assert.equal(node.type, "WhileStatement");
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");
        
        const bodyEntry = this.rng.get();
        this.output.push({
            type: "SwitchCase",
            test: { type: "Literal", value: entry },
            consequent: [
                {
                    type: "ExpressionStatement",
                    expression: {
                        type: "AssignmentExpression",
                        operator: "=",
                        left: { type: "Identifier", name: "state" },
                        right: {
                            type: "ConditionalExpression",
                            test: node.test,
                            consequent:  { type: "Literal", value: bodyEntry },
                            alternate: { type: "Literal", value: exit }
                        }
                    }
                },
                {
                    type: "BreakStatement"
                }
            ]
        });
        this.emitter.emit("branch", entry);
        
        this.breaks.push({
            label: node.label && node.label.name,
            id: exit
        });
        this.continues.push({
            label: node.label && node.label.name,
            id: entry
        });
        this.transformBlock(node.body, bodyEntry, entry);
        this.breaks.pop();
        this.continues.pop();
    }
    
    /**
     * Import DoWhileStatement into control flow table
     * @param {DoWhileStatement} node
     * @param {number} entry Entry point
     * @param {number} exit Exit point
     */
    transformDoWhile (node: Loose, entry: Loose, exit: Loose) {
        assert.equal(node.type, "DoWhileStatement");
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");
        
        const testEntry = this.rng.get();
        this.output.push({
            type: "SwitchCase",
            test: { type: "Literal", value: testEntry },
            consequent: [
                {
                    type: "ExpressionStatement",
                    expression: {
                        type: "AssignmentExpression",
                        operator: "=",
                        left: { type: "Identifier", name: "state" },
                        right: {
                            type: "ConditionalExpression",
                            test: node.test,
                            consequent:  { type: "Literal", value: entry },
                            alternate: { type: "Literal", value: exit }
                        }
                    }
                },
                {
                    type: "BreakStatement"
                }
            ]
        });
        this.emitter.emit("branch", testEntry);
        
        this.breaks.push({
            label: node.label && node.label.name,
            id: exit
        });
        this.continues.push({
            label: node.label && node.label.name,
            id: entry
        });
        this.transformBlock(node.body, entry, testEntry);
        this.breaks.pop();
        this.continues.pop();
    }
    
    /**
     * Import SwitchStatement into control flow table
     * @param {SwitchStatement} node
     * @param {number} entry Entry point
     * @param {number} exit Exit point
     */
    transformSwitch (node: Loose, entry: Loose, exit: Loose) {
        assert.equal(node.type, "SwitchStatement");
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");
        
        const comps: Loose[] = [];
        
        this.breaks.push({
            label: null,
            id: exit
        });
        let nextCaseEntry = this.rng.get();
        node.cases.forEach((switchCase: Loose) => {
            const isLast = switchCase == _.last(node.cases);
            
            const caseEntry = nextCaseEntry;
            nextCaseEntry = this.rng.get();
            
            /**
             * What happens if there are empty BlockStatements elsewhere? Does it hang?
             */
            
            if (switchCase.consequent.length > 0) {
                this.transformBlock({
                    type: "BlockStatement",
                    body: switchCase.consequent
                }, caseEntry, isLast ? exit : nextCaseEntry);
            } else {
                nextCaseEntry = caseEntry;
            }
            
            if (switchCase.test) {
                comps.push({
                    type: "IfStatement",
                    test: {
                        type: "BinaryExpression",
                        operator: "==",
                        left: utils.cloneISwearIKnowWhatImDoing(node.discriminant),
                        right: switchCase.test
                    },
                    consequent: {
                        type: "BlockStatement",
                        body: [
                            {
                                type: "ExpressionStatement",
                                expression: {
                                    type: "AssignmentExpression",
                                    operator: "=",
                                    left: { type: "Identifier", name: "state" },
                                    right: { type: "Literal", value: caseEntry }
                                }
                            },
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
                        {
                            type: "ExpressionStatement",
                            expression: {
                                type: "AssignmentExpression",
                                operator: "=",
                                left: { type: "Identifier", name: "state" },
                                right: { type: "Literal", value: caseEntry }
                            }
                        },
                        {
                            type: "BreakStatement"
                        }
                    ]
                });
            }
        });
        this.breaks.pop();
            
        this.output.push({
            type: "SwitchCase",
            test: { type: "Literal", value: entry },
            consequent: comps
        });
    }
    
    /**
     * Import TryStatement into control flow table
     * @param {TryStatement} node
     * @param {number} entry Entry point
     * @param {number} exit Exit point
     */
    transformTryCatch (node: Loose, entry: Loose, exit: Loose) {
        assert.equal(node.type, "TryStatement");
        assert.equal(typeof entry, "number");
        assert.equal(typeof exit, "number");
        assert.ok(node.handler);
        assert.ok(!node.finalizer);
        
        const catchEntry = this.rng.get();
        
        if (node.handler) {
            var scopeDef = node.handler.body.body.splice(0, 2);
            assert(
                scopeDef[0].type == "VariableDeclaration" &&
                scopeDef[0].declarations.length == 1 &&
                scopeDef[0].declarations[0].id.name.indexOf("$$scope") == 0,
                "First element of node.handler.body isn't a VariableDeclaration of a scope object");
            assert(
                scopeDef[1].type == "ExpressionStatement" &&
                scopeDef[1].expression.type == "AssignmentExpression" &&
                scopeDef[1].expression.left.type == "MemberExpression" &&
                scopeDef[1].expression.left.object.name.indexOf("$$scope") == 0 &&
                scopeDef[1].expression.right.name.indexOf("$$var") == 0,
                "Second element of node.handler.body is not a e assignment");
        }
        const createHandler = (entry: Loose) => {
            if (node.handler) {
                pushUniqSwitchCase(this.handlers, {
                    type: "SwitchCase",
                    test: { type: "Literal", value: entry },
                    consequent: [
                        scopeDef[0],
                        {
                            type: "ExpressionStatement",
                            expression: {
                                type: "AssignmentExpression",
                                operator: "=",
                                left: node.handler.toildefender$exception,
                                right: { type: "Identifier", name: "e" }
                            }
                        },
                        {
                            type: "ExpressionStatement",
                            expression: {
                                type: "AssignmentExpression",
                                operator: "=",
                                left: { type: "Identifier", name: "state" },
                                right: { type: "Literal", value: catchEntry }
                            }
                        },
                        {
                            type: "BreakStatement"
                        }
                    ]
                });
            }
        };
        this.emitter.on("branch", createHandler);
        this.transformBlock(node.block, entry, exit);
        this.emitter.removeListener("branch", createHandler);
        
        if (node.handler) {
            this.transformBlock(node.handler.body, catchEntry, exit);
        }
    }
    
    /**
     * Transform duplicate scope and arguments into single unified declarations
     * @params {Node} ast Root node
     * @returns {Node}
     */
    unifyPrefixStatements (ast: Loose) {
        const scopeObjects = new Map();
        let maximumScopeIndex = 0;

        function scopeNameFromReference(node: Loose) {
            if (
                node &&
                node.type == "MemberExpression" &&
                node.object &&
                node.object.type == "Identifier" &&
                _.startsWith(node.object.name, "$$scope") &&
                node.property &&
                node.property.type == "Literal" &&
                typeof node.property.value == "number"
            ) {
                return node.object.name;
            }
            return null;
        }

        function ensureScopeObject(name: Loose) {
            if (!scopeObjects.has(name)) {
                scopeObjects.set(name, {
                    max: -1,
                    offset: 0
                });
            }
            return scopeObjects.get(name);
        }

        traverser.traverse(ast, [], (node: Loose, stack: Loose) => {
            if (node.toildefender$scopeObject) {
                const declaration = node.declarations && node.declarations[0];
                if (declaration && declaration.id && declaration.id.type == "Identifier") {
                    ensureScopeObject(declaration.id.name);
                }
            } else if (node.toildefender$scopeObjectReference) {
                const name = scopeNameFromReference(node);
                if (name) {
                    const info = ensureScopeObject(name);
                    info.max = Math.max(info.max, node.property.value);
                }
            }
            return node;
        });

        if (scopeObjects.size > 1) {
            return ast;
        }

        let nextScopeOffset = 0;
        scopeObjects.forEach((info: Loose) => {
            info.offset = nextScopeOffset;
            nextScopeOffset += info.max + 1;
        });
        
        ast = traverser.traverse(ast, [], (node: Loose, stack: Loose) => {
            if (node.toildefender$reassigningArguments && !node.toildefender$followsSlicingArguments) {
                node = { type: "EmptyStatement" };
            } else if (node.toildefender$scopeObject) {
                node = { type: "EmptyStatement" };
            } else if (node.toildefender$scopeObjectReference) {
                const name = scopeNameFromReference(node);
                const info = name ? scopeObjects.get(name) : null;
                if (info) {
                    node.property.value += info.offset;
                    maximumScopeIndex = Math.max(maximumScopeIndex, node.property.value);
                }
                if (node.object && node.object.type == "Identifier") {
                    node.object.name = "$$unifiedScope";
                }
            } else if (node.type == "Identifier" && _.startsWith(node.name, "$$scope")) {
                const parent = stack[1] && stack[1].node;
                if (parent && parent.toildefender$scopeObjectReference) {
                    return node;
                }
                node.name = "$$unifiedScope";
            }
            return node;
        });
        
        ast.body[0].body.body.splice(0, 0,
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
    
};
