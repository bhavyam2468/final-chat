---
name: explore-function
kind: block
title: Explore a function
description: A graph with sliders bound to its letters plus a value table — for "what happens if b changes?" without touching a single line of code.
tags: block math function graph slider interactive desmos explore plot
vars:
  - title | what is being explored | Damped sine
  - fn | the function, letters become sliders | y=a*sin(b*x)*exp(-c*x)
---
Letters in `fn` that have no input become sliders automatically; the ones below set their range. Dragging is a genuine parameter change — the curve, the labels and the table all follow.

```html
<x-card title="{{title}}">
  <x-graph fn="{{fn}}" xmin="-1" xmax="12" height="260"></x-graph>
  <x-row>
    <x-col>
      <label>a <input type="range" name="a" min="0" max="3" step="0.1" value="1"></label>
      <label>b <input type="range" name="b" min="0.5" max="6" step="0.1" value="2"></label>
      <label>c <input type="range" name="c" min="0" max="1" step="0.02" value="0.2"></label>
    </x-col>
    <x-table csv="x,y\n0,0\n1,?\n2,?\n3,?" caption="Sample values"></x-table>
  </x-row>
</x-card>
```
