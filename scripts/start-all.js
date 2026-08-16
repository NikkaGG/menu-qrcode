#!/usr/bin/env node
'use strict';

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const dns = require('dns');

const ROOT_DIR = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT_DIR, '.runtime');
const STATE_FILE = path.join(RUNTIME_DIR, 'state.json');

function ensureRuntimeDir() {
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  }
}

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (match) {
      env[match[1]] = match[2].trim();
    }
  }
  return env;
}

function validateConfiguration() {
  const rootEnv = parseEnv(path.join(ROOT_DIR, '.env'));
  const botEnv = parseEnv(path.join(ROOT_DIR, 'bot', '.env'));

  const requiredBotKeys = [
    'TELEGRAM_BOT_TOKEN',
    'KITCHEN_CHAT_ID',
    'WAITER_CHAT_ID',
    'BOT_INTERNAL_API_SECRET',
    'APP_URL',
  ];

  const missingBotKeys = requiredBotKeys.filter((key) => !botEnv[key]);
  if (missingBotKeys.length > 0) {
    throw new Error(`Missing required keys in bot/.env: ${missingBotKeys.join(', ')}`);
  }

  return { rootEnv, botEnv };
}

const dnsResolver = new dns.promises.Resolver();
dnsResolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);

const customDnsLookup = (hostname, options, callback) => {
  dnsResolver.resolve4(hostname).then((addresses) => {
    if (options && options.all) {
      callback(null, addresses.map((addr) => ({ address: addr, family: 4 })));
    } else {
      callback(null, addresses[0], 4);
    }
  }).catch((err) => {
    dns.lookup(hostname, options, callback);
  });
};

const customHttpsAgent = new https.Agent({ lookup: customDnsLookup });

async function pollHealth(url, timeoutMs = 60000, intervalMs = 2000) {
  const startTime = Date.now();
  const isHttps = url.startsWith('https://');

  while (Date.now() - startTime < timeoutMs) {
    const ok = await new Promise((resolve) => {
      try {
        const client = isHttps ? https : http;
        const req = client.get(
          url,
          {
            agent: isHttps ? customHttpsAgent : undefined,
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          },
          (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
              if (res.statusCode === 200) {
                try {
                  const data = JSON.parse(body);
                  if (data && data.status === 'ok') {
                    return resolve(true);
                  }
                } catch (_) {}
              }
              resolve(false);
            });
          }
        );
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
      } catch (_) {
        resolve(false);
      }
    });

    if (ok) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout waiting for health check at ${url}`);
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill.exe /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch (_) {}
}

async function runVercelCommand(args, stdinInput = null) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'cmd.exe' : 'npx';
    const cmdArgs = isWindows
      ? ['/c', `npx --yes vercel@58.9.2 ${args.join(' ')}`]
      : ['--yes', 'vercel@58.9.2', ...args];

    const child = spawn(cmd, cmdArgs, {
      cwd: ROOT_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    if (stdinInput !== null) {
      child.stdin.write(stdinInput + '\n');
      child.stdin.end();
    }

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const errorMsg = stderr || stdout || `Process exited with code ${code}`;
        reject(new Error(`Vercel command failed: ${errorMsg}`));
      }
    });
  });
}

async function startBot(botEnv) {
  const pythonPath = path.join(ROOT_DIR, 'bot', '.venv', 'Scripts', 'python.exe');
  if (!fs.existsSync(pythonPath)) {
    throw new Error(`Python virtual environment not found at ${pythonPath}`);
  }

  const childEnv = { ...process.env, ...botEnv };
  const botProcess = spawn(pythonPath, ['-m', 'bot'], {
    cwd: ROOT_DIR,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  botProcess.stdout.on('data', (d) => {
    const line = d.toString().trim();
    if (line) console.log(`[Bot] ${line}`);
  });

  botProcess.stderr.on('data', (d) => {
    const line = d.toString().trim();
    if (line) console.error(`[Bot Error] ${line}`);
  });

  return botProcess;
}

async function startTunnel(port = 8080) {
  return new Promise((resolve, reject) => {
    const tunnelProcess = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        killTree(tunnelProcess.pid);
        reject(new Error('Timeout waiting for Cloudflare Tunnel URL (30s)'));
      }
    }, 30000);

    tunnelProcess.stderr.on('data', (d) => {
      const text = d.toString();
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ tunnelProcess, url: match[0] });
      }
    });

    tunnelProcess.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    tunnelProcess.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`Tunnel exited prematurely with code ${code}`));
      }
    });
  });
}

async function main() {
  console.log('=====================================================');
  console.log('  Sushi Crazy Menu & Telegram Bot Launcher');
  console.log('=====================================================');

  ensureRuntimeDir();

  console.log('[1/5] Checking configuration...');
  const { botEnv } = validateConfiguration();

  let botProcess = null;
  let tunnelProcess = null;

  function cleanup() {
    console.log('\nStopping background services...');
    if (botProcess && botProcess.pid) {
      console.log(`- Terminating bot (PID: ${botProcess.pid})...`);
      killTree(botProcess.pid);
    }
    if (tunnelProcess && tunnelProcess.pid) {
      console.log(`- Terminating tunnel (PID: ${tunnelProcess.pid})...`);
      killTree(tunnelProcess.pid);
    }
    try {
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    } catch (_) {}
    console.log('Shutdown complete.');
  }

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  try {
    console.log('[2/5] Starting Telegram Bot on port 8080...');
    botProcess = await startBot(botEnv);

    console.log('      Waiting for bot health check (http://localhost:8080/health)...');
    await pollHealth('http://127.0.0.1:8080/health', 15000);
    console.log('      ✓ Bot is healthy and polling Telegram.');

    console.log('[3/5] Opening Cloudflare Quick Tunnel...');
    const tunnelResult = await startTunnel(8080);
    tunnelProcess = tunnelResult.tunnelProcess;
    const tunnelUrl = tunnelResult.url;
    console.log(`      ✓ Tunnel active: ${tunnelUrl}`);

    console.log('      Checking tunnel endpoint health...');
    await pollHealth(`${tunnelUrl}/health`, 60000);
    console.log('      ✓ Tunnel health verified.');

    console.log('[4/5] Connecting Vercel production & preview to tunnel URL...');
    console.log('      Updating BOT_INTERNAL_API_URL on Vercel Production...');
    await runVercelCommand(
      ['env', 'add', 'BOT_INTERNAL_API_URL', 'production', '--force', '--sensitive', '--yes', '--non-interactive'],
      tunnelUrl
    );

    console.log('      Updating BOT_INTERNAL_API_URL on Vercel Preview...');
    await runVercelCommand(
      ['env', 'add', 'BOT_INTERNAL_API_URL', 'preview', '--force', '--sensitive', '--yes', '--non-interactive'],
      tunnelUrl
    );

    console.log('      Redeploying Vercel production to apply changes...');
    await runVercelCommand([
      'redeploy',
      'menu-qrcode.vercel.app',
      '--target',
      'production',
      '--non-interactive',
    ]);
    console.log('      ✓ Vercel production redeployed and aliased.');

    const state = {
      startedAt: new Date().toISOString(),
      botPid: botProcess.pid,
      tunnelPid: tunnelProcess.pid,
      tunnelUrl,
      appUrl: botEnv.APP_URL || 'https://menu-qrcode.vercel.app',
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    console.log('[5/5] All systems online and linked!');
    console.log('=====================================================');
    console.log(`  Public Menu Website:  ${state.appUrl}`);
    console.log(`  Telegram Bot Status:  Online (Kitchen: ${botEnv.KITCHEN_CHAT_ID}, Waiter: ${botEnv.WAITER_CHAT_ID})`);
    console.log(`  Tunnel URL:           ${tunnelUrl}`);
    console.log('=====================================================');
    console.log('Press Ctrl+C to stop all services.');

    // Keep event loop alive and supervise children
    await new Promise((_, reject) => {
      botProcess.on('exit', (code) => {
        reject(new Error(`Bot exited unexpectedly with code ${code}`));
      });
      tunnelProcess.on('exit', (code) => {
        reject(new Error(`Tunnel exited unexpectedly with code ${code}`));
      });
    });
  } catch (err) {
    console.error('\nLauncher Error:', err.message);
    cleanup();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseEnv,
  validateConfiguration,
  pollHealth,
  killTree,
  runVercelCommand,
  startBot,
  startTunnel,
  main,
};
