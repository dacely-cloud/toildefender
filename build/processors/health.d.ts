import type { AstNode, LoggerLike } from "../types.js";
export default class Health {
    logger: LoggerLike;
    strict: boolean;
    constructor(logger: LoggerLike);
    throwError(msg: string): void;
    check(ast: AstNode): AstNode;
}
