import type { Loose, ReferenceLike } from "./types.js";
export declare function splice<T>(arr: T[], pos: number, del: number, elems: T[]): void;
export declare function unshift<T>(arr: T[], arr2: T | T[]): void;
export declare function push<T>(arr: T[], arr2: T | T[]): void;
export declare function array<T>(obj: T | T[]): T[];
export declare function cloneISwearIKnowWhatImDoing<T>(obj: T): T;
export declare function random(minimum: number, maximum: number): number;
export declare function randomAlpha(length: number): string;
export declare function isResolvedReference(reference: ReferenceLike): boolean;
export declare class UniqueRandom {
    private readonly arr;
    private idx;
    private readonly max;
    constructor(max: number);
    get(): number;
}
export declare class UniqueRandomAlpha {
    private readonly offset;
    private readonly rng;
    constructor(len: number);
    get(): string;
}
export declare class HashMap<T = Loose> {
    private readonly store;
    get(key: string): T | undefined;
    set(key: string, value: T): T;
    exists(key: string): boolean;
    remove(key: string): void;
}
export declare function hash(obj: unknown): string;
declare const _default: {
    splice: typeof splice;
    unshift: typeof unshift;
    push: typeof push;
    array: typeof array;
    cloneISwearIKnowWhatImDoing: typeof cloneISwearIKnowWhatImDoing;
    random: typeof random;
    randomAlpha: typeof randomAlpha;
    isResolvedReference: typeof isResolvedReference;
    UniqueRandom: typeof UniqueRandom;
    UniqueRandomAlpha: typeof UniqueRandomAlpha;
    HashMap: typeof HashMap;
    hash: typeof hash;
};
export default _default;
