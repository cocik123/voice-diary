// 음성 인식 워커: Whisper 모델을 이 기기 안에서(WASM) 실행한다. 음성은 어디로도 전송되지 않는다.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;   // 모델은 Hugging Face에서 한 번 받아 브라우저 캐시에 저장

let asr = null;
let chain = Promise.resolve();  // 여러 녹음이 겹쳐도 순서대로 처리

function progressReporter() {
  const files = new Map();
  let last = -1;
  return p => {
    if (p.status !== 'progress' || !p.total) return;
    files.set(p.file, [p.loaded, p.total]);
    let loaded = 0, total = 0;
    for (const [l, t] of files.values()) { loaded += l; total += t; }
    const percent = Math.floor((loaded / total) * 100);
    if (percent !== last) { last = percent; postMessage({ type: 'progress', percent }); }
  };
}

self.onmessage = ({ data }) => {
  if (data.type === 'load') {
    chain = chain.then(async () => {
      try {
        asr = await pipeline('automatic-speech-recognition', data.model, {
          dtype: 'q8', device: 'wasm', progress_callback: progressReporter(),
        });
        postMessage({ type: 'ready' });
      } catch (e) { postMessage({ type: 'loadError', message: String(e && e.message || e) }); }
    });
  } else if (data.type === 'run') {
    chain = chain.then(async () => {
      try {
        if (!asr) throw new Error('모델이 준비되지 않았어요');
        const out = await asr(data.audio, { language: 'korean', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
        postMessage({ type: 'result', id: data.id, text: (out.text || '').trim() });
      } catch (e) { postMessage({ type: 'runError', id: data.id, message: String(e && e.message || e) }); }
    });
  }
};
