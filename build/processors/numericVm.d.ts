import type { AstNode, LoggerLike } from "../types.js";
interface HashMeshOptions {
    bindToVmState?: boolean;
    chaffRatio?: number;
    deriveDialectFromMesh?: boolean;
    enabled?: boolean;
    encodeChaff?: boolean;
    mode?: string;
    serverBound?: boolean;
    unlock?: string;
}
interface NumericVmResolvedOptions {
    enabled: boolean;
    excludeNames: string[];
    hashMesh: HashMeshOptions;
    maxFunctionSize: number;
    maxFunctions: number;
    minFunctionSize: number;
    mode: string;
    ratio: number;
    seed: string;
    virtualize: string;
}
export default class NumericVm {
    logger: LoggerLike;
    options: NumericVmResolvedOptions;
    count: number;
    constructor(logger: LoggerLike, options: unknown);
    shouldTry(node: AstNode): boolean;
    apply(ast: AstNode): AstNode;
}
export {};
