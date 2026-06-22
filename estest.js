import assert from "assert";
import _ from "lodash";

const EXPRESSIONS = [
    "Identifier"
];

const COMPOUND_STATEMENTS = [
    "BlockStatement",
    "WithStatement",
    "IfStatement",
    "SwitchStatement",
    "TryStatement",
    "WhileStatement",
    "DoWhileStatement",
    "ForStatement",
    "ForInStatement"
];

export function isNode(x) {
    return x != null && typeof x.type == "string";
}

export function isStatement(x) {
    assert.ok(isNode(x));
    
    return x.type == "Program" || _.endsWith(x.type, "Statement") || _.endsWith(x.type, "Declaration");
}

export function isCompoundStatement(x) {
    assert.ok(isNode(x));
    
    return _.includes(COMPOUND_STATEMENTS.indexOf, x.type);
}

export function isExpression(x) {
    assert.ok(isNode(x));
    
    return _.includes(EXPRESSIONS, x.type) || _.endsWith(x.type, "Expression");
}

export function isFunction(x) {
    assert.ok(isNode(x));
    
    return _.startsWith(x.type, "Function");
}

export default {
    isNode,
    isStatement,
    isCompoundStatement,
    isExpression,
    isFunction
};
