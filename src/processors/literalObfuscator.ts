import assert from "assert";
import * as esprima from "esprima";
import type { AstNode, LoggerLike } from "../types.js";

export default class LiteralObfuscator {
    logger: LoggerLike;

    constructor (logger: LoggerLike) {
        this.logger = logger;
    }
    
    /**
     * Generate an obfuscated string generator
     * @param {string} input
     * @returns {Node}
     */
    obfuscateString1 (input: string): AstNode {
        assert.equal(typeof input, "string");
        
        function is16Bit (s: string): boolean {
            return s.split("").some((x: string) => x.charCodeAt(0) > 65536);
        }
        
        const getCharCode = function (x: string): number { return x.charCodeAt(0); };
        const chars = input.split("").map(getCharCode);

        const out: number[] = [];
        for (let i = 0; i < input.length; i += 2) {
            const n = chars[i] | (chars[i + 1] << 16);
            out.push(n);
        }
        
        return esprima.parseScript(`
        var input = ${JSON.stringify(out)};
        input.map(function(x) { return String.fromCharCode(x & ~0 >>> 16) + String.fromCharCode(x >> 16); }).join("");
        `) as unknown as AstNode;
    }
    
};
