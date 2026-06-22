import type { Loose } from "../types.js";
export default class Scopes {
    logger: Loose;
    esutils: Loose;
    constructor(logger: Loose);
    createScopeObjects(ast: Loose, scopeManager: Loose, options: Loose): void;
}
