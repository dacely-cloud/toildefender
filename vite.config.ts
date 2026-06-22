import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const nodeBuiltins = new Set([
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`)
]);

const runtimeDependencies = [
    "@babel/parser",
    "escodegen",
    "escope",
    "esprima",
    "esshorten",
    "estraverse",
    "expr-eval-fork",
    "lodash",
    "minimist"
];

export default defineConfig({
    build: {
        emptyOutDir: true,
        lib: {
            entry: {
                toildefender: "src/toildefender.ts",
                cli: "src/cli.ts",
                "processors/preprocessing": "src/processors/preprocessing.ts"
            },
            formats: [ "es", "cjs" ],
            fileName: (format, entryName) => format === "cjs" ? `${entryName}.cjs` : `${entryName}.js`
        },
        minify: false,
        outDir: "build",
        rollupOptions: {
            external: (id) =>
                nodeBuiltins.has(id)
                || runtimeDependencies.some((dependency) => id == dependency || id.startsWith(`${dependency}/`)),
            output: {
                exports: "named"
            }
        },
        sourcemap: false,
        target: "node24"
    }
});
