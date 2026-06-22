"use strict";

var assert = require("assert");

var _ = require("lodash");

var estest = require("../estest");
var traverser = require("../traverser");
var utils = require("../utils");

/**
 * Generate string generator from string.
 * @param {string} str
 * @returns {Node}
 */
function makeStringGenerator(str) {
    assert.equal(typeof str, "string");
    
    var fragments = [];
    
    while (str.length > 0) {
        var len = utils.random(1, 5);
        fragments.push(str.substring(0, len));
        str = str.substring(len);
    }
    
    var block = {
        type: "BlockStatement",
        body: [
            {
                type: "VariableDeclaration",
                kind: "var",
                declarations: [
                    {
                        type: "VariableDeclarator",
                        id: { type: "Identifier", name: "str" },
                        init: { type: "Literal", value: "" }
                    }
                ]
            }
        ]
    };
    
    fragments.forEach(fragment => {
        var decoded = makeStringByteArrayCall(fragment);
        
        block.body.push({
            type: "ExpressionStatement",
            expression: {
                type: "BinaryExpression",
                operator: "+=",
                left: { type: "Identifier", name: "str" },
                right: decoded
            }
        });
    });
    
    block.body.push({
        type: "ReturnStatement",
        argument: { type: "Identifier", name: "str" }
    });
    
    return {
        type: "CallExpression",
        arguments: [],
        callee: {
            type: "FunctionExpression",
            params: [],
            body: block
        }
    };
}

/**
 * Generate unicode-escaped string generator from string.
 * @param {string} str
 * @returns {Node}
 */
function makeStringUnicode(str) {
    assert.equal(typeof str, "string");
    
    return {
        type: "CallExpression",
        callee: { type: "Identifier", name: "eval" },
        arguments: [
            {
                type: "Literal",
                value: "\"" + str.split("").map(x => "\\x" + x.charCodeAt().toString(16)).join("") + "\""
            }
        ]
    };
}

/**
 * Generate URL-escaped string generator from string.
 * @param {string} str
 * @returns {Node}
 */
function makeStringUnescape(str) {
    assert.equal(typeof str, "string");
    
    return {
        type: "CallExpression",
        callee: { type: "Identifier", name: "unescape" },
        arguments: [
            {
                type: "Literal",
                value: str.split("").map(x => "%" + x.charCodeAt().toString(16)).join("")
            }
        ]
    };
}

/**
 * Generate char-code-escaped char generator from char.
 * @param {string} cha
 * @returns {Node}
 */
function makeCharByte(cha) {
    assert.equal(typeof cha, "string");
    assert.equal(cha.length, 1);
    
    return {
        type: "CallExpression",
        callee: {
            type: "MemberExpression",
            computed: false,
            object: { type: "Identifier", name: "String" },
            property: { type: "Identifier", name: "fromCharCode" }
        },
        arguments: [
            {
                type: "Literal",
                value: cha.charCodeAt(0)
            }
        ]
    };
}

/**
 * Generate char-code-escaped string generator from string.
 * @param {string} str
 * @returns {Node}
 */
function makeStringByteArrayCall(str) {
    assert.equal(typeof str, "string");
    
    return {
        type: "CallExpression",
        callee: { type: "Identifier", name: "toildefender$fromCharCodes" },
        arguments: str.split("").map(x => ({ type: "Literal", value: x.charCodeAt() }))
    };
}

function isUnencodedPropertyKey(stack) {
    var parentFrame = stack[1];
    if (!parentFrame || parentFrame.node.type != "Property") {
        return false;
    }
    return parentFrame.key == "key" && parentFrame.node.computed !== true;
}

function isNumericVmInternalFunction(stack) {
    return stack.some(frame => frame.node && frame.node.toildefender$numericVmInternal === true);
}

function makeStringExpression(str) {
    if (str.length == 0) {
        return { type: "Literal", value: "" };
    }
    return makeStringGenerator(str);
}

function makeStringCallExpression(expr) {
    return {
        type: "CallExpression",
        callee: { type: "Identifier", name: "String" },
        arguments: [expr]
    };
}

function concatExpressions(left, right) {
    return {
        type: "BinaryExpression",
        operator: "+",
        left: left,
        right: right
    };
}

function makeTemplateExpression(node) {
    assert.equal(node.type, "TemplateLiteral");

    var expression;
    for (var i = 0; i < node.quasis.length; i += 1) {
        var quasi = node.quasis[i];
        var cooked = quasi.value && typeof quasi.value.cooked == "string" ? quasi.value.cooked : "";
        var quasiExpression = makeStringExpression(cooked);
        expression = expression ? concatExpressions(expression, quasiExpression) : quasiExpression;

        if (i < node.expressions.length) {
            expression = concatExpressions(expression, makeStringCallExpression(node.expressions[i]));
        }
    }

    return expression || { type: "Literal", value: "" };
}

function makeRegexExpression(node) {
    assert.equal(node.type, "Literal");
    assert.ok(node.regex);

    return {
        type: "NewExpression",
        callee: { type: "Identifier", name: "RegExp" },
        arguments: [
            makeStringExpression(node.regex.pattern || ""),
            makeStringExpression(node.regex.flags || "")
        ]
    };
}

module.exports = class Literals {

    constructor (logger) {
        this.logger = logger;
    }
    
    /**
     * Move strings into $$strings array
     * @param {Node} ast Root node
     * @returns {Node} Root node
     */
    extractStrings (ast) {
        assert.ok(estest.isNode(ast));
        
        var global = { type: "Identifier", name: "$$strings" };
        
        var strings = [];
        var stringMap = {};
        
        ast = traverser.traverse(ast, [], (node, stack) => {
            if (isNumericVmInternalFunction(stack)) {
                return node;
            }
            if (node.type == "Literal" && typeof node.value == "string") {
                var idx = stringMap["_" + node.value];
                if (!idx) {
                    stringMap["_" + node.value] = idx = strings.length;
                    strings.push(node);
                }
                
                return {
                    type: "MemberExpression",
                    computed: true,
                    object: global,
                    property: { type: "Literal", value: idx }
                };
            }
            
            return node;
        });
        
        ast.body.splice(0, 0, {
            type: "VariableDeclaration",
            kind: "var",
            declarations: [
                {
                    type: "VariableDeclarator",
                    id: global,
                    init: {
                        type: "ArrayExpression",
                        elements: strings
                    }
                }
            ]
        });
        
        return ast;
    }

    /**
     * Replace string literals with string generators.
     * @param {Node} ast Root node
     * @returns {Node} Root node
     */
    generateStrings (ast) {
        assert.ok(estest.isNode(ast));
        
        ast = traverser.traverse(ast, [], (node, stack) => {
            if (isNumericVmInternalFunction(stack)) {
                return node;
            }
            if (node.type == "TemplateLiteral") {
                return makeTemplateExpression(node);
            }
            if (node.type == "Literal" && node.regex) {
                return makeRegexExpression(node);
            }
            if (node.type == "Literal"
                && typeof node.value == "string"
                && stack.length > 1
                && !isUnencodedPropertyKey(stack)) {
                return makeStringGenerator(node.value);
            }
            
            return node;
        });
        
        return ast;
    }
    
};
