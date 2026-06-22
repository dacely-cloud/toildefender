import type { Loose } from "../types.js";
export default class Variables {
    logger: Loose;
    esutils: Loose;
    constructor(logger: Loose);
    removeFunctionExpressionIds(ast: Loose): import("../types.js").AstNode;
    functionDeclarationToExpression(ast: Loose, scopeManager: Loose): void;
    obfuscateIdentifiers(ast: Loose, scopeManager: Loose): void;
    redefineParameters(ast: Loose, scopeManager: Loose): void;
}
