import type { Loose } from "../types.js";
export default class Literals {
    logger: Loose;
    constructor(logger: Loose);
    extractStrings(ast: Loose): any;
    generateStrings(ast: Loose): any;
}
