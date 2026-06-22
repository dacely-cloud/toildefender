import type { AstNode, LoggerLike } from "../types.js";
export default class Literals {
    logger: LoggerLike;
    constructor(logger: LoggerLike);
    extractStrings(ast: AstNode): AstNode;
    generateStrings(ast: AstNode): AstNode;
}
