# Templates

A **template** is a small piece that was made to work once and is kept: a schematic, a block shell, a document
shape. The agent pulls one instead of inventing it, and the library ships with the app.

The reason is narrow and practical. Some things a model writes from memory look right and are wrong — a gate
circuit that does not compile, a quiz whose scoring contradicts itself, a lab report missing the error
analysis. A template is that piece, captured after it was verified, with the parts that change left as
`{{placeholders}}`.

## Shape

```
workspace-template/templates/<name>/template.md      shipped (and where community templates land)
templates/<name>/template.md                         the user's own shelf
```

`template.md` is front matter plus a body. The front matter is the shape; the body is the prose and — for a
circuit or a block — exactly one fenced block, which is the artefact.

```
---
name: half-adder
kind: circuit                 # circuit | block | doc
title: Half adder
description: Two bits in, sum (XOR) and carry (AND) out.
tags: circuit digital logic adder xor
vars:
  - a | label of the first input | A
  - b | label of the second input | B
---
The smallest combinational circuit. Sum is `A` XOR `B`, carry is `A` AND `B`.

```tex
\begin{circuitikz}
  ...
\end{circuitikz}
```
```

- **kinds** — `circuit` (circuitikz/TikZ, drawn by the app's own renderer), `block` (a Blocks document),
  `doc` (prose only: the sections and the rules).
- **vars** — `name | label | example`. Values can be passed when reading; anything left out falls back to its
  example (so a preview is a real document) and is reported back as `usedExample`.
- **files** — anything else in the folder travels with it (`bom.csv`, `notes.md`).

## The check

Reading a template verifies it, and the answer is part of the result:

| kind | checked how | what `check.ok` means |
|---|---|---|
| `circuit` | rendered through `renderTikz` (the engine the block uses, packages and all) | this source compiles — it cannot be a red box in front of the user |
| `block` | `uiIssues` — the same structural check the app runs on a block | the markup is sound: known components, closed tags, no CDN scripts |
| `doc` | parse only | the structure is there; the words are the model's |

A failed check comes back as a sentence (`NOT usable as it is — Could not find font cmmib5 …`), not an
exception: the caller can fix the source, or save a corrected version, without the request failing.

TikZ renders run in a **worker with a deadline** (`src/lib/tikz.ts`), because the engine is WebAssembly and can
die from inside a callback — an unrenderable or hanging source costs one worker and one error line, never the
app.

## API

| Call | What it does |
|---|---|
| `GET /api/templates` | the library: id, kind, title, description, tags, vars — never sources |
| `GET /api/templates?q=&kind=` | the same, ranked |
| `GET /api/templates?id=<name>&<var>=<value>` | one template, filled and verified (circuits rendered) |
| `POST /api/templates` | save one to `templates/<name>/` |
| `DELETE /api/templates?id=<name>` | remove one of the user's own |

Tools: `template_search(query, kind)`, `template_get(name, vars)`, `template_save({name, kind, description,
body, vars, files})`. The palette has the same list under `/templates`; picking a row opens it in a canvas —
a circuit draws itself, a block shell runs, a doc opens as a document.

## Contributing

There is no packaging step, which is the point: a template is a folder.

1. `mkdir workspace-template/templates/<name>` (shipped) or `templates/<name>` (your own workspace),
2. write `template.md` as above — the artefact in one fenced block, the parts that change as `{{vars}}`,
3. read it once (`GET /api/templates?id=<name>`) and look at `check`: a circuit that does not render, or a
   block the checker complains about, is not done yet,
4. for the shipped shelf, open a pull request with the folder. Nothing else registers it.

The bar for accepting one: it must be verified (`check.ok`), it must be worth a lookup rather than a
sentence — a schematic, a shell with behaviour, a document whose structure is the hard part — and its
description must say when to use it, because that line is what the search reads.
