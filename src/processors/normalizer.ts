import assert from "assert";
import _ from "lodash";
import utils from "../utils.js";
import traverser from "../traverser.js";
import estest from "../estest.js";
import type { Loose } from "../types.js";

/**
 * Chain an array of expressions with an operator.
 * @param {Expression[]} expressions
 * @param {BinaryOperator} operator
 * @returns {Expression}
 */
function chain (expressions: Loose, operator: Loose) {
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
                right: expressions[1]
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
function blockToArray (node: Loose) {
    assert.ok(estest.isNode(node));
    
    if (Array.isArray(node.body)) {
        return node.body;
    } else if (node.body) {
        return [ node.body ];
    } else {
        return [ node ];
    }
}

function hasSpreadElement(nodes: Loose) {
    return nodes.some((node: Loose) => node && node.type == "SpreadElement");
}

function isSimpleThisReceiver(node: Loose) {
    return node.type == "Identifier" || node.type == "ThisExpression";
}

function buildArrayConcat(parts: Loose) {
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

function spreadArgumentsToArray(args: Loose) {
    const parts: Loose[] = [];
    let pending: Loose[] = [];

    function flushPending() {
        if (pending.length > 0) {
            parts.push({ type: "ArrayExpression", elements: pending });
            pending = [];
        }
    }

    args.forEach((arg: Loose) => {
        if (arg.type == "SpreadElement") {
            flushPending();
            parts.push(arg.argument);
        } else {
            pending.push(arg);
        }
    });
    flushPending();

    return buildArrayConcat(parts);
}

function isLoopOrSwitch(node: Loose) {
    return node.type == "WhileStatement"
        || node.type == "DoWhileStatement"
        || node.type == "ForStatement"
        || node.type == "ForInStatement"
        || node.type == "ForOfStatement"
        || node.type == "SwitchStatement";
}

function exitsCurrentTry(node: Loose, stack: Loose) {
    if (node.type == "ReturnStatement") {
        return true;
    }

    if (node.type == "BreakStatement" || node.type == "ContinueStatement") {
        return !stack.some((frame: Loose) => isLoopOrSwitch(frame.node));
    }

    return false;
}

function withFinalizerBefore(node: Loose, finalizer: Loose) {
    const body: Loose[] = [];

    if (node.type == "ReturnStatement") {
        body.push({
            type: "VariableDeclaration",
            kind: "var",
            declarations: [
                {
                    type: "VariableDeclarator",
                    id: { type: "Identifier", name: "toildefender$return" },
                    init: node.argument
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

function methodDefinitionName(method: Loose) {
    if (!method || !method.key) {
        return "";
    }
    if (method.key.type == "Identifier") {
        return method.key.name;
    }
    if (method.key.type == "Literal") {
        return String(method.key.value);
    }
    return "";
}

function isConstructorMethod(method: Loose) {
    return method.type == "MethodDefinition" && method.kind == "constructor" && methodDefinitionName(method) == "constructor";
}

function privateStoreName(className: Loose, privateName: Loose) {
    return `$$private$${className}$${privateName}`;
}

function classFieldKey(field: Loose) {
    if (field.key.type == "Identifier") {
        return {
            type: "Identifier",
            name: field.key.name
        };
    }
    if (field.key.type == "PrivateIdentifier") {
        return {
            type: "Literal",
            value: field.key.name
        };
    }
    return field.key;
}

function assignmentStatement(left: Loose, right: Loose) {
    return {
        type: "ExpressionStatement",
        expression: {
            type: "AssignmentExpression",
            operator: "=",
            left: left,
            right: right || { type: "Identifier", name: "undefined" }
        }
    };
}

function weakMapSetStatement(storeName: Loose, object: Loose, value: Loose) {
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
                value || { type: "Identifier", name: "undefined" }
            ]
        }
    };
}

function weakMapGetExpression(storeName: Loose, object: Loose) {
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

function undefinedExpression() {
    return { type: "Identifier", name: "undefined" };
}

function nullishTest(expression: Loose) {
    return {
        type: "BinaryExpression",
        operator: "==",
        left: expression,
        right: { type: "Literal", value: null }
    };
}

function notNullishTest(expression: Loose) {
    return {
        type: "BinaryExpression",
        operator: "!=",
        left: expression,
        right: { type: "Literal", value: null }
    };
}

function propertyKeyValue(property: Loose) {
    if (property.key.type == "Identifier") {
        return property.key.name;
    }
    if (property.key.type == "Literal") {
        return property.key.value;
    }
    return null;
}

function propertyMemberExpression(object: Loose, property: Loose) {
    return {
        type: "MemberExpression",
        object: object,
        property: property.key.type == "Identifier"
            ? { type: "Identifier", name: property.key.name }
            : utils.cloneISwearIKnowWhatImDoing(property.key),
        computed: property.computed === true || property.key.type == "Literal"
    };
}

function hasObjectRest(pattern: Loose) {
    return pattern.type == "ObjectPattern" && pattern.properties.some((prop: Loose) => prop.type == "RestElement");
}

function hasObjectPattern(pattern: Loose) {
    return pattern.type == "ObjectPattern";
}

function hasArrayPattern(pattern: Loose) {
    return pattern.type == "ArrayPattern";
}

function canLowerArrayPattern(pattern: Loose) {
    return pattern.type == "ArrayPattern" && pattern.elements.every((element: Loose) => {
        if (element == null) {
            return true;
        }
        if (element.type == "Identifier") {
            return true;
        }
        if (element.type == "RestElement") {
            return element.argument.type == "Identifier";
        }
        return element.type == "AssignmentPattern" && element.left.type == "Identifier";
    });
}

function canLowerObjectRest(pattern: Loose) {
    return pattern.type == "ObjectPattern" && pattern.properties.every((prop: Loose) => {
        if (prop.type == "RestElement") {
            return prop.argument.type == "Identifier";
        }
        if (prop.type != "Property" || prop.computed === true || propertyKeyValue(prop) == null) {
            return false;
        }
        if (prop.value.type == "Identifier") {
            return true;
        }
        return prop.value.type == "AssignmentPattern" && prop.value.left.type == "Identifier";
    });
}

function hasObjectSpread(node: Loose) {
    return node.properties.some((prop: Loose) => prop.type == "SpreadElement");
}

function objectAssignCall(parts: Loose) {
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

function objectWithoutKeysCall(source: Loose, keys: Loose) {
    return {
        type: "CallExpression",
        callee: { type: "Identifier", name: "toildefender$objectWithoutKeys" },
        arguments: [
            source,
            {
                type: "ArrayExpression",
                elements: keys.map((key: Loose) => ({ type: "Literal", value: key }))
            }
        ]
    };
}

function arrayElementExpression(sourceName: Loose, index: Loose) {
    return {
        type: "MemberExpression",
        object: { type: "Identifier", name: sourceName },
        property: { type: "Literal", value: index },
        computed: true
    };
}

function arrayRestExpression(sourceName: Loose, index: Loose) {
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

function arrayPatternElementDeclaration(kind: Loose, sourceName: Loose, element: Loose, index: Loose) {
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
                    id: element.argument,
                    init: arrayRestExpression(sourceName, index)
                }
            ]
        };
    }

    let id = element;
    let init;
    init = arrayElementExpression(sourceName, index);
    if (element.type == "AssignmentPattern") {
        id = element.left;
        init = {
            type: "ConditionalExpression",
            test: {
                type: "BinaryExpression",
                operator: "===",
                left: arrayElementExpression(sourceName, index),
                right: { type: "Identifier", name: "undefined" }
            },
            consequent: element.right,
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

function arrayPatternStatements(kind: Loose, pattern: Loose, init: Loose, rngAlpha: Loose) {
    const sourceName = `$$destructure$arr$${rngAlpha.get()}`;
    let statements;
    statements = [
        {
            type: "VariableDeclaration",
            kind: "var",
            declarations: [
                {
                    type: "VariableDeclarator",
                    id: { type: "Identifier", name: sourceName },
                    init: init || { type: "ArrayExpression", elements: [] }
                }
            ]
        }
    ];

    pattern.elements.forEach((element: Loose, index: Loose) => {
        const lowered = arrayPatternElementDeclaration(kind, sourceName, element, index);
        if (lowered) {
            statements.push(lowered);
        }
    });

    return statements;
}

function arrayPatternAssignmentStatement(sourceName: Loose, element: Loose, index: Loose) {
    if (element == null) {
        return null;
    }

    let left;
    let right;
    if (element.type == "RestElement") {
        left = element.argument;
        right = arrayRestExpression(sourceName, index);
    } else if (element.type == "AssignmentPattern") {
        left = element.left;
        right = {
            type: "ConditionalExpression",
            test: {
                type: "BinaryExpression",
                operator: "===",
                left: arrayElementExpression(sourceName, index),
                right: { type: "Identifier", name: "undefined" }
            },
            consequent: element.right,
            alternate: arrayElementExpression(sourceName, index)
        };
    } else {
        left = element;
        right = arrayElementExpression(sourceName, index);
    }

    return assignmentStatement(left, right);
}

function arrayPatternAssignmentStatements(pattern: Loose, init: Loose, rngAlpha: Loose) {
    const sourceName = `$$destructure$arr$${rngAlpha.get()}`;
    let statements: Loose[];
    statements = [
        {
            type: "VariableDeclaration",
            kind: "var",
            declarations: [
                {
                    type: "VariableDeclarator",
                    id: { type: "Identifier", name: sourceName },
                    init: init || { type: "ArrayExpression", elements: [] }
                }
            ]
        }
    ];

    pattern.elements.forEach((element: Loose, index: Loose) => {
        const lowered = arrayPatternAssignmentStatement(sourceName, element, index);
        if (lowered) {
            statements.push(lowered);
        }
    });

    return statements;
}

function objectPatternPropertyDeclaration(kind: Loose, sourceName: Loose, prop: Loose) {
    const member = propertyMemberExpression(
        { type: "Identifier", name: sourceName },
        prop
    );
    let id = prop.value;
    let init;
    init = member;

    if (prop.value.type == "AssignmentPattern") {
        id = prop.value.left;
        init = {
            type: "ConditionalExpression",
            test: {
                type: "BinaryExpression",
                operator: "===",
                left: utils.cloneISwearIKnowWhatImDoing(member),
                right: undefinedExpression()
            },
            consequent: prop.value.right,
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

function containsThisExpression(node: Loose) {
    let found = false;
    traverser.traverseEx(node, [], function (this: { abort(): void }, child: Loose) {
        if (child.type == "ThisExpression") {
            found = true;
            this.abort();
        }
        return child;
    });
    return found;
}

function defaultParameterStatement(param: Loose) {
    return {
        type: "IfStatement",
        test: {
            type: "BinaryExpression",
            operator: "===",
            left: utils.cloneISwearIKnowWhatImDoing(param.left),
            right: { type: "Identifier", name: "undefined" }
        },
        consequent: {
            type: "BlockStatement",
            body: [
                {
                    type: "ExpressionStatement",
                    expression: {
                        type: "AssignmentExpression",
                        operator: "=",
                        left: utils.cloneISwearIKnowWhatImDoing(param.left),
                        right: param.right
                    }
                }
            ]
        }
    };
}

function restParameterStatement(param: Loose, index: Loose) {
    return {
        type: "VariableDeclaration",
        kind: "var",
        declarations: [
            {
                type: "VariableDeclarator",
                id: param.argument,
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

function lowerFunctionParameters(node: Loose) {
    if (!estest.isFunction(node) || !Array.isArray(node.params)) {
        return node;
    }

    const prefix: Loose[] = [];
    const params: Loose[] = [];
    node.params.forEach((param: Loose, index: Loose) => {
        if (param.type == "AssignmentPattern" && param.left.type == "Identifier") {
            prefix.push(defaultParameterStatement(param));
            params.push(param.left);
            return;
        }
        if (param.type == "RestElement" && param.argument.type == "Identifier") {
            prefix.push(restParameterStatement(param, index));
            return;
        }
        params.push(param);
    });
    node.params = params;

    if (prefix.length == 0) {
        return node;
    }

    if (node.body.type != "BlockStatement") {
        node.body = {
            type: "BlockStatement",
            body: [
                {
                    type: "ReturnStatement",
                    argument: node.body
                }
            ]
        };
    }
    node.body.body = prefix.concat(node.body.body);
    return node;
}

function blockNeedsLexicalScope(node: Loose) {
    if (node.type != "BlockStatement") {
        return false;
    }

    let needsScope = false;
    traverser.traverseEx(node, [], function (this: { abort(): void }, child: Loose) {
        if (child != node && estest.isFunction(child)) {
            return child;
        }
        if (
            (child.type == "VariableDeclaration" && child.kind != "var")
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
    logger: Loose;
    rngAlpha: Loose;

    constructor (logger: Loose) {
        this.logger = logger;
        this.rngAlpha = new utils.UniqueRandomAlpha(3);
    }

    /**
     * Simplify AST.
     * @param {Node} ast Root node
     * @returns {Node}
     */
    simplify (ast: Loose) {
        assert.ok(estest.isNode(ast));
        
        return traverser.traverse(ast, [], (node: Loose, stack: Loose) => {
            switch (node.type) {
                case "Program":
                case "BlockStatement":
                    return this.simplifyBlockStatement(node);
                /*case "WhileStatement":
                    return this.simplifyWhileStatement(node);*/
                /*case "DoWhileStatement":
                    return this.simplifyDoWhileStatement(node);*/
                case "ForStatement":
                    return this.simplifyForStatement(node);
                case "ForInStatement":
                    return this.simplifyForStatement(this.simplifyForInStatement(node));
                case "ForOfStatement":
                    return this.simplifyForOfStatement(node);
                /*case "SwitchStatement":
                    return this.simplifySwitchStatement(node);*/
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
    simplifyBlockStatement (node: Loose) {
        assert.ok(estest.isNode(node));
    
        function getBlockBodys(node: Loose, isRoot: Loose) {
            if (node.type == "Program" || node.type == "BlockStatement") {
                if (!isRoot && blockNeedsLexicalScope(node)) {
                    return [ node ];
                }
                const stmts: Loose[] = [];
                node.body.forEach((stmt: Loose) => utils.push(stmts, getBlockBodys(stmt, false)));
                return stmts;
            } else {
                return [ node ];
            }
        }
        
        return {
            type: node.type,
            body: getBlockBodys(node, true)
        };
    }

    /**
     * Simplify WhileStatement.
     * @param {WhileStatement} node
     * @return {Node}
     */
    simplifyWhileStatement (node: Loose) {
        assert.ok(estest.isNode(node));
        
        return {
            type: "WhileStatement",
            test: { type: "Literal", value: true },
            body: {
                type: "IfStatement",
                test: node.test,
                consequent: node.body,
                alternate: { type: "BreakStatement" }
            }
        };
    }

    /**
     * Simplify DoWhileStatement.
     * @param {DoWhileStatement} node
     * @return {Node}
     */
    simplifyDoWhileStatement (node: Loose) {
        assert.ok(estest.isNode(node));
        
        return {
            type: "WhileStatement",
            test: { type: "Literal", value: true },
            body: {
                type: "BlockStatement",
                body: [
                    node.body,
                    {
                        type: "IfStatement",
                        test: node.test,
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
    simplifyForStatement (node: Loose) {
        assert.ok(estest.isNode(node));
        
        const body: Loose[] = [];
        if (node.init) {
            if (estest.isStatement(node.init)) {
                body.push(node.init);
            } else if (estest.isExpression(node.init)) {
                body.push({
                    type: "ExpressionStatement",
                    expression: node.init
                });
            } else {
                throw new Error("Invalid node.init type " + node.init.type);
            }
        }
        body.push({
            type: "WhileStatement",
            test: node.test,
            body: {
                type: "BlockStatement",
                body: blockToArray(node.body).concat(node.update ? [
                    {
                        type: "ExpressionStatement",
                        expression: node.update
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
    simplifyForInStatement (node: Loose) {
        assert.ok(estest.isNode(node));
        
        const propsName = `$$forin$props$${this.rngAlpha.get()}`, iterName = `$$forin$iter$${this.rngAlpha.get()}`;
        const valueAtIndex = {
            type: "MemberExpression",
            object: { type: "Identifier", name: propsName },
            property: { type: "Identifier", name: iterName },
            computed: true
        };
        let assignStatements;
        if (node.left.type == "VariableDeclaration") {
            const declaration = node.left.declarations[0];
            if (hasArrayPattern(declaration.id) && canLowerArrayPattern(declaration.id)) {
                assignStatements = arrayPatternStatements(
                    node.left.kind == "const" ? "let" : node.left.kind,
                    declaration.id,
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
                                id: declaration.id,
                                init: valueAtIndex
                            }
                        ]
                    }
                ];
            }
        } else if (hasArrayPattern(node.left) && canLowerArrayPattern(node.left)) {
            assignStatements = arrayPatternAssignmentStatements(
                node.left,
                valueAtIndex,
                this.rngAlpha
            );
        } else {
            assignStatements = [
                {
                    type: "ExpressionStatement",
                    expression: {
                        type: "AssignmentExpression",
                        operator: "=",
                        left: node.left,
                        right: valueAtIndex
                    }
                }
            ];
        }
        
        const forStmt = {
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
                                node.right
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
                body: assignStatements.concat([node.body])
            }
        };
        return forStmt;
    }

    /**
     * Simplify ForOfStatement to an index-based ForStatement.
     * @param {ForOfStatement} node
     * @return {Node}
     */
    simplifyForOfStatement (node: Loose) {
        assert.ok(estest.isNode(node));

        const valuesName = `$$forof$values$${this.rngAlpha.get()}`, iterName = `$$forof$iter$${this.rngAlpha.get()}`;
        const valueAtIndex = {
            type: "MemberExpression",
            object: { type: "Identifier", name: valuesName },
            property: { type: "Identifier", name: iterName },
            computed: true
        };
        let assignStatements;
        if (node.left.type == "VariableDeclaration") {
            const declaration = node.left.declarations[0];
            if (hasArrayPattern(declaration.id) && canLowerArrayPattern(declaration.id)) {
                assignStatements = arrayPatternStatements(
                    node.left.kind == "const" ? "let" : node.left.kind,
                    declaration.id,
                    valueAtIndex,
                    this.rngAlpha
                );
            } else {
                assignStatements = [
                    {
                        type: "VariableDeclaration",
                        kind: node.left.kind == "const" ? "let" : node.left.kind,
                        declarations: [
                            {
                                type: "VariableDeclarator",
                                id: declaration.id,
                                init: valueAtIndex
                            }
                        ]
                    }
                ];
            }
        } else if (hasArrayPattern(node.left) && canLowerArrayPattern(node.left)) {
            assignStatements = arrayPatternAssignmentStatements(
                node.left,
                valueAtIndex,
                this.rngAlpha
            );
        } else {
            assignStatements = [
                {
                    type: "ExpressionStatement",
                    expression: {
                        type: "AssignmentExpression",
                        operator: "=",
                        left: node.left,
                        right: valueAtIndex
                    }
                }
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
                            init: node.right
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
                        body: assignStatements.concat(blockToArray(node.body))
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
    simplifySwitchStatement (node: Loose) {
        assert.ok(estest.isNode(node));
        
        const cases = node.cases.map((c: Loose) => {
            const breakIndex = _.findIndex(c.consequent, (x: Loose) => x.type == "BreakStatement");
            let statements, breaks;
            if (breakIndex != -1) {
                statements = c.consequent.slice(0, breakIndex);
                breaks = true;
            } else {
                statements = c.consequent;
                breaks = false;
            }
            return {
                test: c.test,
                statements: statements,
                breaks: breaks
            };
        });
        
        let stack: Loose[] = [], ifStmts: Loose[] = [];
        for (let i = 0; i < cases.length; ++i) {
            stack.push(cases[i]);
            if (cases[i].breaks) {
                const testName = `$$switchtest$${this.rngAlpha.get()}`;
                var ifStmt;
                
                for (let j = 0; j < stack.length; ++j) {
                    const sliced = stack.slice(0, j + 1);
                    if (sliced.every((x: Loose) => x.test)) {
                        
                        ifStmt = {
                            type: "BlockStatement",
                            body: [
                                {
                                    type: "VariableDeclaration",
                                    kind: "var",
                                    declarations: [
                                        {
                                            type: "VariableDeclarator",
                                            id: { type: "Identifier", name: testName }
                                        }
                                    ]
                                }
                            ]
                        };
                        ifStmt = {
                            type: "IfStatement",
                            test: chain(sliced.map((x: Loose) => {
                                return { type: "BinaryExpression", operator: "==", left: x.test, right: node.discriminant };
                            }), "||"),
                            consequent: {
                                type: "BlockStatement",
                                body: (ifStmt ? [ ifStmt ] : []).concat(stack[j].statements)
                            }
                        };
                    } else {
                        ifStmt = {
                            type: "BlockStatement",
                            body: (ifStmt ? [ ifStmt ] : []).concat(stack[j].statements)
                        };
                    }
                }
                ifStmts.push(ifStmt);
                
                ifStmt = null;
                stack = [];
            }
        }
        this.logger.log(ifStmts);
        let combinedIfStmt = ifStmts[ifStmts.length - 1];
        for (let i = ifStmts.length - 2; i >= 0; --i) {
            combinedIfStmt = {
                type: "IfStatement",
                test: ifStmts[i].test,
                consequent: ifStmts[i].consequent,
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
    simplifyTryStatement (node: Loose): Loose {
        assert.ok(estest.isNode(node));
        
        if (node.finalizer) {
            if (node.handler) {
                return this.simplifyTryStatement({
                    type: "TryStatement",
                    block: {
                        type: "BlockStatement",
                        body: [
                            {
                                type: "TryStatement",
                                block: node.block,
                                handler: node.handler
                            }
                        ]
                    },
                    finalizer: node.finalizer
                });
            } else {
                const finalizer = node.finalizer;
                traverser.traverseEx(node.block, [], function (this: { abort(): void }, node: Loose, stack: Loose) {
                    if (stack.some((x: Loose) => estest.isFunction(x.node))) {
                        this.abort();
                        return node;
                    } else if (exitsCurrentTry(node, stack)) {
                        return withFinalizerBefore(node, finalizer);
                    } else {
                        return node;
                    }
                });
                
                return {
                    type: "BlockStatement",
                    body: [
                        {
                            type: "TryStatement",
                            block: node.block,
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
                        node.finalizer,
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
        } else {
            return node;
        }
    }

    /**
     * Lower simple spread calls like target.push(...items) to
     * target.push.apply(target, items). This keeps append-style calls stable
     * even when Babel is disabled.
     * @param {CallExpression} node
     * @return {Node}
     */
    simplifyCallExpression (node: Loose) {
        assert.ok(estest.isNode(node));

        if (!hasSpreadElement(node.arguments)) {
            return node;
        }

        let thisArg = { type: "Literal", value: null };
        if (node.callee.type == "MemberExpression") {
            if (!isSimpleThisReceiver(node.callee.object)) {
                return node;
            }
            thisArg = utils.cloneISwearIKnowWhatImDoing(node.callee.object);
        }

        return {
            type: "CallExpression",
            callee: {
                type: "MemberExpression",
                object: node.callee,
                property: { type: "Identifier", name: "apply" },
                computed: false
            },
            arguments: [
                thisArg,
                spreadArgumentsToArray(node.arguments)
            ]
        };
    }

    simplifyExpressionStatement (node: Loose) {
        assert.ok(estest.isNode(node));

        if (
            node.expression.type == "AssignmentExpression" &&
            node.expression.operator == "=" &&
            hasArrayPattern(node.expression.left) &&
            canLowerArrayPattern(node.expression.left)
        ) {
            return {
                type: "BlockStatement",
                body: arrayPatternAssignmentStatements(
                    node.expression.left,
                    node.expression.right,
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
    simplifyChainExpression (node: Loose) {
        assert.ok(estest.isNode(node));

        return this.lowerOptionalChain(node.expression);
    }

    lowerOptionalChain (node: Loose): Loose {
        if (node.type == "MemberExpression") {
            const object: Loose = this.lowerOptionalChain(node.object);
            const member = {
                type: "MemberExpression",
                object: utils.cloneISwearIKnowWhatImDoing(object),
                property: node.property,
                computed: node.computed === true
            };
            if (node.optional === true) {
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
            if (node.callee.type == "MemberExpression") {
                return this.lowerOptionalMemberCall(node);
            }

            const callee: Loose = this.lowerOptionalChain(node.callee);
            const call = {
                type: "CallExpression",
                callee: utils.cloneISwearIKnowWhatImDoing(callee),
                arguments: node.arguments,
                optional: false
            };
            if (node.optional === true) {
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

    lowerOptionalMemberCall (node: Loose): Loose {
        const member = node.callee;
        const object: Loose = this.lowerOptionalChain(member.object);
        const directMember = {
            type: "MemberExpression",
            object: utils.cloneISwearIKnowWhatImDoing(object),
            property: member.property,
            computed: member.computed === true
        };

        let alternate;
        if (node.optional === true) {
            alternate = {
                type: "CallExpression",
                callee: {
                    type: "MemberExpression",
                    object: utils.cloneISwearIKnowWhatImDoing(directMember),
                    property: { type: "Identifier", name: "call" },
                    computed: false
                },
                arguments: [ utils.cloneISwearIKnowWhatImDoing(object) ].concat(node.arguments),
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
                arguments: node.arguments,
                optional: false
            };
        }

        if (member.optional === true) {
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
    simplifyLogicalExpression (node: Loose) {
        assert.ok(estest.isNode(node));

        if (node.operator != "??") {
            return node;
        }

        return {
            type: "ConditionalExpression",
            test: notNullishTest(utils.cloneISwearIKnowWhatImDoing(node.left)),
            consequent: node.left,
            alternate: node.right
        };
    }

    /**
     * Lower object spread to Object.assign({}, ...parts).
     * @param {ObjectExpression} node
     * @return {Node}
     */
    simplifyObjectExpression (node: Loose) {
        assert.ok(estest.isNode(node));

        if (!hasObjectSpread(node)) {
            return node;
        }

        const parts: Loose[] = [
            {
                type: "ObjectExpression",
                properties: []
            }
        ];
        let pending: Loose[] = [];

        function flushPending() {
            if (pending.length > 0) {
                parts.push({
                    type: "ObjectExpression",
                    properties: pending
                });
                pending = [];
            }
        }

        node.properties.forEach((prop: Loose) => {
            if (prop.type == "SpreadElement") {
                flushPending();
                parts.push(prop.argument);
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
    simplifyVariableDeclaration (node: Loose, stack: Loose) {
        assert.ok(estest.isNode(node));

        const needsLowering = node.declarations.some((decl: Loose) => hasObjectPattern(decl.id) || hasArrayPattern(decl.id));
        if (!needsLowering) {
            return node;
        }
        if (node.declarations.some((decl: Loose) => hasObjectPattern(decl.id) && !canLowerObjectRest(decl.id))) {
            return node;
        }
        if (node.declarations.some((decl: Loose) => hasArrayPattern(decl.id) && !canLowerArrayPattern(decl.id))) {
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

        let statements: Loose[] = [];
        let normalDeclarations: Loose[] = [];
        const declarationKind = "var";

        function flushNormalDeclarations() {
            if (normalDeclarations.length > 0) {
                statements.push({
                    type: "VariableDeclaration",
                    kind: declarationKind,
                    declarations: normalDeclarations
                });
                normalDeclarations = [];
            }
        }

        node.declarations.forEach((decl: Loose) => {
            if (!hasObjectPattern(decl.id) && !hasArrayPattern(decl.id)) {
                normalDeclarations.push(decl);
                return;
            }

            flushNormalDeclarations();

            if (hasArrayPattern(decl.id)) {
                statements = statements.concat(arrayPatternStatements(
                    "var",
                    decl.id,
                    decl.init,
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
                        init: decl.init || { type: "ObjectExpression", properties: [] }
                    }
                ]
            });

            const excluded: Loose[] = [];
            decl.id.properties.forEach((prop: Loose) => {
                if (prop.type == "RestElement") {
                    statements.push({
                        type: "VariableDeclaration",
                        kind: declarationKind,
                        declarations: [
                            {
                                type: "VariableDeclarator",
                                id: prop.argument,
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
    simplifyArrowFunctionExpression (node: Loose) {
        assert.ok(estest.isNode(node));

        let fn = {
            type: "FunctionExpression",
            id: null,
            params: node.params,
            body: node.body.type == "BlockStatement" ? node.body : {
                type: "BlockStatement",
                body: [
                    {
                        type: "ReturnStatement",
                        argument: node.body
                    }
                ]
            },
            generator: false,
            expression: false,
            async: node.async === true
        };
        fn = lowerFunctionParameters(fn);

        if (!containsThisExpression(fn.body)) {
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
    simplifyClassDeclaration (node: Loose) {
        assert.ok(estest.isNode(node));

        const className = node.id && node.id.name || `$$class$${this.rngAlpha.get()}`;
        const privateStores: Record<string, Loose> = {};
        const instanceInitializers: Loose[] = [];
        const staticAssignments: Loose[] = [];
        const methods: Loose[] = [];

        node.body.body.forEach((element: Loose) => {
            if (element.type != "PropertyDefinition" && element.type != "FieldDefinition") {
                methods.push(element);
                return;
            }

            if (element.key.type == "PrivateIdentifier") {
                const storeName = privateStoreName(className, element.key.name);
                privateStores[element.key.name] = storeName;
                if (element.static) {
                    staticAssignments.push(weakMapSetStatement(
                        storeName,
                        { type: "Identifier", name: className },
                        element.value
                    ));
                } else {
                    instanceInitializers.push(weakMapSetStatement(
                        storeName,
                        { type: "ThisExpression" },
                        element.value
                    ));
                }
                return;
            }

            const target = {
                type: "MemberExpression",
                object: element.static ? { type: "Identifier", name: className } : { type: "ThisExpression" },
                property: classFieldKey(element),
                computed: element.computed === true || element.key.type == "Literal"
            };
            if (element.static) {
                staticAssignments.push(assignmentStatement(target, element.value));
            } else {
                instanceInitializers.push(assignmentStatement(target, element.value));
            }
        });

        methods.forEach((method: Loose) => {
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
                            body: node.superClass ? [
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

            const body = constructor.value.body.body;
            let insertAt = 0;
            if (node.superClass) {
                const superIndex = body.findIndex((stmt: Loose) => stmt.type == "ExpressionStatement"
                    && stmt.expression.type == "CallExpression"
                    && stmt.expression.callee.type == "Super");
                insertAt = superIndex == -1 ? 0 : superIndex + 1;
            }
            body.splice.apply(body, [insertAt, 0].concat(instanceInitializers));
        }

        node.body.body = methods;

        const privateDeclarations = Object.keys(privateStores).map((name: Loose) => {
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
            body: (privateDeclarations as Loose[]).concat([node]).concat(staticAssignments)
        };
    }

    lowerPrivateMembers (node: Loose, privateStores: Loose) {
        traverser.traverse(node, [], (child: Loose, stack: Loose) => {
            const parentFrame = stack[1];
            if (child.type == "MemberExpression"
                && parentFrame
                && parentFrame.node.type == "AssignmentExpression"
                && parentFrame.key == "left") {
                return child;
            }
            if (child.type == "AssignmentExpression"
                && child.left.type == "MemberExpression"
                && child.left.property.type == "PrivateIdentifier"
                && privateStores[child.left.property.name]) {
                return {
                    type: "CallExpression",
                    callee: {
                        type: "MemberExpression",
                        object: { type: "Identifier", name: privateStores[child.left.property.name] },
                        property: { type: "Identifier", name: "set" },
                        computed: false
                    },
                    arguments: [
                        child.left.object,
                        child.right
                    ]
                };
            }
            if (child.type == "MemberExpression"
                && child.property.type == "PrivateIdentifier"
                && privateStores[child.property.name]) {
                return weakMapGetExpression(privateStores[child.property.name], child.object);
            }
            return child;
        });
    }

};
