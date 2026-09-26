# Go
Install: https://go.dev/dl (tarball to /usr/local/go, add /usr/local/go/bin to PATH), `brew install go`, or distro package (may be old; need ≥ 1.22 for method routing). Check `go version`.

```bash
mkdir -p ~/projects/<name> && cd ~/projects/<name>
go mod init example.com/<name>
```
CLI main.go:
```go
package main

import (
	"flag"
	"fmt"
	"os"
)

func main() {
	n := flag.Int("n", 3, "how many")
	flag.Parse()
	if flag.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "usage: <name> [-n N] <input>")
		os.Exit(2)
	}
	fmt.Println(*n, flag.Arg(0))
}
```
HTTP server (stdlib, Go ≥ 1.22 patterns):
```go
mux := http.NewServeMux()
mux.HandleFunc("GET /api/items/{id}", func(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"id": r.PathValue("id")})
})
mux.Handle("GET /", http.FileServer(http.Dir("static")))
log.Fatal(http.ListenAndServe(":8080", mux))
```
Run: `go run .` · server: proc_start(command="go run .") + proc_logs(wait_for="port") (log the address so the port is detected: `log.Println("listening on :8080")`).
Deps: `go get github.com/spf13/cobra@latest` then `go mod tidy`. Embed static files: `//go:embed static` + `embed.FS`.
Tests: file x_test.go, `func TestX(t *testing.T)`, run `go test ./...`. Vet/build: check(path) runs `go vet ./...` and `go build ./...`.
Build: `go build -o bin/<name> .`; cross: `GOOS=windows GOARCH=amd64 go build -o bin/<name>.exe .` (also linux/arm64, darwin/arm64). Static binary: `CGO_ENABLED=0`.
Layout when it grows: cmd/<name>/main.go, internal/<pkg>/.
