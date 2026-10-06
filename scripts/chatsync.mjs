#!/usr/bin/env node
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import process from 'node:process';
import readline from 'node:readline';

// ── Paths & Detection ─────────────────────────────────────────────
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

function findRepoDir() {
  try {
    const realScript = realpathSync(fileURLToPath(import.meta.url));
    const candidate = resolve(dirname(realScript), '..');
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  } catch {}
  if (existsSync(join(process.cwd(), 'package.json'))) return process.cwd();
  return process.env.CHAT_DIR || process.cwd();
}

const REPO_DIR = findRepoDir();

// ── Terminal Styling & Truecolor ──────────────────────────────────
const esc = (s) => `\x1b[${s}`;
const c = {
  reset: esc('0m'),
  bold: esc('1m'),
  dim: esc('2m'),
  italic: esc('3m'),
  underline: esc('4m'),
  black: esc('30m'),
  red: esc('31m'),
  green: esc('32m'),
  yellow: esc('33m'),
  blue: esc('34m'),
  magenta: esc('35m'),
  cyan: esc('36m'),
  white: esc('37m'),
  gray: esc('90m'),
  bgBlack: esc('40m'),
  bgBlue: esc('44m'),
  bgCyan: esc('46m'),
};

const clearScreen = esc('2J') + esc('H');
const hideCursor = esc('?25l');
const showCursor = esc('?25h');

const supportsTrueColor = () => {
  if (process.env.NO_COLOR) return false;
  return /truecolor|24bit/i.test(process.env.COLORTERM || '') ||
    /xterm-256|alacritty|kitty|wezterm|ghostty|tmux/i.test(process.env.TERM || '');
};

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const mix = (from, to, t) => [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)];
const rgbFg = ([r, g, b]) => esc(`38;2;${r};${g};${b}m`);

function gradient(text, stops = ['#00c6ff', '#0072ff', '#9b51e0', '#ff007f']) {
  if (!supportsTrueColor()) return `${c.cyan}${c.bold}${text}${c.reset}`;
  const rgbStops = stops.map(hexToRgb);
  const lines = text.split('\n');
  const width = Math.max(...lines.map((l) => [...l].length));

  return lines.map((line) => {
    let col = 0;
    let out = '';
    for (const ch of line) {
      if (ch === ' ') { out += ' '; col++; continue; }
      const t = width <= 1 ? 0 : col / (width - 1);
      const segment = t * (rgbStops.length - 1);
      const idx = Math.min(Math.floor(segment), rgbStops.length - 2);
      const localT = segment - idx;
      const rgb = mix(rgbStops[idx], rgbStops[idx + 1], localT);
      out += `${rgbFg(rgb)}${ch}`;
      col++;
    }
    return out + c.reset;
  }).join('\n');
}

const CYAN = supportsTrueColor() ? esc('38;2;0;210;255m') : c.cyan;
const GREEN = supportsTrueColor() ? esc('38;2;74;222;128m') : c.green;
const AMBER = supportsTrueColor() ? esc('38;2;251;191;36m') : c.yellow;
const PURPLE = supportsTrueColor() ? esc('38;2;192;132;252m') : c.magenta;
const ROSE = supportsTrueColor() ? esc('38;2;244;63;94m') : c.red;

// ── Banner Art ───────────────────────────────────────────────────
const ASCII_BANNER = `
  ╔═══════════════════════════════════════════════════════════╗
  ║    ███████╗██╗███╗   ██╗ █████╗ ██╗         ██████╗       ║
  ║    ██╔════╝██║████╗  ██║██╔══██╗██║        ██╔════╝       ║
  ║    █████╗  ██║██╔██╗ ██║███████║██║        ██║            ║
  ║    ██╔══╝  ██║██║╚██╗██║██╔══██║██║        ██║            ║
  ║    ██║     ██║██║ ╚████║██║  ██║███████╗   ╚██████╗       ║
  ║    ╚═╝     ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝    ╚═════╝       ║
  ║              FINAL CHAT · WORKSPACE SYNC                  ║
  ╚═══════════════════════════════════════════════════════════╝`;

// ── Git & Execution Utilities ─────────────────────────────────────
function run(cmd, args, cwd = REPO_DIR, silent = false) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 180000 });
  if (r.error) throw r.error;
  if (!silent && r.status !== 0) {
    // console.error(r.stderr || r.stdout);
  }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function runAsyncWithSpinner(title, taskFn) {
  return new Promise(async (resolve, reject) => {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    process.stdout.write(hideCursor);
    const timer = setInterval(() => {
      process.stdout.write(`\r  ${CYAN}${frames[i++ % frames.length]}${c.reset}  ${title} `);
    }, 80);

    try {
      const res = await taskFn();
      clearInterval(timer);
      process.stdout.write(`\r  ${GREEN}✓${c.reset}  ${title} \n`);
      resolve(res);
    } catch (err) {
      clearInterval(timer);
      process.stdout.write(`\r  ${ROSE}✖${c.reset}  ${title} (failed)\n`);
      reject(err);
    } finally {
      process.stdout.write(showCursor);
    }
  });
}

// ── Git Queries ───────────────────────────────────────────────────
function fetchRemotes() {
  return run('git', ['fetch', '--all', '--prune'], REPO_DIR);
}

function getRemoteBranches() {
  fetchRemotes();
  const res = run('git', [
    'for-each-ref',
    '--sort=-committerdate',
    'refs/remotes/origin/',
    '--format=%(committerdate:relative)|||%(refname:short)|||%(subject)|||%(objectname:short)'
  ], REPO_DIR);

  return res.stdout
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.includes('origin/HEAD') && !l.startsWith('origin|||'))
    .map(line => {
      const [date, ref, subject, hash] = line.split('|||');
      const name = ref.replace(/^origin\//, '');
      return { ref, name, date, subject: (subject || '').slice(0, 50), hash };
    });
}

function getCurrentBranch() {
  const r = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], REPO_DIR);
  return r.stdout.trim() || 'main';
}

function ensureTsConfigExclude() {
  const p = join(REPO_DIR, 'tsconfig.json');
  if (!existsSync(p)) return;
  try {
    let raw = readFileSync(p, 'utf8');
    if (!raw.includes('"workspace"')) {
      raw = raw.replace('"node_modules",\n    "dev"', '"node_modules",\n    "dev",\n    "workspace"');
      writeFileSync(p, raw, 'utf8');
    }
  } catch {}
}

async function checkAppHealth(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:3000/api/health'], REPO_DIR, true);
    if (res.stdout.trim() === '200') return true;
    await new Promise(r => setTimeout(r, 600));
  }
  return false;
}

// ── Rollback State Management ─────────────────────────────────────
function getRollbackFile() {
  const gitDir = join(REPO_DIR, '.git');
  if (existsSync(gitDir)) return join(gitDir, 'chatsync-rollback.json');
  return join(REPO_DIR, '.chatsync-rollback.json');
}

function saveRollbackSnapshot(meta) {
  try {
    const file = getRollbackFile();
    let history = [];
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        if (Array.isArray(parsed)) history = parsed;
        else if (parsed && parsed.hash) history = [parsed];
      } catch {}
    }
    history.unshift({
      id: Date.now().toString(36),
      timestamp: new Date().toISOString(),
      ...meta,
    });
    // keep up to 15 rollback snapshots
    history = history.slice(0, 15);
    writeFileSync(file, JSON.stringify(history, null, 2), 'utf8');
  } catch {}
}

function getRollbackSnapshots() {
  try {
    const file = getRollbackFile();
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
      if (parsed && parsed.hash) return [parsed];
    }
  } catch {}
  return [];
}

function getRecentCommits(limit = 15) {
  const res = run('git', ['log', `-n${limit}`, '--format=%h|||%cr|||%s|||%H'], REPO_DIR);
  if (res.status !== 0) return [];
  return res.stdout
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const [shortHash, relativeTime, subject, fullHash] = line.split('|||');
      return { shortHash, relativeTime, subject: (subject || '').slice(0, 50), fullHash };
    });
}

// ── Interactive UI Components ────────────────────────────────────
function header() {
  console.clear();
  console.log(gradient(ASCII_BANNER));
  console.log(`  ${c.dim}Repository:${c.reset} ${c.bold}${REPO_DIR}${c.reset}  ${c.dim}│${c.reset}  ${c.dim}Active Branch:${c.reset} ${CYAN}${getCurrentBranch()}${c.reset}`);
  console.log(`  ${c.dim}Service:${c.reset}    ${GREEN}minimalist-chat.service${c.reset}  ${c.dim}│${c.reset}  ${c.dim}Target:${c.reset} ${AMBER}http://localhost:3000${c.reset}\n`);
}

function promptSelect(items, promptTitle, renderItem) {
  return new Promise((resolve) => {
    let index = 0;
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    function render() {
      header();
      console.log(`  ${c.bold}${promptTitle}${c.reset}`);
      console.log(`  ${c.dim}${'─'.repeat(58)}${c.reset}`);

      items.forEach((item, i) => {
        const isSelected = i === index;
        const prefix = isSelected ? `  ${CYAN}❯ ${c.bold}` : `    ${c.dim}`;
        const suffix = isSelected ? `${c.reset}` : `${c.reset}`;
        console.log(`${prefix}${renderItem(item, isSelected)}${suffix}`);
      });

      console.log(`  ${c.dim}${'─'.repeat(58)}${c.reset}`);
      console.log(`  ${c.dim}↑/↓ or 1-${items.length} to move  ·  ⏎ enter to select  ·  q to exit${c.reset}\n`);
    }

    function onKey(b) {
      const key = b.toString();
      if (key === '\x03' || key === 'q' || key === 'Q') {
        cleanup();
        resolve(null);
        return;
      }
      if (key === '\r' || key === '\n') {
        cleanup();
        resolve(items[index]);
        return;
      }
      if (key === '\x1b[A' || key === 'k') { // UP
        index = (index - 1 + items.length) % items.length;
        render();
      } else if (key === '\x1b[B' || key === 'j') { // DOWN
        index = (index + 1) % items.length;
        render();
      } else {
        const num = parseInt(key, 10);
        if (!isNaN(num) && num >= 1 && num <= items.length) {
          index = num - 1;
          cleanup();
          resolve(items[index]);
        }
      }
    }

    function cleanup() {
      process.stdin.removeListener('data', onKey);
      if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    }

    process.stdin.on('data', onKey);
    render();
  });
}

function promptText(question, defaultValue = "") {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const defStr = defaultValue ? ` ${c.dim}(default: ${defaultValue})${c.reset}` : '';
    rl.question(`\n  ${c.bold}${question}${defStr}: `, (ans) => {
      rl.close();
      res(ans.trim() || defaultValue);
    });
  });
}

// ── Workflows ─────────────────────────────────────────────────────

async function pullWorkflow() {
  header();
  console.log(`  ${CYAN}Connecting to GitHub... Fetching remote branches...${c.reset}\n`);
  
  let branches = [];
  try {
    branches = getRemoteBranches();
  } catch (e) {
    console.log(`  ${ROSE}Failed to fetch remote branches:${c.reset} ${e.message}`);
    await promptText("Press Enter to continue...");
    return;
  }

  if (!branches.length) {
    console.log(`  ${AMBER}No remote branches found.${c.reset}`);
    await promptText("Press Enter to continue...");
    return;
  }

  const selectedBranch = await promptSelect(
    branches,
    "SELECT REMOTE BRANCH TO PULL (Latest → Oldest):",
    (b, isSelected) => {
      const name = isSelected ? `${CYAN}${b.name}${c.reset}` : b.name;
      const date = `${c.dim}[${b.date}]${c.reset}`;
      const msg = b.subject ? `${c.dim}— ${b.subject}${c.reset}` : '';
      return `${name.padEnd(32)} ${date.padEnd(20)} ${msg}`;
    }
  );

  if (!selectedBranch) return;

  const targetChoice = await promptSelect(
    [
      { id: "test", label: "🧪 Local Test Branch (test-update)", desc: "Safe: keeps main branch untouched, updates test environment" },
      { id: "main", label: "📦 Main Branch (main)", desc: "Direct: applies update directly onto local main branch" }
    ],
    `WHERE WOULD YOU LIKE TO APPLY '${selectedBranch.name}'?`,
    (t, isSelected) => `${t.label} ${c.dim}— ${t.desc}${c.reset}`
  );

  if (!targetChoice) return;

  header();
  console.log(`\n  ${c.bold}Updating Application:${c.reset}\n`);

  try {
    const targetBranch = targetChoice.id === "test" ? "test-update" : "main";
    
    // 0. Record rollback snapshot before pull
    const prePullBranch = getCurrentBranch();
    const prePullHash = run('git', ['rev-parse', 'HEAD'], REPO_DIR).stdout.trim();
    const prePullLog = run('git', ['log', '-1', '--format=%h|||%s|||%cr'], REPO_DIR).stdout.trim().split('|||');
    saveRollbackSnapshot({
      branch: prePullBranch,
      hash: prePullHash,
      shortHash: prePullLog[0] || prePullHash.slice(0, 7),
      subject: prePullLog[1] || 'State before pull',
      relativeTime: prePullLog[2] || 'just now',
      pulledRef: selectedBranch.ref,
      targetBranch,
      reason: `Snapshot before pulling ${selectedBranch.name}`
    });

    // 1. Checkout target branch
    await runAsyncWithSpinner(`Checking out ${targetBranch}`, async () => {
      run('git', ['checkout', '-B', targetBranch], REPO_DIR);
    });

    // 2. Pull / Merge branch
    await runAsyncWithSpinner(`Merging ${selectedBranch.ref} into ${targetBranch}`, async () => {
      const r = run('git', ['merge', '--no-ff', selectedBranch.ref, '-m', `Merge ${selectedBranch.ref} via chatsync`], REPO_DIR);
      if (r.status !== 0 && !r.stdout.includes('Already up to date')) {
        // Fallback: reset if unmerged
        run('git', ['reset', '--hard', selectedBranch.ref], REPO_DIR);
      }
    });

    // 3. Ensure tsconfig
    ensureTsConfigExclude();

    // 4. Install / sync dependencies if package.json updated
    await runAsyncWithSpinner(`Installing dependencies (npm install)`, async () => {
      const ins = run('npm', ['install', '--no-audit', '--no-fund'], REPO_DIR);
      if (ins.status !== 0) throw new Error("npm install failed: " + ins.stderr);
    });

    // 5. Clean cache & Build
    await runAsyncWithSpinner(`Building production Next.js bundle (npm run build)`, async () => {
      run('rm', ['-rf', '.next'], REPO_DIR);
      const b = run('npm', ['run', 'build'], REPO_DIR);
      if (b.status !== 0) throw new Error("Build failed: " + b.stderr);
    });

    // 5. Restart service
    await runAsyncWithSpinner(`Restarting minimalist-chat.service`, async () => {
      const s = run('systemctl', ['--user', 'restart', 'minimalist-chat.service'], REPO_DIR);
      if (s.status !== 0) throw new Error("Systemd restart failed");
    });

    // 6. Verify health
    await runAsyncWithSpinner(`Verifying application health check`, async () => {
      const ok = await checkAppHealth(20000);
      if (!ok) throw new Error("Service did not report HTTP 200 on /api/health");
    });

    // Success Screen
    console.log(`
  ${GREEN}╔═══════════════════════════════════════════════════════════╗${c.reset}
  ${GREEN}║${c.reset}  ${c.bold}✓ APPLICATION SUCCESSFULLY UPDATED & RESTARTED!${c.reset}          ${GREEN}║${c.reset}
  ${GREEN}╠═══════════════════════════════════════════════════════════╣${c.reset}
  ${GREEN}║${c.reset}  Branch:   ${CYAN}${selectedBranch.ref.padEnd(46)}${c.reset}${GREEN}║${c.reset}
  ${GREEN}║${c.reset}  Target:   ${AMBER}${targetBranch.padEnd(46)}${c.reset}${GREEN}║${c.reset}
  ${GREEN}║${c.reset}  Commit:   ${selectedBranch.hash} ${selectedBranch.subject.slice(0, 36).padEnd(38)}${GREEN}║${c.reset}
  ${GREEN}║${c.reset}  Status:   ${GREEN}● LIVE & ACTIVE${c.reset}  (${AMBER}http://localhost:3000${c.reset})           ${GREEN}║${c.reset}
  ${GREEN}║${c.reset}  Rollback: ${AMBER}chatsync --rollback${c.reset} ${c.dim}(undo update anytime)${c.reset}          ${GREEN}║${c.reset}
  ${GREEN}╚═══════════════════════════════════════════════════════════╝${c.reset}
`);
  } catch (err) {
    console.log(`\n  ${ROSE}Error during update:${c.reset} ${err.message}`);
  }

  await promptText("Press Enter to return to menu...");
}

async function pushWorkflow() {
  header();
  const statusRes = run('git', ['status', '-s'], REPO_DIR);
  const currentBranch = getCurrentBranch();

  console.log(`  ${c.bold}CURRENT REPOSITORY STATUS:${c.reset}`);
  console.log(`  ${c.dim}${'─'.repeat(58)}${c.reset}`);
  if (statusRes.stdout.trim()) {
    console.log(statusRes.stdout.split('\n').map(l => `    ${AMBER}${l}${c.reset}`).join('\n'));
  } else {
    console.log(`    ${GREEN}● Working tree clean (no uncommitted changes)${c.reset}`);
  }
  console.log(`  ${c.dim}${'─'.repeat(58)}${c.reset}\n`);

  const pushDest = await promptSelect(
    [
      { id: "current", label: `Current Branch (${currentBranch})`, desc: `Push directly to origin/${currentBranch}` },
      { id: "main", label: `Main Branch (origin/main)`, desc: `Push updates into origin/main` },
      { id: "new", label: `Create New Branch`, desc: `Create a new branch and push upstream` }
    ],
    "SELECT DESTINATION FOR PUSH:",
    (d) => `${d.label} ${c.dim}— ${d.desc}${c.reset}`
  );

  if (!pushDest) return;

  let targetBranch = currentBranch;
  if (pushDest.id === "main") targetBranch = "main";
  else if (pushDest.id === "new") {
    targetBranch = await promptText("Enter new branch name (e.g. feature/my-update)");
    if (!targetBranch) return;
  }

  const commitMsg = await promptText("Commit message", `update: ${new Date().toISOString().slice(0, 16)}`);

  header();
  console.log(`\n  ${c.bold}Pushing to GitHub:${c.reset}\n`);

  try {
    if (pushDest.id === "new") {
      await runAsyncWithSpinner(`Creating and switching to branch '${targetBranch}'`, async () => {
        run('git', ['checkout', '-b', targetBranch], REPO_DIR);
      });
    }

    if (statusRes.stdout.trim()) {
      await runAsyncWithSpinner(`Staging and committing files`, async () => {
        run('git', ['add', '.'], REPO_DIR);
        const cm = run('git', ['commit', '-m', commitMsg], REPO_DIR);
        if (cm.status !== 0 && !cm.stdout.includes('nothing to commit')) {
          throw new Error("Commit failed: " + cm.stderr);
        }
      });
    }

    await runAsyncWithSpinner(`Pushing to origin/${targetBranch}`, async () => {
      const p = run('git', ['push', '-u', 'origin', targetBranch], REPO_DIR);
      if (p.status !== 0) throw new Error("Push failed: " + p.stderr);
    });

    console.log(`
  ${GREEN}╔═══════════════════════════════════════════════════════════╗${c.reset}
  ${GREEN}║${c.reset}  ${c.bold}✓ PUSH TO GITHUB COMPLETED SUCCESSFULLY!${c.reset}               ${GREEN}║${c.reset}
  ${GREEN}╠═══════════════════════════════════════════════════════════╣${c.reset}
  ${GREEN}║${c.reset}  Remote:  ${CYAN}https://github.com/bhavyam2468/final-chat${c.reset}          ${GREEN}║${c.reset}
  ${GREEN}║${c.reset}  Branch:  ${AMBER}${targetBranch.padEnd(46)}${c.reset}${GREEN}║${c.reset}
  ${GREEN}║${c.reset}  Message: ${commitMsg.slice(0, 46).padEnd(46)}${GREEN}║${c.reset}
  ${GREEN}╚═══════════════════════════════════════════════════════════╝${c.reset}
`);
  } catch (err) {
    console.log(`\n  ${ROSE}Push error:${c.reset} ${err.message}`);
  }

  await promptText("Press Enter to return to menu...");
}

async function restartWorkflow() {
  header();
  console.log(`\n  ${c.bold}Restarting Application Service:${c.reset}\n`);

  try {
    ensureTsConfigExclude();
    await runAsyncWithSpinner("Rebuilding Next.js application bundle", async () => {
      const b = run('npm', ['run', 'build'], REPO_DIR);
      if (b.status !== 0) throw new Error(b.stderr);
    });

    await runAsyncWithSpinner("Restarting minimalist-chat.service", async () => {
      const r = run('systemctl', ['--user', 'restart', 'minimalist-chat.service'], REPO_DIR);
      if (r.status !== 0) throw new Error("Restart failed");
    });

    await runAsyncWithSpinner("Awaiting service health check", async () => {
      const ok = await checkAppHealth();
      if (!ok) throw new Error("Service health check timed out");
    });

    console.log(`\n  ${GREEN}✓ minimalist-chat is active and responding on http://localhost:3000${c.reset}\n`);
  } catch (e) {
    console.log(`\n  ${ROSE}Failed to restart:${c.reset} ${e.message}\n`);
  }

  await promptText("Press Enter to return to menu...");
}

async function rollbackWorkflow() {
  header();
  console.log(`  ${CYAN}Inspecting rollback points & git history...${c.reset}\n`);

  const snapshots = getRollbackSnapshots();
  const recentCommits = getRecentCommits(12);

  if (!snapshots.length && !recentCommits.length) {
    console.log(`  ${AMBER}No rollback points or git commits found.${c.reset}`);
    await promptText("Press Enter to continue...");
    return;
  }

  const choices = [];

  // 1. Saved pull snapshots
  if (snapshots.length > 0) {
    snapshots.forEach((snap, idx) => {
      const isLatest = idx === 0;
      const title = isLatest
        ? `⚡ Undo Last Pull (${snap.shortHash})`
        : `↩ Rollback Snapshot #${idx + 1} (${snap.shortHash})`;
      choices.push({
        type: 'snapshot',
        targetHash: snap.hash,
        shortHash: snap.shortHash || snap.hash.slice(0, 7),
        branch: snap.branch || getCurrentBranch(),
        subject: snap.subject || 'Previous state',
        time: snap.relativeTime || (snap.timestamp ? new Date(snap.timestamp).toLocaleString() : 'saved point'),
        label: title,
        desc: `${snap.branch ? '[' + snap.branch + '] ' : ''}${snap.subject} (${snap.relativeTime || 'saved point'})`
      });
    });
  }

  // 2. Option to choose from recent git commits
  if (recentCommits.length > 0) {
    choices.push({
      type: 'pick_commit',
      label: `📜 Pick From Recent Commits (${recentCommits.length})`,
      desc: `Browse recent commit history on ${getCurrentBranch()}`
    });
  }

  // 3. Back to menu
  choices.push({
    type: 'cancel',
    label: `✖ Back to Main Menu`,
    desc: `Cancel rollback operation`
  });

  const selected = await promptSelect(
    choices,
    "SELECT ROLLBACK OPTION:",
    (opt) => `${opt.label.padEnd(38)} ${c.dim}— ${opt.desc}${c.reset}`
  );

  if (!selected || selected.type === 'cancel') return;

  let rollbackTarget = null;

  if (selected.type === 'snapshot') {
    rollbackTarget = selected;
  } else if (selected.type === 'pick_commit') {
    const commitChoice = await promptSelect(
      recentCommits,
      "SELECT COMMIT TO RESTORE:",
      (commit, isSelected) => {
        const hash = isSelected ? `${CYAN}${commit.shortHash}${c.reset}` : commit.shortHash;
        const time = `${c.dim}[${commit.relativeTime}]${c.reset}`;
        return `${hash}  ${time.padEnd(20)}  ${commit.subject}`;
      }
    );

    if (!commitChoice) return;
    rollbackTarget = {
      targetHash: commitChoice.fullHash,
      shortHash: commitChoice.shortHash,
      branch: getCurrentBranch(),
      subject: commitChoice.subject,
      time: commitChoice.relativeTime,
      desc: commitChoice.subject
    };
  }

  if (!rollbackTarget) return;

  // Check uncommitted changes before rolling back
  const statusRes = run('git', ['status', '-s'], REPO_DIR);
  if (statusRes.stdout.trim()) {
    header();
    console.log(`  ${AMBER}⚠️  YOU HAVE UNCOMMITTED LOCAL CHANGES:${c.reset}`);
    console.log(`  ${c.dim}${'─'.repeat(58)}${c.reset}`);
    console.log(statusRes.stdout.split('\n').map(l => `    ${AMBER}${l}${c.reset}`).join('\n'));
    console.log(`  ${c.dim}${'─'.repeat(58)}${c.reset}\n`);

    const dirtyChoice = await promptSelect(
      [
        { id: 'stash', label: '📦 Stash changes & proceed', desc: 'Safely saves your uncommitted edits to git stash' },
        { id: 'discard', label: '🗑 Discard changes & proceed', desc: 'Cleans working tree and discards local changes' },
        { id: 'abort', label: '✖ Cancel rollback', desc: 'Keep changes and return to menu' }
      ],
      "HOW WOULD YOU LIKE TO HANDLE LOCAL CHANGES?",
      (item) => `${item.label.padEnd(32)} ${c.dim}— ${item.desc}${c.reset}`
    );

    if (!dirtyChoice || dirtyChoice.id === 'abort') return;

    if (dirtyChoice.id === 'stash') {
      run('git', ['stash', 'push', '-u', '-m', `chatsync-rollback-${Date.now()}`], REPO_DIR);
    } else if (dirtyChoice.id === 'discard') {
      run('git', ['reset', '--hard'], REPO_DIR);
      run('git', ['clean', '-fd'], REPO_DIR);
    }
  }

  // Confirmation screen
  header();
  console.log(`  ${c.bold}CONFIRM ROLLBACK TARGET:${c.reset}`);
  console.log(`  ${c.dim}${'─'.repeat(58)}${c.reset}`);
  console.log(`  Commit:  ${CYAN}${rollbackTarget.shortHash}${c.reset} — ${rollbackTarget.subject}`);
  console.log(`  Target:  ${AMBER}${rollbackTarget.branch || getCurrentBranch()}${c.reset}`);
  console.log(`  Date:    ${c.dim}${rollbackTarget.time}${c.reset}`);
  console.log(`  ${c.dim}${'─'.repeat(58)}${c.reset}\n`);

  const confirm = await promptText("Proceed with rollback, build & restart? [Y/n]", "y");
  if (confirm.toLowerCase() === 'n' || confirm.toLowerCase() === 'no') return;

  header();
  console.log(`\n  ${c.bold}Rolling Back Application:${c.reset}\n`);

  try {
    // 0. Save current state before rolling back (so user can redo if desired)
    const currentBranch = getCurrentBranch();
    const currentHash = run('git', ['rev-parse', 'HEAD'], REPO_DIR).stdout.trim();
    const currentLog = run('git', ['log', '-1', '--format=%h|||%s|||%cr'], REPO_DIR).stdout.trim().split('|||');
    saveRollbackSnapshot({
      branch: currentBranch,
      hash: currentHash,
      shortHash: currentLog[0] || currentHash.slice(0, 7),
      subject: currentLog[1] || 'State before rollback',
      relativeTime: currentLog[2] || 'just now',
      reason: `Snapshot before rolling back to ${rollbackTarget.shortHash}`
    });

    // 1. Checkout branch if specified
    if (rollbackTarget.branch && rollbackTarget.branch !== currentBranch) {
      await runAsyncWithSpinner(`Switching to branch ${rollbackTarget.branch}`, async () => {
        run('git', ['checkout', rollbackTarget.branch], REPO_DIR);
      });
    }

    // 2. Reset hard to target commit
    await runAsyncWithSpinner(`Resetting git repository to ${rollbackTarget.shortHash}`, async () => {
      const r = run('git', ['reset', '--hard', rollbackTarget.targetHash], REPO_DIR);
      if (r.status !== 0) throw new Error("Git reset failed: " + r.stderr);
    });

    // 3. Ensure tsconfig
    ensureTsConfigExclude();

    // 4. Restore dependencies for this commit if needed
    await runAsyncWithSpinner(`Syncing dependencies (npm install)`, async () => {
      const ins = run('npm', ['install', '--no-audit', '--no-fund'], REPO_DIR);
      if (ins.status !== 0) throw new Error("npm install failed: " + ins.stderr);
    });

    // 5. Clean cache & Build
    await runAsyncWithSpinner(`Building production Next.js bundle (npm run build)`, async () => {
      run('rm', ['-rf', '.next'], REPO_DIR);
      const b = run('npm', ['run', 'build'], REPO_DIR);
      if (b.status !== 0) throw new Error("Build failed: " + b.stderr);
    });

    // 5. Restart service
    await runAsyncWithSpinner(`Restarting minimalist-chat.service`, async () => {
      const s = run('systemctl', ['--user', 'restart', 'minimalist-chat.service'], REPO_DIR);
      if (s.status !== 0) throw new Error("Systemd restart failed");
    });

    // 6. Verify health
    await runAsyncWithSpinner(`Verifying application health check`, async () => {
      const ok = await checkAppHealth(20000);
      if (!ok) throw new Error("Service did not report HTTP 200 on /api/health");
    });

    // Success Screen
    console.log(`
  ${GREEN}╔═══════════════════════════════════════════════════════════╗${c.reset}
  ${GREEN}║${c.reset}  ${c.bold}✓ APPLICATION SUCCESSFULLY ROLLED BACK & RESTARTED!${c.reset}       ${GREEN}║${c.reset}
  ${GREEN}╠═══════════════════════════════════════════════════════════╣${c.reset}
  ${GREEN}║${c.reset}  Restored: ${CYAN}${rollbackTarget.shortHash} ${rollbackTarget.subject.slice(0, 36).padEnd(38)}${c.reset}${GREEN}║${c.reset}
  ${GREEN}║${c.reset}  Branch:   ${AMBER}${(rollbackTarget.branch || getCurrentBranch()).padEnd(46)}${c.reset}${GREEN}║${c.reset}
  ${GREEN}║${c.reset}  Status:   ${GREEN}● LIVE & ACTIVE${c.reset}  (${AMBER}http://localhost:3000${c.reset})           ${GREEN}║${c.reset}
  ${GREEN}╚═══════════════════════════════════════════════════════════╝${c.reset}
`);
  } catch (err) {
    console.log(`\n  ${ROSE}Error during rollback:${c.reset} ${err.message}`);
  }

  await promptText("Press Enter to return to menu...");
}

// ── Main Menu Loop ────────────────────────────────────────────────
async function main() {
  // Check CLI arguments for direct flags
  const arg = process.argv[2];
  if (arg === '--help' || arg === '-h') {
    header();
    console.log(`  ${c.bold}Final Chat Sync CLI Tool${c.reset}
  ${c.dim}${'─'.repeat(58)}${c.reset}
  ${c.bold}Usage:${c.reset}
    chatsync                    ${c.dim}Open interactive menu${c.reset}
    chatsync -p, --pull         ${c.dim}Pull remote update and restart${c.reset}
    chatsync -u, --push         ${c.dim}Commit and push updates to GitHub${c.reset}
    chatsync -b, --rollback     ${c.dim}Undo last pull or restore previous commit${c.reset}
    chatsync -r, --restart      ${c.dim}Rebuild and restart application service${c.reset}
    chatsync -h, --help         ${c.dim}Show this help message${c.reset}
  ${c.dim}${'─'.repeat(58)}${c.reset}\n`);
    process.exit(0);
  }
  if (arg === '--pull' || arg === '-p') return pullWorkflow();
  if (arg === '--push' || arg === '-u') return pushWorkflow();
  if (arg === '--rollback' || arg === '-b') return rollbackWorkflow();
  if (arg === '--restart' || arg === '-r') return restartWorkflow();

  const MAIN_OPTIONS = [
    { id: "pull", title: "⬇  Pull Update", desc: "Fetch remote branches (latest to oldest), pull, rebuild & restart" },
    { id: "push", title: "⬆  Push Update", desc: "Stage changes, commit, and push upstream to GitHub" },
    { id: "rollback", title: "⏪ Rollback Update", desc: "Undo last pull or restore previous commit, rebuild & restart" },
    { id: "restart", title: "↺  Restart App", desc: "Rebuild bundle and restart the background systemd service" },
    { id: "exit", title: "✖  Exit", desc: "Close sync utility" }
  ];

  while (true) {
    const chosen = await promptSelect(
      MAIN_OPTIONS,
      "CHOOSE ACTION:",
      (item) => `${item.title.padEnd(20)} ${c.dim}— ${item.desc}${c.reset}`
    );

    if (!chosen || chosen.id === "exit") {
      console.clear();
      console.log(`\n  ${CYAN}✦ Thank you for using Final Chat Sync!${c.reset}\n`);
      process.exit(0);
    }

    if (chosen.id === "pull") await pullWorkflow();
    else if (chosen.id === "push") await pushWorkflow();
    else if (chosen.id === "rollback") await rollbackWorkflow();
    else if (chosen.id === "restart") await restartWorkflow();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
