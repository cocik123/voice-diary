// 워커: 음성 인식(Whisper)과 문장 임베딩 모델을 이 기기 안에서(WASM) 실행한다.
// 음성과 글은 어디로도 전송되지 않는다.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;   // 모델은 Hugging Face에서 한 번 받아 브라우저 캐시에 저장

const EMBED_MODEL = 'Xenova/multilingual-e5-small';   // 문장 뜻을 벡터로 바꾸는 모델
const EMBED_PREFIX = 'query: ';                        // 이 모델이 학습 때 쓴 머리말. 붙여야 구분이 잘 된다

let asr = null, embedder = null;
let chain = Promise.resolve();  // 요청이 겹쳐도 순서대로 처리

function progressReporter(stage) {
  const files = new Map();
  let last = -1;
  return p => {
    if (p.status !== 'progress' || !p.total) return;
    files.set(p.file, [p.loaded, p.total]);
    let loaded = 0, total = 0;
    for (const [l, t] of files.values()) { loaded += l; total += t; }
    const percent = Math.floor((loaded / total) * 100);
    if (percent !== last) { last = percent; postMessage({ type: 'progress', stage, percent }); }
  };
}

const errText = e => String(e && e.message || e);

async function load(model) {
  try {
    asr = await pipeline('automatic-speech-recognition', model, {
      dtype: 'q8', device: 'wasm', progress_callback: progressReporter('음성 인식 모델'),
    });
  } catch (e) { postMessage({ type: 'loadError', message: errText(e) }); return; }
  try {
    embedder = await pipeline('feature-extraction', EMBED_MODEL, {
      dtype: 'q8', device: 'wasm', progress_callback: progressReporter('문단 판단 모델'),
    });
  } catch { embedder = null; }   // 없어도 받아쓰기는 되게 한다
  postMessage({ type: 'ready', embed: !!embedder });
}

async function run(audio) {
  if (!asr) throw new Error('모델이 준비되지 않았어요');
  const out = await asr(audio, { language: 'korean', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
  return (out.text || '').trim();
}

// texts[0]과 나머지 각각의 코사인 유사도. 벡터를 길이 1로 정규화했으므로 내적이 곧 코사인이다.
async function similar(texts) {
  if (!embedder) throw new Error('문단 판단 모델이 없어요');
  const v = (await embedder(texts.map(t => EMBED_PREFIX + t), { pooling: 'mean', normalize: true })).tolist();
  return v.slice(1).map(x => x.reduce((sum, xi, i) => sum + xi * v[0][i], 0));
}

self.onmessage = ({ data }) => {
  chain = chain.then(async () => {
    if (data.type === 'load') { await load(data.model); return; }
    try {
      const value = data.type === 'run' ? await run(data.audio) : await similar(data.texts);
      postMessage({ type: 'result', id: data.id, value });
    } catch (e) { postMessage({ type: 'error', id: data.id, message: errText(e) }); }
  });
};
