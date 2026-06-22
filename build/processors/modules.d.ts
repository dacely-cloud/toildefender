import type { Loose } from "../types.js";
export default class Modules {
    logger: Loose;
    esutils: Loose;
    constructor(logger: Loose);
    replaceExportsReferences(ast: Loose, replacement: Loose): any;
    merge(modules: Loose, mainKey: Loose, scopeManager: Loose): any;
}
