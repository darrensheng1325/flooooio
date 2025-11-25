import * as esbuild from "esbuild";
import { readFileSync, rm, writeFileSync } from "fs";
import { readFile } from "fs/promises";
import JsConfuser from "js-confuser";
import { confirm } from "@inquirer/prompts";
import { optimize } from "svgo";

const prebuildedFileName = "./prebuilded-" + Date.now() + ".js";

// Check if running in non-interactive mode (CI, automated builds, etc.)
const isNonInteractive = process.env.CI === "true" || 
                         process.env.NON_INTERACTIVE === "true" ||
                         !process.stdin.isTTY;

async function build(isWatch, obfuscateEnabled = false) {

    const ctx = await esbuild.context({
        entryPoints: ["./Sources/LegacyClient/Application.ts"],
        bundle: true,
        minify: true,
        target: "es2022",
        outfile:
            obfuscateEnabled
                ? prebuildedFileName
                : "./Sources/server/static/client.js",
        legalComments: "none",
        tsconfig: "./tsconfig.json",
        loader: { ".svg": "text" },
        plugins: [
            {
                name: "svgo",
                setup({ onLoad }) {
                    onLoad({ filter: /\.svg$/ }, async args => {
                        const raw = await readFile(args.path, "utf-8");
                        const { data: contents } = optimize(raw);

                        return { contents, loader: "default" };
                    });
                },
            },
            {
                name: "watch-client-only",
                setup({ onEnd }) {
                    onEnd(async result => {
                        if (obfuscateEnabled) {
                            console.log("Builded, starts obfuscate with js-confuser...");

                            JsConfuser.obfuscate(readFileSync(prebuildedFileName, "utf-8"), {
                                target: "browser",
                                preset: "low",
                                verbose: true,
                                compact: true,

                                stringEncoding: false,
                                stringCompression: false,
                                stringConcealing: false,

                                shuffle: false,
                                controlFlowFlattening: false,
                                globalConcealing: false,

                                opaquePredicates: true,
                                variableMasking: true,

                                identifierGenerator: "mangled",
                                hexadecimalNumbers: false,
                                deadCode: false,
                            }).then(result => {
                                writeFileSync("./Sources/server/static/client.js", result.code);
                                rm(prebuildedFileName, () => { });

                                console.log("Ofsucated");
                            });
                        } else {
                            console.log("Builded");
                        }
                    });
                },
            },
        ],
    });

    if (isWatch) {
        await ctx.watch();
        
        console.log("Watching...");
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

async function main() {
    let watchMode = false;
    let obfuscateEnabled = false;

    if (isNonInteractive) {
        // Non-interactive mode: use defaults or environment variables
        watchMode = process.env.WATCH === "true";
        obfuscateEnabled = process.env.OBFUSCATE === "true";
    } else {
        // Interactive mode: prompt user
        watchMode = await confirm({
            message: "Enable watch mode?",
            default: false,
        });

        obfuscateEnabled = await confirm({
            message: "Obfuscate bundled javascript?",
            default: false,
        });
    }

    await build(watchMode, obfuscateEnabled);
}

main();