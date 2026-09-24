//! Build-output inventory, never a browser loader. Reads one JSON recipe on stdin.
//! No command-line options are accepted. Validate output with owls-interfaces before use.
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
};
use url::Url;
mod telemetry;
type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Recipe {
    root: PathBuf,
    base_url: String,
    app_id: String,
    release: String,
    runtime: String,
    entrypoint: String,
    #[serde(default)]
    framework: Option<String>,
    #[serde(default)]
    islands: Vec<String>,
    #[serde(default)]
    routes: BTreeMap<String, String>,
    /// Named raw-Wasm page/application roots. Values are build-output paths.
    #[serde(default)]
    roots: BTreeMap<String, String>,
    /// Build-output paths, never asset IDs. Producers derive this from exact build output.
    #[serde(default)]
    dependencies: BTreeMap<String, Vec<String>>,
    /// Optional exact asset IDs for raw-Wasm graph nodes. These are also the default
    /// import namespaces used by ComposedWasmAdapter.
    #[serde(default)]
    asset_ids: BTreeMap<String, String>,
    #[serde(default)]
    toolchain: BTreeMap<String, String>,
}

fn identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.as_bytes()[0].is_ascii_alphanumeric()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}
fn app_identifier(s: &str) -> bool {
    identifier(s)
        && s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn safe_path(s: &str) -> bool {
    !s.is_empty()
        && s.split('/').all(|x| {
            !x.is_empty()
                && !x.starts_with('.')
                && x.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        })
}
fn route_key(s: &str) -> bool {
    s.starts_with('/')
        && s.len() <= 256
        && !s
            .bytes()
            .any(|b| b.is_ascii_whitespace() || b.is_ascii_control() || b"?#".contains(&b))
        && s.split('/')
            .skip(1)
            .all(|segment| segment != "." && segment != "..")
}
fn chunk_id(path: &str) -> String {
    format!("chunk-{:x}", Sha256::digest(path.as_bytes()))
}
fn raw_default_id(path: &str) -> Result<String> {
    let stem = path
        .strip_suffix(".wasm")
        .ok_or_else(|| format!("raw-Wasm graph path is not .wasm: {path}"))?;
    let candidate = stem.replace('/', "-");
    if identifier(&candidate) {
        Ok(candidate)
    } else {
        Err(format!(
            "raw-Wasm path {path} cannot derive a safe asset/import id; declare asset_ids"
        ))
    }
}
fn mime(path: &str) -> Option<&'static str> {
    match path.rsplit('.').next()? {
        "wasm" => Some("application/wasm"),
        "mjs" | "js" => Some("text/javascript"),
        "json" => Some("application/json"),
        "css" => Some("text/css"),
        "ttf" => Some("font/ttf"),
        "otf" => Some("font/otf"),
        "woff" => Some("font/woff"),
        "woff2" => Some("font/woff2"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "svg" => Some("image/svg+xml"),
        "bin" => Some("application/octet-stream"),
        _ => None,
    }
}
fn inventory(root: &Path, dir: &Path, out: &mut Vec<String>) -> Result<()> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_str()
            .ok_or("non-UTF8 asset")?
            .replace('\\', "/");
        if ty.is_symlink() {
            return Err(format!("symlink asset forbidden: {relative}"));
        }
        if !safe_path(&relative) {
            return Err(format!("unsafe asset path: {relative}"));
        }
        if ty.is_dir() {
            inventory(root, &path, out)?;
        } else if ty.is_file() && mime(&relative).is_some() {
            out.push(relative);
        } else if !ty.is_file() {
            return Err("non-regular asset forbidden".into());
        }
        if out.len() > 512 {
            return Err("release exceeds the contract's 512-asset limit".into());
        }
    }
    Ok(())
}
fn validate_dependency_graph(graph: &BTreeMap<String, Vec<String>>) -> Result<()> {
    fn visit(
        node: &str,
        graph: &BTreeMap<String, Vec<String>>,
        visiting: &mut BTreeSet<String>,
        visited: &mut BTreeSet<String>,
        path: &mut Vec<String>,
    ) -> Result<()> {
        if visited.contains(node) {
            return Ok(());
        }
        if visiting.contains(node) {
            let start = path.iter().position(|value| value == node).unwrap_or(0);
            let mut cycle = path[start..].to_vec();
            cycle.push(node.to_string());
            return Err(format!("Wasm dependency cycle: {}", cycle.join(" -> ")));
        }
        visiting.insert(node.to_string());
        path.push(node.to_string());
        if let Some(dependencies) = graph.get(node) {
            for dependency in dependencies {
                visit(dependency, graph, visiting, visited, path)?;
            }
        }
        path.pop();
        visiting.remove(node);
        visited.insert(node.to_string());
        Ok(())
    }
    let mut visiting = BTreeSet::new();
    let mut visited = BTreeSet::new();
    for node in graph.keys() {
        visit(node, graph, &mut visiting, &mut visited, &mut Vec::new())?;
    }
    Ok(())
}
fn validate_wasm_path(path: &str, paths: &[String], label: &str) -> Result<()> {
    if !safe_path(path) || !path.ends_with(".wasm") || !paths.contains(&path.to_string()) {
        return Err(format!("{label} must name an actual emitted Wasm file"));
    }
    Ok(())
}
fn validate_split_path(path: &str, expected_wasm: &str, paths: &[String], label: &str) -> Result<()> {
    validate_wasm_path(path, paths, label)?;
    if path == expected_wasm {
        return Err(format!("{label} must name an actual emitted split Wasm file"));
    }
    Ok(())
}
fn reachable_from(roots: &BTreeSet<String>, graph: &BTreeMap<String, Vec<String>>) -> BTreeSet<String> {
    fn visit(node: &str, graph: &BTreeMap<String, Vec<String>>, seen: &mut BTreeSet<String>) {
        if !seen.insert(node.to_string()) {
            return;
        }
        if let Some(dependencies) = graph.get(node) {
            for dependency in dependencies {
                visit(dependency, graph, seen);
            }
        }
    }
    let mut seen = BTreeSet::new();
    for root in roots {
        visit(root, graph, &mut seen);
    }
    seen
}
fn closure_from(root: &str, graph: &BTreeMap<String, Vec<String>>) -> BTreeSet<String> {
    let roots = BTreeSet::from([root.to_string()]);
    reachable_from(&roots, graph)
}
fn validate_edges(graph: &BTreeMap<String, Vec<String>>, paths: &[String], label: &str) -> Result<()> {
    for (source, dependencies) in graph {
        validate_wasm_path(source, paths, &format!("{label} dependency source"))?;
        if dependencies.len() > 64 {
            return Err(format!("{label} dependency source {source} exceeds 64 dependencies"));
        }
        let mut unique = BTreeSet::new();
        for dependency in dependencies {
            validate_wasm_path(dependency, paths, &format!("{label} dependency target"))?;
            if dependency == source {
                return Err(format!("{label} Wasm file {source} cannot depend on itself"));
            }
            if !unique.insert(dependency.clone()) {
                return Err(format!("{label} Wasm file {source} repeats dependency {dependency}"));
            }
        }
    }
    validate_dependency_graph(graph)
}

#[derive(Default)]
struct RawPlan {
    roots: BTreeMap<String, String>,
    root_paths: BTreeSet<String>,
    graph_paths: BTreeSet<String>,
    ids: BTreeMap<String, String>,
    default_closure: BTreeSet<String>,
}
fn raw_plan(recipe: &Recipe, paths: &[String]) -> Result<RawPlan> {
    validate_wasm_path(&recipe.entrypoint, paths, "raw-Wasm entrypoint")?;
    validate_edges(&recipe.dependencies, paths, "raw-Wasm")?;

    let roots = if recipe.roots.is_empty() {
        BTreeMap::from([("default".to_string(), recipe.entrypoint.clone())])
    } else {
        recipe.roots.clone()
    };
    let mut root_paths = BTreeSet::new();
    for (name, path) in &roots {
        if !identifier(name) {
            return Err(format!("invalid raw-Wasm root name: {name}"));
        }
        validate_wasm_path(path, paths, &format!("raw-Wasm root {name}"))?;
        if !root_paths.insert(path.clone()) {
            return Err(format!("raw-Wasm root path is declared more than once: {path}"));
        }
    }
    if !root_paths.contains(&recipe.entrypoint) {
        return Err("raw-Wasm roots must include the entrypoint path".into());
    }

    let reachable = reachable_from(&root_paths, &recipe.dependencies);
    for source in recipe.dependencies.keys() {
        if !reachable.contains(source) {
            return Err(format!("raw-Wasm dependency source {source} is not reachable from any root"));
        }
    }
    let mut graph_paths = reachable;
    graph_paths.extend(root_paths.iter().cloned());

    for path in recipe.asset_ids.keys() {
        if !graph_paths.contains(path) {
            return Err(format!("raw-Wasm asset_ids entry {path} is not part of the reachable graph"));
        }
    }
    let mut ids = BTreeMap::new();
    let mut used = BTreeSet::new();
    for path in &graph_paths {
        let id = match recipe.asset_ids.get(path) {
            Some(id) if identifier(id) => id.clone(),
            Some(_) => return Err(format!("raw-Wasm asset id for {path} is invalid")),
            None => raw_default_id(path)?,
        };
        if !used.insert(id.clone()) {
            return Err(format!("raw-Wasm graph produces duplicate asset id {id}"));
        }
        ids.insert(path.clone(), id);
    }

    Ok(RawPlan {
        roots,
        root_paths,
        graph_paths,
        ids,
        default_closure: closure_from(&recipe.entrypoint, &recipe.dependencies),
    })
}

fn build(recipe: &Recipe) -> Result<Value> {
    if !app_identifier(&recipe.app_id)
        || !identifier(&recipe.release)
        || !safe_path(&recipe.entrypoint)
    {
        return Err("invalid build identity".into());
    }
    if !["raw-wasm", "wasm-bindgen", "flutter-web"].contains(&recipe.runtime.as_str()) {
        return Err("unsupported build runtime".into());
    }
    let framework = match (recipe.runtime.as_str(), recipe.framework.as_deref()) {
        ("raw-wasm", None | Some("none")) => "none",
        ("flutter-web", None | Some("flutter")) => "flutter",
        ("wasm-bindgen", None | Some("leptos")) => "leptos",
        ("wasm-bindgen", Some("dioxus")) => "dioxus",
        _ => return Err("framework is incompatible with build runtime".into()),
    };
    if framework == "leptos"
        && (recipe.islands.is_empty()
            || !recipe.routes.is_empty()
            || !recipe.roots.is_empty()
            || !recipe.dependencies.is_empty()
            || !recipe.asset_ids.is_empty())
    {
        return Err("Leptos build must declare islands and no routes/raw-Wasm graph metadata".into());
    }
    if framework == "dioxus"
        && (!recipe.islands.is_empty()
            || recipe.routes.is_empty()
            || !recipe.roots.is_empty()
            || !recipe.asset_ids.is_empty())
    {
        return Err("Dioxus build must declare routes and no Leptos/raw-Wasm metadata".into());
    }
    if framework == "flutter"
        && (!recipe.islands.is_empty()
            || !recipe.routes.is_empty()
            || !recipe.roots.is_empty()
            || !recipe.dependencies.is_empty()
            || !recipe.asset_ids.is_empty())
    {
        return Err("Flutter build cannot declare Rust/raw-Wasm activation metadata".into());
    }
    if framework == "none" && (!recipe.islands.is_empty() || !recipe.routes.is_empty()) {
        return Err("raw-Wasm build cannot declare framework islands/routes".into());
    }

    let base = Url::parse(&recipe.base_url).map_err(|e| e.to_string())?;
    if base.scheme() != "https"
        || !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
        || !base.path().ends_with('/')
        || base.as_str() != recipe.base_url
    {
        return Err("canonical credentialless HTTPS base required".into());
    }
    if !base.path().split('/').any(|segment| segment == recipe.release) {
        return Err("release must be an immutable path segment".into());
    }
    if fs::symlink_metadata(&recipe.root)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("symlink root forbidden".into());
    }
    let root = fs::canonicalize(&recipe.root).map_err(|e| e.to_string())?;
    let mut paths = Vec::new();
    inventory(&root, &root, &mut paths)?;
    paths.sort();
    if !paths.contains(&recipe.entrypoint) {
        return Err("entrypoint missing from actual build".into());
    }

    let raw = if recipe.runtime == "raw-wasm" {
        Some(raw_plan(recipe, &paths)?)
    } else {
        None
    };
    let expected_wasm = if recipe.runtime == "flutter-web" {
        Some("main.dart.wasm".to_string())
    } else if recipe.runtime == "wasm-bindgen" {
        Some(recipe.entrypoint.trim_end_matches(".js").to_string() + "_bg.wasm")
    } else {
        None
    };
    if let Some(expected) = &expected_wasm {
        if !paths.contains(expected) {
            return Err("matching Wasm companion is missing".into());
        }
    }

    let mut split_paths = BTreeSet::new();
    let mut split_ids = BTreeMap::new();
    if framework == "dioxus" {
        let expected = expected_wasm.as_ref().unwrap();
        let route_roots: BTreeSet<String> = recipe.routes.values().cloned().collect();
        for (route, path) in &recipe.routes {
            if !route_key(route) {
                return Err(format!("invalid Dioxus route key: {route}"));
            }
            validate_split_path(path, expected, &paths, &format!("Dioxus route {route}"))?;
            split_paths.insert(path.clone());
        }
        for (source, dependencies) in &recipe.dependencies {
            validate_split_path(source, expected, &paths, "Dioxus dependency source")?;
            if dependencies.len() > 64 {
                return Err(format!("Dioxus dependency source {source} exceeds 64 dependencies"));
            }
            let mut unique = BTreeSet::new();
            for dependency in dependencies {
                validate_split_path(dependency, expected, &paths, "Dioxus dependency target")?;
                if dependency == source {
                    return Err(format!("Dioxus split file {source} cannot depend on itself"));
                }
                if !unique.insert(dependency.clone()) {
                    return Err(format!("Dioxus split file {source} repeats dependency {dependency}"));
                }
                split_paths.insert(dependency.clone());
            }
            split_paths.insert(source.clone());
        }
        validate_dependency_graph(&recipe.dependencies)?;
        let reachable = reachable_from(&route_roots, &recipe.dependencies);
        for source in recipe.dependencies.keys() {
            if !reachable.contains(source) {
                return Err(format!("Dioxus dependency source {source} is not reachable from any declared route"));
            }
        }
        split_ids = split_paths
            .iter()
            .map(|path| (path.clone(), chunk_id(path)))
            .collect();
    }

    let mut assets = Vec::new();
    let mut content_types = BTreeMap::new();
    let mut used_ids = BTreeSet::new();
    for (index, path) in paths.iter().enumerate() {
        let file = fs::File::open(root.join(path)).map_err(|e| e.to_string())?;
        let size = file.metadata().map_err(|e| e.to_string())?.len();
        if size == 0 || size > 268435456 {
            return Err(format!("asset outside contract byte limits: {path}"));
        }
        let mut data = Vec::new();
        file.take(268435457)
            .read_to_end(&mut data)
            .map_err(|e| e.to_string())?;
        if data.len() as u64 != size {
            return Err(format!("build output changed during inventory: {path}"));
        }

        let (id, role, kind, prepare, stage) = if let Some(plan) = &raw {
            if plan.graph_paths.contains(path) {
                let prepare = plan.default_closure.contains(path);
                (
                    plan.ids[path].clone(),
                    if plan.root_paths.contains(path) { "chunk" } else { "module" },
                    "wasm",
                    prepare,
                    if prepare { "optional" } else { "lazy" },
                )
            } else {
                (
                    format!("asset-{index}"),
                    "asset",
                    if path.ends_with(".wasm") { "wasm" } else if path.ends_with(".mjs") { "module" } else if path.ends_with(".js") { "script" } else if [".ttf", ".otf", ".woff", ".woff2"].iter().any(|ext| path.ends_with(ext)) { "font" } else { "data" },
                    false,
                    "lazy",
                )
            }
        } else if *path == recipe.entrypoint {
            if recipe.runtime == "flutter-web" {
                ("bootstrap".to_string(), "bootstrap", "script", true, "optional")
            } else {
                ("glue".to_string(), "glue", "module", true, "optional")
            }
        } else if expected_wasm.as_ref() == Some(path) {
            ("module".to_string(), "module", "wasm", true, "optional")
        } else if let Some(id) = split_ids.get(path) {
            (id.clone(), "chunk", "wasm", false, "lazy")
        } else if path == "main.dart.js" {
            ("fallback".to_string(), "fallback", "script", false, "lazy")
        } else {
            (
                format!("asset-{index}"),
                "asset",
                if path.ends_with(".wasm") { "wasm" } else if path.ends_with(".mjs") { "module" } else if path.ends_with(".js") { "script" } else if [".ttf", ".otf", ".woff", ".woff2"].iter().any(|ext| path.ends_with(ext)) { "font" } else { "data" },
                false,
                "lazy",
            )
        };
        if !used_ids.insert(id.clone()) {
            return Err(format!("duplicate manifest asset id {id}"));
        }
        content_types.insert(id.clone(), mime(path).unwrap());
        let mut asset = json!({
            "id": id,
            "url": base.join(path).map_err(|e| e.to_string())?.as_str(),
            "kind": kind,
            "role": role,
            "stage": stage,
            "prepare": prepare,
            "bytes": data.len(),
            "sha256": format!("{:x}", Sha256::digest(&data))
        });
        if let Some(dependencies) = recipe.dependencies.get(path) {
            if !dependencies.is_empty() {
                let ids = if let Some(plan) = &raw {
                    dependencies.iter().map(|dependency| plan.ids[dependency].clone()).collect::<Vec<_>>()
                } else {
                    dependencies.iter().map(|dependency| split_ids[dependency].clone()).collect::<Vec<_>>()
                };
                asset["dependencies"] = json!(ids);
            }
        }
        assets.push(asset);
    }

    let (entrypoint, activation, raw_extensions) = if let Some(plan) = &raw {
        let roots: Map<String, Value> = plan
            .roots
            .iter()
            .map(|(name, path)| (name.clone(), json!(plan.ids[path])))
            .collect();
        let ids: Map<String, Value> = plan
            .ids
            .iter()
            .map(|(path, id)| (path.clone(), json!(id)))
            .collect();
        let namespaces: Map<String, Value> = plan
            .ids
            .values()
            .map(|id| (id.clone(), json!(id)))
            .collect();
        (
            plan.ids[&recipe.entrypoint].clone(),
            json!({"mode": "run-app"}),
            json!({
                "rawWasmRoots": roots,
                "rawWasmAssetIds": ids,
                "rawWasmImportNamespaces": namespaces
            }),
        )
    } else if framework == "flutter" {
        ("bootstrap".to_string(), json!({"mode": "attach-view"}), json!({}))
    } else if framework == "dioxus" {
        let routes: Map<String, Value> = recipe
            .routes
            .iter()
            .map(|(route, path)| (route.clone(), json!(split_ids[path])))
            .collect();
        ("glue".to_string(), json!({"mode": "mount-route", "routes": routes}), json!({}))
    } else {
        ("glue".to_string(), json!({"mode": "hydrate-islands", "islands": recipe.islands}), json!({}))
    };

    let mut extensions = json!({
        "buildTool": "owls-build-manifest/0.2.0",
        "toolchain": recipe.toolchain,
        "contentTypes": content_types,
        "publicStaticAssetsOnly": true
    });
    if let Some(map) = raw_extensions.as_object() {
        for (key, value) in map {
            extensions[key] = value.clone();
        }
    }

    Ok(json!({
        "schemaVersion": 2,
        "appId": recipe.app_id,
        "release": recipe.release,
        "runtime": recipe.runtime,
        "framework": framework,
        "entrypoint": entrypoint,
        "assets": assets,
        "prepareBudget": {"maxBytes": 1048576, "maxConcurrency": 2, "furthestStage": "fetch"},
        "activation": activation,
        "extensions": extensions
    }))
}

fn main() {
    const ROUTINE_ID: &str = "ores-routine-Rkf7gb3rutiYivmnP62Fc";
    let log = telemetry::logger();
    let run = || -> Result<()> {
        if std::env::args_os().len() != 1 {
            return Err("no CLI options; pass the documented JSON recipe on stdin".into());
        }
        let mut input = String::new();
        io::stdin()
            .take(65537)
            .read_to_string(&mut input)
            .map_err(|e| e.to_string())?;
        if input.len() > 65536 {
            return Err("recipe exceeds 64 KiB".into());
        }
        let recipe: Recipe = serde_json::from_str(&input).map_err(|e| e.to_string())?;
        println!(
            "{}",
            serde_json::to_string_pretty(&build(&recipe)?).map_err(|e| e.to_string())?
        );
        Ok(())
    };
    match run() {
        Ok(()) => {
            let _ = log
                .info(vec![json!("manifest built")])
                .add_trace("ores-trace-u0TgLlTExI6ipMq67egnG", false)
                .add_routine_id(ROUTINE_ID)
                .send();
        }
        Err(error) => {
            let _ = log
                .error(vec![json!("manifest build rejected")])
                .add_trace("ores-trace-myvhLEvvImWIKHQaoRq6f", false)
                .add_routine_id(ROUTINE_ID)
                .send();
            eprintln!("manifest build rejected: {error}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recipe(root: PathBuf, runtime: &str, entrypoint: &str) -> Recipe {
        Recipe {
            root,
            base_url: "https://example.test/r1/".into(),
            app_id: "pilot".into(),
            release: "r1".into(),
            runtime: runtime.into(),
            entrypoint: entrypoint.into(),
            framework: None,
            islands: vec![],
            routes: BTreeMap::new(),
            roots: BTreeMap::new(),
            dependencies: BTreeMap::new(),
            asset_ids: BTreeMap::new(),
            toolchain: BTreeMap::new(),
        }
    }
    fn temp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("owls-{name}-{}", std::process::id()))
    }
    fn write_wasm(path: impl AsRef<Path>) {
        fs::write(path, b"\0asm\x01\0\0\0").unwrap();
    }

    #[test]
    fn paths_reject_secret_and_traversal_candidates() {
        for s in [".env", "../main.js", "dir/.env", "/main.js", "x//y", "x?token", "x#y", "a b"] {
            assert!(!safe_path(s), "{s}");
        }
    }
    #[test]
    fn route_keys_are_bounded_and_navigation_safe() {
        for s in ["", "app", "/a?token=x", "/a#frag", "/../admin", "/a/../b", "/a b"] {
            assert!(!route_key(s), "{s}");
        }
        assert!(route_key("/app/reports"));
    }
    #[test]
    fn build_extensions_are_explicit() {
        assert_eq!(mime("app.wasm"), Some("application/wasm"));
        assert_eq!(mime("key.pem"), None);
        assert_eq!(mime("app.js.map"), None);
    }
    #[test]
    fn identifiers_cannot_form_paths() {
        assert!(!identifier("../r1"));
        assert!(!identifier(""));
        assert!(!identifier("-r1"));
        assert!(identifier("r1-abcdef"));
        assert!(!app_identifier("App_ID"));
    }
    #[test]
    fn unknown_recipe_fields_fail() {
        assert!(serde_json::from_str::<Recipe>(
            r#"{"root":"x","base_url":"https://x/r1/","app_id":"a","release":"r1","runtime":"flutter-web","entrypoint":"x.js","token":"secret"}"#
        ).is_err());
    }
    #[test]
    fn rejects_unversioned_and_insecure_origins_before_io() {
        for base in ["http://example.test/r1/", "https://example.test/latest/", "https://user@example.test/r1/", "https://example.test/r1/?token=x"] {
            let mut r = recipe("/not-present".into(), "flutter-web", "flutter_bootstrap.js");
            r.base_url = base.into();
            assert!(build(&r).is_err());
        }
    }
    #[test]
    fn real_files_emit_declared_extension_point_and_full_budget() {
        let root = temp("manifest-test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir(&root).unwrap();
        fs::write(root.join("app.js"), b"export default function init() {}").unwrap();
        write_wasm(root.join("app_bg.wasm"));
        let mut r = recipe(root.clone(), "wasm-bindgen", "app.js");
        r.islands = vec!["Pilot".into()];
        let result = build(&r).unwrap();
        assert_eq!(result["framework"], "leptos");
        assert_eq!(result["prepareBudget"]["maxConcurrency"], 2);
        assert_eq!(result["assets"].as_array().unwrap().len(), 2);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn dioxus_routes_emit_real_dependency_closures() {
        let root = temp("dioxus-test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("split")).unwrap();
        fs::write(root.join("app.js"), b"export default function init() {}").unwrap();
        write_wasm(root.join("app_bg.wasm"));
        write_wasm(root.join("split/chunk_0_split.wasm"));
        write_wasm(root.join("split/module_0_routeReports.wasm"));
        let mut r = recipe(root.clone(), "wasm-bindgen", "app.js");
        r.framework = Some("dioxus".into());
        r.routes.insert("/reports".into(), "split/module_0_routeReports.wasm".into());
        r.dependencies.insert("split/module_0_routeReports.wasm".into(), vec!["split/chunk_0_split.wasm".into()]);
        let result = build(&r).unwrap();
        assert_eq!(result["framework"], "dioxus");
        assert_eq!(result["activation"]["mode"], "mount-route");
        let route_id = result["activation"]["routes"]["/reports"].as_str().unwrap();
        let route_asset = result["assets"].as_array().unwrap().iter().find(|asset| asset["id"] == route_id).unwrap();
        assert_eq!(route_asset["role"], "chunk");
        assert_eq!(route_asset["dependencies"].as_array().unwrap().len(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn raw_wasm_mpa_emits_shared_library_and_page_roots() {
        let root = temp("raw-mpa-test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir(&root).unwrap();
        for path in ["vendor-core.wasm", "page-home.wasm", "page-settings.wasm"] {
            write_wasm(root.join(path));
        }
        let mut r = recipe(root.clone(), "raw-wasm", "page-home.wasm");
        r.roots.insert("home".into(), "page-home.wasm".into());
        r.roots.insert("settings".into(), "page-settings.wasm".into());
        r.dependencies.insert("page-home.wasm".into(), vec!["vendor-core.wasm".into()]);
        r.dependencies.insert("page-settings.wasm".into(), vec!["vendor-core.wasm".into()]);
        r.asset_ids.insert("vendor-core.wasm".into(), "vendor-core".into());
        r.asset_ids.insert("page-home.wasm".into(), "page-home".into());
        r.asset_ids.insert("page-settings.wasm".into(), "page-settings".into());
        let result = build(&r).unwrap();
        assert_eq!(result["runtime"], "raw-wasm");
        assert_eq!(result["framework"], "none");
        assert_eq!(result["entrypoint"], "page-home");
        assert_eq!(result["activation"]["mode"], "run-app");
        assert_eq!(result["extensions"]["rawWasmRoots"]["home"], "page-home");
        assert_eq!(result["extensions"]["rawWasmRoots"]["settings"], "page-settings");
        let assets = result["assets"].as_array().unwrap();
        let vendor = assets.iter().find(|a| a["id"] == "vendor-core").unwrap();
        let home = assets.iter().find(|a| a["id"] == "page-home").unwrap();
        let settings = assets.iter().find(|a| a["id"] == "page-settings").unwrap();
        assert_eq!(vendor["role"], "module");
        assert_eq!(home["role"], "chunk");
        assert_eq!(settings["role"], "chunk");
        assert_eq!(home["dependencies"][0], "vendor-core");
        assert_eq!(settings["dependencies"][0], "vendor-core");
        assert_eq!(vendor["prepare"], true);
        assert_eq!(home["prepare"], true);
        assert_eq!(settings["prepare"], false);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn raw_wasm_graph_failures_are_fatal() {
        let root = temp("raw-failure-test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir(&root).unwrap();
        for path in ["a.wasm", "b.wasm", "c.wasm"] {
            write_wasm(root.join(path));
        }
        let mut cycle = recipe(root.clone(), "raw-wasm", "a.wasm");
        cycle.roots.insert("a".into(), "a.wasm".into());
        cycle.dependencies.insert("a.wasm".into(), vec!["b.wasm".into()]);
        cycle.dependencies.insert("b.wasm".into(), vec!["a.wasm".into()]);
        assert!(build(&cycle).unwrap_err().contains("dependency cycle"));

        let mut missing = recipe(root.clone(), "raw-wasm", "a.wasm");
        missing.roots.insert("a".into(), "a.wasm".into());
        missing.dependencies.insert("a.wasm".into(), vec!["missing.wasm".into()]);
        assert!(build(&missing).unwrap_err().contains("actual emitted Wasm file"));

        let mut unreachable = recipe(root.clone(), "raw-wasm", "a.wasm");
        unreachable.roots.insert("a".into(), "a.wasm".into());
        unreachable.dependencies.insert("c.wasm".into(), vec!["b.wasm".into()]);
        assert!(build(&unreachable).unwrap_err().contains("not reachable from any root"));

        let mut duplicate_id = recipe(root.clone(), "raw-wasm", "a.wasm");
        duplicate_id.roots.insert("a".into(), "a.wasm".into());
        duplicate_id.dependencies.insert("a.wasm".into(), vec!["b.wasm".into()]);
        duplicate_id.asset_ids.insert("a.wasm".into(), "same".into());
        duplicate_id.asset_ids.insert("b.wasm".into(), "same".into());
        assert!(build(&duplicate_id).unwrap_err().contains("duplicate asset id"));
        fs::remove_dir_all(root).unwrap();
    }
}