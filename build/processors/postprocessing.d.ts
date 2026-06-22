import type { AstNode, LoggerLike } from "../types.js";
export default class Postprocessing {
    logger: LoggerLike;
    constructor(logger: LoggerLike);
    do(ast: AstNode): AstNode;
}
