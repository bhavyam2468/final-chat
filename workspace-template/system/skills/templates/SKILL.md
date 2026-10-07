---
name: templates
description: Before drawing a circuit, or hand-writing a quiz, dashboard, flashcards, poll, checklist or document shell, take the verified one from the template library. Also how to save what you build so it is a lookup next time.
---

# Templates

A template is a piece that has already been made to work once: a **circuit** (circuitikz source that was
rendered before it was saved), a **block** shell (a Blocks document that passed the app's checker), or a
**doc** structure (the sections, in the order a marker or reviewer looks for them).

The library exists because some things a model writes from memory are quietly wrong: schematics and
gate-level drawings, scoring logic, the shape of a lab report. Pulling one is one call; inventing one is a
page of plausible-looking markup that renders as a red box.

## Use it

1. `template_search("half adder")` — or `("quiz with scoring")`, `("lab report")`, `kind="circuit"`.
   Hits show the id, kind, description and the placeholder names.
2. `template_get("half-adder", { a: "X", b: "Y" })` — returns the source filled in, the prose around it, and
   a **check**: circuits come back rendered through the app's own TikZ engine, blocks through `uiIssues`.
   `check.ok` means it will come out right. Use the returned source as it is.
3. Put it where it belongs:
   - circuit → an `<x-tikz>` block in the reply (or the canvas the user is looking at):
     `<x-tikz src-tex="…source…"></x-tikz>`;
   - block → wrap in `<ui>…</ui>` exactly like any block you write;
   - doc → the prose is the reply.

Nothing in the library is a template of *your thinking*: the values are yours, the drawing or the shell is
not. Never rewrite a verified circuit "to make it nicer" — change the variable values instead.

## If nothing fits

Write it yourself, then `template_save` it. That is the whole contribution path:

```
template_save({
  name: "full-subtractor",          // one word, lowercase, dashes
  kind: "circuit",                  // circuit | block | doc
  title: "Full subtractor",
  description: "Two bits plus a borrow in, difference and borrow out.",
  tags: "circuit digital logic subtractor xor and",
  vars: [{ name: "a", label: "first input", example: "A" }],
  body: "One line of prose.\n\n```tex\n\\begin{circuitikz} … \\end{circuitikz}\n```\n",
})
```

Rules the saver enforces, so a broken template cannot get in:

- `name` is one word; `description` is required and is what a search shows;
- the artifact lives in **one** fenced block: ` ```tex ` for a circuit, ` ```html ` for a block, nothing for a doc;
- every `{{placeholder}}` should be declared in `vars` with a sane `example` (the example is what a preview
  fills in), and every declared var should appear in the body — `template_save` tells you which ones do not match;
- `overwrite: true` replaces an existing one of the same name.

Save it in `templates/<name>/` in the workspace and it is searchable immediately, exactly like a shipped one.
A ship-worthy template goes in the app's repo under `workspace-template/templates/<name>/` (same folder shape),
which is how the community shelf grows.

## Where things live

| Shelf | Path | Who writes it |
|---|---|---|
| shipped | `workspace-template/templates/` | the app, and pull requests |
| yours | `templates/` in the workspace | you, or the user by hand |

A user template with the same name shadows the shipped one. `GET /api/templates` lists both,
`?id=<name>` returns one verified and filled, `POST` saves, `DELETE` removes one of yours (shipped ones are
read-only). The palette (`/templates`) shows the same list: picking a row opens it in a canvas — a circuit
renders, a block shell runs.

## What the shipped library covers

- **circuits**: half-adder, voltage-divider, rc-lowpass, bridge-rectifier, opamp-noninverting,
  bjt-common-emitter, mosfet-switch, rlc-series, zener-regulator. Each one also carries the sentence worth
  saying with it (the formula, the practical catch).
- **blocks**: quiz (graded, with `sendToLm` for the misses), dashboard (live machine numbers through
  `x-live`), flashcards, poll, checklist, explore-function (sliders bound to `x-graph`).
- **docs**: lab-report, study-plan, debug-log.
