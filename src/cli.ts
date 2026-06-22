import fs from "fs";
import os from "os";
import path from "path";
import _ from "lodash";
import minimist from "minimist";
import toildefender from "./obfuscator.js";
import type { ParsedArgs } from "minimist";
import type { FeatureConfig, FeatureName, ToilDefenderResult } from "./types.js";

type FileMap = Record<string, string>;

interface CliArgs extends ParsedArgs {
    features?: string | string[];
    help?: boolean;
    input?: string | string[];
    output?: string;
    preprocessor?: string | string[];
}

interface PackageMainConfig {
    defendjs?: {
        mainFiles?: string[];
    };
    main?: string;
    toildefender?: {
        mainFiles?: string[];
    };
}

function stringArray(value: string | string[] | undefined): string[] {
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [ value ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value == "object" && value !== null && !Array.isArray(value);
}

function recordStringArray(value: unknown): string[] | undefined {
    return Array.isArray(value) && value.every((item) => typeof item == "string")
        ? value
        : undefined;
}

function packageMainConfig(value: unknown): PackageMainConfig | null {
    if (!isRecord(value)) return null;

    const toildefenderConfig = isRecord(value.toildefender) ? value.toildefender : undefined;
    const defendjsConfig = isRecord(value.defendjs) ? value.defendjs : undefined;

    return {
        defendjs: defendjsConfig
            ? { mainFiles: recordStringArray(defendjsConfig.mainFiles) }
            : undefined,
        main: typeof value.main == "string" ? value.main : undefined,
        toildefender: toildefenderConfig
            ? { mainFiles: recordStringArray(toildefenderConfig.mainFiles) }
            : undefined
    };
}

function parsePackageConfig(code: string | undefined): PackageMainConfig | null {
    if (code === undefined) return null;
    try {
        const parsed: unknown = JSON.parse(code);
        return packageMainConfig(parsed);
    } catch {
        return null;
    }
}

export function run(): void {

    const argv = minimist(process.argv.slice(2)) as CliArgs;
    if (argv.help) {
        console.info(
            "# Usage\n" +
            "\n" +
            "toildefender --input [directory] --output [directory] --features [features] --preprocessor [variable]\n" +
            "\n" +
            "# Parameters\n" +
            "\n" +
            "--input\n" +
            "\tPath to input directory or file. Can be repeated multiple times.\n" +
            "\n" +
            "--output\n" +
            "\tPath to output directory.\n" +
            "\n" +
            "--features\n" +
            "\tComma-separated list of features. (available features: " + _.join(_.keys(toildefender.features), ", ") + ")\n" +
            "\te.g. --features scope,control_flow,compress\n" +
            "\n" +
            "--preprocessor\n" +
            "\tPreprocessor variable declaration or assignment.\n" +
            (() => { switch (os.platform()) {
                case "win32":
                    return "\te.g. --preprocessor PLATFORM_WINDOWS --preprocessor PLATFORM_WINDOWS_VERSION=10\n";
                case "darwin":
                    return "\te.g. --preprocessor PLATFORM_MACOS --preprocessor PLATFORM_MACOS_VERSION=10.12\n";
                default:
                    return "\te.g. --preprocessor PLATFORM_LINUX --preprocessor PLATFORM_LINUX_VERSION=4.8\n";
            } })() +
            "\n" +
            "# Example\n" +
            "\n" +
            (() => { switch (os.platform()) { // bit of a pointless feature, but its neat
                case "win32":
                    return "toildefender --input \"D:\\project\\src\" --output \"D:\\project\\dist\" --features scope,control_flow,compress --preprocessor PLATFORM_WINDOWS\n";
                case "darwin":
                    return "toildefender --input \"~/project/src\" --output \"~/project/dist\" --features scope,control_flow,compress --preprocessor PLATFORM_MACOS\n";
                default:
                    return "toildefender --input \"~/project/src\" --output \"~/project/dist\" --features scope,control_flow,compress --preprocessor PLATFORM_LINUX\n";
            } })() +
            "\n"
        );
        process.exit(0);
    }
    const input = stringArray(argv.input);
    const preprocessor = stringArray(argv.preprocessor);

    if (input.length == 0) {
        console.error(
            "Missing --input"
        );
        process.exit(0);
    }
    if (!argv.output) {
        console.error(
            "Missing --output"
        );
        process.exit(0);
    }
    const output = argv.output;

    const files: FileMap = {};
    input.forEach((item: string) => {
        const stat = fs.lstatSync(item);
        if (stat.isDirectory()) {
            readdirRecursiveSync(item)
                .filter(
                    (file: string) => !/(^|[\\/])(\.git|node_modules)($|[\\/])/.test(file)
                )
                .forEach(
                    (file: string) => files[file] = fs.readFileSync(path.join(item, file), "utf8")
                );
        } else if (stat.isFile()) {
            files[item] = fs.readFileSync(item, "utf8");
        }
    });

    const mainFiles = getMainFiles(files);

    const selectedFeatures = new Set(
        stringArray(argv.features)
            .flatMap((value) => value.split(","))
            .map((value) => value.trim())
            .filter(Boolean)
    );
    const features = Object.fromEntries(
        (Object.keys(toildefender.features) as FeatureName[]).map((key) => [
            key,
            selectedFeatures.has(key)
        ])
    ) as FeatureConfig;

    const preprocessorVariables: Record<string, string | null> = {};
    preprocessor.forEach((decl: string) => {
        const [, variable, value] = /^\s*([\w\d]+)\s*(?:=\s*([\w\d]+))?\s*$/.exec(decl) || [];
        if (variable) {
            preprocessorVariables[variable] = value || null;
        }
    });

    const results: Record<string, ToilDefenderResult> = _.fromPairs(mainFiles.map((key: string) => {
        const code = files[key];
        if (code === undefined) {
            throw new Error(`Main file not found: ${key}`);
        }
        console.info(`Obfuscating ${key} ...`);
        return [key, toildefender.do({
            code,
            modulesCode: _.pickBy(files, (_value: string, _key: string) => key != _key && isCodeFile(_key) && !mainFiles.includes(_key)),
            features,
            preprocessorVariables
        })];
    }));

    _.each(results, (result: ToilDefenderResult, key: string) => {
        const target = path.join(output, key);
        if (!pathExists(path.dirname(target))) {
            fs.mkdirSync(path.dirname(target));
        }
        if (pathExists(target)) {
            fs.unlinkSync(target);
        }
        fs.writeFileSync(target, result.code);
    });

    function readdirRecursiveSync(dir: string): string[] {
        const results: string[] = [];
        const files = fs.readdirSync(dir);
        files.forEach(function(file: string) {
            const stat = fs.statSync(dir + "/" + file);
            if (stat.isDirectory()) {
                readdirRecursiveSync(dir + "/" + file).forEach((subfile: string) => results.push(file + "/" + subfile));
            } else {
                results.push(file);
            }
        });
        return results;
    }

    function isSourceFile(name: string): boolean {
        return _.includes([ ".js", ".json" ], path.extname(name));
    }

    function isCodeFile(name: string): boolean {
        return path.extname(name) == ".js";
    }

    function pathExists(path: string): boolean {
        try {
            const stat = fs.lstatSync(path);
            return stat.isFile() || stat.isDirectory();
        } catch (e) {
            return false;
        }
    }

    function getMainFiles(files: FileMap): string[] {
        const packageConfig = parsePackageConfig(files["package.json"]);
        if (packageConfig?.toildefender?.mainFiles) {
            return packageConfig.toildefender.mainFiles;
        } else if (packageConfig?.defendjs?.mainFiles) {
            return packageConfig.defendjs.mainFiles;
        } else if (packageConfig?.main) {
            return [ packageConfig.main ];
        } else if (Object.keys(files).filter(isSourceFile).length == 1) {
            return [ Object.keys(files).filter(isSourceFile)[0] ];
        } else {
            return [ "app.js", "main.js", "index.js" ].filter((x: string) => files[x] != null).slice(0, 1);
        }
    }

}
