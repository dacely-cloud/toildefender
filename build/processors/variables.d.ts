import ESUtils from "../esutils.js";
import type { AstNode, LoggerLike } from "../types.js";
export default class Variables {
    logger: LoggerLike;
    esutils: ESUtils;
    constructor(logger: LoggerLike);
    removeFunctionExpressionIds(ast: AstNode): AstNode;
    functionDeclarationToExpression(ast: AstNode, scopeManager: unknown): void;
    obfuscateIdentifiers(ast: AstNode, scopeManager: unknown): void;
    redefineParameters(ast: AstNode, scopeManager: unknown): void;
}
