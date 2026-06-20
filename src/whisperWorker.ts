// Web Worker: runs OpenAI Whisper fully in the browser via transformers.js.
// Keeps model download + inference off the main thread so the UI stays smooth.
import { pipeline } from '@huggingface/transformers';

let transcriber: any = null;
let loadedModel = '';

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data || {};

  if (msg.type === 'load') {
    if (transcriber && loadedModel === msg.model) {
      (self as any).postMessage({ type: 'ready' });
      return;
    }
    try {
      loadedModel = msg.model;
      transcriber = await pipeline('automatic-speech-recognition', msg.model, {
        device: msg.device || 'wasm',
        progress_callback: (p: any) => (self as any).postMessage({ type: 'progress', data: p }),
      });
      (self as any).postMessage({ type: 'ready' });
    } catch (err: any) {
      transcriber = null;
      loadedModel = '';
      (self as any).postMessage({ type: 'error', error: String(err?.message || err) });
    }
    return;
  }

  if (msg.type === 'transcribe') {
    if (!transcriber) {
      (self as any).postMessage({ type: 'result', id: msg.id, text: '' });
      return;
    }
    try {
      const out = await transcriber(msg.audio, {
        language: msg.language || 'english',
        task: 'transcribe',
      });
      const text = (Array.isArray(out) ? out[0]?.text : out?.text) || '';
      (self as any).postMessage({ type: 'result', id: msg.id, text: String(text).trim() });
    } catch (err: any) {
      (self as any).postMessage({ type: 'result', id: msg.id, text: '', error: String(err?.message || err) });
    }
    return;
  }
};
