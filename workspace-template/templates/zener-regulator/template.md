---
name: zener-regulator
kind: circuit
title: Zener shunt regulator
description: Series resistor plus Zener diode — the simplest way to hold a voltage, and its load-current limit drawn.
tags: circuit power zener regulator diode clamping supply voltage reference
vars:
  - rs | series resistor label | R_S
  - rl | load label | R_L
---
The series resistor takes the difference between `V_in` and `V_z`; the Zener absorbs whatever the load does not. That gives a hard limit worth stating with the drawing: `I_load ≤ (V_in − V_z)/R_S − I_z(min)`, and the diode must be able to dissipate `V_z · I_z(max)`.

Efficient it is not — but it is two parts, needs no feedback loop, and survives input transients that would kill a linear regulator's input.

```tex
\begin{circuitikz}
  \draw (0,0) to[battery1, l=$V_{in}$] (0,3.4) to[R=${{rs}}$, *-*] (3.6,3.4) coordinate (out);
  \draw (out) to[zD*, l=$D_z$] (3.6,0) -- (0,0);
  \draw (out) -- (6,3.4) to[R=${{rl}}$, v=$V_{out}$] (6,0.0) -- (3.6,0);
\end{circuitikz}
```
