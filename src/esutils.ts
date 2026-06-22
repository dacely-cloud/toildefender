import assert from "assert";
import estest from "./estest.js";
import traverser from "./traverser.js";
import type { AstNode, LoggerLike, ScopeLike } from "./types.js";

function nodeFields(node: AstNode): Record<string, unknown> {
    return node as unknown as Record<string, unknown>;
}

function isStatementContainer(node: AstNode): boolean {
    return node.type == "Program" || node.type == "BlockStatement";
}

function statementBody(node: AstNode): AstNode[] | null {
    const body = nodeFields(node).body;
    return Array.isArray(body) ? body as AstNode[] : null;
}

function nestedStatementContainer(node: AstNode): AstNode | null {
    const body = nodeFields(node).body;
    return estest.isNode(body) && isStatementContainer(body) ? body : null;
}

export default class ESUtils {
    private readonly logger: LoggerLike;

    constructor(logger: LoggerLike) {
        this.logger = logger;
    }

    setParents(node: AstNode): void {
        assert.ok(estest.isNode(node));
        
        traverser.visitChildrenEx(node, (child: AstNode) => {
            Object.defineProperty(child, "toildefender$parent", {
                value: node,
                configurable: true
            });
            return child;
        });
    }

    setParentsRecursive(node: AstNode): void {
        assert.ok(estest.isNode(node));
        
        traverser.visitChildrenEx(node, (child: AstNode) => {
            Object.defineProperty(child, "toildefender$parent", {
                value: node,
                configurable: true
            });
            this.setParentsRecursive(child);
            return child;
        });
    }

    canInsertIntoScope(scope: ScopeLike): boolean {
        if (!scope || !scope.block) {
            return false;
        }
        if (nestedStatementContainer(scope.block)) {
            return true;
        }
        return isStatementContainer(scope.block);
    }

    insertIntoScope(scope: ScopeLike, node: AstNode, idx = 0): void {
        assert.ok(estest.isNode(node));

        const nested = nestedStatementContainer(scope.block);
        if (nested) {
            const body = statementBody(nested);
            assert.ok(body);
            body.splice(idx, 0, node);
            
            Object.defineProperty(node, "toildefender$parent", {
                value: nested,
                configurable: true
            });
        } else if (isStatementContainer(scope.block)) {
            const body = statementBody(scope.block);
            assert.ok(body);
            body.splice(idx, 0, node);
            
            Object.defineProperty(node, "toildefender$parent", {
                value: scope.block,
                configurable: true
            });
        } else {
            throw new Error("Cannot insert into scope.block of type " + scope.block.type);
        }
    }
    
    replaceNode(root: AstNode, child: AstNode, replacement: AstNode): void {
        assert.ok(estest.isNode(root));
        assert.ok(estest.isNode(child));
        assert.ok(estest.isNode(replacement));
        assert.equal(estest.isStatement(child), estest.isStatement(replacement), `Replacee ${child.type} is not of the same type as replacement ${replacement.type}`);
        assert.equal(estest.isExpression(child), estest.isExpression(replacement), `Replacee ${child.type} is not of the same type as replacement ${replacement.type}`);
        
        const parent = this.getParent(child);
        if (parent && parent.type == "Property" && parent.shorthand === true && parent.value == child) {
            parent.shorthand = false;
        }
        root = parent || root;
        let replaced = false;
        traverser.traverseEx(root, [], (node: AstNode) => {
            if (!replaced && node == child) {
                replaced = true;
                Object.defineProperty(replacement, "toildefender$parent", {
                    value: child.toildefender$parent,
                    configurable: true
                });
                this.setParents(replacement);
                return replacement;
            } else {
                return node;
            }
        });
    }

    getParent(node: AstNode): AstNode | null {
        assert.ok(estest.isNode(node));
        
        const parent = node.toildefender$parent as AstNode | undefined;
        let legit = false;
        if (parent) {
            traverser.visitChildren(parent, (child: AstNode) => {
                if (node == child) {
                    legit = true;
                }
                return child;
            });
        }
        if (legit) {
            return parent || null;
        } else if (parent) {
            this.logger.debug("Child has wrong parent");
            return null;
        } else {
            this.logger.debug("Child has no parent");
            return null;
        }
        return null;
    }
}
