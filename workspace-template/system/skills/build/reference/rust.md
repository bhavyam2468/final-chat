# Rust
Install: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y` then `source "$HOME/.cargo/env"`. Check `cargo --version`.

```bash
cd ~/projects && cargo new <name> && cd <name>
cargo add clap --features derive
```
CLI src/main.rs:
```rust
use clap::Parser;

#[derive(Parser)]
#[command(version, about)]
struct Args {
    /// Input file
    input: String,
    #[arg(short, long, default_value_t = 3)]
    n: u32,
}

fn main() {
    let args = Args::parse();
    println!("{} {}", args.n, args.input);
}
```
Web server (axum + tokio): `cargo add axum tokio --features tokio/full` and `cargo add serde --features derive` + `cargo add serde_json`.
```rust
use axum::{routing::get, Json, Router};

#[tokio::main]
async fn main() {
    let app = Router::new().route("/api/health", get(|| async { Json(serde_json::json!({"ok": true})) }));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    println!("listening on 0.0.0.0:3000");
    axum::serve(listener, app).await.unwrap();
}
```
Path params: axum 0.8 uses "/items/{id}", 0.7 uses "/items/:id" (check `cargo tree -i axum`), extract with `axum::extract::Path(id): Path<String>`.
Run: `cargo run -- <args>` · server: proc_start(command="cargo run") (first build is slow; proc_logs(wait_for="port", timeout=180)).
Check/test: check(path) runs `cargo check`; tests in `#[cfg(test)] mod tests` + `cargo test`. Lint: `cargo clippy`, format `cargo fmt`.
Release: `cargo build --release` → target/release/<name>.
Errors: read the first error only; borrow errors → clone at the boundary or restructure ownership; missing trait → add `use` shown in the compiler's help line.
