import assert from "assert";
import _ from "lodash";
import escodegen from "escodegen";
import * as esprima from "esprima";
import traverser from "./traverser.js";
import type { ReferenceLike } from "./types.js";

export function splice<T>(arr: T[], pos: number, del: number, elems: T[]): void {
    arr.splice(pos, del, ...elems);
}

export function unshift<T>(arr: T[], arr2: T | T[]): void {
    if (Array.isArray(arr2)) {
        arr.unshift(...arr2);
    } else {
        arr.push(arr2);
    }
}

export function push<T>(arr: T[], arr2: T | T[]): void {
    if (Array.isArray(arr2)) {
        arr.push(...arr2);
    } else {
        arr.push(arr2);
    }
}

export function array<T>(obj: T | T[]): T[] {
    return Array.isArray(obj) ? obj : [ obj ];
}

export function cloneISwearIKnowWhatImDoing<T>(obj: T): T {
    const cloned = JSON.parse(JSON.stringify(obj)) as T;
    return cloned;
}

/**
 * Generate a random number.
 * @param {number} Inclusive minimum
 * @param {number} Inclusive maximum
 * @returns {number}
 */
export function random(minimum: number, maximum: number): number {
    return Math.floor(Math.random() * (maximum - minimum)) + minimum;
}

export function randomAlpha(length: number): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    for (let i=0; i < length; i++) { 
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }

    return text;
}

export function isResolvedReference(reference: ReferenceLike): boolean {
    return reference.resolved !== undefined
        && reference.resolved !== null
        && Array.isArray(reference.resolved.defs)
        && reference.resolved.defs.length > 0;
}

export class UniqueRandom {
    private readonly arr: number[];
    private idx = 0;
    private readonly max: number;

    constructor(max: number) {
        assert(typeof max == "number");
        if (max > 32768) {
            console.warn(`Allocating large (${max}) UniqueRandom instance`);
        }
        this.max = max;
        this.arr = _.shuffle(_.range(max));
    }

    get(): number {
        if (this.idx < this.max) {
            return this.arr[this.idx++];
        } else {
            throw new Error("No numbers left");
        }
    }
}

export class UniqueRandomAlpha {
    private readonly offset: number;
    private readonly rng: UniqueRandom;

    constructor(len: number) {
        assert(typeof len == "number");
        this.offset = Math.pow(32, len - 1);
        this.rng = new UniqueRandom(this.offset * 31);
    }

    get(): string {
        return (this.offset + this.rng.get()).toString(32);  
    }
}

export class HashMap<T = unknown> {
    private readonly store: Record<string, T> = {};

    get(key: string): T | undefined {
        return this.store["HashMap" + key];
    }

    set(key: string, value: T): T {
        return this.store["HashMap" + key] = value;
    }

    exists(key: string): boolean {
        return this.store["HashMap" + key] !== undefined;
    }

    remove(key: string): void {
        delete this.store["HashMap" + key];
    }
}

interface HashableObject {
    $$hash?: string;
}

function isHashableObject(value: unknown): value is HashableObject {
    return (typeof value == "object" && value !== null) || typeof value == "function";
}

export function hash(obj: unknown): string {
    if (obj == null) {
        return "x";
    }
    
    if (typeof obj == "string") {
        return "s" + obj;
    }
    
    if (typeof obj == "number") {
        return "n" + obj.toString();
    }
    
    if (!isHashableObject(obj)) {
        return String(obj);
    }
    
    if (obj.$$hash) {
        return obj.$$hash;
    }

    Object.defineProperty(obj, "$$hash", {
        configurable: false,
        enumerable: false,
        value: "o" + randomAlpha(8)
    });

    return obj.$$hash || "x";
}

export default {
    splice,
    unshift,
    push,
    array,
    cloneISwearIKnowWhatImDoing,
    random,
    randomAlpha,
    isResolvedReference,
    UniqueRandom,
    UniqueRandomAlpha,
    HashMap,
    hash
};
