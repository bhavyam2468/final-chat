---
name: bridge-rectifier
kind: circuit
title: Full-wave bridge rectifier
description: Four diodes, one load — how AC becomes DC, with the conduction path of each half cycle.
tags: circuit power diode rectifier ac dc bridge supply
vars:
  - rl | label of the load | R_L
  - d | diode label prefix | D
---
On the positive half cycle `D1` and `D4` conduct (`P → A → load → B → N`); on the negative half `D3` and `D2` do. Either way the current through the load runs the same way, so the output is the input's absolute value minus two diode drops.

Add a capacitor across `R_L` and the output becomes roughly `V_peak − 1.4 V` with ripple `I_load / (2 f C)`.

```tex
\begin{circuitikz}
  \coordinate (P) at (0,4); \coordinate (N) at (0,0);
  \draw (P) to[sV, l=$v_{in}$] (N);
  \coordinate (A) at (4,4); \coordinate (B) at (4,0);
  \draw (P) to[D*, l_=${{d}}_1$] (A);
  \draw (N) to[D*, l_=${{d}}_3$] (A);
  \draw (B) to[D*, l=${{d}}_2$] (P);
  \draw (B) to[D*, l=${{d}}_4$] (N);
  \draw (A) to[R=${{rl}}$, v=$v_{out}$] (B);
\end{circuitikz}
```
