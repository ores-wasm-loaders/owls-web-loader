import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import {readFileSync,writeFileSync} from "node:fs";
// AJV's supported compiler generates CSP-compatible validation at build time.
const schema=JSON.parse(readFileSync("zed_modules/ores-wasm-loaders/owls-interfaces/schemas/release.schema.json","utf8"));
const ajv=new Ajv2020({code:{source:true,esm:true},allErrors:true});
writeFileSync("src/generated-validate.js",standaloneCode(ajv,ajv.compile(schema)));

