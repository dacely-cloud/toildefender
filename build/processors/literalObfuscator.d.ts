import type { AstNode, LoggerLike } from "../types.js";
export default class LiteralObfuscator {
    logger: LoggerLike;
    constructor(logger: LoggerLike);
    obfuscateString1(input: string): AstNode;
}
