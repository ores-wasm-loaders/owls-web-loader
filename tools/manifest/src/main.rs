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
    /// Build-output paths, never asset IDs. Producers derive this from exact framework output.
    #[serde(default)]
    dependencies: BTreeMap<String, Vec<String>>,
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
            return Err(format!("Dioxus dependency cycle: {}", cycle.join(" -> ")));
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
fn validate_split_path(
    path: &str,
    expected_wasm: &str,
    paths: &[String],
    label: &str,
) -> Result<()> {
    if !safe_path(path)
        || !path.ends_with(".wasm")
        || path == expected_wasm
        || !paths.contains(&path.to_string())
    {
        return Err(format!(
            "{label} must name an actual emitted split Wasm file"
        ));
    }
    Ok(())
}
fn build(recipe: &Recipe) -> Result<Value> {
    if !app_identifier(&recipe.app_id)
        || !identifier(&recipe.release)
        || !safe_path(&recipe.entrypoint)
    {
        return Err("invalid build identity".into());
    }
    if !["wasm-bindgen", "flutter-web"].contains(&recipe.runtime.as_str()) {
        return Err("unsupported build runtime".into());
    }
    let framework = match (recipe.runtime.as_str(), recipe.framework.as_deref()) {
        ("flutter-web", None | Some("flutter")) => "flutter",
        ("wasm-bindgen", None | Some("leptos")) => "leptos",
        ("wasm-bindgen", Some("dioxus")) => "dioxus",
        _ => return Err("framework is incompatible with build runtime".into()),
    };
    if framework == "leptos"
        && (recipe.islands.is_empty()
            || !recipe.routes.is_empty()
            || !recipe.dependencies.is_empty())
    {
        return Err("Leptos build must declare islands and no Dioxus routes/dependencies".into());
    }
    if framework == "dioxus" && (!recipe.islands.is_empty() || recipe.routes.is_empty()) {
        return Err("Dioxus build must declare routes and no Leptos islands".into());
    }
    if framework == "flutter"
        && (!recipe.islands.is_empty()
            || !recipe.routes.is_empty()
            || !recipe.dependencies.is_empty())
    {
        return Err("Flutter build cannot declare Rust framework activation metadata".into());
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
    if !base
        .path()
        .split('/')
        .any(|segment| segment == recipe.release)
    {
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
    let expected_wasm = if recipe.runtime == "flutter-web" {
        "main.dart.wasm".to_string()
    } else {
        recipe.entrypoint.trim_end_matches(".js").to_string() + "_bg.wasm"
    };
    if !paths.contains(&expected_wasm) {
        return Err("matching Wasm companion is missing".into());
    }

    let mut split_paths = BTreeSet::new();
    let route_roots: BTreeSet<String> = recipe.routes.values().cloned().collect();
    for (route, path) in &recipe.routes {
        if !route_key(route) {
            return Err(format!("invalid Dioxus route key: {route}"));
        }
        validate_split_path(
            path,
            &expected_wasm,
            &paths,
            &format!("Dioxus route {route}"),
        )?;
        split_paths.insert(path.clone());
    }

    let mut inbound = BTreeSet::new();
    for (source, dependencies) in &recipe.dependencies {
        validate_split_path(source, &expected_wasm, &paths, "Dioxus dependency source")?;
        if dependencies.len() > 64 {
            return Err(format!(
                "Dioxus dependency source {source} exceeds 64 dependencies"
            ));
        }
        let mut unique = BTreeSet::new();
        for dependency in dependencies {
            validate_split_path(
                dependency,
                &expected_wasm,
                &paths,
                "Dioxus dependency target",
            )?;
            if dependency == source {
                return Err(format!(
                    "Dioxus split file {source} cannot depend on itself"
                ));
            }
            if !unique.insert(dependency.clone()) {
                return Err(format!(
                    "Dioxus split file {source} repeats dependency {dependency}"
                ));
            }
            inbound.insert(dependency.clone());
            split_paths.insert(dependency.clone());
        }
        split_paths.insert(source.clone());
    }
    for source in recipe.dependencies.keys() {
        if !route_roots.contains(source) && !inbound.contains(source) {
            return Err(format!(
                "Dioxus dependency source {source} is not reachable from any declared route"
            ));
        }
    }
    validate_dependency_graph(&recipe.dependencies)?;

    let split_ids: BTreeMap<String, String> = split_paths
        .iter()
        .map(|path| (path.clone(), chunk_id(path)))
        .collect();
    let mut assets = Vec::new();
    let mut content_types = BTreeMap::new();
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
        let (id, role, kind, prepare, stage) = if *path == recipe.entrypoint {
            if recipe.runtime == "flutter-web" {
                (
                    "bootstrap".to_string(),
                    "bootstrap",
                    "script",
                    true,
                    "optional",
                )
            } else {
                ("glue".to_string(), "glue", "module", true, "optional")
            }
        } else if *path == expected_wasm {
            ("module".to_string(), "module", "wasm", true, "optional")
        } else if let Some(id) = split_ids.get(path) {
            (id.clone(), "chunk", "wasm", false, "lazy")
        } else if path == "main.dart.js" {
            ("fallback".to_string(), "fallback", "script", false, "lazy")
        } else {
            (
                format!("asset-{index}"),
                "asset",
                if path.ends_with(".wasm") {
                    "wasm"
                } else if path.ends_with(".mjs") {
                    "module"
                } else if path.ends_with(".js") {
                    "script"
                } else if [".ttf", ".otf", ".woff", ".woff2"]
                    .iter()
                    .any(|ext| path.ends_with(ext))
                {
                    "font"
                } else {
                    "data"
                },
                false,
                "lazy",
            )
        };
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
                let ids = dependencies
                    .iter()
                    .map(|dependency| split_ids[dependency].clone())
                    .collect::<Vec<_>>();
                asset["dependencies"] = json!(ids);
            }
        }
        assets.push(asset);
    }
    let activation = if framework == "flutter" {
        json!({"mode": "attach-view"})
    } else if framework == "dioxus" {
        let routes: Map<String, Value> = recipe
            .routes
            .iter()
            .map(|(route, path)| (route.clone(), json!(split_ids[path])))
            .collect();
        json!({"mode": "mount-route", "routes": routes})
    } else {
        json!({"mode": "hydrate-islands", "islands": recipe.islands})
    };
    // `extensions` is the existing schema's explicit extension point; never add an
    // ad-hoc top-level config field or loosen either independently authored authority.
    Ok(json!({
        "schemaVersion": 2,
        "appId": recipe.app_id,
        "release": recipe.release,
        "runtime": recipe.runtime,
        "framework": framework,
        "entrypoint": if recipe.runtime == "flutter-web" { "bootstrap" } else { "glue" },
        "assets": assets,
        "prepareBudget": {"maxBytes": 1048576, "maxConcurrency": 2, "furthestStage": "fetch"},
        "activation": activation,
        "extensions": {
            "buildTool": "owls-build-manifest/0.1.0",
            "toolchain": recipe.toolchain,
            "contentTypes": content_types,
            "publicStaticAssetsOnly": true
        }
    }))
}
fn main() {
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
    if let Err(error) = run() {
        eprintln!("manifest build rejected: {error}");
        std::process::exit(1);
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
            dependencies: BTreeMap::new(),
            toolchain: BTreeMap::new(),
        }
    }
    fn write_wasm(path: impl AsRef<Path>) {
        fs::write(path, b"\0asm\x01\0\0\0").unwrap();
    }
    #[test]
    fn paths_reject_secret_and_traversal_candidates() {
        for s in [
            ".env",
            "../main.js",
            "dir/.env",
            "/main.js",
            "x//y",
            "x?token",
            "x#y",
            "a b",
        ] {
            assert!(!safe_path(s), "{s}");
        }
    }
    #[test]
    fn route_keys_are_bounded_and_navigation_safe() {
        for s in [
            "",
            "app",
            "/a?token=x",
            "/a#frag",
            "/../admin",
            "/a/../b",
            "/a b",
        ] {
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
        )
        .is_err());
    }
    #[test]
    fn rejects_unversioned_and_insecure_origins_before_io() {
        for base in [
            "http://example.test/r1/",
            "https://example.test/latest/",
            "https://user@example.test/r1/",
            "https://example.test/r1/?token=x",
        ] {
            let mut r = recipe("/not-present".into(), "flutter-web", "flutter_bootstrap.js");
            r.base_url = base.into();
            assert!(build(&r).is_err());
        }
    }
    #[test]
    fn real_files_emit_declared_extension_point_and_full_budget() {
        let root = std::env::temp_dir().join(format!("owls-manifest-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir(&root).unwrap();
        fs::write(root.join("app.js"), b"export default function init() {}").unwrap();
        write_wasm(root.join("app_bg.wasm"));
        let mut r = recipe(root.clone(), "wasm-bindgen", "app.js");
        r.islands = vec!["Pilot".into()];
        let result = build(&r).unwrap();
        assert!(result.get("config").is_none());
        assert!(result.get("extensions").is_some());
        assert_eq!(result["framework"], "leptos");
        assert_eq!(result["prepareBudget"]["maxConcurrency"], 2);
        assert_eq!(result["assets"].as_array().unwrap().len(), 2);
        assert_eq!(result["assets"][0]["sha256"].as_str().unwrap().len(), 64);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn dioxus_routes_emit_real_dependency_closures() {
        let root =
            std::env::temp_dir().join(format!("owls-dioxus-manifest-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("split")).unwrap();
        fs::write(root.join("app.js"), b"export default function init() {}").unwrap();
        write_wasm(root.join("app_bg.wasm"));
        write_wasm(root.join("split/chunk_0_split.wasm"));
        write_wasm(root.join("split/module_0_routeReports.wasm"));
        let mut r = recipe(root.clone(), "wasm-bindgen", "app.js");
        r.framework = Some("dioxus".into());
        r.routes
            .insert("/reports".into(), "split/module_0_routeReports.wasm".into());
        r.dependencies.insert(
            "split/module_0_routeReports.wasm".into(),
            vec!["split/chunk_0_split.wasm".into()],
        );
        let result = build(&r).unwrap();
        assert_eq!(result["framework"], "dioxus");
        assert_eq!(result["activation"]["mode"], "mount-route");
        let route_id = result["activation"]["routes"]["/reports"].as_str().unwrap();
        let route_asset = result["assets"]
            .as_array()
            .unwrap()
            .iter()
            .find(|asset| asset["id"] == route_id)
            .unwrap();
        assert_eq!(route_asset["role"], "chunk");
        assert_eq!(route_asset["kind"], "wasm");
        assert_eq!(route_asset["prepare"], false);
        assert_eq!(route_asset["stage"], "lazy");
        let dependency_id = route_asset["dependencies"][0].as_str().unwrap();
        let shared = result["assets"]
            .as_array()
            .unwrap()
            .iter()
            .find(|asset| asset["id"] == dependency_id)
            .unwrap();
        assert_eq!(shared["role"], "chunk");
        assert_eq!(shared["kind"], "wasm");
        assert_eq!(shared["prepare"], false);
        assert_eq!(shared["stage"], "lazy");
        assert_ne!(dependency_id, route_id);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn dioxus_dependency_graph_failures_are_fatal() {
        let root = std::env::temp_dir().join(format!(
            "owls-dioxus-dependency-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("split")).unwrap();
        fs::write(root.join("app.js"), b"export default function init() {}").unwrap();
        write_wasm(root.join("app_bg.wasm"));
        for path in ["a.wasm", "b.wasm", "c.wasm"] {
            write_wasm(root.join("split").join(path));
        }
        let mut base = recipe(root.clone(), "wasm-bindgen", "app.js");
        base.framework = Some("dioxus".into());
        base.routes.insert("/a".into(), "split/a.wasm".into());

        let mut missing = recipe(root.clone(), "wasm-bindgen", "app.js");
        missing.framework = Some("dioxus".into());
        missing.routes = base.routes.clone();
        missing
            .dependencies
            .insert("split/a.wasm".into(), vec!["split/missing.wasm".into()]);
        assert!(build(&missing)
            .unwrap_err()
            .contains("actual emitted split Wasm file"));

        let mut duplicate = recipe(root.clone(), "wasm-bindgen", "app.js");
        duplicate.framework = Some("dioxus".into());
        duplicate.routes = base.routes.clone();
        duplicate.dependencies.insert(
            "split/a.wasm".into(),
            vec!["split/b.wasm".into(), "split/b.wasm".into()],
        );
        assert!(build(&duplicate)
            .unwrap_err()
            .contains("repeats dependency"));

        let mut self_edge = recipe(root.clone(), "wasm-bindgen", "app.js");
        self_edge.framework = Some("dioxus".into());
        self_edge.routes = base.routes.clone();
        self_edge
            .dependencies
            .insert("split/a.wasm".into(), vec!["split/a.wasm".into()]);
        assert!(build(&self_edge)
            .unwrap_err()
            .contains("cannot depend on itself"));

        let mut cycle = recipe(root.clone(), "wasm-bindgen", "app.js");
        cycle.framework = Some("dioxus".into());
        cycle.routes = base.routes.clone();
        cycle
            .dependencies
            .insert("split/a.wasm".into(), vec!["split/b.wasm".into()]);
        cycle
            .dependencies
            .insert("split/b.wasm".into(), vec!["split/a.wasm".into()]);
        assert!(build(&cycle).unwrap_err().contains("dependency cycle"));

        let mut unreachable = recipe(root.clone(), "wasm-bindgen", "app.js");
        unreachable.framework = Some("dioxus".into());
        unreachable.routes = base.routes.clone();
        unreachable
            .dependencies
            .insert("split/c.wasm".into(), Vec::new());
        assert!(build(&unreachable)
            .unwrap_err()
            .contains("not reachable from any declared route"));

        let mut leptos = recipe(root.clone(), "wasm-bindgen", "app.js");
        leptos.islands = vec!["Pilot".into()];
        leptos
            .dependencies
            .insert("split/a.wasm".into(), vec!["split/b.wasm".into()]);
        assert!(build(&leptos)
            .unwrap_err()
            .contains("no Dioxus routes/dependencies"));
        fs::remove_dir_all(root).unwrap();
    }
}
