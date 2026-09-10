// Dependency-free .ores-wasm.toml boundary. The browser loader is first-party bootstrap code,
// so it deliberately does not pull a general TOML package into the page. This parser accepts
// only the TOML surface needed by the v1 contract and rejects everything else explicitly.

import {
  LoaderError,
  parseOresWasmConfig,
  resolveOresWasmEnv,
} from './contract.mjs';

const BARE_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;

function tomlError(line, message) {
  return new LoaderError('config-toml', `.ores-wasm.toml:${line}: ${message}`);
}

function stripComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '#') return line.slice(0, index);
  }
  return line;
}

function parsePath(raw, line) {
  const parts = raw.trim().split('.').map((part) => part.trim());
  if (!parts.length || parts.some((part) => !BARE_KEY.test(part))) {
    throw tomlError(line, `only bare dotted keys matching ${BARE_KEY} are supported`);
  }
  return parts;
}

function splitArray(body, line) {
  const values = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[') depth += 1;
    else if (char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      values.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quote || depth !== 0) throw tomlError(line, 'unterminated array value');
  const tail = body.slice(start).trim();
  if (tail) values.push(tail);
  else if (values.length && body.trim().endsWith(',')) return values;
  return values;
}

function parseValue(raw, line) {
  const value = raw.trim();
  if (!value) throw tomlError(line, 'missing value after =');

  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) throw tomlError(line, 'unterminated basic string');
    try {
      return JSON.parse(value);
    } catch {
      throw tomlError(line, 'basic strings must use JSON-compatible escapes');
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) throw tomlError(line, 'unterminated literal string');
    return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?(?:0|[1-9][0-9]*)$/u.test(value)) {
    const integer = Number(value);
    if (!Number.isSafeInteger(integer)) throw tomlError(line, 'integer is outside the JavaScript safe range');
    return integer;
  }
  if (/^-?(?:0|[1-9][0-9]*)\.[0-9]+(?:[eE][+-]?[0-9]+)?$/u.test(value)) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw tomlError(line, 'floating-point value must be finite');
    return number;
  }
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) throw tomlError(line, 'unterminated array');
    const body = value.slice(1, -1).trim();
    if (!body) return [];
    return splitArray(body, line).map((entry) => parseValue(entry, line));
  }
  if (value.startsWith('{') || value.startsWith('[[')) {
    throw tomlError(line, 'inline tables and arrays-of-tables are intentionally unsupported; use named tables');
  }
  throw tomlError(line, `unsupported value syntax: ${value}`);
}

function ensureTable(root, path, line) {
  let node = root;
  for (const part of path) {
    if (!(part in node)) node[part] = {};
    else if (!node[part] || typeof node[part] !== 'object' || Array.isArray(node[part])) {
      throw tomlError(line, `${path.join('.')} conflicts with an existing scalar value`);
    }
    node = node[part];
  }
  return node;
}

function assign(root, basePath, keyPath, value, line) {
  const parent = ensureTable(root, [...basePath, ...keyPath.slice(0, -1)], line);
  const key = keyPath.at(-1);
  if (Object.hasOwn(parent, key)) throw tomlError(line, `duplicate key ${[...basePath, ...keyPath].join('.')}`);
  parent[key] = value;
}

/** Parse the strict, portable TOML subset used by .ores-wasm.toml into plain JSON data. */
export function parseOresWasmTomlDocument(source) {
  if (typeof source !== 'string') throw new LoaderError('config-toml', '.ores-wasm.toml source must be a string');
  const root = {};
  const seenTables = new Set();
  let tablePath = [];
  const lines = source.replace(/^\uFEFF/u, '').split(/\r?\n/u);

  for (let offset = 0; offset < lines.length; offset += 1) {
    const lineNumber = offset + 1;
    const line = stripComment(lines[offset]).trim();
    if (!line) continue;

    if (line.startsWith('[[')) throw tomlError(lineNumber, 'arrays-of-tables are intentionally unsupported; use [hosts.<name>]');
    if (line.startsWith('[')) {
      if (!line.endsWith(']')) throw tomlError(lineNumber, 'unterminated table header');
      const path = parsePath(line.slice(1, -1), lineNumber);
      const key = path.join('.');
      if (seenTables.has(key)) throw tomlError(lineNumber, `duplicate table [${key}]`);
      ensureTable(root, path, lineNumber);
      seenTables.add(key);
      tablePath = path;
      continue;
    }

    let quote = null;
    let escaped = false;
    let equals = -1;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (quote === '"' && escaped) {
        escaped = false;
        continue;
      }
      if (quote === '"' && char === '\\') {
        escaped = true;
        continue;
      }
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") quote = char;
      else if (char === '=') {
        equals = index;
        break;
      }
    }
    if (equals <= 0) throw tomlError(lineNumber, 'expected key = value');
    const keyPath = parsePath(line.slice(0, equals), lineNumber);
    assign(root, tablePath, keyPath, parseValue(line.slice(equals + 1), lineNumber), lineNumber);
  }

  return root;
}

/** Parse TOML, validate the shared config contract, normalize defaults, and freeze it. */
export function parseOresWasmToml(source) {
  return parseOresWasmConfig(parseOresWasmTomlDocument(source));
}

/** Parse TOML and apply only env overrides explicitly declared by the config contract. */
export function resolveOresWasmToml(source, environment = globalThis.process?.env ?? {}) {
  return resolveOresWasmEnv(parseOresWasmToml(source), environment);
}

/** Node-only convenience for the conventional repository-root .ores-wasm.toml file. */
export async function loadOresWasmConfig({ path = '.ores-wasm.toml', environment = globalThis.process?.env ?? {} } = {}) {
  if (!globalThis.process?.versions?.node) {
    throw new LoaderError('config-file', 'loadOresWasmConfig is Node-only; browser callers should fetch text and use parseOresWasmToml');
  }
  const { readFile } = await import('node:fs/promises');
  let source;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    throw new LoaderError('config-file', `Unable to read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return resolveOresWasmToml(source, environment);
}
