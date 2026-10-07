---
name: opamp-noninverting
kind: circuit
title: Non-inverting op-amp
description: Feedback divider from the output to the inverting input — gain of 1 + R2/R1, drawn with the divider that sets it.
tags: circuit analog opamp amplifier feedback gain noninverting
vars:
  - r1 | label of the feedback resistor to ground | R_1
  - r2 | label of the feedback resistor from the output | R_2
---
`v_out = (1 + R2/R1) · v_in`. The gain never drops below 1, the input impedance is the op-amp's (very high), and the feedback network is what actually sets the ratio — the op-amp only supplies the current.

Two practical notes worth saying out loud: keep `R2 ∥ R1` low enough that bias current does not add offset, and put a small capacitor across `R2` if the layout is long — it damps the peaking that stray capacitance causes.

```tex
\begin{circuitikz}
  \draw (0,1) -- (2.2,0) -- (0,-1) -- cycle;
  \node[left] at (0.4,0.42) {$+$};
  \node[left] at (0.4,-0.42) {$-$};
  \draw (0,0.5) -- (-2.2,0.5) node[left]{$v_{in}$};
  \draw (0,-0.5) -- (-1.6,-0.5) coordinate (fb);
  \draw (fb) to[R=${{r1}}$, *-] ++(0,-1.7) node[ground]{};
  \draw (2.2,0) -- (5.4,0) node[right]{$v_{out}$};
  \draw (4.4,0) |- (4.4,1.9) to[R=${{r2}}$] (0.4,1.9) -| (fb);
\end{circuitikz}
```
