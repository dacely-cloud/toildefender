import type { Loose } from "../types.js";
export default class Methods {
    logger: Loose;
    constructor(logger: Loose);
    addCustomBind(ast: Loose): void;
    methodRefersToArguments(method: Loose, scopeManager: Loose): any;
    removeFirstArguments(method: Loose, num: Loose): void;
    listMethods(ast: Loose): any[];
    extractMethods(ast: Loose): any[];
    replaceArgumentReferences(method: Loose, useReassignedVariable: Loose): any;
    replaceFunctionCalls(ast: Loose, methodEntryExitPoints: Loose): void;
    bumpArgumentsIndices(method: Loose, inc: Loose): void;
}
