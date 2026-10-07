---
name: poll
kind: block
title: Quick poll
description: One question, a few options, and a button that sends the pick to the model — for surveys, preference checks and class-wide votes.
tags: block poll survey vote question options feedback choice
vars:
  - question | what is being asked | Which topic should we do next?
  - options | the choices, pipe separated | Recursion|Graphs|Dynamic programming|Backtracking
  - note | one line under the question | Pick one — the next lesson is built around the winner.
---
`x-choice` without an `answer` is a poll: it records the pick and shows which one was taken. `sendToLm` hands the value to the model, so the reply can act on the vote instead of asking again.

```html
<x-state sent="false" pick=""></x-state>
<x-card title="Poll">
  <p>{{question}}</p>
  <x-choice name="poll" options="{{options}}" layout="grid" @change="picked()"></x-choice>
  <small>{{note}}</small>
  <x-row>
    <button tone="accent" :disabled="!pick" @click="sendToLm({ topic: pick }, 'Use the vote as the decision: say why it is a good next step, then start')">Send my pick</button>
    <span show="sent" tone="success">Sent — the reply is below.</span>
  </x-row>
</x-card>
<script>
function picked() {
  pick = $$("x-choice")[0].value;
}
</script>
```
