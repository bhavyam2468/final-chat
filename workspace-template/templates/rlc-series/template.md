---
name: rlc-series
kind: circuit
title: Series RLC circuit
description: Resistor, inductor, capacitor in series with the resonant frequency marked — impedance, bandwidth, damping.
tags: circuit analog rlc resonance impedance filter damping inductor capacitor
vars:
  - r | resistor label | R
  - l | inductor label | L
  - c | capacitor label | C
---
`f_0 = 1 / (2π√(LC))`, quality factor `Q = (1/R)·√(L/C)`, bandwidth `f_0 / Q`. At resonance the reactances cancel, the impedance is just `R`, and the voltage across `L` and `C` can each be `Q` times the source — which is why a resonant tank is both useful and a way to destroy components.

```tex
\begin{circuitikz}
  \draw (0,0) to[sV, l=$v_{in}$] (0,3) to[R=${{r}}$] (3,3) to[L=${{l}}$] (6,3) to[C=${{c}}$] (6,0) -- (0,0);
  \draw (3,3) node[circ]{} (6,3) node[circ]{};
\end{circuitikz}
```
