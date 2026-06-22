import type { AstNode, LoggerLike } from "../types.js";
interface MethodEntryPoint {
    dispatcher?: string;
    entry: number;
}
export default class Methods {
    logger: LoggerLike;
    constructor(logger: LoggerLike);
    addCustomBind(ast: AstNode): void;
    methodRefersToArguments(method: AstNode, scopeManager: unknown): boolean;
    removeFirstArguments(method: AstNode, num: number): void;
    listMethods(ast: AstNode): string[];
    extractMethods(ast: AstNode): AstNode[];
    replaceArgumentReferences(method: AstNode, useReassignedVariable: boolean): AstNode;
    replaceFunctionCalls(ast: AstNode, methodEntryExitPoints: Record<string, MethodEntryPoint>): void;
    bumpArgumentsIndices(method: AstNode, inc: number): void;
}
export {};
