import assert from "assert";
import _ from "lodash";
import estest from "../estest.js";
import ESUtils from "../esutils.js";
import traverser from "../traverser.js";
import utils from "../utils.js";

function literal(value) {
    return { type: "Literal", value: value };
}

function encodeObjectKey(key, salt, index) {
    var encoded = [ key.length ^ ((salt + index * 131) & 65535) ];
    for (var i = 0; i < key.length; i += 1) {
        encoded.push(key.charCodeAt(i) ^ ((salt + index * 257 + i * 17) & 65535));
    }
    return encoded;
}

function objectKey(prop) {
    return prop.key.name || prop.key.value;
}

function canPackObjectExpression(node) {
    return node.properties.every(prop => prop.type != "SpreadElement" && prop.key);
}

function isBigIntLiteral(node) {
    return node.type == "Literal" && typeof node.value == "bigint";
}

function canMoveLiteral(node) {
    if (node.type != "Literal" || isBigIntLiteral(node) || node.regex) {
        return false;
    }
    return typeof node.value == "string";
}

function isNumericVmInternalFunction(stack) {
    return stack.some(frame => frame.node && frame.node.toildefender$numericVmInternal === true);
}

export default class Identifiers {

    constructor (logger) {
        this.logger = logger;
        this.esutils = new ESUtils(logger);
    }
    
    /**
     * This checks whether the given node has a parent that
     * accepts undefined children without throwing errors.
     * Those cannot be moved to separate variables without
     * causing errors by assigning undefined variables
     * to new variables.
     * @param {Node} node
     * @returns {boolean}
     */
    hasParentAcceptingUndefined (node) {
        var parent = this.esutils.getParent(node);
        return parent
            && parent.type == "UnaryExpression"
            && _.includes([ "typeof", "delete" ], parent.operator);
    }
    
    /**
     * Replace property references like obj.prop with obj["prop"].
     * @param {Node} ast Root node
     * @returns {Node} Root node
     */
    computeProperties (ast) {
        assert.ok(estest.isNode(ast));
        
        ast = traverser.traverse(ast, [], (node, stack) => {
            if (isNumericVmInternalFunction(stack)) {
                return node;
            }
            if (node.type == "MemberExpression"
                && !node.computed) {
                assert(node.property.type == "Identifier");
                node.property = { type: "Literal", value: node.property.name };
                node.computed = true;
            }
            
            return node;
        });
        
        return ast;
    }
    
    /**
     * Replace objects with an array via toildefender$toObject.
     * @param {Node} ast Root node
     * @returns {Node} Root node
     */
    arrayizeObjects (ast, options) {
        assert.ok(estest.isNode(ast));
        options = options || {};

        ast = traverser.traverse(ast, [], (node, stack) => {
            if (isNumericVmInternalFunction(stack)) {
                return node;
            }
            if (node.type == "ObjectExpression") {
                if (options.objectPacking === false) {
                    return node;
                }
                if (!canPackObjectExpression(node)) {
                    return node;
                }

                var salt = utils.random(1, 65535);
                var schema = [ salt, node.properties.length ];
                var values = [];

                node.properties.forEach(prop => {
                    var key = objectKey(prop);
                    encodeObjectKey(String(key), salt, values.length).forEach(value => schema.push(value));
                    values.push(prop.value);
                });

                return {
                    type: "CallExpression",
                    callee: { type: "Identifier", name: "toildefender$toObject"  },
                    arguments: [
                        literal(String(utils.hash(schema.join(",")))),
                        {
                            type: "ArrayExpression",
                            elements: schema.map(literal)
                        },
                        {
                            type: "ArrayExpression",
                            elements: values
                        }
                    ]
                };
            }
            
            return node;
        });
        
        return ast;
    }
    
    // This seems to be ununsed.
    // TODO: Figure this out
    moveIdentifiers (ast, scopeManager) {
        assert.ok(estest.isNode(ast));
        
        var rng = new utils.UniqueRandomAlpha(3);
        
        this.esutils.setParentsRecursive(ast);
        
        scopeManager.scopes.forEach(scope => {
            /**
             * That could cause problems if there are multiple unresolved
             * references with the same name. (is that even possible?)
             */
            
            var replaced = new utils.HashMap();
            
            scope.references
            .filter(reference => !utils.isResolvedReference(reference))
            .forEach(reference => {
                if (replaced.exists(reference.identifier.name)) {
                    reference.identifier.name = replaced.get(reference.identifier.name);
                } else if (!this.hasParentAcceptingUndefined(reference.identifier)) {
                    var name = "$$ident$" + rng.get();
                    replaced.set(reference.identifier.name, name);
                    
                    var init;
                    if (reference.identifier.name == "undefined") {
                        init = { type: "Identifier", name: "undefined" };
                    } else {
                        init = {
                            type: "ConditionalExpression",
                            test: {
                                type: "BinaryExpression",
                                operator: "!==",
                                left: {
                                    type: "UnaryExpression",
                                    operator: "typeof",
                                    prefix: true,
                                    argument: { type: "Identifier", name: reference.identifier.name }
                                },
                                right: { type: "Literal", value: "undefined" }
                            },
                            consequent: { type: "Identifier", name: reference.identifier.name },
                            alternate: { type: "Identifier", name: "undefined" }
                        };
                    }
                                        
                    this.esutils.insertIntoScope(scope, {
                        type: "VariableDeclaration",
                        kind: "var",
                        declarations: [
                            {
                                type: "VariableDeclarator",
                                id: { type: "Identifier", name: name },
                                init: init
                            }
                        ]
                    });
                    
                    reference.identifier.name = name;
                }
            });
        });
        
        return ast;
    }
    
    /**
     * Move all literals into the toildefender$literals array.
     * @param {Node} ast Root node
     * @param {ScopeManager} scopeManager Scope manager
     * @returns {Node} Root node
     */
    moveLiterals (ast, scopeManager) {
        assert.ok(estest.isNode(ast));
        
        var rng = new utils.UniqueRandomAlpha(3);
        
        var vars = [];
        
        ast = traverser.traverse(ast, [], (node, stack) => {
            if (isNumericVmInternalFunction(stack)) {
                return node;
            }
            if (canMoveLiteral(node) && stack.length > 0 && stack[1].node.type != "Property") {
                var idx = vars.indexOf(node.value);
                if (idx == -1) {
                    idx = vars.length;
                    vars.push(node.value);
                }
                
                return {
                    type: "MemberExpression",
                    object: { type: "Identifier", name: "toildefender$literals" },
                    property: { type: "Literal", value: idx },
                    computed: true
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
                    id: { type: "Identifier", name: "toildefender$literals" },
                    init: {
                        type: "ArrayExpression",
                        elements: vars.map(x => ({ type: "Literal", value: x }))
                    }
                }
            ]
        });
        
        return ast;
    }
    
};
