/**
 * برچسب‌زنی ویس‌های ذخیره‌شده برای آموزش whisper:
 *
 *   npm run stt:label            (پوشه: STT_SAMPLE_DIR)
 *   npm run stt:label -- --dir uploads/stt-dataset --port 3999
 *
 * SpeechToTextService با STT_SAMPLE_DIR هر ویس را به‌صورت name.wav و name.got.txt (متن whisper) نگه می‌دارد.
 * این صفحه (فقط روی 127.0.0.1) ویس‌ها را پخش می‌کند تا متن درست نوشته شود؛ متن درست در name.txt ذخیره
 * می‌شود، همان قالب eval/stt-samples، پس پوشه هم برای ارزیابی (evaluateSpeech --samples) و هم برای آموزش
 * آماده است. ویس خراب/بی‌ربط با «کنار بگذار» name.skip می‌گیرد و دیگر نمایش داده نمی‌شود (فایلی پاک نمی‌شود).
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { config } from 'dotenv';

config();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const DIR = resolve(arg('dir') ?? process.env.STT_SAMPLE_DIR ?? 'uploads/stt-dataset');
const PORT = Number(arg('port') ?? 3999);
// نام‌ها همان timestamp های SpeechToTextService است؛ هر چیز دیگری (مثل ../) پذیرفته نمی‌شود
const SAFE_NAME = /^[\w-]+$/;

interface Sample {
  name: string;
  heard: string;
  label: string | null;
  at: number;
}

function readHeard(name: string): string {
  const path = join(DIR, `${name}.got.txt`);
  if (!existsSync(path)) return '';
  const text = readFileSync(path, 'utf8');
  return /^final: (.*)$/m.exec(text)?.[1] ?? text.trim();
}

function samples(): Sample[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((file) => file.endsWith('.wav'))
    .map((file) => file.slice(0, -4))
    .filter((name) => SAFE_NAME.test(name) && !existsSync(join(DIR, `${name}.skip`)))
    .map((name) => {
      const labelPath = join(DIR, `${name}.txt`);
      return {
        name,
        heard: readHeard(name),
        label: existsSync(labelPath) ? readFileSync(labelPath, 'utf8').trim() : null,
        at: statSync(join(DIR, `${name}.wav`)).mtimeMs,
      };
    })
    .sort((a, b) => b.at - a.at);
}

function body(request: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    let data = '';
    request.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10_000) request.destroy();
    });
    request.on('end', () => done(data));
    request.on('error', fail);
  });
}

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function page(): string {
  const all = samples();
  const done = all.filter((s) => s.label !== null).length;
  const rows = all
    .map(
      (s) => `
    <li class="${s.label === null ? 'todo' : 'done'}" data-name="${s.name}">
      <div class="meta">${new Date(s.at).toLocaleString('fa-IR')} ${s.label === null ? '' : '✅'}</div>
      <audio controls preload="none" src="/audio/${s.name}"></audio>
      <div class="heard">whisper: ${escape(s.heard)}</div>
      <textarea rows="2">${escape(s.label ?? s.heard)}</textarea>
      <div class="actions"><button class="save">ذخیره</button><button class="skip">کنار بگذار</button></div>
    </li>`,
    )
    .join('');
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>برچسب ویس‌ها</title>
<style>
  body { font-family: Vazirmatn, Tahoma, sans-serif; margin: 0 auto; max-width: 760px; padding: 16px; background: #f4f7fc; color: #0e1a3b; }
  h1 { font-size: 18px; } .hint { color: #6b7488; font-size: 13px; line-height: 1.8; }
  ul { list-style: none; padding: 0; } li { background: #fff; border: 1px solid #e3e9f4; border-radius: 12px; padding: 12px; margin-bottom: 12px; }
  li.done { opacity: .75; } .meta { font-size: 12px; color: #6b7488; } audio { width: 100%; margin: 8px 0; }
  .heard { font-size: 13px; color: #6b7488; margin-bottom: 6px; }
  textarea { width: 100%; box-sizing: border-box; font: inherit; font-size: 15px; padding: 8px; border: 1px solid #cdd6e6; border-radius: 8px; }
  .actions { display: flex; gap: 8px; margin-top: 8px; } button { font: inherit; padding: 6px 14px; border-radius: 8px; border: 1px solid #cdd6e6; background: #fff; cursor: pointer; }
  button.save { background: #f5761a; border-color: #f5761a; color: #fff; } label { font-size: 14px; }
</style></head><body>
<h1>برچسب ویس‌ها — ${done.toLocaleString('fa-IR')} از ${all.length.toLocaleString('fa-IR')} برچسب خورده</h1>
<p class="hint">ویس را گوش بدهید و متن را <b>دقیقاً به همان شکلی که می‌خواهید مدل بنویسد</b> درست کنید (مثلاً TRB10008، ۶۰۰۰ تن، «رو»)؛ با همین متن آموزش می‌بیند.
ویس خراب یا بی‌ربط را «کنار بگذار» بزنید. پوشه: <code dir="ltr">${escape(DIR)}</code></p>
<label><input type="checkbox" id="todo"> فقط برچسب‌نخورده‌ها</label>
<ul>${rows}</ul>
<script>
  const post = (url, text) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: text });
  document.querySelectorAll('li').forEach((li) => {
    const name = li.dataset.name;
    li.querySelector('.save').onclick = async () => {
      const text = li.querySelector('textarea').value.trim();
      if (!text) return alert('متن خالی است.');
      if ((await post('/label/' + name, text)).ok) { li.className = 'done'; li.querySelector('.meta').append(' ✅'); }
    };
    li.querySelector('.skip').onclick = async () => { if ((await post('/skip/' + name, '')).ok) li.remove(); };
  });
  document.getElementById('todo').onchange = (e) => document.querySelectorAll('li.done').forEach((li) => (li.hidden = e.target.checked));
</script></body></html>`;
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const [, action, name] = (request.url ?? '/').split('?')[0].split('/');
  if (request.method === 'GET' && !action) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return void response.end(page());
  }
  if (!name || !SAFE_NAME.test(name) || !existsSync(join(DIR, `${name}.wav`))) {
    response.writeHead(404);
    return void response.end();
  }
  if (request.method === 'GET' && action === 'audio') {
    response.writeHead(200, { 'Content-Type': 'audio/wav' });
    return void response.end(readFileSync(join(DIR, `${name}.wav`)));
  }
  if (request.method === 'POST' && action === 'label') {
    const text = (await body(request)).trim();
    if (!text) {
      response.writeHead(400);
      return void response.end();
    }
    writeFileSync(join(DIR, `${name}.txt`), `${text}\n`);
    response.writeHead(204);
    return void response.end();
  }
  if (request.method === 'POST' && action === 'skip') {
    writeFileSync(join(DIR, `${name}.skip`), '');
    response.writeHead(204);
    return void response.end();
  }
  response.writeHead(404);
  response.end();
}

createServer((request, response) => {
  handle(request, response).catch(() => {
    response.writeHead(500);
    response.end();
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Labeling ${DIR}\nOpen http://127.0.0.1:${PORT}`);
});
