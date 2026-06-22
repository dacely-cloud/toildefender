import type { LoggerLike } from "../types.js";
type PreprocessorDefines = Record<string, string | number | boolean | null | undefined>;
export default class Preprocessing {
    logger: LoggerLike;
    constructor(logger: LoggerLike);
    processDirectives(code: string, preprocessorVariables?: PreprocessorDefines): string;
    process(code: string, preprocessorVariables?: PreprocessorDefines): string;
}
export {};
