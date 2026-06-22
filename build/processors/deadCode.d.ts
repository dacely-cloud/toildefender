import type { AstNode, LoggerLike } from "../types.js";
export default class DeadCode {
    logger: LoggerLike;
    constructor(logger: LoggerLike);
    insert(ast: AstNode, probability: number): AstNode;
}
