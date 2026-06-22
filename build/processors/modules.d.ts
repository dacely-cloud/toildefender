import ESUtils from "../esutils.js";
import type { AstNode, LoggerLike } from "../types.js";
export default class Modules {
    logger: LoggerLike;
    esutils: ESUtils;
    constructor(logger: LoggerLike);
    replaceExportsReferences(ast: AstNode, replacement: AstNode): AstNode;
    merge(modules: Record<string, AstNode>, mainKey: string, _scopeManager: unknown): AstNode;
}
