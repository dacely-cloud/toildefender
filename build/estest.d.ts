import type { AstNode } from "./types.js";
export declare function isNode(x: unknown): x is AstNode;
export declare function isStatement(x: unknown): boolean;
export declare function isCompoundStatement(x: unknown): boolean;
export declare function isExpression(x: unknown): boolean;
export declare function isFunction(x: unknown): boolean;
declare const _default: {
    isNode: typeof isNode;
    isStatement: typeof isStatement;
    isCompoundStatement: typeof isCompoundStatement;
    isExpression: typeof isExpression;
    isFunction: typeof isFunction;
};
export default _default;
