---
name: bjt-common-emitter
kind: circuit
title: Common-emitter amplifier
description: One NPN transistor with bias, input and output coupling — the standard single-stage gain block.
tags: circuit analog transistor bjt amplifier npn biasing gain
vars:
  - rb | label of the base resistor | R_B
  - rc | label of the collector resistor | R_C
  - cin | label of the input capacitor | C_{in}
  - cout | label of the output capacitor | C_{out}
---
The collector current sets the gain: `A_v ≈ −R_C / r_e`, with `r_e ≈ 25 mV / I_C`. Bias so the collector sits near half of `V_CC` — that is the largest symmetric swing, and the reason `R_B` is chosen from the base-current the collector current implies.

The coupling capacitors block DC while passing the signal, so the stage does not shift the bias of whatever drives it or of whatever it drives.

```tex
\begin{circuitikz}
  \node[npn] (q) at (3,0) {};
  \draw (q.B) -- ++(-1,0) to[C, l=${{cin}}$] ++(-2.2,0) node[left]{$v_{in}$};
  \draw (q.B) -- ++(-1,0) to[R=${{rb}}$, *-*] ++(0,2.6) node[vcc]{$V_{CC}$};
  \draw (q.C) to[R=${{rc}}$, *-*] ++(0,2.6) node[vcc]{$V_{CC}$};
  \draw (q.C) -- ++(1.4,0) to[C, l=${{cout}}$] ++(2.2,0) node[right]{$v_{out}$};
  \draw (q.E) -- ++(0,-0.8) node[ground]{};
\end{circuitikz}
```
