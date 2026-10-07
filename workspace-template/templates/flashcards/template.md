---
name: flashcards
kind: block
title: Flashcards deck
description: Term on one side, answer on the other, one card at a time with a numbers nav — the fastest way to drill a list of facts.
tags: block flashcards revise memorise drill terms practice deck
vars:
  - topic | what the deck is about | Organic chemistry — reagents
  - term1 | first prompt | What does LiAlH4 reduce?
  - def1 | its answer | Esters, carboxylic acids and amides to alcohols/amines — but not double bonds
  - term2 | second prompt | What does PCC oxidise?
  - def2 | its answer | Primary alcohols to aldehydes; stops there
  - term3 | third prompt | What does NaBH4 reduce?
  - def3 | its answer | Aldehydes and ketones to alcohols (mild, water tolerant)
---
Duplicate a `<x-slide>` for every card. The answer stays behind a `<details>` so the deck is usable with the keyboard alone, and the arrows move between cards.

```html
<x-deck id="cards" nav="numbers" loop>
  <x-slide label="1">
    <h3>{{term1}}</h3>
    <details><summary>Show the answer</summary><p>{{def1}}</p></details>
  </x-slide>
  <x-slide label="2">
    <h3>{{term2}}</h3>
    <details><summary>Show the answer</summary><p>{{def2}}</p></details>
  </x-slide>
  <x-slide label="3">
    <h3>{{term3}}</h3>
    <details><summary>Show the answer</summary><p>{{def3}}</p></details>
  </x-slide>
</x-deck>
<x-row>
  <small>{{topic}} · cards stay in this chat, so ask for more and they land in the same deck pattern.</small>
</x-row>
```
