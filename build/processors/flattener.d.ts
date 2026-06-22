import type { Loose } from "../types.js";
export default class Flattener {
    logger: Loose;
    rng: Loose;
    emitter: Loose;
    output: Loose;
    handlers: Loose;
    breaks: Loose;
    continues: Loose;
    constructor(logger: Loose, rng: Loose);
    addMethod(input: Loose, entry: Loose, exit: Loose): void;
    getCases(entry: Loose, exit: Loose): {
        type: string;
        block: {
            type: string;
            body: {
                type: string;
                discriminant: {
                    type: string;
                    name: string;
                };
                cases: any[];
            }[];
        };
        handler: {
            type: string;
            param: {
                type: string;
                name: string;
            };
            body: {
                type: string;
                body: ({
                    type: string;
                    expression: {
                        type: string;
                        operator: string;
                        left: {
                            type: string;
                            name: string;
                        };
                        right: {
                            type: string;
                            value: null;
                        };
                    };
                    discriminant?: undefined;
                    cases?: undefined;
                } | {
                    type: string;
                    discriminant: {
                        type: string;
                        name: string;
                    };
                    cases: any;
                    expression?: undefined;
                })[];
            };
        };
    };
    getProgram(entry: Loose, exit: Loose, options: Loose): {
        type: string;
        body: any[];
    };
    transformStatement(node: Loose, entry: Loose, exit: Loose): void;
    transformBlock(node: Loose, entry: Loose, exit: Loose): void;
    transformSequence(node: Loose, entry: Loose, exit: Loose): void;
    transformIf(node: Loose, entry: Loose, exit: Loose): void;
    transformWhile(node: Loose, entry: Loose, exit: Loose): void;
    transformDoWhile(node: Loose, entry: Loose, exit: Loose): void;
    transformSwitch(node: Loose, entry: Loose, exit: Loose): void;
    transformTryCatch(node: Loose, entry: Loose, exit: Loose): void;
    unifyPrefixStatements(ast: Loose): any;
}
