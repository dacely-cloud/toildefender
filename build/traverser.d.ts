import type { AstChildVisitor, AstNode, AstStackFrame, AstVisitor } from "./types.js";
export declare function traverse(node: AstNode, stack: AstStackFrame[], processor: AstVisitor): AstNode;
export declare function traverseEx(node: AstNode, stack: AstStackFrame[], processor: AstVisitor): AstNode;
declare const _default: {
    traverse: typeof traverse;
    traverseEx: typeof traverseEx;
    visitChildren: typeof visitChildren;
    visitChildrenEx: typeof visitChildrenEx;
};
export default _default;
export declare function visitChildren(node: AstNode, processor: AstChildVisitor): void;
export declare function visitChildrenEx(node: AstNode, processor: AstChildVisitor): void;
