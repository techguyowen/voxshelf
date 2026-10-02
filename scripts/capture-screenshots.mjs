import { spawn } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'docs', 'screenshots');
mkdirSync(outDir, { recursive: true });

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9222;

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--user-data-dir=/tmp/cprof-' + Date.now(),
  `--remote-debugging-port=${port}`,
  '--remote-allow-origins=*',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,850'
]);

let browserWsUrl = await new Promise((resolve) => {
  chrome.stderr.on('data', (d) => {
    const str = d.toString();
    const m = str.match(/ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+/);
    if (m) resolve(m[0]);
    const m6 = str.match(/ws:\/\/\[::1\]:\d+\/devtools\/browser\/[^\s]+/);
    if (m6) resolve(m6[0].replace('[::1]', '127.0.0.1'));
  });
});

async function sendCmd(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 100000);
    const handler = (event) => {
      const data = JSON.parse(event.data);
      if (data.id === id) {
        ws.removeEventListener('message', handler);
        if (data.error) reject(data.error);
        else resolve(data.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const browserWs = new WebSocket(browserWsUrl);
await new Promise(r => browserWs.onopen = r);

async function capture(url, filename, { width = 1280, height = 850, deviceScaleFactor = 2, mobile = false, waitMs = 3000, action = null } = {}) {
  const { targetId } = await sendCmd(browserWs, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await sendCmd(browserWs, 'Target.attachToTarget', { targetId, flatten: true });

  async function sendSession(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 100000);
      const handler = (event) => {
        const data = JSON.parse(event.data);
        if (data.sessionId === sessionId && data.id === id) {
          browserWs.removeEventListener('message', handler);
          if (data.error) reject(data.error);
          else resolve(data.result);
        }
      };
      browserWs.addEventListener('message', handler);
      browserWs.send(JSON.stringify({ sessionId, id, method, params }));
    });
  }

  await sendSession('Page.enable');
  await sendSession('Runtime.enable');
  await sendSession('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor,
    mobile,
  });

  await sendSession('Page.navigate', { url });
  await new Promise(r => setTimeout(r, waitMs));

  if (action) {
    await sendSession('Runtime.evaluate', { expression: action });
    await new Promise(r => setTimeout(r, 1200));
  }

  const snap = await sendSession('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(snap.data, 'base64');
  const outFile = join(outDir, filename);
  writeFileSync(outFile, buf);
  console.log(`Saved ${filename} (${buf.length} bytes)`);

  await sendCmd(browserWs, 'Target.closeTarget', { targetId });
}

try {
  // 1. Library screenshot
  await capture('http://127.0.0.1:38492', 'library.png', { width: 1280, height: 850, waitMs: 2500 });

  // 2. Reader view screenshot
  await capture('http://127.0.0.1:38492/reader/fac732a6-a40c-49d2-be21-d2339e7acaab', 'reader.png', { width: 1280, height: 850, waitMs: 2500 });

  // 3. AI Assistant drawer screenshot
  await capture('http://127.0.0.1:38492/reader/fac732a6-a40c-49d2-be21-d2339e7acaab', 'ai-drawer.png', {
    width: 1280,
    height: 850,
    waitMs: 2500,
    action: `document.querySelector('button[aria-label="Generate AI podcast"]')?.click()`
  });

  // 4. Mobile reader view screenshot
  await capture('http://127.0.0.1:38492/reader/fac732a6-a40c-49d2-be21-d2339e7acaab', 'mobile.png', { width: 390, height: 844, mobile: true, waitMs: 2500 });

  console.log('All screenshots generated!');
} catch (e) {
  console.error('Screenshot error:', e);
} finally {
  browserWs.close();
  chrome.kill();
}
