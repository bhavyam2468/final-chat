---
name: mosfet-switch
kind: circuit
title: Low-side MOSFET switch
description: N-channel MOSFET as a switch between a load and ground, with the gate drive drawn — relays, LEDs, heaters.
tags: circuit power mosfet switch transistor load pwm gate nmos
vars:
  - rl | label of the load | R_L
  - vg | label of the gate drive | V_{gate}
---
The load sits on the drain, the MOSFET pulls its source to ground: `V_gate` above the threshold turns it on, and `R_DS(on)` (tens of milliohms in a good part) sets the dissipation — `P = I² · R_DS(on)`, which is why a switch runs cold while the load does the work.

Two things that bite in practice: the gate needs a series resistor (a few hundred ohms) so it does not ring, and an inductive load needs a flyback diode across it.

```tex
\begin{circuitikz}
  \node[nmos] (m) at (2,1.6) {};
  \draw (m.D) to[R=${{rl}}$, *-*] ++(0,2.6) node[vcc]{$V_{DD}$};
  \draw (m.S) -- ++(0,-1.2) node[ground]{};
  \draw (m.G) -- ++(-0.8,0) coordinate (g);
  \draw (g) -- ++(0,-1.5) coordinate (gl);
  \draw (gl) to[R=$R_G$] ++(-2.4,0) node[left]{${{vg}}$};
\end{circuitikz}
```
