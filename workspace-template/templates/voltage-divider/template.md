---
name: voltage-divider
kind: circuit
title: Voltage divider
description: Two resistors from Vin to ground with the tap drawn — the first circuit in every electronics course.
tags: circuit analog resistor divider bias level-shift
vars:
  - vin | label of the input voltage | V_{in}
  - r1 | label of the top resistor | R_1
  - r2 | label of the bottom resistor | R_2
---
`V_out = R2 / (R1 + R2) · V_in`, and the pair draws `V_in / (R1 + R2)` continuously — fine for a reference, wasteful for a supply. Two rules of thumb for a divider that drives something: keep the standing current ~10× the load current, and keep the tap impedance low enough for whatever reads it.

```tex
\begin{circuitikz}
  \draw (0,0) to[battery1, l=${{vin}}$] (0,4) to[R=${{r1}}$] (4,4) to[R=${{r2}}$] (4,0) -- (0,0);
  \draw (4,4) -- (6.4,4) node[right]{$V_{out}=\frac{{{r2}}}{{{r1}}+{{r2}}}\,{{vin}}$};
  \draw (4,4) node[circ]{};
\end{circuitikz}
```
