---
name: dashboard
kind: block
title: Live machine dashboard
description: A dashboard whose numbers are real: CPU, load, RAM, disk and uptime read from the machine on a loop, with history ready for the charts.
tags: block dashboard live system monitor ram cpu disk uptime sparkline metrics real-time
vars:
  - title | what the dashboard is called | This machine
---
Each pill is a producer running in the sandbox every second: the value, its history and its health (`.ok`, `.error`) land in `S.<name>`, so the chart and the sparkline have nothing to do but draw. Point one at a different producer — a sensor, a queue depth, an API — and the dashboard follows.

```html
<x-state cpu="{}" ram="{}" disk="{}" procs="{}"></x-state>
<x-card title="{{title}}">
  <x-row>
    <x-live name="cpu" lang="bash" every="1s" label="CPU" unit="%">top -bn1 | awk '/Cpu\(s\)/{printf "%.0f", 100-$8}'</x-live>
    <x-live name="ram" lang="bash" every="1s" label="RAM" unit="%">free -m | awk '/Mem:/{printf "%.1f", $3/$2*100}'</x-live>
    <x-live name="disk" lang="bash" every="5s" label="Disk" unit="%">df -h / | awk 'NR==2{printf "%.0f", $5+0}'</x-live>
    <x-live name="procs" lang="bash" every="3s" label="Processes" show="value">ps -e --no-headers | wc -l</x-live>
    <x-live name="load" lang="bash" every="1s" label="Load 1m" parse="text" show="value">cut -d' ' -f1 /proc/loadavg</x-live>
    <x-live name="up" lang="bash" every="20s" label="Uptime" parse="text" show="value">uptime -p | sed 's/^up //'</x-live>
  </x-row>
  <x-chart type="area" :data="ram.history" title="Memory over time" x-label="seconds ago" y-label="%" height="150"></x-chart>
  <x-row>
    <x-sparkline :data="cpu.history" height="40"></x-sparkline>
    <p><small>Every value keeps its last 120 readings. A producer that fails keeps its last good number and shows the reason in place of it — the dashboard never lies about being stale.</small></p>
  </x-row>
</x-card>
```
