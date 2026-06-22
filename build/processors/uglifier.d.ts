import type { AstNode, LoggerLike } from "../types.js";
export default class Uglifier {
    logger: LoggerLike;
    constructor(logger: LoggerLike);
    uglify(ast: AstNode): AstNode;
}
