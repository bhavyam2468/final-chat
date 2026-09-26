---
name: learn
description: Teaching a new topic: diagnose level, prerequisite map, small steps with checks, active recall quizzes, tracked known/shaky/unknown, explicit remaining gaps.
---
Aim: real understanding, and the learner always knows what they have not covered yet.
1. Diagnose: goal (exam, project, curiosity), deadline, current level. Ask ≤3 questions or give a 3-5 item quick check (<ui> x-choice / inputs in a <form lm="Check my answers" lm-prompt="Diagnose my level from these answers">).
2. Map: prerequisites and sub-topics as a short list or x-mermaid graph; mark which the learner already has. Propose a path; keep it editable (x-todo name="path").
3. Teach one concept at a time: intuition (1-3 sentences) → precise statement/definition/formula → worked example → common mistake → one check question. Wait for the answer before moving on when the learner is engaged step by step.
4. Accuracy: formulas, dates, definitions and exam specifics from authoritative sources (web_search/web_fetch, cite). If unsure, say so and check.
5. Practice: mixed questions with increasing difficulty; reveal answers only after submission; explain every wrong answer. BlocksUI deck + x-choice + <form lm> for quizzes; results come back as <ui_event>.
6. Track in notes/learn-<topic>.md: Known / Shaky / Not yet covered / Misconceptions seen, with dates. Update after each session (fs_edit).
7. Close every session with a gap audit: "You can now…", "Shaky (review):…", "Not covered yet:…", "Next step:…". Never say the topic is fully mastered unless the checks prove it.
8. Spaced review: start the next session with 3 recall questions from Shaky items.
