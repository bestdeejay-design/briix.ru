/* Real PCM waveform checks in Chromium using a synthetic WAV, not a live music server. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { launch } = require('./browser-env.cjs');
(async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><style>:root{--accent:#d97757}</style><div id="a"></div><div id="b"></div><div id="c"></div>');
    await page.addScriptTag({ path: path.resolve(__dirname, '../studio/waveform.js') });
    await page.evaluate(() => {
      const sampleRate = 16000, samples = sampleRate * 2, bytes = new ArrayBuffer(44 + samples * 2), v = new DataView(bytes);
      const str = (offset, text) => [...text].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
      str(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      str(36, 'data'); v.setUint32(40, samples * 2, true);
      for (let i = 0; i < samples; i++) {
        const amplitude = i < samples / 2 ? 0.03 : 0.8;
        v.setInt16(44 + i * 2, Math.round(amplitude * Math.sin(2 * Math.PI * 440 * i / sampleRate) * 32767), true);
      }
      const blob = new Blob([bytes], { type: 'audio/wav' });
      window.sampleBlob = blob;
      for (const id of ['a', 'b', 'c']) {
        const container = document.getElementById(id), audio = document.createElement('audio');
        audio.controls = true; audio.controlsList = 'nodownload'; audio.src = URL.createObjectURL(blob); container.append(audio);
        const input = id === 'a' ? blob : id === 'b' ? new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]) : new Blob(['not an audio file']);
        BriixWaveform.attach(audio, input, container);
      }
    });
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].every(a => Number.isFinite(a.duration) && a.duration > 0));
    await page.locator('#a .waveform-load').click();
    await page.waitForSelector('#a canvas', { timeout: 15000 });
    const peaks = await page.evaluate(() => {
      const canvas = document.querySelector('#a canvas'), ctx = canvas.getContext('2d');
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let quiet = 0, loud = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3]) { if (x < canvas.width / 2) quiet++; else loud++; }
      }
      const slider = document.querySelector('#a .waveform-seek');
      slider.value = '750'; slider.dispatchEvent(new Event('input', { bubbles: true }));
      return { quiet, loud, currentTime: document.querySelector('#a audio').currentTime, label: slider.getAttribute('aria-label') };
    });
    assert.ok(peaks.loud > peaks.quiet * 5, 'real loud section produces larger waveform than quiet section');
    assert.ok(Math.abs(peaks.currentTime - 1.5) < 0.1, 'slider seeks native audio');
    assert.match(peaks.label, /Позиция/);
    await page.locator('#b .waveform-load').click();
    assert.match(await page.locator('#b .waveform-status').innerText(), /Обычный плеер доступен/);
    assert.equal(await page.locator('#b audio').evaluate(a => a.controls), true);
    await page.locator('#c .waveform-load').click();
    await page.waitForFunction(() => document.querySelector('#c .waveform-status').textContent.includes('Не удалось'));
    assert.equal(await page.locator('#c audio').evaluate(a => a.controls), true);
    await page.evaluate(() => {
      const NativeAudio = window.AudioContext;
      window.waveContexts = { active: 0, max: 0, closed: 0 };
      window.AudioContext = class extends NativeAudio {
        constructor(options) { super(options); waveContexts.active++; waveContexts.max = Math.max(waveContexts.max, waveContexts.active); }
        async close() { await super.close(); waveContexts.active--; waveContexts.closed++; }
      };
      for (const id of ['d', 'e']) {
        const container = document.createElement('div'); container.id = id; document.body.append(container);
        const audio = document.createElement('audio'); audio.controls = true; audio.src = URL.createObjectURL(sampleBlob); container.append(audio);
        BriixWaveform.attach(audio, sampleBlob, container);
      }
    });
    await page.waitForFunction(() => ['d', 'e'].every(id => Number.isFinite(document.querySelector('#' + id + ' audio').duration)));
    await page.evaluate(() => { document.querySelector('#d .waveform-load').click(); document.querySelector('#e .waveform-load').click(); });
    await page.waitForSelector('#d canvas'); await page.waitForSelector('#e canvas');
    await page.waitForFunction(() => waveContexts.closed === 2);
    assert.deepEqual(await page.evaluate(() => waveContexts), { active: 0, max: 1, closed: 2 }, 'decode is serial and contexts close');
    await page.evaluate(() => {
      window.originalDecode = AudioContext.prototype.decodeAudioData;
      AudioContext.prototype.decodeAudioData = function (bytes) {
        return new Promise((resolve, reject) => setTimeout(() => originalDecode.call(this, bytes).then(resolve, reject), 1000));
      };
      const container = document.createElement('div'); container.id = 'removed'; document.body.append(container);
      const audio = document.createElement('audio'); audio.controls = true; audio.src = URL.createObjectURL(sampleBlob); container.append(audio);
      BriixWaveform.attach(audio, sampleBlob, container);
    });
    await page.waitForFunction(() => Number.isFinite(document.querySelector('#removed audio').duration));
    await page.locator('#removed .waveform-load').click();
    await page.waitForFunction(() => waveContexts.active === 1);
    await page.evaluate(() => document.querySelector('#removed').remove());
    await page.waitForFunction(() => waveContexts.closed === 3, {}, { timeout: 700 });
    await page.evaluate(() => { AudioContext.prototype.decodeAudioData = originalDecode; });
    const m4a = fs.readFileSync(path.resolve(__dirname, '../assets/media/showcase/jingle.m4a')).toString('base64');
    await page.evaluate(encoded => {
      const binary = atob(encoded), bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'audio/mp4' }), container = document.createElement('div');
      container.id = 'm4a'; document.body.append(container);
      const audio = document.createElement('audio'); audio.controls = true; audio.src = URL.createObjectURL(blob); container.append(audio);
      BriixWaveform.attach(audio, blob, container);
    }, m4a);
    await page.waitForFunction(() => Number.isFinite(document.querySelector('#m4a audio').duration), {}, { timeout: 10000 });
    await page.locator('#m4a .waveform-load').click();
    await page.waitForSelector('#m4a canvas', { timeout: 15000 });
    console.log('PASS real PCM waveform (WAV and repository M4A), seek, oversized and decode-error fallbacks', JSON.stringify(peaks));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
