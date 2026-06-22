import type { Loose } from "../types.js";
export default class Uglifier {
    logger: Loose;
    constructor(logger: Loose);
    uglify(ast: Loose): any;
}
