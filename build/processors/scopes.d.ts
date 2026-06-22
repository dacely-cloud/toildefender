import ESUtils from "../esutils.js";
import type { AstNode, LoggerLike } from "../types.js";
interface ScopeOptions {
    forceProgram?: boolean;
    ratio?: unknown;
    seed?: string;
}
export default class Scopes {
    logger: LoggerLike;
    esutils: ESUtils;
    constructor(logger: LoggerLike);
    createScopeObjects(ast: AstNode, scopeManager: unknown, options?: ScopeOptions): void;
}
export {};
