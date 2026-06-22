import assert from "assert";
import estraverse from "estraverse";
import estest from "./estest.js";
import utils from "./utils.js";
import type { AstChildVisitor, AstNode, AstStackFrame, AstVisitor } from "./types.js";

const VISITOR_KEYS = Object.assign({}, estraverse.VisitorKeys, {
    ChainExpression: [ "expression" ],
    PropertyDefinition: [ "key", "value" ],
    FieldDefinition: [ "key", "value" ]
}) as Record<string, string[]>;

function nodeFields(node: AstNode): Record<string, unknown> {
    return node as unknown as Record<string, unknown>;
}

function unknownArray(value: unknown): unknown[] | null {
    return Array.isArray(value) ? value as unknown[] : null;
}

// Depth-first
export function traverse(node: AstNode, stack: AstStackFrame[], processor: AstVisitor): AstNode {
    assert.ok(estest.isNode(node));
    assert.ok(Array.isArray(stack));
    assert.equal(typeof processor, "function");
    
    visitChildren(node, (child: AstNode, key: string) => {
        return traverse(child, [ { node, key }, ...stack ], processor);
    });
    
    return processor(node, [ { node: node } ].concat(stack));
}

// Breadth-first
export function traverseEx(node: AstNode, stack: AstStackFrame[], processor: AstVisitor): AstNode {
    assert.ok(estest.isNode(node));
    assert.ok(Array.isArray(stack));
    assert.equal(typeof processor, "function");
    
    let abort = false;
    const controller = {
        abort: function() {
            abort = true;
        }
    };
    
    const queue: Array<{ child: AstNode; key: string }> = [];
    visitChildrenEx(node, (child: AstNode, key: string) => {
        const repl = processor.call(controller, child, [ { node }, ...stack ]);
        if (repl == child) {
            queue.push({
                child: child,
                key: key
            });
        }
        return repl;
    });
    if (!abort) {
        queue.every((elem) => {
            traverseEx.call(controller, elem.child, [ { node, key: elem.key }, ...stack ], processor);
            return !abort;
        });
    }
    return node;
}

export default {
    traverse,
    traverseEx,
    visitChildren,
    visitChildrenEx
};

export function visitChildren(node: AstNode, processor: AstChildVisitor): void {
    assert.ok(estest.isNode(node));
    assert.equal(typeof processor, "function");
    
    const fields = nodeFields(node);
    const keys = VISITOR_KEYS[node.type] || [];
    keys.forEach((key: string) => {
        const value = fields[key];
        const values = unknownArray(value);
        if (values) {
            fields[key] = values.map((x: unknown) => {
                if (!estest.isNode(x)) {
                    return x;
                }
                const repl = processor(x, key);
                assert(repl);
                return repl;
            });
        } else if (estest.isNode(value)) {
            const repl = processor(value, key);
            assert(repl);
            fields[key] = repl;
        }
    });
}

export function visitChildrenEx(node: AstNode, processor: AstChildVisitor): void {
    assert.ok(estest.isNode(node));
    assert.equal(typeof processor, "function");
    
    const fields = nodeFields(node);
    const keys = VISITOR_KEYS[node.type] || [];
    keys.forEach((key: string) => {
        const value = fields[key];
        const values = unknownArray(value);
        if (values) {
            let i = values.length;
            while (i--) {
                const child = values[i];
                if (!estest.isNode(child)) {
                    continue;
                }
                let replacement = processor(child, key);
                assert(replacement);
                if (Array.isArray(replacement) && replacement.length == 1) {
                    replacement = replacement[0];
                }
                if (Array.isArray(replacement)) {
                    utils.splice(values, i, 1, replacement);
                } else {
                    values[i] = replacement;
                }
            }
        } else if (estest.isNode(value)) {
            let replacement = processor(value, key);
            assert(replacement);
            if (Array.isArray(replacement) && replacement.length == 1) {
                replacement = replacement[0];
            }
            if (Array.isArray(replacement)) {
                throw new Error("Cannot use array here: " + node.type + "." + key + "\n" + JSON.stringify(node) + "\n" + JSON.stringify(replacement));
            } else {
                fields[key] = replacement;
            }
        }
    });
}
