import type { AstNode, LoggerLike, ScopeLike } from "./types.js";
export default class ESUtils {
    private readonly logger;
    constructor(logger: LoggerLike);
    setParents(node: AstNode): void;
    setParentsRecursive(node: AstNode): void;
    canInsertIntoScope(scope: ScopeLike): boolean;
    insertIntoScope(scope: ScopeLike, node: AstNode, idx?: number): void;
    replaceNode(root: AstNode, child: AstNode, replacement: AstNode): void;
    getParent(node: AstNode): AstNode | null;
}
