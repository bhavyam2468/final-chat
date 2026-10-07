---
name: rc-lowpass
kind: circuit
title: RC low-pass filter
description: One resistor, one capacitor, and the -3 dB corner at 1/(2πRC) — the standard filter question, drawn properly.
tags: circuit analog filter lowpass rc frequency bode cutoff signal
vars:
  - r | label of the resistor | R
  - c | label of the capacitor | C
---
`f_c = 1 / (2πRC)`. Below `f_c` the output follows the input; above it, the output falls 20 dB per decade and the phase lags toward −90°.

A first-order filter is a good default answer — it is stable, needs no supply, and its behaviour is one line of algebra instead of a simulation.

```tex
\begin{circuitikz}
  \draw (0,0) to[sV, l=$v_{in}$] (0,3) to[R=${{r}}$] (4.4,3) coordinate (out) to[C=${{c}}$] (4.4,0) -- (0,0);
  \draw (out) -- (6.6,3) node[right]{$v_{out}$};
  \draw (out) node[circ]{};
\end{circuitikz}
```
