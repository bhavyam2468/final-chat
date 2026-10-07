---
name: checklist
kind: block
title: Working checklist
description: A plan as tickable items that keep their state while the user reads and scrolls — revision, lab steps, launch runbooks.
tags: block checklist todo plan steps tasks runbook revision
vars:
  - title | what the list is called | Physics revision — this week
  - tasks | the items, one per line, "- [x] done" or "- [ ] to do" | - [x] Rotational motion: revise the derivation\n- [ ] Rotational motion: 12 problems\n- [ ] SHM: read the chapter\n- [ ] SHM: graph problems
---
`x-todo` keeps `.value`, `.done` and `.total`, so the progress line is not a decoration — it is the list counting itself.

```html
<x-card title="{{title}}">
  <x-todo name="plan" add>{{tasks}}</x-todo>
  <x-progress :value="plan.done" :max="plan.total" tone="success" label="Progress"></x-progress>
  <small>Add or remove items in place; the count above follows.</small>
</x-card>
```
