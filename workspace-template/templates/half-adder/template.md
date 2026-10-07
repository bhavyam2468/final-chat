---
name: half-adder
kind: circuit
title: Half adder
description: Two bits in, sum (XOR) and carry (AND) out — gate level, the drawing a digital-logic question is really asking for.
tags: circuit digital logic adder xor and gate combinational truth-table
vars:
  - a | label of the first input | A
  - b | label of the second input | B
---
The smallest combinational circuit: the sum is `A` XOR `B`, the carry is `A` AND `B`.

| A | B | Sum | Carry |
|---|---|---|---|
| 0 | 0 | 0 | 0 |
| 0 | 1 | 1 | 0 |
| 1 | 0 | 1 | 0 |
| 1 | 1 | 0 | 1 |

Chain two of these (carry out → carry in) for a full adder, and four for a 4-bit ripple-carry adder.

```tex
\begin{circuitikz}[scale=1]
  \node[xor port] (xor1) at (3.4,3.0) {};
  \node[and port] (and1) at (3.4,-0.4) {};
  \draw (xor1.in 1) -- ++(-0.4,0) -- ++(-0.8,0) -- ++(-0.9,0) node[left]{${{a}}$};
  \draw (xor1.in 2) -- ++(-0.8,0) -- ++(-1.3,0) node[left]{${{b}}$};
  \draw (and1.in 1) -- ++(-1.2,0) |- (1.3,3.0);
  \draw (and1.in 2) -- ++(-2.1,0) |- (0.9,3.0);
  \draw (xor1.out) -- ++(1.5,0) node[right]{Sum};
  \draw (and1.out) -- ++(1.5,0) node[right]{Carry};
\end{circuitikz}
```
