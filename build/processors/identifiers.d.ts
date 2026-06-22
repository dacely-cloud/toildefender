import ESUtils from "../esutils.js";
import type { AstNode, LoggerLike } from "../types.js";
interface ArrayizeObjectOptions {
    objectPacking?: boolean;
}
export default class Identifiers {
    logger: LoggerLike;
    esutils: ESUtils;
    constructor(logger: LoggerLike);
    hasParentAcceptingUndefined(node: AstNode): boolean;
    computeProperties(ast: AstNode): AstNode;
    arrayizeObjects(ast: AstNode, options?: ArrayizeObjectOptions): AstNode;
    moveIdentifiers(ast: AstNode, scopeManager: unknown): AstNode;
    moveLiterals(ast: AstNode, _scopeManager: unknown): AstNode;
}
export {};
