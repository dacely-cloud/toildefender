import assert from "assert";
import estest from "../estest.js";
import ESUtils from "../esutils.js";
import traverser from "../traverser.js";
import utils from "../utils.js";
import type { AstNode, AstStackFrame, LoggerLike, ReferenceLike, ScopeLike } from "../types.js";

interface IdentifierReference extends ReferenceLike {
    identifier: AstNode;
}

interface IdentifierScope extends ScopeLike {
    references: IdentifierReference[];
}

interface IdentifierScopeManager {
    scopes: IdentifierScope[];
}

interface ArrayizeObjectOptions {
    objectPacking?: boolean;
}

function nodeArray(value: unknown): AstNode[] {
    return Array.isArray(value) ? (value as AstNode[]) : [];
}

function nodeFields(node: AstNode): Record<string, unknown> {
    return node as unknown as Record<string, unknown>;
}

function childNode(node: AstNode, key: string): AstNode | null {
    const value = nodeFields(node)[key];
    return estest.isNode(value) ? value : null;
}

function setChildNode(node: AstNode, key: string, value: AstNode): void {
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

function setNodeComputed(node: AstNode, computed: boolean): void {
    (node as { computed?: boolean }).computed = computed;
}

function nodeComputed(node: AstNode): boolean {
    return (node as { computed?: unknown }).computed === true;
}

function nodeOperator(node: AstNode): string | null {
    const operator = (node as { operator?: unknown }).operator;
    return typeof operator == "string" ? operator : null;
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

function scopeList(scopeManager: unknown): IdentifierScope[] {
    const scopes = (scopeManager as { scopes?: unknown }).scopes;
    return Array.isArray(scopes) ? (scopes as IdentifierScope[]) : [];
}

function literal(value: unknown): AstNode {
    return { type: "Literal", value: value };
}

function encodeObjectKey(key: string, salt: number, index: number): number[] {
    const encoded = [ key.length ^ ((salt + index * 131) & 65535) ];
    for (let i = 0; i < key.length; i += 1) {
        encoded.push(key.charCodeAt(i) ^ ((salt + index * 257 + i * 17) & 65535));
    }
    return encoded;
}

function objectKey(prop: AstNode): string {
    const key = childNode(prop, "key");
    return nodeName(key) || String(nodeValue(key));
}

function propertyValue(prop: AstNode): AstNode {
    return childNode(prop, "value") || { type: "Identifier", name: "undefined" };
}

function canPackObjectExpression(node: AstNode): boolean {
    return nodeArray(nodeFields(node).properties).every((prop: AstNode) => prop.type != "SpreadElement" && childNode(prop, "key") !== null);
}

function isBigIntLiteral(node: AstNode): boolean {
    return node.type == "Literal" && typeof nodeValue(node) == "bigint";
}

function canMoveLiteral(node: AstNode): boolean {
    if (node.type != "Literal" || isBigIntLiteral(node) || nodeFields(node).regex) {
        return false;
    }
    return typeof nodeValue(node) == "string";
}

function isNumericVmInternalFunction(stack: AstStackFrame[]): boolean {
    return stack.some((frame: AstStackFrame) => (frame.node as { toildefender$numericVmInternal?: unknown }).toildefender$numericVmInternal === true);
}

export default class Identifiers {
    logger: LoggerLike;
    esutils: ESUtils;

    constructor (logger: LoggerLike) {
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
    hasParentAcceptingUndefined (node: AstNode): boolean {
        const parent = this.esutils.getParent(node);
        return Boolean(parent
            && parent.type == "UnaryExpression"
            && [ "typeof", "delete" ].includes(nodeOperator(parent) || ""));
    }
    
    /**
     * Replace property references like obj.prop with obj["prop"].
     * @param {Node} ast Root node
     * @returns {Node}
     */
    computeProperties (ast: AstNode): AstNode {
        assert.ok(estest.isNode(ast));
        
        ast = traverser.traverse(ast, [], (node: AstNode, stack: AstStackFrame[]) => {
            if (isNumericVmInternalFunction(stack)) {
                return node;
            }
            if (node.type == "MemberExpression" && !nodeComputed(node)) {
                const property = childNode(node, "property");
                assert(property?.type == "Identifier");
                setChildNode(node, "property", { type: "Literal", value: nodeName(property) || "" });
                setNodeComputed(node, true);
            }
            
            return node;
        });
        
        return ast;
    }
    
    /**
     * Replace objects with an array via toildefender$toObject.
     * @param {Node} ast Root node
     * @returns {Node}
     */
    arrayizeObjects (ast: AstNode, options: ArrayizeObjectOptions = {}): AstNode {
        assert.ok(estest.isNode(ast));

        ast = traverser.traverse(ast, [], (node: AstNode, stack: AstStackFrame[]) => {
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

                const properties = nodeArray(nodeFields(node).properties);
                const salt = utils.random(1, 65535);
                const schema = [ salt, properties.length ];
                const values: AstNode[] = [];

                properties.forEach((prop: AstNode) => {
                    const key = objectKey(prop);
                    encodeObjectKey(key, salt, values.length).forEach((value: number) => schema.push(value));
                    values.push(propertyValue(prop));
                });

                return {
                    type: "CallExpression",
                    callee: { type: "Identifier", name: "toildefender$toObject"  },
                    arguments: [
                        literal(utils.hash(schema.join(","))),
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
    moveIdentifiers (ast: AstNode, scopeManager: unknown): AstNode {
        assert.ok(estest.isNode(ast));
        
        const rng = new utils.UniqueRandomAlpha(3);
        
        this.esutils.setParentsRecursive(ast);
        
        scopeList(scopeManager).forEach((scope: IdentifierScope) => {
            /**
             * That could cause problems if there are multiple unresolved
             * references with the same name. (is that even possible?)
             */
            
            const replaced = new utils.HashMap<string>();
            
            scope.references
            .filter((reference: IdentifierReference) => !utils.isResolvedReference(reference))
            .forEach((reference: IdentifierReference) => {
                const identifierName = nodeName(reference.identifier);
                if (!identifierName) {
                    return;
                }

                const previous = replaced.get(identifierName);
                if (previous) {
                    setNodeName(reference.identifier, previous);
                } else if (!this.hasParentAcceptingUndefined(reference.identifier)) {
                    const name = "$$ident$" + rng.get();
                    replaced.set(identifierName, name);
                    
                    let init: AstNode;
                    if (identifierName == "undefined") {
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
                                    argument: { type: "Identifier", name: identifierName }
                                },
                                right: { type: "Literal", value: "undefined" }
                            },
                            consequent: { type: "Identifier", name: identifierName },
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
                    
                    setNodeName(reference.identifier, name);
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
    moveLiterals (ast: AstNode, _scopeManager: unknown): AstNode {
        assert.ok(estest.isNode(ast));
        
        const vars: string[] = [];
        
        ast = traverser.traverse(ast, [], (node: AstNode, stack: AstStackFrame[]) => {
            if (isNumericVmInternalFunction(stack)) {
                return node;
            }
            const parentFrame = stack[1];
            if (canMoveLiteral(node) && stack.length > 0 && parentFrame?.node.type != "Property") {
                const value = String(nodeValue(node));
                let idx = vars.indexOf(value);
                if (idx == -1) {
                    idx = vars.length;
                    vars.push(value);
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
        
        mutableBody(ast).splice(0, 0, {
            type: "VariableDeclaration",
            kind: "var",
            declarations: [
                {
                    type: "VariableDeclarator",
                    id: { type: "Identifier", name: "toildefender$literals" },
                    init: {
                        type: "ArrayExpression",
                        elements: vars.map((x: string) => ({ type: "Literal", value: x }))
                    }
                }
            ]
        });
        
        return ast;
    }
    
};
