import type { Loose } from "../types.js";
export default class NumericVm {
    logger: Loose;
    options: Loose;
    count: Loose;
    constructor(logger: Loose, options: Loose);
    shouldTry(node: Loose): boolean;
    apply(ast: Loose): any;
}
