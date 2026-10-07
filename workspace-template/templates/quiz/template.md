---
name: quiz
kind: block
title: Graded quiz
description: A deck of multiple-choice questions with real scoring, a revealed answer per question and a button that asks the model to explain the misses.
tags: block quiz mcq test exam practice score multiple-choice questions
vars:
  - title | what the quiz is called | Kinematics check
  - q1 | first question | A car speeds up from 0 to 20 m/s in 5 s. What is its acceleration?
  - q1options | its options, pipe separated | 2 m/s^2|4 m/s^2|8 m/s^2|20 m/s^2
  - q1answer | the right option: its letter, text or 1-based number | B
  - q2 | second question | A ball is thrown straight up. What is its acceleration at the highest point?
  - q2options | its options | 0 m/s^2|9.8 m/s^2 downward|9.8 m/s^2 upward|changing
  - q2answer | the right option | B
---
Copy the `<x-slide>` block for every extra question — each one keeps its own `answer`, so scoring stays right without a separate answer key. `x-choice` marks the picked option, `reveal` shows the right one once the quiz is graded, and the last button hands the score to the model.

```html
<x-state submitted="false" right="0" total="0"></x-state>
<x-card title="{{title}}">
  <x-deck id="q" nav="numbers" show="!submitted">
    <x-slide label="Q1">
      <p>{{q1}}</p>
      <x-choice name="q1" options="{{q1options}}" answer="{{q1answer}}" :reveal="submitted" layout="grid"></x-choice>
    </x-slide>
    <x-slide label="Q2">
      <p>{{q2}}</p>
      <x-choice name="q2" options="{{q2options}}" answer="{{q2answer}}" :reveal="submitted" layout="grid"></x-choice>
    </x-slide>
    <x-row>
      <button tone="accent" @click="grade()">Grade</button>
      <x-spacer></x-spacer>
      <small>Move through the deck with the arrows; answers can be changed until you grade.</small>
    </x-row>
  </x-deck>
  <x-section show="submitted" title="Result">
    <x-progress :value="right" :max="total" tone="success" label="Score"></x-progress>
    <p><b>{{ '{{' }} right {{ '}}' }} of {{ '{{' }} total {{ '}}' }}</b> correct. The right answer is revealed beside yours.</p>
    <x-row>
      <button @click="sendToLm({ right: right, total: total }, 'Explain what I got wrong, one question at a time')">Explain my mistakes</button>
      <button tone="neutral" @click="again()">Try again</button>
    </x-row>
  </x-section>
</x-card>
<script>
function grade() {
  const cs = $$("x-choice");
  right = cs.filter((c) => c.correct).length;
  total = cs.length;
  submitted = true;
}
function again() {
  $$("x-choice").forEach((c) => c.reset && c.reset());
  submitted = false; right = 0;
}
</script>
```
