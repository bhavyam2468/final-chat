# Python apps
Python ≥ 3.10. Prefer uv if present (`command -v uv`; install `curl -LsSf https://astral.sh/uv/install.sh | sh`), else venv.

Project:
```bash
mkdir -p ~/projects/<name> && cd ~/projects/<name>
uv init --app            # or: python3 -m venv .venv && . .venv/bin/activate
uv add typer rich        # or: pip install typer rich
```
CLI (main.py):
```python
import typer
app = typer.Typer()

@app.command()
def run(path: str, n: int = 3):
    print(n, path)

if __name__ == "__main__":
    app()
```
Run `uv run main.py x --n 2` (or `python main.py …` inside the venv).
API (FastAPI): `uv add fastapi uvicorn`:
```python
from fastapi import FastAPI
app = FastAPI()

@app.get("/api/health")
def health():
    return {"ok": True}
```
Serve: proc_start(command="uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload") → proc_logs(wait_for="port") → browser("http://localhost:8000/docs").
Tests: `uv add --dev pytest`, tests/test_x.py, `uv run pytest -q`. Lint: `uvx ruff check .`.
Desktop GUI: tkinter (stdlib) for simple tools; for data apps prefer a small FastAPI + static HTML UI (reference/web-static.md) or Streamlit (`uv add streamlit`, `uv run streamlit run app.py --server.headless true`).
Packaging a CLI: `[project.scripts] <name> = "main:app"` in pyproject.toml, then `uv tool install .`.
