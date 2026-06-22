import type { Loose } from "../types.js";
export default class Normalizer {
    logger: Loose;
    rngAlpha: Loose;
    constructor(logger: Loose);
    simplify(ast: Loose): import("../types.js").AstNode;
    simplifyBlockStatement(node: Loose): {
        type: string;
        body: any[];
    };
    simplifyWhileStatement(node: Loose): {
        type: string;
        test: {
            type: string;
            value: boolean;
        };
        body: {
            type: string;
            test: any;
            consequent: any;
            alternate: {
                type: string;
            };
        };
    };
    simplifyDoWhileStatement(node: Loose): {
        type: string;
        test: {
            type: string;
            value: boolean;
        };
        body: {
            type: string;
            body: any[];
        };
    };
    simplifyForStatement(node: Loose): {
        type: string;
        body: any[];
    };
    simplifyForInStatement(node: Loose): {
        type: string;
        init: {
            type: string;
            kind: string;
            declarations: ({
                type: string;
                id: {
                    type: string;
                    name: string;
                };
                init: {
                    type: string;
                    callee: {
                        type: string;
                        object: {
                            type: string;
                            name: string;
                        };
                        property: {
                            type: string;
                            name: string;
                        };
                        computed: boolean;
                    };
                    arguments: any[];
                    value?: undefined;
                };
            } | {
                type: string;
                id: {
                    type: string;
                    name: string;
                };
                init: {
                    type: string;
                    value: number;
                    callee?: undefined;
                    arguments?: undefined;
                };
            })[];
        };
        test: {
            type: string;
            operator: string;
            left: {
                type: string;
                name: string;
            };
            right: {
                type: string;
                object: {
                    type: string;
                    name: string;
                };
                property: {
                    type: string;
                    name: string;
                };
                computed: boolean;
            };
        };
        update: {
            type: string;
            operator: string;
            argument: {
                type: string;
                name: string;
            };
            prefix: boolean;
        };
        body: {
            type: string;
            body: any[];
        };
    };
    simplifyForOfStatement(node: Loose): {
        type: string;
        body: ({
            type: string;
            kind: string;
            declarations: {
                type: string;
                id: {
                    type: string;
                    name: string;
                };
                init: any;
            }[];
            init?: undefined;
            test?: undefined;
            update?: undefined;
            body?: undefined;
        } | {
            type: string;
            init: null;
            test: {
                type: string;
                operator: string;
                left: {
                    type: string;
                    name: string;
                };
                right: {
                    type: string;
                    object: {
                        type: string;
                        name: string;
                    };
                    property: {
                        type: string;
                        name: string;
                    };
                    computed: boolean;
                };
            };
            update: {
                type: string;
                operator: string;
                argument: {
                    type: string;
                    name: string;
                };
                prefix: boolean;
            };
            body: {
                type: string;
                body: any[];
            };
            kind?: undefined;
            declarations?: undefined;
        })[];
    };
    simplifySwitchStatement(node: Loose): any;
    simplifyTryStatement(node: Loose): Loose;
    simplifyCallExpression(node: Loose): import("../types.js").AstNode;
    simplifyExpressionStatement(node: Loose): import("../types.js").AstNode;
    simplifyChainExpression(node: Loose): any;
    lowerOptionalChain(node: Loose): Loose;
    lowerOptionalMemberCall(node: Loose): Loose;
    simplifyLogicalExpression(node: Loose): import("../types.js").AstNode;
    simplifyObjectExpression(node: Loose): import("../types.js").AstNode | {
        type: string;
        callee: {
            type: string;
            object: {
                type: string;
                name: string;
            };
            property: {
                type: string;
                name: string;
            };
            computed: boolean;
        };
        arguments: any;
    };
    simplifyVariableDeclaration(node: Loose, stack: Loose): import("../types.js").AstNode;
    simplifyArrowFunctionExpression(node: Loose): {
        type: string;
        id: null;
        params: any;
        body: any;
        generator: boolean;
        expression: boolean;
        async: boolean;
    } | {
        type: string;
        callee: {
            type: string;
            object: {
                type: string;
                id: null;
                params: any;
                body: any;
                generator: boolean;
                expression: boolean;
                async: boolean;
            };
            property: {
                type: string;
                name: string;
            };
            computed: boolean;
        };
        arguments: {
            type: string;
        }[];
    };
    simplifyClassDeclaration(node: Loose): import("../types.js").AstNode;
    lowerPrivateMembers(node: Loose, privateStores: Loose): void;
}
