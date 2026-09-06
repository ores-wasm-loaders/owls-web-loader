var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  "node_modules/ajv/dist/runtime/ucs2length.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value;
      while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 55296 && value <= 56319 && pos < len) {
          value = str.charCodeAt(pos);
          if ((value & 64512) === 56320)
            pos++;
        }
      }
      return length;
    }
    exports.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  }
});

// src/generated-validate.js
var generated_validate_default = validate20;
var schema31 = { "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "https://ores-wasm-loaders.github.io/schemas/release-v1.json", "title": "WASM application release", "type": "object", "additionalProperties": false, "required": ["schemaVersion", "appId", "release", "runtime", "entrypoint", "assets"], "properties": { "schemaVersion": { "const": 1 }, "appId": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{0,63}$" }, "release": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }, "runtime": { "enum": ["raw-wasm", "wasm-bindgen", "flutter-web"] }, "entrypoint": { "type": "string", "minLength": 1, "maxLength": 128 }, "assets": { "type": "array", "minItems": 1, "maxItems": 512, "items": { "$ref": "#/$defs/asset" } }, "extensions": { "type": "object" } }, "$defs": { "asset": { "type": "object", "additionalProperties": false, "required": ["id", "url", "kind", "bytes", "sha256", "prepare"], "properties": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }, "url": { "type": "string", "pattern": "^https://[^\\s]+$", "maxLength": 4096 }, "kind": { "enum": ["wasm", "module", "script", "data", "font"] }, "bytes": { "type": "integer", "minimum": 1, "maximum": 268435456 }, "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" }, "prepare": { "type": "boolean" } } } } };
var schema32 = { "type": "object", "additionalProperties": false, "required": ["id", "url", "kind", "bytes", "sha256", "prepare"], "properties": { "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }, "url": { "type": "string", "pattern": "^https://[^\\s]+$", "maxLength": 4096 }, "kind": { "enum": ["wasm", "module", "script", "data", "font"] }, "bytes": { "type": "integer", "minimum": 1, "maximum": 268435456 }, "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" }, "prepare": { "type": "boolean" } } };
var pattern4 = new RegExp("^[a-z0-9][a-z0-9-]{0,63}$", "u");
var pattern5 = new RegExp("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$", "u");
var pattern7 = new RegExp("^https://[^\\s]+$", "u");
var pattern8 = new RegExp("^[0-9a-f]{64}$", "u");
var func1 = require_ucs2length().default;
function validate20(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate20.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.schemaVersion === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "schemaVersion" }, message: "must have required property 'schemaVersion'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.appId === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "appId" }, message: "must have required property 'appId'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.release === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "release" }, message: "must have required property 'release'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.runtime === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "runtime" }, message: "must have required property 'runtime'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.entrypoint === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entrypoint" }, message: "must have required property 'entrypoint'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.assets === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "assets" }, message: "must have required property 'assets'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "schemaVersion" || key0 === "appId" || key0 === "release" || key0 === "runtime" || key0 === "entrypoint" || key0 === "assets" || key0 === "extensions")) {
        const err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.schemaVersion !== void 0) {
      if (1 !== data.schemaVersion) {
        const err7 = { instancePath: instancePath + "/schemaVersion", schemaPath: "#/properties/schemaVersion/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.appId !== void 0) {
      let data1 = data.appId;
      if (typeof data1 === "string") {
        if (!pattern4.test(data1)) {
          const err8 = { instancePath: instancePath + "/appId", schemaPath: "#/properties/appId/pattern", keyword: "pattern", params: { pattern: "^[a-z0-9][a-z0-9-]{0,63}$" }, message: 'must match pattern "^[a-z0-9][a-z0-9-]{0,63}$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/appId", schemaPath: "#/properties/appId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.release !== void 0) {
      let data2 = data.release;
      if (typeof data2 === "string") {
        if (!pattern5.test(data2)) {
          const err10 = { instancePath: instancePath + "/release", schemaPath: "#/properties/release/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"' };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/release", schemaPath: "#/properties/release/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.runtime !== void 0) {
      let data3 = data.runtime;
      if (!(data3 === "raw-wasm" || data3 === "wasm-bindgen" || data3 === "flutter-web")) {
        const err12 = { instancePath: instancePath + "/runtime", schemaPath: "#/properties/runtime/enum", keyword: "enum", params: { allowedValues: schema31.properties.runtime.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.entrypoint !== void 0) {
      let data4 = data.entrypoint;
      if (typeof data4 === "string") {
        if (func1(data4) > 128) {
          const err13 = { instancePath: instancePath + "/entrypoint", schemaPath: "#/properties/entrypoint/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
        if (func1(data4) < 1) {
          const err14 = { instancePath: instancePath + "/entrypoint", schemaPath: "#/properties/entrypoint/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
      } else {
        const err15 = { instancePath: instancePath + "/entrypoint", schemaPath: "#/properties/entrypoint/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
    if (data.assets !== void 0) {
      let data5 = data.assets;
      if (Array.isArray(data5)) {
        if (data5.length > 512) {
          const err16 = { instancePath: instancePath + "/assets", schemaPath: "#/properties/assets/maxItems", keyword: "maxItems", params: { limit: 512 }, message: "must NOT have more than 512 items" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
        if (data5.length < 1) {
          const err17 = { instancePath: instancePath + "/assets", schemaPath: "#/properties/assets/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
        const len0 = data5.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data6 = data5[i0];
          if (data6 && typeof data6 == "object" && !Array.isArray(data6)) {
            if (data6.id === void 0) {
              const err18 = { instancePath: instancePath + "/assets/" + i0, schemaPath: "#/$defs/asset/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              if (vErrors === null) {
                vErrors = [err18];
              } else {
                vErrors.push(err18);
              }
              errors++;
            }
            if (data6.url === void 0) {
              const err19 = { instancePath: instancePath + "/assets/" + i0, schemaPath: "#/$defs/asset/required", keyword: "required", params: { missingProperty: "url" }, message: "must have required property 'url'" };
              if (vErrors === null) {
                vErrors = [err19];
              } else {
                vErrors.push(err19);
              }
              errors++;
            }
            if (data6.kind === void 0) {
              const err20 = { instancePath: instancePath + "/assets/" + i0, schemaPath: "#/$defs/asset/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
              if (vErrors === null) {
                vErrors = [err20];
              } else {
                vErrors.push(err20);
              }
              errors++;
            }
            if (data6.bytes === void 0) {
              const err21 = { instancePath: instancePath + "/assets/" + i0, schemaPath: "#/$defs/asset/required", keyword: "required", params: { missingProperty: "bytes" }, message: "must have required property 'bytes'" };
              if (vErrors === null) {
                vErrors = [err21];
              } else {
                vErrors.push(err21);
              }
              errors++;
            }
            if (data6.sha256 === void 0) {
              const err22 = { instancePath: instancePath + "/assets/" + i0, schemaPath: "#/$defs/asset/required", keyword: "required", params: { missingProperty: "sha256" }, message: "must have required property 'sha256'" };
              if (vErrors === null) {
                vErrors = [err22];
              } else {
                vErrors.push(err22);
              }
              errors++;
            }
            if (data6.prepare === void 0) {
              const err23 = { instancePath: instancePath + "/assets/" + i0, schemaPath: "#/$defs/asset/required", keyword: "required", params: { missingProperty: "prepare" }, message: "must have required property 'prepare'" };
              if (vErrors === null) {
                vErrors = [err23];
              } else {
                vErrors.push(err23);
              }
              errors++;
            }
            for (const key1 in data6) {
              if (!(key1 === "id" || key1 === "url" || key1 === "kind" || key1 === "bytes" || key1 === "sha256" || key1 === "prepare")) {
                const err24 = { instancePath: instancePath + "/assets/" + i0, schemaPath: "#/$defs/asset/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err24];
                } else {
                  vErrors.push(err24);
                }
                errors++;
              }
            }
            if (data6.id !== void 0) {
              let data7 = data6.id;
              if (typeof data7 === "string") {
                if (!pattern5.test(data7)) {
                  const err25 = { instancePath: instancePath + "/assets/" + i0 + "/id", schemaPath: "#/$defs/asset/properties/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"' };
                  if (vErrors === null) {
                    vErrors = [err25];
                  } else {
                    vErrors.push(err25);
                  }
                  errors++;
                }
              } else {
                const err26 = { instancePath: instancePath + "/assets/" + i0 + "/id", schemaPath: "#/$defs/asset/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err26];
                } else {
                  vErrors.push(err26);
                }
                errors++;
              }
            }
            if (data6.url !== void 0) {
              let data8 = data6.url;
              if (typeof data8 === "string") {
                if (func1(data8) > 4096) {
                  const err27 = { instancePath: instancePath + "/assets/" + i0 + "/url", schemaPath: "#/$defs/asset/properties/url/maxLength", keyword: "maxLength", params: { limit: 4096 }, message: "must NOT have more than 4096 characters" };
                  if (vErrors === null) {
                    vErrors = [err27];
                  } else {
                    vErrors.push(err27);
                  }
                  errors++;
                }
                if (!pattern7.test(data8)) {
                  const err28 = { instancePath: instancePath + "/assets/" + i0 + "/url", schemaPath: "#/$defs/asset/properties/url/pattern", keyword: "pattern", params: { pattern: "^https://[^\\s]+$" }, message: 'must match pattern "^https://[^\\s]+$"' };
                  if (vErrors === null) {
                    vErrors = [err28];
                  } else {
                    vErrors.push(err28);
                  }
                  errors++;
                }
              } else {
                const err29 = { instancePath: instancePath + "/assets/" + i0 + "/url", schemaPath: "#/$defs/asset/properties/url/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err29];
                } else {
                  vErrors.push(err29);
                }
                errors++;
              }
            }
            if (data6.kind !== void 0) {
              let data9 = data6.kind;
              if (!(data9 === "wasm" || data9 === "module" || data9 === "script" || data9 === "data" || data9 === "font")) {
                const err30 = { instancePath: instancePath + "/assets/" + i0 + "/kind", schemaPath: "#/$defs/asset/properties/kind/enum", keyword: "enum", params: { allowedValues: schema32.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                if (vErrors === null) {
                  vErrors = [err30];
                } else {
                  vErrors.push(err30);
                }
                errors++;
              }
            }
            if (data6.bytes !== void 0) {
              let data10 = data6.bytes;
              if (!(typeof data10 == "number" && (!(data10 % 1) && !isNaN(data10)) && isFinite(data10))) {
                const err31 = { instancePath: instancePath + "/assets/" + i0 + "/bytes", schemaPath: "#/$defs/asset/properties/bytes/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                if (vErrors === null) {
                  vErrors = [err31];
                } else {
                  vErrors.push(err31);
                }
                errors++;
              }
              if (typeof data10 == "number" && isFinite(data10)) {
                if (data10 > 268435456 || isNaN(data10)) {
                  const err32 = { instancePath: instancePath + "/assets/" + i0 + "/bytes", schemaPath: "#/$defs/asset/properties/bytes/maximum", keyword: "maximum", params: { comparison: "<=", limit: 268435456 }, message: "must be <= 268435456" };
                  if (vErrors === null) {
                    vErrors = [err32];
                  } else {
                    vErrors.push(err32);
                  }
                  errors++;
                }
                if (data10 < 1 || isNaN(data10)) {
                  const err33 = { instancePath: instancePath + "/assets/" + i0 + "/bytes", schemaPath: "#/$defs/asset/properties/bytes/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
                  if (vErrors === null) {
                    vErrors = [err33];
                  } else {
                    vErrors.push(err33);
                  }
                  errors++;
                }
              }
            }
            if (data6.sha256 !== void 0) {
              let data11 = data6.sha256;
              if (typeof data11 === "string") {
                if (!pattern8.test(data11)) {
                  const err34 = { instancePath: instancePath + "/assets/" + i0 + "/sha256", schemaPath: "#/$defs/asset/properties/sha256/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
                  if (vErrors === null) {
                    vErrors = [err34];
                  } else {
                    vErrors.push(err34);
                  }
                  errors++;
                }
              } else {
                const err35 = { instancePath: instancePath + "/assets/" + i0 + "/sha256", schemaPath: "#/$defs/asset/properties/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err35];
                } else {
                  vErrors.push(err35);
                }
                errors++;
              }
            }
            if (data6.prepare !== void 0) {
              if (typeof data6.prepare !== "boolean") {
                const err36 = { instancePath: instancePath + "/assets/" + i0 + "/prepare", schemaPath: "#/$defs/asset/properties/prepare/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                if (vErrors === null) {
                  vErrors = [err36];
                } else {
                  vErrors.push(err36);
                }
                errors++;
              }
            }
          } else {
            const err37 = { instancePath: instancePath + "/assets/" + i0, schemaPath: "#/$defs/asset/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err37];
            } else {
              vErrors.push(err37);
            }
            errors++;
          }
        }
      } else {
        const err38 = { instancePath: instancePath + "/assets", schemaPath: "#/properties/assets/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err38];
        } else {
          vErrors.push(err38);
        }
        errors++;
      }
    }
    if (data.extensions !== void 0) {
      let data13 = data.extensions;
      if (!(data13 && typeof data13 == "object" && !Array.isArray(data13))) {
        const err39 = { instancePath: instancePath + "/extensions", schemaPath: "#/properties/extensions/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err39];
        } else {
          vErrors.push(err39);
        }
        errors++;
      }
    }
  } else {
    const err40 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err40];
    } else {
      vErrors.push(err40);
    }
    errors++;
  }
  validate20.errors = vErrors;
  return errors === 0;
}
validate20.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };

// src/manifest.ts
var LoaderError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "LoaderError";
  }
};
function assertOrigin(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new LoaderError("origin", "Allowed origin is not a parseable URL");
  }
  if (u.protocol !== "https:" || u.username || u.password || u.pathname !== "/" || u.search || u.hash || u.href !== `${u.origin}/` || raw !== u.origin)
    throw new LoaderError("origin", "Allowed origins must be canonical HTTPS origins");
  return u.origin;
}
function assertAssetUrl(raw, origins) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new LoaderError("origin", "Asset URL is not a parseable absolute URL");
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.href !== raw || !origins.includes(u.origin))
    throw new LoaderError("origin", "Asset URL must be canonical HTTPS on an allowed origin");
  return u;
}
function parseRelease(input, origins) {
  if (!generated_validate_default(input)) throw new LoaderError("manifest", "Release does not match release-v1 schema");
  const allowedOrigins = origins.map(assertOrigin);
  const r = structuredClone(input);
  const ids = /* @__PURE__ */ new Set(), urls = /* @__PURE__ */ new Set();
  for (const a of r.assets) {
    assertAssetUrl(a.url, allowedOrigins);
    if (ids.has(a.id) || urls.has(a.url)) throw new LoaderError("duplicate", "Duplicate asset identity");
    ids.add(a.id);
    urls.add(a.url);
    Object.freeze(a);
  }
  const e = r.assets.find((a) => a.id === r.entrypoint);
  const expected = r.runtime === "raw-wasm" ? "wasm" : r.runtime === "wasm-bindgen" ? "module" : "script";
  if (!e || e.kind !== expected) throw new LoaderError("entrypoint", "Entrypoint kind does not match runtime");
  Object.freeze(r.assets);
  freezeJson(r.extensions);
  return Object.freeze(r);
}
function assetKey(a) {
  return a.url + "#" + a.sha256;
}
function releaseKey(r) {
  return r.appId + "@" + r.release;
}
function releaseIdentity(r) {
  return canonicalJson(r);
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function freezeJson(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
}

// src/transport.ts
var MemoryStore = class {
  constructor(maxBytes = 64 * 1024 * 1024) {
    this.maxBytes = maxBytes;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new LoaderError("budget", "Invalid cache budget");
  }
  values = /* @__PURE__ */ new Map();
  size = 0;
  async get(key) {
    const value = this.values.get(key);
    if (value) {
      this.values.delete(key);
      this.values.set(key, value);
    }
    return value?.slice();
  }
  async delete(key) {
    const old = this.values.get(key);
    if (old) this.size -= old.length;
    this.values.delete(key);
  }
  async put(key, bytes) {
    await this.delete(key);
    if (bytes.length > this.maxBytes) return;
    while (this.size + bytes.length > this.maxBytes) await this.delete(this.values.keys().next().value);
    this.values.set(key, bytes.slice());
    this.size += bytes.length;
  }
};
async function verifyBytes(asset, bytes) {
  if (bytes.byteLength !== asset.bytes) throw new LoaderError("size", "Asset byte length mismatch");
  const hash = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  const hex = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== asset.sha256) throw new LoaderError("integrity", "Asset SHA-256 mismatch");
}
function responseContentTypeAllowed(asset, header) {
  const type = header?.split(";", 1)[0]?.trim().toLowerCase();
  if (!type) return false;
  if (asset.kind === "wasm") return type === "application/wasm";
  if (asset.kind === "module" || asset.kind === "script")
    return ["text/javascript", "application/javascript", "text/ecmascript", "application/ecmascript"].includes(type);
  if (asset.kind === "font") return ["font/woff", "font/woff2", "font/ttf", "font/otf", "application/font-woff"].includes(type);
  return type !== "text/html" && type !== "application/xhtml+xml";
}
function httpTransport(fetcher = globalThis.fetch) {
  return async (asset, signal) => {
    const response = await fetcher(asset.url, {
      signal,
      credentials: "omit",
      redirect: "error",
      mode: "cors",
      referrerPolicy: "no-referrer",
      cache: "default"
    });
    if (!response.ok || !response.body || response.type === "opaque")
      throw new LoaderError("http", "Asset request failed");
    if (!responseContentTypeAllowed(asset, response.headers.get("content-type")))
      throw new LoaderError("mime", "Asset response has an unexpected content type");
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (; ; ) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > asset.bytes) throw new LoaderError("size", "Asset exceeds declared byte budget");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {
      });
      reader.releaseLock();
    }
    signal.throwIfAborted();
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  };
}

// src/coordinator.ts
function browserPolicy(origins) {
  return {
    origins,
    maxPrepareBytes: 8 * 1024 * 1024,
    maxAssetBytes: 64 * 1024 * 1024,
    concurrency: 2,
    timeoutMs: 3e4,
    activationJoinMs: 50,
    allowPreparation: () => {
      const n = globalThis.navigator;
      return !n?.connection?.saveData && !["slow-2g", "2g"].includes(n?.connection?.effectiveType ?? "");
    }
  };
}
var Coordinator = class {
  constructor(policy, transport = httpTransport(), store = new MemoryStore(), report = () => {
  }) {
    this.transport = transport;
    this.store = store;
    this.report = report;
    for (const n of [policy.maxPrepareBytes, policy.maxAssetBytes, policy.concurrency, policy.timeoutMs])
      if (!Number.isSafeInteger(n) || n < 1) throw new LoaderError("budget", "Policy limits must be positive integers");
    if (!Number.isSafeInteger(policy.activationJoinMs) || policy.activationJoinMs < 0)
      throw new LoaderError("budget", "Activation join must be a non-negative safe integer");
    const origins = policy.origins.map(assertOrigin);
    const activationJoinMs = Math.min(policy.activationJoinMs, policy.timeoutMs);
    this.policy = Object.freeze({ ...policy, activationJoinMs, origins: Object.freeze(origins) });
  }
  policy;
  manifests = /* @__PURE__ */ new Map();
  preparing = /* @__PURE__ */ new Map();
  active = /* @__PURE__ */ new Map();
  running = 0;
  queue = [];
  register(input) {
    const r = parseRelease(input, this.policy.origins), key = releaseKey(r);
    const identity = releaseIdentity(r);
    const old = this.manifests.get(key);
    if (old && old.identity !== identity) throw new LoaderError("release-conflict", "Release ID already identifies different assets");
    this.manifests.set(key, { release: r, identity });
    return r;
  }
  emit(event) {
    try {
      this.report(Object.freeze(event));
    } catch {
    }
  }
  get(key) {
    const entry = this.manifests.get(key);
    if (!entry) throw new LoaderError("unregistered", "Register the release before use");
    return entry.release;
  }
  async slot(signal, work) {
    signal.throwIfAborted();
    if (this.running >= this.policy.concurrency) await new Promise((resolve, reject) => {
      const grant = () => {
        signal.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        const i = this.queue.indexOf(grant);
        if (i >= 0) this.queue.splice(i, 1);
        reject(signal.reason);
      };
      this.queue.push(grant);
      signal.addEventListener("abort", abort, { once: true });
    });
    else this.running++;
    try {
      signal.throwIfAborted();
      return await work();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.running--;
    }
  }
  async bytes(r, id, signal) {
    signal.throwIfAborted();
    const a = r.assets.find((a2) => a2.id === id);
    if (!a) throw new LoaderError("asset", "Unknown asset");
    if (a.bytes > this.policy.maxAssetBytes) throw new LoaderError("budget", "Asset exceeds policy");
    return this.slot(signal, async () => {
      const key = assetKey(a), cached = await this.store.get(key).catch(() => void 0);
      if (cached) {
        try {
          await verifyBytes(a, cached);
          signal.throwIfAborted();
          return cached;
        } catch {
          await this.store.delete(key).catch(() => {
          });
          signal.throwIfAborted();
        }
      }
      const bytes = await this.transport(a, signal);
      signal.throwIfAborted();
      await verifyBytes(a, bytes);
      signal.throwIfAborted();
      await this.store.put(key, bytes).catch(() => {
      });
      this.emit({ phase: "fetch", appId: r.appId, release: r.release, assetId: a.id, bytes: bytes.length });
      return bytes;
    });
  }
  newPreparation(key, r) {
    const job = {
      controller: new AbortController(),
      leases: /* @__PURE__ */ new Set(),
      promise: Promise.resolve({}),
      claimed: false,
      settled: false
    };
    this.preparing.set(key, job);
    const timer = setTimeout(() => job.controller.abort(new LoaderError("timeout", "Preparation timed out")), this.policy.timeoutMs);
    job.promise = this.runPreparation(r, job).finally(() => {
      clearTimeout(timer);
      job.settled = true;
      if (this.preparing.get(key) === job) this.preparing.delete(key);
    });
    return job;
  }
  async runPreparation(r, job) {
    const selected = r.assets.filter((a) => a.prepare);
    const completed = /* @__PURE__ */ new Set();
    const tasks = selected.map(async (a) => {
      await this.bytes(r, a.id, job.controller.signal);
      completed.add(a.id);
    });
    try {
      await Promise.all(tasks);
      job.controller.signal.throwIfAborted();
      const prepared = selected.filter((a) => completed.has(a.id));
      const outcome = this.outcome(r, "warmed", prepared.map((a) => a.id), [], prepared.reduce((n, a) => n + a.bytes, 0));
      this.emit({ phase: "prepared", appId: r.appId, release: r.release });
      return outcome;
    } catch (error) {
      const cancelled = job.controller.signal.aborted;
      if (!cancelled) job.controller.abort(error);
      await Promise.allSettled(tasks);
      const prepared = selected.filter((a) => completed.has(a.id));
      const skipped = selected.filter((a) => !completed.has(a.id)).map((a) => ({
        id: a.id,
        reason: cancelled ? "cancelled" : "failed"
      }));
      if (!cancelled) this.emit({ phase: "error", appId: r.appId, release: r.release });
      return this.outcome(
        r,
        cancelled ? "cancelled" : "failed",
        prepared.map((a) => a.id),
        skipped,
        prepared.reduce((n, a) => n + a.bytes, 0),
        reasonOf(error)
      );
    }
  }
  outcome(r, status, prepared, skipped, bytes, reason) {
    return Object.freeze({
      status,
      appId: r.appId,
      release: r.release,
      prepared: Object.freeze([...prepared]),
      skipped: Object.freeze(skipped.map((s) => Object.freeze({ ...s }))),
      bytes,
      ...reason ? { reason } : {}
    });
  }
  /** Acquire a shared, cancellable preparation lease. Releasing one lease never cancels another. */
  prepare(key, signal) {
    const r = this.get(key);
    const selected = r.assets.filter((a) => a.prepare);
    if (!this.policy.allowPreparation(r)) {
      const outcome = this.outcome(r, "skipped", [], selected.map((a) => ({ id: a.id, reason: "policy-declined" })), 0, "policy-declined");
      return { promise: Promise.resolve(outcome), release: () => {
      } };
    }
    if (selected.reduce((n, a) => n + a.bytes, 0) > this.policy.maxPrepareBytes || selected.some((a) => a.bytes > this.policy.maxAssetBytes))
      throw new LoaderError("budget", "Preparation exceeds policy");
    const job = this.preparing.get(key) ?? this.newPreparation(key, r);
    const token = Symbol(key);
    job.leases.add(token);
    let released = false;
    let onAbort;
    const release = () => {
      if (released) return;
      released = true;
      job.leases.delete(token);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      if (!job.settled && !job.claimed && job.leases.size === 0)
        job.controller.abort(new LoaderError("cancelled", "Preparation released"));
    };
    if (signal?.aborted) release();
    else if (signal) {
      onAbort = release;
      signal.addEventListener("abort", onAbort, { once: true });
    }
    return { promise: job.promise, release };
  }
  /** Fetch-only preparation. The resolved outcome is telemetry-friendly; it never blocks activation. */
  prefetch(key, signal) {
    let lease;
    try {
      lease = this.prepare(key, signal);
    } catch (error) {
      return Promise.reject(error);
    }
    return lease.promise.then((outcome) => signal?.aborted ? this.outcome(
      this.get(key),
      "cancelled",
      outcome.prepared,
      outcome.skipped,
      outcome.bytes,
      "caller-aborted"
    ) : outcome).finally(lease.release);
  }
  /** Abort unclaimed preparation for one release, for pagehide or an explicit policy decision. */
  cancelPreparation(key) {
    const job = this.preparing.get(key);
    if (!job || job.settled || job.claimed) return false;
    job.controller.abort(new LoaderError("cancelled", "Preparation cancelled"));
    return true;
  }
  /** Abort all speculative jobs that have not been claimed by activation. */
  cancelAllPreparation() {
    for (const key of this.preparing.keys()) this.cancelPreparation(key);
  }
  async joinPreparation(job) {
    if (job.settled) return;
    if (this.policy.activationJoinMs === 0) {
      job.controller.abort(new LoaderError("cancelled", "Activation took ownership"));
      return;
    }
    await new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          resolve();
        }
      };
      const timer = setTimeout(finish, this.policy.activationJoinMs);
      void job.promise.then(finish, finish);
    });
    if (!job.settled) job.controller.abort(new LoaderError("cancelled", "Activation took ownership"));
  }
  /** Activation owns a lifetime separate from speculative fetch; a failed warmup never prevents it. */
  activate(key, adapter) {
    const r = this.get(key), old = this.active.get(key);
    if (old) {
      if (old.adapter !== adapter) return Promise.reject(new LoaderError("adapter-conflict", "Release already has an activation owner"));
      return old.promise;
    }
    const preparation = this.preparing.get(key);
    if (preparation) preparation.claimed = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new LoaderError("timeout", "Activation timed out")), this.policy.timeoutMs);
    const p = Promise.resolve().then(async () => {
      if (preparation) await this.joinPreparation(preparation);
      controller.signal.throwIfAborted();
      const result = await abortable(adapter.activate({ release: r, signal: controller.signal, bytes: (id) => this.bytes(r, id, controller.signal) }), controller.signal);
      controller.signal.throwIfAborted();
      this.emit({ phase: "activated", appId: r.appId, release: r.release });
      return result;
    }).catch((error) => {
      this.emit({ phase: "error", appId: r.appId, release: r.release });
      throw error;
    }).finally(() => clearTimeout(timer));
    this.active.set(key, { adapter, promise: p });
    return p;
  }
  /** Release a persistent-shell activation; the adapter owns the actual cleanup semantics. */
  async deactivate(key) {
    const entry = this.active.get(key);
    if (!entry) return false;
    try {
      const instance = await entry.promise;
      if (entry.adapter.deactivate) await entry.adapter.deactivate(instance);
    } finally {
      this.active.delete(key);
    }
    return true;
  }
};
function reasonOf(error) {
  if (error instanceof LoaderError) return error.code;
  if (typeof DOMException !== "undefined" && error instanceof DOMException) return error.name;
  if (error instanceof Error) return error.name;
  return "error";
}
function abortable(work, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

// src/adapters.ts
var RawWasmAdapter = class {
  constructor(imports = {}) {
    this.imports = imports;
  }
  compiled;
  owner;
  async compile(context) {
    if (context.release.runtime !== "raw-wasm") throw new LoaderError("runtime", "Raw adapter requires raw-wasm");
    const key = releaseKey(context.release);
    if (this.owner && this.owner !== key) throw new LoaderError("release-conflict", "Use a new adapter per release");
    this.owner = key;
    if (!this.compiled) this.compiled = context.bytes(context.release.entrypoint).then((bytes) => WebAssembly.compile(bytes.slice().buffer)).catch((error) => {
      this.compiled = void 0;
      throw error;
    });
    return this.compiled;
  }
  async activate(context) {
    const module = await this.compile(context);
    context.signal.throwIfAborted();
    return WebAssembly.instantiate(module, this.imports);
  }
};
var BindgenAdapter = class {
  constructor(wasmAssetId, loadGlue, start = async (glue) => glue) {
    this.wasmAssetId = wasmAssetId;
    this.loadGlue = loadGlue;
    this.start = start;
  }
  async activate(context) {
    if (context.release.runtime !== "wasm-bindgen") throw new LoaderError("runtime", "Expected wasm-bindgen release");
    const asset = context.release.assets.find((a) => a.id === this.wasmAssetId);
    if (asset?.kind !== "wasm") throw new LoaderError("asset", "Bindgen binary must be a declared WASM asset");
    const bytes = await context.bytes(this.wasmAssetId);
    context.signal.throwIfAborted();
    const glue = await this.loadGlue(context);
    context.signal.throwIfAborted();
    if (typeof glue?.default !== "function") throw new LoaderError("glue", "Generated glue does not export an init function");
    await glue.default({ module_or_path: bytes });
    context.signal.throwIfAborted();
    return this.start(glue, context);
  }
};
var LeptosAdapter = class extends BindgenAdapter {
  constructor(wasmAssetId, loadGlue, hydrate) {
    super(wasmAssetId, loadGlue, async (glue, context) => {
      context.signal.throwIfAborted();
      await hydrate(glue);
    });
  }
};
var DioxusAdapter = class extends BindgenAdapter {
};

// src/flutter.ts
var owners = /* @__PURE__ */ new WeakMap();
var FlutterAdapter = class {
  constructor(options) {
    this.options = options;
  }
  async activate(context) {
    if (context.release.runtime !== "flutter-web") throw new LoaderError("runtime", "Expected flutter-web release");
    const { document: doc } = this.options, key = releaseKey(context.release), owner = owners.get(doc);
    if (owner && owner !== key) throw new LoaderError("flutter-owner", "Use a separate document for independent Flutter builds");
    if (!owner && this.options.getLoader()) throw new LoaderError("flutter-owner", "An unmanaged Flutter loader already owns this document");
    owners.set(doc, key);
    const asset = context.release.assets.find((a) => a.id === context.release.entrypoint);
    await context.bytes(asset.id);
    context.signal.throwIfAborted();
    await new Promise((resolve, reject) => {
      const script = doc.createElement("script");
      const finish = (error) => {
        script.onload = null;
        script.onerror = null;
        context.signal.removeEventListener("abort", abort);
        if (error) {
          script.remove();
          reject(error);
        } else resolve();
      };
      const abort = () => finish(context.signal.reason);
      script.src = asset.url;
      const binary = asset.sha256.match(/../g).map((n) => String.fromCharCode(parseInt(n, 16))).join("");
      script.integrity = "sha256-" + btoa(binary);
      script.crossOrigin = "anonymous";
      script.referrerPolicy = "no-referrer";
      if (this.options.nonce) script.nonce = this.options.nonce;
      script.onload = () => finish();
      script.onerror = () => finish(new LoaderError("bootstrap", "Flutter bootstrap failed"));
      context.signal.addEventListener("abort", abort, { once: true });
      doc.head.append(script);
    });
    context.signal.throwIfAborted();
    const loader = this.options.getLoader();
    if (!loader) throw new LoaderError("bootstrap", "Generated Flutter loader is missing");
    return new Promise((resolve, reject) => {
      let called = false;
      const abort = () => reject(context.signal.reason);
      context.signal.addEventListener("abort", abort, { once: true });
      try {
        Promise.resolve(loader.load({
          config: this.options.loadConfig ?? {},
          onEntrypointLoaded: async (initializer) => {
            if (called) return;
            called = true;
            try {
              context.signal.throwIfAborted();
              const engine = await initializer.initializeEngine({ ...this.options.engineConfig, multiViewEnabled: true });
              context.signal.throwIfAborted();
              const app = await engine.runApp();
              context.signal.throwIfAborted();
              resolve(app);
            } catch (error) {
              reject(error);
            } finally {
              context.signal.removeEventListener("abort", abort);
            }
          }
        })).catch((error) => {
          context.signal.removeEventListener("abort", abort);
          reject(error);
        });
      } catch (error) {
        context.signal.removeEventListener("abort", abort);
        reject(error);
      }
    });
  }
};
function mountFlutterView(app, hostElement, initialData) {
  const id = app.addView({ hostElement, initialData });
  let removed = false;
  return () => {
    if (!removed) {
      removed = true;
      app.removeView(id);
    }
  };
}

// src/hints.ts
function hintDescriptors(release, rel = "prefetch", budget = 8 * 1024 * 1024) {
  const selected = release.assets.filter((a) => a.prepare && (rel !== "modulepreload" || a.kind === "module"));
  if (!Number.isSafeInteger(budget) || budget < 1 || selected.reduce((n, a) => n + a.bytes, 0) > budget)
    throw new LoaderError("budget", "Hints exceed declared preparation budget");
  return selected.map((a) => Object.freeze({
    rel,
    href: a.url,
    as: rel === "modulepreload" ? void 0 : "fetch",
    crossorigin: "anonymous",
    referrerpolicy: "no-referrer"
  }));
}
function addHints(doc, release, rel = "prefetch", budget) {
  const links = hintDescriptors(release, rel, budget).map((h) => {
    const link = doc.createElement("link");
    for (const [key, value] of Object.entries(h)) if (value) link.setAttribute(key, value);
    doc.head.append(link);
    return link;
  });
  return () => links.forEach((link) => link.remove());
}
function prepareOnIntent(element, coordinator, key, optionsOrError = {}) {
  const options = typeof optionsOrError === "function" ? { onError: optionsOrError } : optionsOrError;
  const dwellMs = options.dwellMs ?? 150, exitGraceMs = options.exitGraceMs ?? 150;
  if (!Number.isSafeInteger(dwellMs) || dwellMs < 0 || !Number.isSafeInteger(exitGraceMs) || exitGraceMs < 0)
    throw new LoaderError("budget", "Intent delays must be non-negative safe integers");
  const doc = options.doc ?? element.ownerDocument;
  let pointer = false, focused = false, touched = false, stopped = false;
  let startTimer, releaseTimer;
  let lease;
  const wanted = () => pointer || focused || touched;
  const clearStart = () => {
    if (startTimer !== void 0) {
      clearTimeout(startTimer);
      startTimer = void 0;
    }
  };
  const clearRelease = () => {
    if (releaseTimer !== void 0) {
      clearTimeout(releaseTimer);
      releaseTimer = void 0;
    }
  };
  const release = () => {
    clearRelease();
    lease?.release();
    lease = void 0;
  };
  const reportError = (error) => {
    try {
      options.onError?.(error);
    } catch {
    }
  };
  const reportOutcome = (outcome) => {
    try {
      options.onOutcome?.(outcome);
    } catch {
    }
  };
  const start = () => {
    if (stopped || lease || !wanted()) return;
    try {
      lease = coordinator.prepare(key);
      void lease.promise.then(reportOutcome, reportError);
    } catch (error) {
      reportError(error);
    }
  };
  const arm = () => {
    clearRelease();
    if (startTimer === void 0 && !lease) startTimer = setTimeout(() => {
      startTimer = void 0;
      start();
    }, dwellMs);
  };
  const releaseLater = () => {
    if (wanted()) {
      clearRelease();
      return;
    }
    clearStart();
    if (releaseTimer !== void 0) return;
    releaseTimer = setTimeout(() => {
      releaseTimer = void 0;
      if (!wanted()) release();
    }, exitGraceMs);
  };
  const pointerEnter = () => {
    pointer = true;
    arm();
  };
  const pointerLeave = () => {
    pointer = false;
    releaseLater();
  };
  const focusIn = () => {
    focused = true;
    arm();
  };
  const focusOut = () => {
    focused = false;
    releaseLater();
  };
  const touchStart = () => {
    touched = true;
    clearStart();
    start();
  };
  const touchEnd = () => {
    touched = false;
    releaseLater();
  };
  const pointerDown = () => {
    pointer = true;
    clearStart();
    start();
  };
  const hide = () => {
    if (doc?.visibilityState === "hidden") {
      pointer = false;
      focused = false;
      touched = false;
      clearStart();
      release();
    }
  };
  element.addEventListener("pointerenter", pointerEnter, { passive: true });
  element.addEventListener("pointerleave", pointerLeave, { passive: true });
  element.addEventListener("pointerdown", pointerDown, { passive: true });
  element.addEventListener("focusin", focusIn, { passive: true });
  element.addEventListener("focusout", focusOut, { passive: true });
  element.addEventListener("touchstart", touchStart, { passive: true });
  element.addEventListener("touchend", touchEnd, { passive: true });
  element.addEventListener("touchcancel", touchEnd, { passive: true });
  doc?.addEventListener("visibilitychange", hide);
  doc?.addEventListener("pagehide", hide);
  return () => {
    stopped = true;
    pointer = false;
    focused = false;
    touched = false;
    clearStart();
    release();
    element.removeEventListener("pointerenter", pointerEnter);
    element.removeEventListener("pointerleave", pointerLeave);
    element.removeEventListener("pointerdown", pointerDown);
    element.removeEventListener("focusin", focusIn);
    element.removeEventListener("focusout", focusOut);
    element.removeEventListener("touchstart", touchStart);
    element.removeEventListener("touchend", touchEnd);
    element.removeEventListener("touchcancel", touchEnd);
    doc?.removeEventListener("visibilitychange", hide);
    doc?.removeEventListener("pagehide", hide);
  };
}
function prepareWhenIdle(coordinator, key, onError = () => {
}) {
  const controller = new AbortController();
  const start = () => {
    void coordinator.prefetch(key, controller.signal).catch(onError);
  };
  const win = globalThis;
  const idle = !!win.requestIdleCallback;
  const id = idle ? win.requestIdleCallback(start) : setTimeout(start, 200);
  return () => {
    controller.abort();
    if (idle) win.cancelIdleCallback?.(id);
    else clearTimeout(id);
  };
}

// src/webview.ts
function createWebViewBridge(coordinator, adapters, currentDocument, reply) {
  return Object.freeze({ receive(input) {
    const r = input;
    const valid = r && typeof r === "object" && Object.keys(r).sort().join(",") === "document,method,releaseKey,requestId" && typeof r.requestId === "string" && /^[0-9]{1,16}$/.test(r.requestId) && typeof r.releaseKey === "string" && r.releaseKey.length <= 256 && r.document === currentDocument() && ["prefetch", "activate"].includes(r.method);
    if (!valid) throw new LoaderError("bridge", "Invalid bridge request or document");
    const operation = async () => {
      if (r.method === "prefetch") await coordinator.prefetch(r.releaseKey);
      else {
        const adapter = adapters.get(r.releaseKey);
        if (!adapter) throw new LoaderError("bridge", "No activation adapter registered");
        await coordinator.activate(r.releaseKey, adapter);
      }
    };
    void operation().then(
      () => reply(JSON.stringify({ requestId: r.requestId, ok: true })),
      () => reply(JSON.stringify({ requestId: r.requestId, ok: false }))
    );
  } });
}

// src/cache-storage.ts
var CacheStorageStore = class {
  constructor(storage, origin, namespace, maxEntryBytes = 64 * 1024 * 1024, maxEntries = 32) {
    this.origin = origin;
    this.namespace = namespace;
    this.maxEntryBytes = maxEntryBytes;
    this.maxEntries = maxEntries;
    if (!/^owls-[a-z0-9-]+$/.test(namespace) || new URL(origin).origin !== origin || !origin.startsWith("https://") || !Number.isSafeInteger(maxEntryBytes) || maxEntryBytes < 1 || !Number.isSafeInteger(maxEntries) || maxEntries < 1)
      throw new LoaderError("cache", "Invalid cache configuration");
    this.cache = storage.open(namespace);
  }
  cache;
  async request(key) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const hex = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
    return new Request(this.origin + "/.owls-cache/" + this.namespace + "/" + hex);
  }
  async get(key) {
    const response = await (await this.cache).match(await this.request(key));
    if (!response?.body) return void 0;
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > this.maxEntryBytes) throw new LoaderError("budget", "Cached entry too large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {
      });
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }
  async put(key, bytes) {
    if (bytes.length > this.maxEntryBytes) return;
    const cache = await this.cache;
    await cache.put(await this.request(key), new Response(bytes.slice().buffer, { headers: { "content-type": "application/octet-stream" } }));
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - this.maxEntries))) await cache.delete(old);
  }
  async delete(key) {
    await (await this.cache).delete(await this.request(key));
  }
};
export {
  BindgenAdapter,
  CacheStorageStore,
  Coordinator,
  DioxusAdapter,
  FlutterAdapter,
  LeptosAdapter,
  LoaderError,
  MemoryStore,
  RawWasmAdapter,
  addHints,
  assertAssetUrl,
  assertOrigin,
  assetKey,
  browserPolicy,
  canonicalJson,
  createWebViewBridge,
  freezeJson,
  hintDescriptors,
  httpTransport,
  mountFlutterView,
  parseRelease,
  prepareOnIntent,
  prepareWhenIdle,
  releaseIdentity,
  releaseKey,
  responseContentTypeAllowed,
  verifyBytes
};
