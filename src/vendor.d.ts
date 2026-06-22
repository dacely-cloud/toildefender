declare module "escope" {
    export interface AnalyzeOptions {
        ecmaVersion?: number;
        optimistic?: boolean;
        sourceType?: "script" | "module";
    }

    export function analyze(
        ast: import("./types.js").AstNode,
        options?: AnalyzeOptions
    ): import("./types.js").ScopeManagerLike;

    const escope: {
        analyze: typeof analyze;
    };

    export default escope;
}

declare module "esshorten" {
    const esshorten: {
        mangle: (
            ast: import("./types.js").AstNode,
            options?: import("./types.js").Loose
        ) => import("./types.js").AstNode;
    };

    export default esshorten;
}
