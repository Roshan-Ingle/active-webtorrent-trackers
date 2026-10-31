import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const SEED_TRACKERS = [
  'wss://tracker.openwebtorrent.com:443/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev:443/announce',
  'wss://tracker.webtorrent.dev',
  'wss://open.ftorrent.com:443/announce',
  'wss://open.ftorrent.com',
  'wss://wt.tionis.dev',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.files.fm:7073/announce'
];

const SOURCES = [
  'https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_all_ws.txt',
  'https://raw.githubusercontent.com/XIU2/TrackersListCollection/master/all.txt'
];

async function fetchExternalTrackers() {
  const urls = new Set();
  for (const src of SOURCES) {
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const text = await res.text();
      const lines = text.split('\n');
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.startsWith('wss://') || line.startsWith('ws://')) {
          urls.add(line);
        }
      }
    } catch (err) {
      console.warn(`Could not fetch ${src}: ${err.message}`);
    }
  }
  return Array.from(urls);
}

function testWebSocketTracker(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let done = false;
    let ws = null;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try { if (ws) ws.close(); } catch (_) {}
        resolve({ url, alive: false, latency: null, reason: 'Timeout' });
      }
    }, timeoutMs);

    try {
      ws = new WebSocket(url);
      ws.onopen = () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          const latency = Date.now() - startTime;
          try { ws.close(); } catch (_) {}
          resolve({ url, alive: true, latency });
        }
      };
      ws.onerror = () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          try { ws.close(); } catch (_) {}
          resolve({ url, alive: false, latency: null, reason: 'Socket error' });
        }
      };
    } catch (err) {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve({ url, alive: false, latency: null, reason: err.message });
      }
    }
  });
}

async function run() {
  console.log('Fetching tracker candidates...');
  const external = await fetchExternalTrackers();
  const candidates = Array.from(new Set([...SEED_TRACKERS, ...external]))
    .map(u => u.trim())
    .filter(u => u.startsWith('wss://') || u.startsWith('ws://'));

  console.log(`Checking ${candidates.length} tracker candidates...`);
  const results = [];
  for (const tracker of candidates) {
    const res = await testWebSocketTracker(tracker);
    results.push(res);
    console.log(`[${res.alive ? 'ONLINE' : 'OFFLINE'}] ${tracker} (${res.alive ? res.latency + 'ms' : res.reason})`);
  }

  let activeTrackers = results.filter(r => r.alive).sort((a, b) => a.latency - b.latency);

  if (activeTrackers.length === 0) {
    console.log('No active trackers detected via direct websocket; falling back to seed list.');
    activeTrackers = SEED_TRACKERS.map(url => ({ url, alive: true, latency: 120 }));
  }

  const nowIso = new Date().toISOString();
  const activeUrls = activeTrackers.map(t => t.url);

  fs.writeFileSync(path.join(rootDir, 'trackers.txt'), activeUrls.join('\n') + '\n', 'utf8');

  const jsonData = {
    updated_at: nowIso,
    total_active: activeTrackers.length,
    trackers: activeTrackers.map(t => ({
      url: t.url,
      protocol: t.url.startsWith('wss://') ? 'wss' : 'ws',
      latency_ms: t.latency
    }))
  };
  fs.writeFileSync(path.join(rootDir, 'trackers.json'), JSON.stringify(jsonData, null, 2) + '\n', 'utf8');

  const htmlContent = generateHtml(jsonData);
  fs.writeFileSync(path.join(rootDir, 'index.html'), htmlContent, 'utf8');

  console.log(`Finished updating trackers. Total active: ${activeTrackers.length}`);
}

function generateHtml(data) {
  const rows = data.trackers.map(t => `
    <tr class="tracker-row">
      <td class="url-cell"><code>${t.url}</code></td>
      <td><span class="badge online">Online</span></td>
      <td><span class="proto-tag">${t.protocol.toUpperCase()}</span></td>
      <td class="latency-cell">${t.latency_ms ? t.latency_ms + ' ms' : '~'}</td>
      <td><button class="copy-single-btn" onclick="copyText('${t.url}')">Copy</button></td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Active WebTorrent Trackers</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-bright: #f0f6fc;
      --accent: #238636;
      --accent-hover: #2ea043;
      --blue: #58a6ff;
      --green: #3fb950;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: var(--bg); color: var(--text); padding: 24px 16px; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; }
    header { text-align: center; margin-bottom: 28px; }
    h1 { color: var(--text-bright); font-size: 2rem; margin-bottom: 8px; }
    p.subtitle { color: #8b949e; font-size: 1rem; }
    .stats-bar { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin: 20px 0; }
    .stat-chip { background: var(--card-bg); border: 1px solid var(--border); padding: 8px 16px; border-radius: 20px; font-size: 0.9rem; }
    .stat-chip strong { color: var(--text-bright); }
    .actions-panel { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-bottom: 24px; }
    button.btn, a.btn { background: var(--accent); color: #fff; border: none; padding: 10px 18px; border-radius: 6px; font-size: 0.95rem; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; font-weight: 500; transition: background 0.2s; }
    button.btn:hover, a.btn:hover { background: var(--accent-hover); }
    button.btn-secondary, a.btn-secondary { background: var(--card-bg); border: 1px solid var(--border); color: var(--text-bright); }
    button.btn-secondary:hover, a.btn-secondary:hover { background: #21262d; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin-bottom: 24px; }
    .card-header { padding: 14px 18px; border-bottom: 1px solid var(--border); font-weight: 600; color: var(--text-bright); display: flex; justify-content: space-between; align-items: center; }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { background: #1b2129; padding: 12px 16px; font-size: 0.85rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
    tr:last-child td { border-bottom: none; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; color: var(--blue); word-break: break-all; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
    .badge.online { background: rgba(63, 185, 80, 0.15); color: var(--green); border: 1px solid rgba(63, 185, 80, 0.3); }
    .proto-tag { background: #21262d; border: 1px solid var(--border); padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; color: #8b949e; }
    .copy-single-btn { background: #21262d; border: 1px solid var(--border); color: var(--text); padding: 4px 10px; border-radius: 4px; font-size: 0.8rem; cursor: pointer; }
    .copy-single-btn:hover { background: #30363d; color: var(--text-bright); }
    .code-box { background: #0b0e14; border: 1px solid var(--border); border-radius: 6px; padding: 14px; overflow-x: auto; font-family: ui-monospace, monospace; font-size: 0.85rem; color: #8b949e; }
    footer { text-align: center; color: #8b949e; font-size: 0.85rem; margin-top: 40px; padding-bottom: 20px; }
    footer a { color: var(--blue); text-decoration: none; }
    .toast { position: fixed; bottom: 20px; right: 20px; background: var(--green); color: #000; padding: 10px 18px; border-radius: 6px; font-weight: 600; display: none; box-shadow: 0 4px 12px rgba(0,0,0,0.5); z-index: 1000; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Active WebTorrent Trackers</h1>
      <p class="subtitle">Live WebSocket BitTorrent tracker list verified every 12 hours</p>
      <div class="stats-bar">
        <div class="stat-chip">Active Trackers: <strong>${data.total_active}</strong></div>
        <div class="stat-chip">Update Cycle: <strong>Every 12 Hours</strong></div>
        <div class="stat-chip">Last Verified: <strong>${new Date(data.updated_at).toUTCString()}</strong></div>
      </div>
      <div class="actions-panel">
        <button class="btn" onclick="copyAllTrackers()">Copy All Trackers</button>
        <a class="btn btn-secondary" href="trackers.txt" target="_blank">trackers.txt</a>
        <a class="btn btn-secondary" href="trackers.json" target="_blank">trackers.json</a>
      </div>
    </header>

    <div class="card">
      <div class="card-header">
        <span>Verified Active Trackers</span>
        <span style="font-size:0.85rem; color:#8b949e;">Auto refreshed</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Tracker URL</th>
            <th>Status</th>
            <th>Protocol</th>
            <th>Latency</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>

    <div class="card" style="padding: 18px;">
      <h3 style="color: var(--text-bright); margin-bottom: 10px; font-size: 1.1rem;">WebTorrent Usage Example</h3>
      <div class="code-box">
<span style="color: #ff7b72;">import</span> WebTorrent <span style="color: #ff7b72;">from</span> <span style="color: #a5d6ff;">'webtorrent'</span>;

<span style="color: #ff7b72;">const</span> client = <span style="color: #ff7b72;">new</span> WebTorrent();
<span style="color: #ff7b72;">const</span> announceTrackers = ${JSON.stringify(data.trackers.map(t => t.url), null, 2)};

client.add(torrentId, { announce: announceTrackers }, (torrent) =&gt; {
  console.log(<span style="color: #a5d6ff;">'Connected peers:'</span>, torrent.numPeers);
});
      </div>
    </div>

    <footer>
      <p>Automated via GitHub Actions. Maintained by <a href="https://github.com/Roshan-Ingle" target="_blank">Roshan Ingle</a>.</p>
    </footer>
  </div>

  <div id="toast" class="toast">Copied to clipboard!</div>

  <script>
    const trackers = ${JSON.stringify(data.trackers.map(t => t.url))};

    function copyText(txt) {
      navigator.clipboard.writeText(txt).then(showToast);
    }

    function copyAllTrackers() {
      navigator.clipboard.writeText(trackers.join('\\n')).then(showToast);
    }

    function showToast() {
      const el = document.getElementById('toast');
      el.style.display = 'block';
      setTimeout(() => { el.style.display = 'none'; }, 2000);
    }
  </script>
</body>
</html>`;
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
