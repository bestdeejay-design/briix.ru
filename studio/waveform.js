/* Real PCM peaks, decoded only on request and one track at a time. Native controls remain available. */
(() => {
  'use strict';
  let queue = Promise.resolve();
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const MAX_PLAYBACK_SECONDS = 60;
  const RATE = 16000;
  const MAX_PCM_BYTES = 32 * 1024 * 1024;

  function formatTime(seconds) {
    const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }
  function attach(audio, blob, container) {
    const box = document.createElement('div'); box.className = 'waveform';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'action waveform-load';
    button.textContent = 'Показать форму звука';
    const status = document.createElement('span'); status.className = 'waveform-status'; status.setAttribute('role', 'status');
    box.append(button, status); container.append(box);
    audio.addEventListener('play', () => {
      document.querySelectorAll('audio').forEach(other => { if (other !== audio) other.pause(); });
    });
    button.addEventListener('click', () => {
      if (button.disabled) return;
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        status.textContent = 'Сначала дождитесь загрузки аудио. Обычный плеер доступен.'; return;
      }
      if (!blob || blob.size > MAX_FILE_BYTES || audio.duration > MAX_PLAYBACK_SECONDS) {
        status.textContent = 'Форма звука недоступна для этого файла. Обычный плеер доступен.'; return;
      }
      button.disabled = true; status.textContent = 'Готовим форму звука…';
      const task = async () => {
        let context, observer, closing;
        const closeContext = () => {
          if (context && context.state !== 'closed' && !closing) closing = context.close().catch(() => {});
          return closing;
        };
        try {
          if (!box.isConnected || box.closest('[hidden]')) return;
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) throw new Error('Декодирование не поддерживается');
          context = new Audio({ sampleRate: RATE });
          observer = new MutationObserver(() => {
            if (!box.isConnected || box.closest('[hidden]')) { observer.disconnect(); closeContext(); }
          });
          observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
          if (context.sampleRate > RATE) throw new Error('Превышен бюджет памяти');
          const bytes = await blob.arrayBuffer();
          const buffer = await context.decodeAudioData(bytes);
          if (buffer.length * buffer.numberOfChannels * 4 > MAX_PCM_BYTES) throw new Error('Превышен бюджет памяти');
          if (!box.isConnected || box.closest('[hidden]')) return;
          const bars = 160;
          const peaks = new Float32Array(bars);
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const samples = buffer.getChannelData(channel);
            for (let bar = 0; bar < bars; bar++) {
              const start = Math.floor(bar * samples.length / bars), end = Math.floor((bar + 1) * samples.length / bars);
              let peak = peaks[bar];
              for (let n = start; n < end; n++) peak = Math.max(peak, Math.abs(samples[n]));
              peaks[bar] = peak;
            }
          }
          const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 72; canvas.className = 'waveform-canvas';
          canvas.setAttribute('aria-hidden', 'true');
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = getComputedStyle(box).getPropertyValue('--accent').trim();
          for (let i = 0; i < bars; i++) {
            const height = Math.max(1, peaks[i] * canvas.height);
            ctx.fillRect(i * 4, (canvas.height - height) / 2, 2, height);
          }
          const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '1000'; slider.value = '0';
          slider.className = 'waveform-seek'; slider.setAttribute('aria-label', 'Позиция воспроизведения');
          const sync = () => {
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
            slider.value = String(Math.round(audio.currentTime / audio.duration * 1000));
            slider.setAttribute('aria-valuetext', formatTime(audio.currentTime) + ' из ' + formatTime(audio.duration));
          };
          slider.addEventListener('input', () => { if (Number.isFinite(audio.duration)) audio.currentTime = Number(slider.value) / 1000 * audio.duration; });
          audio.addEventListener('timeupdate', sync); audio.addEventListener('seeked', sync); audio.addEventListener('loadedmetadata', sync);
          sync();
          button.remove(); status.remove(); box.append(canvas, slider);
        } catch (_) {
          if (box.isConnected) { button.disabled = false; status.textContent = 'Не удалось построить форму звука. Обычный плеер доступен.'; }
        } finally {
          if (observer) observer.disconnect();
          await closeContext();
          if (button.isConnected) {
            button.disabled = false;
            if (status.textContent === 'Готовим форму звука…') status.textContent = 'Откройте сессию и попробуйте снова.';
          }
        }
      };
      queue = queue.then(task, task);
    });
  }
  globalThis.BriixWaveform = Object.freeze({ attach });
})();
