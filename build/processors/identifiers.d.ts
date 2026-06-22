import type { Loose } from "../types.js";
export default class Identifiers {
    logger: Loose;
    esutils: Loose;
    constructor(logger: Loose);
    hasParentAcceptingUndefined(node: Loose): any;
    computeProperties(ast: Loose): any;
    arrayizeObjects(ast: Loose, options: Loose): any;
    moveIdentifiers(ast: Loose, scopeManager: Loose): import("../types.js").AstNode;
    moveLiterals(ast: Loose, scopeManager: Loose): any;
}
