import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { 
  Languages, Copy, Check, Info, Zap, Trash2, 
  ArrowRightLeft, Mic, MicOff, XCircle, StopCircle, 
  FileText, X, Sparkles, ListChecks, Sliders, Settings, Key, Globe, Brain, RefreshCw,
  Edit, ArrowUp, Menu, GripVertical, Wifi, Users, LayoutDashboard, Eye, EyeOff
} from 'lucide-react';
import { cn } from './lib/utils';
import { isFirebaseConfigured, parseFirebaseConfig, saveFirebaseConfig, clearFirebaseConfig } from './firebaseConfig';
import {
  pushSegment, updateSegment, clearRoomSegments, subscribeSegments,
  joinPresence, leavePresence, subscribeMembers, subscribeConnection,
  setMemberRecording, setMemberMeta, sendCommand, subscribeCommand,
  setRoomConfig, subscribeRoomConfig,
  pushClip, subscribeClips, deleteClip,
  setLiveTranscript, clearLiveTranscript, subscribeLiveTranscripts,
  type LiveTranscript,
} from './roomSync';

const IS_MOBILE = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
// iOS (iPhone / iPad) — blocks local Whisper; Mac Safari is NOT included here.
const IS_IOS = typeof navigator !== 'undefined' && (
  /iPhone|iPod/i.test(navigator.userAgent) ||
  (/iPad/i.test(navigator.userAgent)) ||
  // iPad on iOS 13+ reports itself as MacIntel but has touch
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
);

// Encode 16kHz Float32 audio as base64 Int16 PCM (compact relay over RTDB).
const float32ToBase64Pcm16 = (f32: Float32Array): string => {
  const buf = new ArrayBuffer(f32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(bin);
};

const base64Pcm16ToFloat32 = (b64: string): Float32Array => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(bytes.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
};
import {
  browserTranslate, browserTranslateAvailable, getBrowserTranslator, getBrowserTranslatorAvailability,
  type BrowserTranslatorAvailability,
} from './browserTranslate';
import { MicVAD } from '@ricky0123/vad-web';

type TranslateMode = 'ai' | 'browser';
type RecognitionMode = 'dual' | 'live' | 'whisper';
type SegmentStatus = 'initial-ready' | 'whisper-processing' | 'translating' | 'completed' | 'failed';
type VisibleBlocks = {
  voiceControls: boolean;
  timeline: boolean;
};

const DEFAULT_VISIBLE_BLOCKS: VisibleBlocks = {
  voiceControls: true,
  timeline: true,
};

// Stable per-device identity + a human label for the multi-device timeline.
const getDeviceId = (): string => {
  let id = localStorage.getItem('swift_device_id');
  if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem('swift_device_id', id); }
  return id;
};
const detectDeviceLabel = (): string =>
  /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? '📱 手機' : '💻 電腦';
const makeRoomCode = (): string => Math.random().toString(36).slice(2, 7).toUpperCase();

// Language configuration
const LANGUAGES = [
  { code: 'en', label: '不指定口音', flag: '🌐' },
  { code: 'en-US', label: '美式英文', flag: '🇺🇸' },
  { code: 'en-GB', label: '英式英文', flag: '🇬🇧' },
  { code: 'en-NZ', label: '紐西蘭英文', flag: '🇳🇿' },
  { code: 'en-AU', label: '澳洲英文', flag: '🇦🇺' },
  { code: 'en-CA', label: '加拿大英文', flag: '🇨🇦' },
  { code: 'en-IN', label: '印度英文', flag: '🇮🇳' },
];

// Predefined context templates
const CONTEXT_PRESETS = [
  { id: 'nz-econ', icon: '🎓', label: '經濟學課', text: '紐西蘭教授開設的經濟學大綱，重點在自由市場、凱因斯理論與紐澳貿易往來，包含特定紐澳母音縮讀與在地縮寫。' },
  { id: 'tech-dev', icon: '💻', label: '軟體開發', text: '跨國軟體技術工程敏捷研討會，包含高併發架構、Microservices、CI/CD 雲端部署，英美口音混合。' },
  { id: 'biz-coop', icon: '💼', label: '商業談判', text: '亞太區商業外包合作談判，討論合約法律條款、智慧財產權與季度 NDA 約定。' },
  { id: 'casual-cafe', icon: '☕', label: '咖啡口語', text: '紐約咖啡廳的日常生活口語交談，充滿美式連讀、口語化俚語與點餐常用縮略詞。' },
  { id: 'ind-service', icon: '📞', label: '技術客服', text: '印度客服中心對接技術支援，討論資料庫重構、伺服器伺服端口溢出與重啟除錯等特有的專有術語。' }
];

// Analyze text content and suggest the best memory preset based on keywords
const analyzeSessionMemory = (text: string) => {
  if (!text) {
    return { recommendedId: 'casual-cafe', matchedWords: [], maxScore: 0 };
  }
  const lower = text.toLowerCase();
  const presetsKeywords: { [key: string]: string[] } = {
    'nz-econ': ['economic', 'market', 'trade', 'inflation', 'gdp', 'demand', 'supply', 'keynes', 'professor', 'finance', 'dollar', 'zealand'],
    'tech-dev': ['api', 'developer', 'server', 'code', 'bug', 'agile', 'architecture', 'microservices', 'deployment', 'cloud', 'system', 'programming'],
    'biz-coop': ['contract', 'nda', 'business', 'legal', 'clause', 'intellectual', 'property', 'terms', 'negotiation', 'agreement', 'cooperation'],
    'casual-cafe': ['coffee', 'weather', 'latte', 'cafe', 'menu', 'cup', 'food', 'slang', 'daily', 'lunch', 'dinner', 'breakfast'],
    'ind-service': ['database', 'reboot', 'restart', 'overflow', 'support', 'port', 'error', 'crash', 'ticket', 'router', 'dns']
  };

  const scores: { [key: string]: number } = {
    'nz-econ': 0,
    'tech-dev': 0,
    'biz-coop': 0,
    'casual-cafe': 0,
    'ind-service': 0
  };

  const matchedWordsMap: { [key: string]: string[] } = {
    'nz-econ': [],
    'tech-dev': [],
    'biz-coop': [],
    'casual-cafe': [],
    'ind-service': []
  };

  for (const [id, words] of Object.entries(presetsKeywords)) {
    words.forEach(word => {
      if (lower.includes(word)) {
        scores[id] += 1;
        const regex = new RegExp('\\b' + word + '\\b', 'i');
        if (regex.test(lower)) {
          scores[id] += 2;
        }
        if (!matchedWordsMap[id].includes(word)) {
          matchedWordsMap[id].push(word);
        }
      }
    });
  }

  let recommendedId = 'casual-cafe';
  let maxScore = 0;
  for (const [id, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      recommendedId = id;
    }
  }

  return {
    recommendedId,
    matchedWords: matchedWordsMap[recommendedId] || [],
    maxScore
  };
};

// Available models per provider
const PROVIDER_MODELS = {
  gemini: [
    { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (推薦 - 極速卓越)' },
    { value: 'gemini-3.5-pro', label: 'Gemini 3.5 Pro (旗艦 - 精巧學術)' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview (預覽版本)' }
  ],
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (推薦 - 快速極致)' },
    { value: 'gpt-4o', label: 'GPT-4o (完整最高解析力)' },
    { value: 'o1-mini', label: 'o1 Mini (進階長鏈推演)' }
  ],
  claude: [
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (推薦 - 頂尖語感)' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (極速輕盈)' },
    { value: 'claude-opus-4-8', label: 'Claude Opus 4.8 (旗艦 - 最高能力)' }
  ]
};

// Concise model name (strips the "(...)" suffix) for the per-segment source badge.
const modelDisplayName = (provider: string, model: string): string => {
  const arr = (PROVIDER_MODELS as any)[provider] || [];
  const found = arr.find((m: any) => m.value === model);
  return (found ? found.label.replace(/\s*\(.*\)$/, '') : model);
};
// Label describing what produced a translation (for display on each segment).
const transLabelFor = (mode: 'ai' | 'browser', info: { provider: string; model: string } | null): string =>
  mode === 'browser' ? '🌐 瀏覽器內建' : (info ? `🤖 ${modelDisplayName(info.provider, info.model)}` : '🤖 AI');

interface AISettings {
  provider: 'gemini' | 'openai' | 'claude';
  geminiModel: string;
  openaiModel: string;
  claudeModel: string;
  geminiKey: string;
  openaiKey: string;
  claudeKey: string;
}

// In dev we route through the Vite proxy; in production (static hosting like
// GitHub Pages) we call the providers directly — both OpenAI and Anthropic
// allow browser CORS requests.
const OPENAI_BASE = import.meta.env.PROD ? 'https://api.openai.com' : '/api/openai';
const ANTHROPIC_BASE = import.meta.env.PROD ? 'https://api.anthropic.com' : '/api/anthropic';

// Selectable Chinese-translation font sizes (px) with short labels.
const TRANS_FONT_SIZES = [
  { px: 13, label: '小' },
  { px: 16, label: '中' },
  { px: 19, label: '大' },
  { px: 24, label: '特大' },
];

// ===== In-browser Whisper (high-accuracy, accent-robust ASR) =====
const WHISPER_MODEL = 'Xenova/whisper-base';        // ~145MB, good accent quality
const WHISPER_SAMPLE_RATE = 16000;                  // Whisper expects 16kHz mono

// Combine captured Float32 frames into one buffer.
const concatFloat32 = (chunks: Float32Array[]): Float32Array => {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
};

// Linear-resample mic audio down to 16kHz mono for Whisper.
const resampleTo16k = (input: Float32Array, inputRate: number): Float32Array => {
  if (inputRate === WHISPER_SAMPLE_RATE) return input;
  const ratio = inputRate / WHISPER_SAMPLE_RATE;
  const newLen = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (idx - i0);
  }
  return out;
};

const frameRms = (frame: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
};

// Strip non-speech sound annotations Whisper emits, e.g. [MUSIC], (applause), ♪.
const cleanTranscript = (raw: string): string =>
  raw.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/[♪♫]+/g, ' ').replace(/\s+/g, ' ').trim();

// Common Whisper hallucinations on silence/noise that aren't real content.
const WHISPER_JUNK = new Set([
  'you', 'thank you', 'thanks', 'thank you very much', 'thanks for watching',
  'thanks for watching!', 'please subscribe', 'subscribe', 'bye', 'bye bye',
  'okay', 'ok', 'so', 'music', 'applause', 'silence', 'foreign',
]);
const isJunkTranscript = (t: string): boolean => {
  if (!t) return true;
  const norm = t.toLowerCase().replace(/[.!?,'"。，！？\s]+/g, ' ').trim();
  if (WHISPER_JUNK.has(norm)) return true;
  // drop results with effectively no letters (pure punctuation/symbols)
  if (t.replace(/[^a-zA-Z一-鿿]/g, '').length <= 1) return true;
  return false;
};

// CORS-safe API fetching helper for OpenAI
const callOpenAI = async (apiKey: string, model: string, text: string, systemInstruction: string) => {
  const url = `${OPENAI_BASE}/v1/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: text }
      ],
      temperature: 0.3
    })
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI 錯誤 (${response.status}): ${errText}`);
  }
  const data = await response.json();
  if (data.choices && data.choices[0] && data.choices[0].message) {
    return data.choices[0].message.content;
  }
  throw new Error('未知的 OpenAI 回傳格式');
};

// CORS-safe API fetching helper for Claude
const callClaude = async (apiKey: string, model: string, text: string, systemInstruction: string) => {
  const url = `${ANTHROPIC_BASE}/v1/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 4000,
      system: systemInstruction,
      messages: [
        { role: 'user', content: text }
      ]
    })
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude 錯誤 (${response.status}): ${errText}`);
  }
  const data = await response.json();
  if (data.content && data.content[0]) {
    return data.content[0].text;
  }
  throw new Error('未知的 Claude 回傳格式');
};

export default function App() {
  const [translatedText, setTranslatedText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // History / Transcript State
  const [history, setHistory] = useState<{
    id: string; original: string; translated?: string; timestamp: number;
    deviceLabel?: string; deviceId?: string; translatedBy?: string;
    mode?: RecognitionMode;
    status?: SegmentStatus;
    draftOriginal?: string;    // Immediate Web Speech text (dual mode) or undefined
    draftTranslated?: string;  // Browser-translate of draftOriginal
    hasFinal: boolean;         // true once Whisper + configured translate are done
    showingDraft: boolean;     // user toggle: true = show draft, false = show final
  }[]>([]);
  
  // Speech Recognition States
  const [isRecording, setIsRecording] = useState(false);
  const isActualRecordingRef = useRef(false);
  // True while the user wants continuous recording — lets us auto-restart the
  // Web Speech API when it ends on its own (silence/timeout) instead of pausing.
  const shouldKeepRecordingRef = useRef(false);
  // Latest un-finalized text; preserved across auto-restarts so the half-spoken
  // sentence at a cut-off isn't dropped.
  const lastInterimRef = useRef('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [liveDraftTranscript, setLiveDraftTranscript] = useState('');
  const liveDraftTranscriptRef = useRef('');
  const liveRecognitionActiveRef = useRef(false);
  const whisperRecordingActiveRef = useRef(false);
  const pendingDualWhisperStartRef = useRef(false);
  const [selectedLang, setSelectedLang] = useState('en-US');

  // Multi-Provider AI Settings
  const [aiSettings, setAiSettings] = useState<AISettings>(() => {
    try {
      const saved = localStorage.getItem('swift_transcript_ai_settings_v2');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Coerce a stored model back to a valid one if it's no longer offered
        // (e.g. a retired Claude model ID saved before the list was updated).
        const validModel = (provider: keyof typeof PROVIDER_MODELS, value: string) =>
          PROVIDER_MODELS[provider].some((m) => m.value === value) ? value : PROVIDER_MODELS[provider][0].value;
        return {
          provider: parsed.provider || 'claude',
          geminiModel: validModel('gemini', parsed.geminiModel || 'gemini-3.5-flash'),
          openaiModel: validModel('openai', parsed.openaiModel || 'gpt-4o-mini'),
          claudeModel: validModel('claude', parsed.claudeModel || 'claude-sonnet-4-6'),
          geminiKey: parsed.geminiKey || '',
          openaiKey: parsed.openaiKey || '',
          claudeKey: parsed.claudeKey || '',
        };
      }
    } catch (e) {
      console.error('Error parsing saved settings, resetting.', e);
    }
    return {
      provider: 'claude',
      geminiModel: 'gemini-3.5-flash',
      openaiModel: 'gpt-4o-mini',
      claudeModel: 'claude-sonnet-4-6',
      geminiKey: '',
      openaiKey: '',
      claudeKey: '',
    };
  });

  const [detectedAccent, setDetectedAccent] = useState<{code: string, label: string, reason: string, wordCount: number, traits: string[], confidence: number} | null>(null);
  const [toasts, setToasts] = useState<{id: string, message: string, type: 'error' | 'success' | 'info'}[]>([]);
  const [sessionContext, setSessionContext] = useState('');
  const [isExtractingContext, setIsExtractingContext] = useState(false);
  const [isFullViewOpen, setIsFullViewOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'speech' | 'ai'>('speech');
  const [summary, setSummary] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [activeTab, setActiveTab] = useState<'transcript' | 'summary'>('transcript');
  
  // Manual text fallback & voice error states
  const [speechErrorDetected, setSpeechErrorDetected] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [hasNewItems, setHasNewItems] = useState(false);
  const [isCompact, setIsCompact] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [visibleBlocks, setVisibleBlocks] = useState<VisibleBlocks>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('swift_visible_blocks') || '{}');
      return { ...DEFAULT_VISIBLE_BLOCKS, ...saved };
    } catch {
      return DEFAULT_VISIBLE_BLOCKS;
    }
  });
  // Adjustable Chinese-translation font size (index into TRANS_FONT_SIZES).
  const [transSizeIdx, setTransSizeIdx] = useState<number>(() => {
    const n = Number(localStorage.getItem('swift_trans_font_idx'));
    return Number.isInteger(n) && n >= 0 && n < TRANS_FONT_SIZES.length ? n : 0;
  });
  // When on, a high-confidence accent detection auto-switches the recognition locale.
  const [autoSwitchAccent, setAutoSwitchAccent] = useState<boolean>(
    () => localStorage.getItem('swift_auto_switch_accent') !== 'false'
  );

  // Recognition engine: dual shows a fast Web Speech draft on the left while
  // only Whisper's corrected transcript is committed/translated on the right.
  const [recognitionMode, setRecognitionMode] = useState<RecognitionMode>(
    () => {
      if (localStorage.getItem('swift_dual_mode_initialized') !== 'true') return 'dual';
      const saved = localStorage.getItem('swift_recognition_mode');
      return saved === 'whisper' ? 'whisper' : saved === 'live' ? 'live' : 'dual';
    }
  );
  const [whisperState, setWhisperState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [whisperProgress, setWhisperProgress] = useState(0);
  const [whisperActivity, setWhisperActivity] = useState<'idle' | 'listening' | 'speech' | 'transcribing'>('idle');
  const whisperPendingJobsRef = useRef(0);

  // User-adjustable Silero VAD + Whisper parameters (persisted).
  const numFromLS = (k: string, d: number) => { const n = Number(localStorage.getItem(k)); return Number.isFinite(n) && n > 0 ? n : d; };
  // Speech-detection threshold (0–1; lower = more sensitive).
  const [vadThreshold, setVadThreshold] = useState<number>(() => numFromLS('swift_vad_threshold', 0.5));
  // How long a pause ends an utterance (ms).
  const [whisperPauseMs, setWhisperPauseMs] = useState<number>(() => numFromLS('swift_whisper_pause', 700));
  const [whisperModel, setWhisperModel] = useState<string>(() => localStorage.getItem('swift_whisper_model') || WHISPER_MODEL);
  const whisperModelRef = useRef(whisperModel);
  useEffect(() => { localStorage.setItem('swift_vad_threshold', String(vadThreshold)); }, [vadThreshold]);
  useEffect(() => { localStorage.setItem('swift_whisper_pause', String(whisperPauseMs)); }, [whisperPauseMs]);
  useEffect(() => { whisperModelRef.current = whisperModel; localStorage.setItem('swift_whisper_model', whisperModel); }, [whisperModel]);

  const whisperWorkerRef = useRef<Worker | null>(null);
  const whisperReadyRef = useRef(false);
  const whisperDispatchQueueRef = useRef<Array<{ id: number; audio: Float32Array }>>([]);
  const whisperJobActiveRef = useRef(false);
  const progressByFileRef = useRef<Record<string, { loaded: number; total: number }>>({});
  const vadRef = useRef<any>(null);
  const whisperJobRef = useRef(0);
  // Jobs where this device transcribes someone else's relayed clip:
  // jobId -> the clip's key + originating device, so the result is attributed right.
  const clipJobsRef = useRef<Map<number, {
    key: string; segmentId: string; mode: 'dual' | 'whisper';
    deviceId: string; deviceLabel: string; ts: number;
  }>>(new Map());
  // Maps solo Whisper jobId → pre-created history entry id so the result updates the right row.
  const whisperJobEntryRef = useRef<Map<number, string>>(new Map());
  // Tracks how many chars of liveDraftTranscript were captured in the previous VAD utterance.
  const lastDraftLengthRef = useRef(0);
  // Interim text already frozen into the current dual segment. When Web Speech
  // later promotes the same text to final, advance the boundary so it is not
  // repeated in the next VAD segment.
  const consumedInterimRef = useRef('');

  const dispatchNextWhisperJob = useCallback(() => {
    if (whisperJobActiveRef.current || !whisperReadyRef.current || !whisperWorkerRef.current) return;
    const next = whisperDispatchQueueRef.current.shift();
    if (!next) return;
    whisperJobActiveRef.current = true;
    setWhisperActivity('transcribing');
    whisperWorkerRef.current.postMessage(
      { type: 'transcribe', id: next.id, audio: next.audio, language: 'english' },
      [next.audio.buffer],
    );
  }, []);

  const enqueueWhisperJob = useCallback((id: number, audio: Float32Array) => {
    whisperDispatchQueueRef.current.push({ id, audio });
    whisperPendingJobsRef.current += 1;
    dispatchNextWhisperJob();
  }, [dispatchNextWhisperJob]);

  // ===== Multi-device room sync =====
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomMembers, setRoomMembers] = useState<{ id: string; label: string; recording: boolean; hasKey: boolean; provider: string; recMode: string; canWhisper: boolean }[]>([]);
  const [roomConnected, setRoomConnected] = useState(false);
  const [isRoomOpen, setIsRoomOpen] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [fbConfigInput, setFbConfigInput] = useState('');
  const roomIdRef = useRef<string | null>(null);
  // Translation method (solo default; in a room the creator's choice wins).
  const [translateMode, setTranslateMode] = useState<TranslateMode>(
    () => (localStorage.getItem('swift_translate_mode') === 'browser' ? 'browser' : 'ai')
  );
  const [roomTranslateMode, setRoomTranslateMode] = useState<TranslateMode | null>(null);
  const [roomLiveTranscripts, setRoomLiveTranscripts] = useState<Record<string, LiveTranscript>>({});
  const [highlightedSegId, setHighlightedSegId] = useState<string | null>(null);
  const liveTranscriptDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [browserTranslatorState, setBrowserTranslatorState] = useState<BrowserTranslatorAvailability>('unknown');
  const [browserTranslatorProgress, setBrowserTranslatorProgress] = useState(0);
  const isRoomCreatorRef = useRef(false);
  const deviceIdRef = useRef<string>(getDeviceId());
  const deviceLabelRef = useRef<string>(detectDeviceLabel());
  const roomUnsubsRef = useRef<Array<() => void>>([]);
  const claimedRoomClipKeysRef = useRef<Set<string>>(new Set());

  // Resizable left panel width (px), only used in the side-by-side layout when both panels visible.
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('swift_left_panel_width'));
    return saved >= 300 && saved <= 760 ? saved : 420;
  });
  const [isWideLayout, setIsWideLayout] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  );

  const translationIdRef = useRef(0);
  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const liveScrollRef = useRef<HTMLDivElement>(null);

  // Backup settings to localStorage
  useEffect(() => {
    localStorage.setItem('swift_transcript_ai_settings_v2', JSON.stringify(aiSettings));
  }, [aiSettings]);

  useEffect(() => {
    localStorage.setItem('swift_left_panel_width', String(leftWidth));
  }, [leftWidth]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = (e: MediaQueryListEvent) => setIsWideLayout(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    localStorage.setItem('swift_auto_switch_accent', String(autoSwitchAccent));
  }, [autoSwitchAccent]);

  useEffect(() => {
    localStorage.setItem('swift_trans_font_idx', String(transSizeIdx));
  }, [transSizeIdx]);

  useEffect(() => {
    localStorage.setItem('swift_visible_blocks', JSON.stringify(visibleBlocks));
  }, [visibleBlocks]);

  const transFontPx = TRANS_FONT_SIZES[transSizeIdx].px;
  const showLeftPanel = visibleBlocks.voiceControls;
  const toggleVisibleBlock = (block: keyof VisibleBlocks) => {
    setVisibleBlocks((current) => ({ ...current, [block]: !current[block] }));
  };

  const startPanelDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftWidth;
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(760, Math.max(300, startWidth + (ev.clientX - startX)));
      setLeftWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [leftWidth]);

  // Close the header menu on Escape.
  useEffect(() => {
    if (!isMenuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMenuOpen]);

  const getGeminiClient = useCallback((customKey?: string) => {
    const key = customKey || (process.env.GEMINI_API_KEY as string);
    if (!key) {
      throw new Error('尚未設定 Gemini API 金鑰，請於右上角「設定」配置，或改用 OpenAI / Claude 引擎。');
    }
    return new GoogleGenAI({ apiKey: key });
  }, []);

  const addToast = useCallback((message: string, type: 'error' | 'success' | 'info' = 'error') => {
    const id = Math.random().toString(36).substring(7);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  const autoExtractContextFromHistory = async () => {
    if (history.length === 0) {
      addToast('目前尚未錄音，無法進行自適應歸納！請先開啟麥克風說幾句話。', 'info');
      return;
    }

    setIsExtractingContext(true);
    addToast('正在分析對話記錄、重塑適合當前對話的大綱與背景...', 'info');

    try {
      const fullText = [...history].reverse().map(h => `英文原文: "${h.original}" -> 中文翻譯: "${h.translated || ''}"`).join('\n');
      const systemInstruction = "You are an advanced bilingual AI specialize in classifying and summarizing educational/business conversation contexts to perfect translations.";
      const prompt = `請根據以下錄音對話的『中英文逐字稿』記錄，客觀且深度地分析並歸納出：
        1. 本次會議或課程的核心「大綱與情境背景」
        2. 主要探討的「學術/研究/產業範疇或特定主題」
        3. 發言者（如教授或講者）可能擁有的語意特色或學科專有名詞
        
        請將上述分析精確提煉、重塑為一段直接、精簡的「課堂大綱與背景描述（限 120 字以內）」。這段描述將填入當前 Session Context 背景記憶，供後續大語言模型即時進行更逼真、口音自適應與術語精確的中英翻譯。
        
        注意：請直接輸出這段高質量的繁體中文（台灣）摘要描述，不要包含任何「好的」、「以下是」等開場白或 JSON 標籤。
        
        當前逐字稿內容：
        ${fullText}`;

      let textResult = '';

      if (aiSettings.provider === 'openai') {
        if (!aiSettings.openaiKey) {
          throw new Error('您選擇了 OpenAI 引擎，但尚未設定 API 金鑰，請點擊右上角「設定」配置。');
        }
        textResult = await callOpenAI(aiSettings.openaiKey, aiSettings.openaiModel, prompt, systemInstruction);
      } else if (aiSettings.provider === 'claude') {
        if (!aiSettings.claudeKey) {
          throw new Error('您選擇了 Claude 引擎，但尚未設定 API 金鑰，請點擊右上角「設定」配置。');
        }
        textResult = await callClaude(aiSettings.claudeKey, aiSettings.claudeModel, prompt, systemInstruction);
      } else {
        // Gemini
        const client = getGeminiClient(aiSettings.geminiKey);
        const response = await client.models.generateContent({
          model: aiSettings.geminiModel,
          contents: prompt,
          config: {
            systemInstruction: systemInstruction,
          }
        });
        textResult = response.text || '';
      }

      const cleanText = textResult.trim();
      if (cleanText) {
        setSessionContext(cleanText);
        addToast('🧠 課堂主題大綱記憶已成功自適應更新！', 'success');
      } else {
        throw new Error('AI 回傳了空的歸納結果');
      }
    } catch (err) {
      console.error('自適應背景歸納錯誤:', err);
      addToast(err instanceof Error ? `歸納失敗: ${err.message}` : '背景自適應歸納失敗，請重試。', 'error');
    } finally {
      setIsExtractingContext(false);
    }
  };

  const generateSummary = async () => {
    if (history.length === 0) {
      addToast('尚無內容可供摘要', 'info');
      return;
    }
    
    setIsSummarizing(true);
    try {
      const fullText = [...history].reverse().map(h => `${h.original} (翻譯: ${h.translated || ''})`).join('\n');
      const systemInstruction = "You are a professional meeting assistant. Create clear, concise summaries with key bullet points.";
      const prompt = `Please summarize the following transcript. 
        ${sessionContext ? `Context: ${sessionContext}` : ''}
        Provide a concise summary in Traditional Chinese (Taiwan). 
        Use bullet points for key takeaways.
        Transcript:
        ${fullText}`;

      let textResult = '';

      if (aiSettings.provider === 'openai') {
        if (!aiSettings.openaiKey) {
          throw new Error('您選擇了 OpenAI 引擎，但尚未設定 API 金鑰，請點擊右上角「設定」進行配置。');
        }
        textResult = await callOpenAI(aiSettings.openaiKey, aiSettings.openaiModel, prompt, systemInstruction);
      } else if (aiSettings.provider === 'claude') {
        if (!aiSettings.claudeKey) {
          throw new Error('您選擇了 Claude 引擎，但尚未設定 API 金鑰，請點擊右上角「設定」進行配置。');
        }
        textResult = await callClaude(aiSettings.claudeKey, aiSettings.claudeModel, prompt, systemInstruction);
      } else {
        // Gemini
        const client = getGeminiClient(aiSettings.geminiKey);
        const response = await client.models.generateContent({
          model: aiSettings.geminiModel,
          contents: prompt,
          config: {
            systemInstruction: systemInstruction,
          }
        });
        textResult = response.text || '';
      }

      setSummary(textResult || '無法生成摘要');
      addToast('摘要已更新', 'success');
      setActiveTab('summary');
    } catch (err) {
      console.error('Summary error:', err);
      addToast(err instanceof Error ? `摘要生成失敗: ${err.message}` : '摘要生成失敗', 'error');
    } finally {
      setIsSummarizing(false);
    }
  };

  const getFullTranscript = () => {
    return [...history].reverse().map(entry => {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      return `[${time}]\nEN: ${entry.original}\nZH: ${entry.translated || '(翻譯中...)'}\n`;
    }).join('\n');
  };

  const translateSegment = async (text: string, id?: string): Promise<string> => {
    if (!text.trim()) return '';
    try {
      const systemInstruction = `You are a professional translator and linguistic expert.
          ${sessionContext ? `[CONTEXT]: The current conversation is about: "${sessionContext}". Use this to ensure terminology and context are accurate.` : ''}
          NOTE: The input may be a partial or incomplete fragment captured from live speech. Always translate whatever is given as faithfully as possible (even a sentence fragment); never refuse and never leave "translation" empty.
          1. Translate English into Traditional Chinese (Taiwan style).
          2. Analyze the input English text like a forensic linguist. Identify clues from:
             - Vocabulary (e.g., NZ/British vs US terms).
             - Syntax/Grammar (detecting non-native patterns like Spanish-English transfer errors).
             - Subtle markers (fillers, phrasal verbs).
          3. Determine the most likely base accent: en-US, en-GB, en-NZ, en-AU, en-CA, en-IN.
          4. Also output a "linguistic_profile" which captures specific detected traits.
          5. Assign a "confidence" score (0-100) based on linguistic evidence.
          Return your response in this STRICT JSON format: 
          {"translation": "...", "detectedAccentCode": "en-XX", "reasoning": "...", "wordCount": 0, "profile_traits": ["trait1", "trait2"], "confidence": 85}.
          Only return the JSON object.`;

      let resText = '';

      if (aiSettings.provider === 'openai') {
        if (!aiSettings.openaiKey) {
          throw new Error('未設定 OpenAI API 金鑰');
        }
        resText = await callOpenAI(aiSettings.openaiKey, aiSettings.openaiModel, text, systemInstruction);
      } else if (aiSettings.provider === 'claude') {
        if (!aiSettings.claudeKey) {
          throw new Error('未設定 Claude API 金鑰');
        }
        resText = await callClaude(aiSettings.claudeKey, aiSettings.claudeModel, text, systemInstruction);
      } else {
        // Gemini
        const client = getGeminiClient(aiSettings.geminiKey);
        const response = await client.models.generateContent({
          model: aiSettings.geminiModel,
          contents: text,
          config: {
            systemInstruction: systemInstruction,
          }
        });
        resText = response.text || '{}';
      }
      
      let data: { translation?: string, detectedAccentCode?: string, reasoning?: string, wordCount?: number, profile_traits?: string[], confidence?: number } = {};
      try {
        const cleanJson = resText.replace(/```json|```/g, '').trim();
        const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          data = JSON.parse(jsonMatch[0]);
        } else {
          data = JSON.parse(cleanJson);
        }
      } catch (e) {
        console.error("Failed to parse AI JSON response", e);
        data = { translation: resText };
      }

      const result = data.translation || resText;
      
      // Update detected accent with evidence
      if (data.detectedAccentCode && data.detectedAccentCode !== selectedLang) {
        const matchingLang = LANGUAGES.find(l => l.code === data.detectedAccentCode);
        if (matchingLang) {
          const confidence = data.confidence || 50;
          setDetectedAccent({
            code: matchingLang.code,
            label: matchingLang.label,
            reason: data.reasoning || '語音特徵比對結果',
            wordCount: text.split(' ').length,
            traits: data.profile_traits || [],
            confidence
          });

          // Closed loop: if we're confident the speaker's accent differs from the
          // current recognition locale, switch it so the next segment is heard
          // with a better-matched accent model. Only while actively recording.
          if (autoSwitchAccent && confidence >= 80 && isActualRecordingRef.current) {
            setSelectedLang(matchingLang.code);
            addToast(`偵測到 ${matchingLang.label}（信心 ${confidence}%），已自動切換辨識口音`, 'success');
          }
        }
      }
      
      if (id) {
        setHistory(prev => prev.map(item => item.id === id ? { ...item, translated: result } : item));
      }
      
      return result;
    } catch (err) {
      console.error('Segment translation error:', err);
      addToast(err instanceof Error ? `服務器錯誤: ${err.message}` : '翻譯過程發生錯誤，AI 無法正常回傳結果。');
      const errorMsg = '[翻譯錯誤，請檢查 API 設定與網路]';
      if (id) {
        setHistory(prev => prev.map(item => item.id === id ? { ...item, translated: errorMsg } : item));
      }
      return errorMsg;
    }
  };

  // Keep a live reference to translateSegment so the speech-recognition effect
  // always uses the current AI settings instead of a stale snapshot.
  const translateSegmentRef = useRef(translateSegment);
  useEffect(() => { translateSegmentRef.current = translateSegment; });

  useEffect(() => {
    localStorage.setItem('swift_recognition_mode', recognitionMode);
    localStorage.setItem('swift_dual_mode_initialized', 'true');
  }, [recognitionMode]);

  useEffect(() => {
    localStorage.setItem('swift_translate_mode', translateMode);
  }, [translateMode]);

  // The mode actually in effect: in a room the creator's choice wins.
  const effectiveTranslateMode: TranslateMode = roomId ? (roomTranslateMode || 'ai') : translateMode;
  const effectiveTranslateModeRef = useRef(effectiveTranslateMode);
  useEffect(() => { effectiveTranslateModeRef.current = effectiveTranslateMode; });

  const translateFinalSegment = useCallback((text: string, segmentId: string) => {
    const mode = effectiveTranslateModeRef.current;
    setHistory(prev => prev.map(h => h.id === segmentId ? { ...h, status: 'translating' } : h));
    if (mode === 'browser') {
      browserTranslate(text)
        .then(t => setHistory(prev => prev.map(h => h.id === segmentId ? {
          ...h, translated: t, translatedBy: transLabelFor('browser', null),
          status: 'completed', hasFinal: true,
        } : h)))
        .catch(() => setHistory(prev => prev.map(h => h.id === segmentId ? {
          ...h, translated: '等待翻譯', status: 'failed', hasFinal: true,
        } : h)));
      return;
    }
    const label = transLabelFor('ai', keyInfoRef.current);
    Promise.resolve(translateSegmentRef.current(text, segmentId))
      .then(() => setHistory(prev => prev.map(h => h.id === segmentId ? {
        ...h, translatedBy: label, status: 'completed', hasFinal: true,
      } : h)))
      .catch(() => setHistory(prev => prev.map(h => h.id === segmentId ? {
        ...h, status: 'failed', hasFinal: true,
      } : h)));
  }, []);

  // Commit a VAD-delimited Web Speech segment. Live translates once with the
  // configured provider. Dual first shows a browser translation, then waits
  // for Whisper to replace the authoritative transcript and translation.
  const commitWebSpeechSegment = useCallback((text: string, mode: 'live' | 'dual'): string | null => {
    const clean = text.trim();
    if (!clean) return null;
    if (roomIdRef.current && isFirebaseConfigured()) {
      const segmentId = pushSegment(roomIdRef.current, {
        original: clean,
        translated: mode === 'dual' ? '等待翻譯' : null,
        draftOriginal: mode === 'dual' ? clean : undefined,
        draftTranslated: mode === 'dual' ? '等待翻譯' : undefined,
        mode,
        status: mode === 'dual' ? 'whisper-processing' : 'translating',
        deviceId: deviceIdRef.current, deviceLabel: deviceLabelRef.current, ts: Date.now(),
      });
      if (segmentId && mode === 'dual') {
        browserTranslate(clean)
          .then(t => updateSegment(roomIdRef.current!, segmentId, { draftTranslated: t, translated: t }))
          .catch(() => updateSegment(roomIdRef.current!, segmentId, { draftTranslated: '等待翻譯', translated: '等待翻譯' }));
      }
      return segmentId;
    } else {
      const segmentId = Math.random().toString(36).substring(7);
      setHistory(prev => [{
        id: segmentId, original: clean, timestamp: Date.now(),
        deviceId: deviceIdRef.current, deviceLabel: deviceLabelRef.current,
        mode, status: mode === 'dual' ? 'whisper-processing' : 'translating',
        hasFinal: false, showingDraft: false,
        draftOriginal: mode === 'dual' ? clean : undefined,
        draftTranslated: mode === 'dual' ? '等待翻譯' : undefined,
      }, ...prev]);
      if (mode === 'dual') {
        browserTranslate(clean)
          .then(t => setHistory(prev => prev.map(h => h.id === segmentId ? {
            ...h, draftTranslated: t, translated: t,
          } : h)))
          .catch(() => setHistory(prev => prev.map(h => h.id === segmentId ? {
            ...h, draftTranslated: '等待翻譯', translated: '等待翻譯',
          } : h)));
      } else {
        translateFinalSegment(clean, segmentId);
      }
      return segmentId;
    }
  }, [translateFinalSegment]);

  // ===== Multi-device room join / leave =====
  const leaveRoom = useCallback(() => {
    roomUnsubsRef.current.forEach((fn) => { try { fn(); } catch {} });
    roomUnsubsRef.current = [];
    if (roomIdRef.current) leavePresence(roomIdRef.current, deviceIdRef.current);
    roomIdRef.current = null;
    isRoomCreatorRef.current = false;
    claimedRoomClipKeysRef.current.clear();
    setRoomId(null);
    setRoomMembers([]);
    setRoomConnected(false);
    setRoomTranslateMode(null);
    setRoomLiveTranscripts({});
    setHistory([]);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());
    } catch {}
  }, []);

  const joinRoom = useCallback((code: string) => {
    const id = code.trim().toUpperCase();
    if (!id) return;
    if (!isFirebaseConfigured()) {
      addToast('尚未設定 Firebase，無法建立多裝置連線。', 'error');
      return;
    }
    // tear down any previous room first
    roomUnsubsRef.current.forEach((fn) => { try { fn(); } catch {} });
    roomUnsubsRef.current = [];
    setHistory([]);
    roomIdRef.current = id;
    setRoomId(id);

    const offSeg = subscribeSegments(
      id,
      (key, seg) => setHistory(prev => {
        if (prev.some(h => h.id === key)) return prev;
        const next = [...prev, {
          id: key, original: seg.original,
          translated: seg.translated ?? undefined, timestamp: seg.ts,
          deviceLabel: seg.deviceLabel, deviceId: seg.deviceId, translatedBy: seg.translatedBy,
          mode: seg.mode, status: seg.status,
          draftOriginal: seg.draftOriginal,
          draftTranslated: seg.draftTranslated ?? undefined,
          hasFinal: seg.status
            ? seg.status === 'completed' || seg.status === 'failed'
            : !!seg.translated,
          showingDraft: false,
        }];
        next.sort((a, b) => b.timestamp - a.timestamp);
        return next;
      }),
      (key, seg) => setHistory(prev => prev.map(h => h.id === key ? {
        ...h,
        original: seg.original ?? h.original,
        translated: seg.translated === null ? undefined : (seg.translated ?? h.translated),
        translatedBy: seg.translatedBy ?? h.translatedBy,
        draftOriginal: seg.draftOriginal ?? h.draftOriginal,
        draftTranslated: seg.draftTranslated ?? h.draftTranslated,
        mode: seg.mode ?? h.mode,
        status: seg.status ?? h.status,
        hasFinal: seg.status
          ? seg.status === 'completed' || seg.status === 'failed'
          : h.hasFinal || !!seg.translated,
      } : h)),
    );
    const offMembers = subscribeMembers(id, setRoomMembers);
    const offConn = subscribeConnection(setRoomConnected);
    const offConfig = subscribeRoomConfig(id, (cfg) => {
      setRoomTranslateMode(cfg?.translateMode === 'browser' ? 'browser' : 'ai');
    });
    const offLive = subscribeLiveTranscripts(id, setRoomLiveTranscripts);
    roomUnsubsRef.current = [offSeg, offMembers, offConn, offConfig, offLive];
    joinPresence(id, deviceIdRef.current, deviceLabelRef.current);

    try {
      const url = new URL(window.location.href);
      url.searchParams.set('room', id);
      window.history.replaceState({}, '', url.toString());
    } catch {}
    addToast(`已加入房間 ${id}`, 'success');
  }, [addToast]);

  const createRoom = useCallback(() => {
    const code = makeRoomCode();
    isRoomCreatorRef.current = true;
    joinRoom(code);
    // Seed the room's translation method from this device's current choice.
    setRoomConfig(code, { translateMode });
  }, [joinRoom, translateMode]);

  // Auto-join a room from the URL (?room=CODE) on first load.
  useEffect(() => {
    try {
      const code = new URL(window.location.href).searchParams.get('room');
      if (code && isFirebaseConfigured()) joinRoom(code);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== In-browser Whisper engine =====
  const ensureWhisperWorker = useCallback(() => {
    if (whisperWorkerRef.current) return whisperWorkerRef.current;
    const worker = new Worker(new URL('./whisperWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data || {};
      if (msg.type === 'progress') {
        const d = msg.data || {};
        if (d.status === 'progress' && d.file && typeof d.total === 'number') {
          progressByFileRef.current[d.file] = { loaded: d.loaded || 0, total: d.total || 0 };
          let loaded = 0, total = 0;
          for (const k in progressByFileRef.current) {
            loaded += progressByFileRef.current[k].loaded;
            total += progressByFileRef.current[k].total;
          }
          if (total > 0) setWhisperProgress(Math.min(99, Math.round((loaded / total) * 100)));
        }
      } else if (msg.type === 'ready') {
        whisperReadyRef.current = true;
        setWhisperProgress(100);
        setWhisperState('ready');
        dispatchNextWhisperJob();
        addToast('🎯 高精準模式就緒（Whisper 已載入）', 'success');
      } else if (msg.type === 'error') {
        whisperReadyRef.current = false;
        setWhisperState('error');
        addToast(`Whisper 載入失敗：${msg.error || '未知錯誤'}`, 'error');
      } else if (msg.type === 'result') {
        whisperJobActiveRef.current = false;
        whisperPendingJobsRef.current = Math.max(0, whisperPendingJobsRef.current - 1);
        if (isActualRecordingRef.current) {
          setWhisperActivity(whisperPendingJobsRef.current > 0 ? 'transcribing' : 'listening');
        } else if (whisperPendingJobsRef.current === 0) {
          setWhisperActivity('idle');
        }
        if (msg.error) {
          console.error('Whisper transcription failed', msg.error);
          addToast(`Whisper 轉錄失敗：${msg.error}`, 'error');
        }
        const cleaned = cleanTranscript(msg.text || '');
        const job = clipJobsRef.current.get(msg.id);
        if (job) {
          clipJobsRef.current.delete(msg.id);
          if (cleaned && !isJunkTranscript(cleaned) && roomIdRef.current) {
            updateSegment(roomIdRef.current, job.segmentId, {
              original: cleaned,
              translated: null,
              status: 'translating',
            });
          } else if (roomIdRef.current) {
            updateSegment(roomIdRef.current, job.segmentId, {
              status: 'failed',
              translated: '[Whisper 無法辨識此段音訊]',
            });
          }
          if (roomIdRef.current) deleteClip(roomIdRef.current, job.key);
          claimedRoomClipKeysRef.current.delete(job.key);
        } else {
          // Solo local transcription: update the pre-created entry (or remove it on junk).
          const entryId = whisperJobEntryRef.current.get(msg.id);
          whisperJobEntryRef.current.delete(msg.id);
          if (!cleaned || isJunkTranscript(cleaned)) {
            if (entryId) setHistory(prev => prev.filter(h => h.id !== entryId));
          } else if (entryId) {
            setHistory(prev => prev.map(h => h.id === entryId ? {
              ...h, original: cleaned, status: 'translating',
            } : h));
            translateFinalSegment(cleaned, entryId);
          } else {
            const fallbackId = Math.random().toString(36).substring(7);
            setHistory(prev => [{
              id: fallbackId, original: cleaned, timestamp: Date.now(),
              deviceId: deviceIdRef.current, deviceLabel: deviceLabelRef.current,
              mode: 'whisper', status: 'translating',
              hasFinal: false, showingDraft: false,
            }, ...prev]);
            translateFinalSegment(cleaned, fallbackId);
          }
        }
        dispatchNextWhisperJob();
      }
    };
    whisperWorkerRef.current = worker;
    return worker;
  }, [addToast, dispatchNextWhisperJob, translateFinalSegment]);

  const loadedModelRef = useRef('');
  const loadWhisperModel = useCallback(() => {
    const model = whisperModelRef.current;
    if (whisperReadyRef.current && loadedModelRef.current === model) { setWhisperState('ready'); return; }
    const worker = ensureWhisperWorker();
    progressByFileRef.current = {};
    setWhisperProgress(0);
    setWhisperState('loading');
    loadedModelRef.current = model;
    const device = (navigator as any).gpu ? 'webgpu' : 'wasm';
    worker.postMessage({ type: 'load', model, device });
  }, [ensureWhisperWorker]);

  // When user changes the model, reset ready state so the next manual download picks up the new model.
  const modelMountRef = useRef(true);
  useEffect(() => {
    if (modelMountRef.current) { modelMountRef.current = false; return; }
    whisperReadyRef.current = false;
    setWhisperState('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whisperModel]);

  // Send one VAD-detected utterance (16kHz Float32) to Whisper, after a capped
  // peak-normalization so quiet mics are boosted to a consistent level.
  // Peak-normalize in place (boost quiet mics; capped to avoid amplifying noise).
  const normalizeAudio = (audio: Float32Array) => {
    let peak = 0;
    for (let i = 0; i < audio.length; i++) { const a = Math.abs(audio[i]); if (a > peak) peak = a; }
    if (peak > 0.001) {
      const gain = Math.min(8, 0.95 / peak);
      if (gain > 1.05) for (let i = 0; i < audio.length; i++) audio[i] *= gain;
    }
  };

  // Solo path: transcribe this device's own utterance with local Whisper.
  // Creates a history entry immediately (with optional Web Speech draft) before queuing the job.
  const transcribeLocal = useCallback((audio: Float32Array, draftOriginal?: string, existingEntryId?: string) => {
    if (!audio || audio.length < WHISPER_SAMPLE_RATE * 0.25 || !whisperReadyRef.current) return;
    normalizeAudio(audio);
    let entryId: string;
    if (existingEntryId) {
      // Entry was already created by Web Speech — just attach this Whisper job to it.
      entryId = existingEntryId;
    } else {
      // No prior entry (whisper-only mode or no WS text): create one now.
      entryId = Math.random().toString(36).substring(7);
      setHistory(prev => [{
        id: entryId, original: '', timestamp: Date.now(),
        deviceId: deviceIdRef.current, deviceLabel: deviceLabelRef.current,
        mode: 'whisper', status: 'whisper-processing',
        hasFinal: false, showingDraft: false,
        draftOriginal, draftTranslated: undefined,
      }, ...prev]);
      if (draftOriginal) {
        browserTranslate(draftOriginal)
          .then(t => setHistory(prev => prev.map(h => h.id === entryId ? { ...h, draftTranslated: t } : h)))
          .catch(() => {});
      }
    }
    const id = ++whisperJobRef.current;
    whisperJobEntryRef.current.set(id, entryId);
    enqueueWhisperJob(id, audio);
  }, [enqueueWhisperJob]);

  // VAD is the single segmentation source for all three recognition modes.
  const handleUtterance = useCallback((audio: Float32Array) => {
    if (!audio || audio.length < WHISPER_SAMPLE_RATE * 0.25) return;
    // Web Speech commonly emits its final result just after the VAD callback.
    // Wait briefly, then freeze final + interim as the immutable dual draft.
    setTimeout(() => {
      const mode = recognitionModeRef.current;
      const fullDraft = liveDraftTranscriptRef.current;
      const finalDraft = fullDraft.slice(lastDraftLengthRef.current).trim();
      const interimDraft = lastInterimRef.current.trim();
      const draft = `${finalDraft}${finalDraft && interimDraft ? ' ' : ''}${interimDraft}`.trim();
      lastDraftLengthRef.current = fullDraft.length;
      if (interimDraft) {
        consumedInterimRef.current = interimDraft;
        lastInterimRef.current = '';
        setInterimTranscript('');
      }

      if (roomIdRef.current && isFirebaseConfigured()) {
        if (mode === 'live') {
          commitWebSpeechSegment(draft, 'live');
          setWhisperActivity('listening');
          return;
        }

        let segmentId: string | null;
        if (mode === 'dual') {
          segmentId = commitWebSpeechSegment(draft || '（此段未取得即時辨識文字）', 'dual');
        } else {
          segmentId = pushSegment(roomIdRef.current, {
            original: '',
            translated: null,
            mode: 'whisper',
            status: 'whisper-processing',
            deviceId: deviceIdRef.current,
            deviceLabel: deviceLabelRef.current,
            ts: Date.now(),
          });
        }

        if (segmentId) {
          normalizeAudio(audio);
          pushClip(roomIdRef.current, {
            audio: float32ToBase64Pcm16(audio),
            segmentId,
            mode,
            deviceId: deviceIdRef.current,
            deviceLabel: deviceLabelRef.current,
            ts: Date.now(),
          });
        }
        setWhisperActivity('listening');
        return;
      }

      if (mode === 'live') {
        commitWebSpeechSegment(draft, 'live');
      } else if (mode === 'dual') {
        const immutableDraft = draft || '（此段未取得即時辨識文字）';
        const entryId = commitWebSpeechSegment(immutableDraft, 'dual');
        transcribeLocal(audio, immutableDraft, entryId || undefined);
      } else {
        transcribeLocal(audio);
      }
    }, 320);
  }, [commitWebSpeechSegment, transcribeLocal]);

  const stopWhisperRecording = useCallback(() => {
    whisperRecordingActiveRef.current = false;
    setWhisperActivity('idle');
    if (vadRef.current) {
      try { vadRef.current.destroy(); } catch {}
      vadRef.current = null;
    }
    const stillRecording = liveRecognitionActiveRef.current;
    isActualRecordingRef.current = stillRecording;
    setIsRecording(stillRecording);
  }, []);

  const describeMicrophoneError = (error: unknown): { code: string; message: string } => {
    const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : '';
    const detail = error instanceof Error ? error.message : String(error);
    if (!window.isSecureContext) {
      return { code: 'insecure-context', message: '麥克風只能在 HTTPS 或 localhost 使用。請改用安全連線後再試。' };
    }
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return { code: 'not-allowed', message: '未取得麥克風權限。請在瀏覽器網址列的網站權限中允許麥克風，再重新啟動。' };
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return { code: 'no-device', message: '找不到可用的麥克風，請確認裝置已連接並由系統啟用。' };
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return { code: 'device-busy', message: '麥克風目前被其他程式占用。請關閉其他錄音或會議程式後再試。' };
    }
    if (/vad\.worklet|silero_vad|onnx|wasm|fetch/i.test(detail)) {
      return { code: 'vad-assets', message: '語音偵測模型載入失敗，請重新整理頁面；若仍失敗，請檢查網路或部署資產。' };
    }
    return { code: name || 'start-failed', message: `麥克風啟動失敗${detail ? `：${detail}` : ''}` };
  };

  const startWhisperRecording = useCallback(async () => {
    // In a room we only CAPTURE + relay clips (the transcriber needs the model,
    // not us). Solo, we transcribe locally, so the model must be ready first.
    if (!roomIdRef.current && recognitionModeRef.current !== 'live' && !whisperReadyRef.current) {
      addToast('Whisper 尚未載入完成，請稍候片刻再開始。', 'info');
      return;
    }
    if (vadRef.current) return; // already running
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('Microphone access requires HTTPS or localhost', 'SecurityError');
      }
      const baseUrl = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
      // Silero VAD detects real speech and hands us each utterance at 16kHz.
      // Current vad-web uses millisecond-based segmentation options.
      const vad = await MicVAD.new({
        baseAssetPath: `${baseUrl}vad-assets/`,
        onnxWASMBasePath: `${baseUrl}ort-assets/`,
        startOnLoad: false,
        model: 'v5',
        positiveSpeechThreshold: vadThreshold,
        negativeSpeechThreshold: Math.max(0.1, vadThreshold - 0.15),
        redemptionMs: whisperPauseMs,
        minSpeechMs: 250,
        preSpeechPadMs: 300,
        submitUserSpeechOnPause: true,
        additionalAudioConstraints: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } as any,
        onSpeechStart: () => setWhisperActivity('speech'),
        onSpeechRealStart: () => setWhisperActivity('speech'),
        onVADMisfire: () => setWhisperActivity('listening'),
        onSpeechEnd: (audio: Float32Array) => { handleUtterance(audio); },
      } as any);
      vadRef.current = vad;
      await vad.start();
      whisperRecordingActiveRef.current = true;
      isActualRecordingRef.current = true;
      setIsRecording(true);
      setWhisperActivity('listening');
      setSpeechErrorDetected(null);
    } catch (err) {
      console.error('VAD/mic error', err);
      const problem = describeMicrophoneError(err);
      setSpeechErrorDetected(problem.code);
      addToast(problem.message, 'error');
      stopWhisperRecording();
    }
  }, [addToast, handleUtterance, stopWhisperRecording, vadThreshold, whisperPauseMs]);

  // Initialize Speech Recognition once. The locale is updated live (see below)
  // rather than by re-creating the instance, which avoids leaking recognizers.
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition && !recognitionRef.current) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = selectedLang;

      recognition.onstart = () => {
        liveRecognitionActiveRef.current = true;
        isActualRecordingRef.current = true;
        setIsRecording(true);
        setSpeechErrorDetected(null);
      };

      recognition.onresult = (event: any) => {
        let finalText = '';
        let interimText = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalText += event.results[i][0].transcript;
          } else {
            interimText += event.results[i][0].transcript;
          }
        }

        if (finalText) {
          const next = `${liveDraftTranscriptRef.current} ${finalText}`.trim();
          liveDraftTranscriptRef.current = next;
          setLiveDraftTranscript(next);
          const consumed = consumedInterimRef.current.trim().toLocaleLowerCase();
          const finalized = finalText.trim().toLocaleLowerCase();
          if (consumed && (finalized.includes(consumed) || consumed.includes(finalized))) {
            lastDraftLengthRef.current = next.length;
            consumedInterimRef.current = '';
          }
        }
        // Remember the still-unfinalized tail so it survives an auto-restart.
        lastInterimRef.current = interimText;
        setInterimTranscript(interimText);
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'aborted') {
          console.warn('Speech recognition aborted');
          return;
        }

        console.error('Speech recognition error', event.error);
        setSpeechErrorDetected(event.error);
        if (event.error === 'not-allowed') {
          addToast('未獲得麥克風權限，請檢查瀏覽器安全性設定，或直接在下方手動鍵盤輸入唷！');
        } else if (event.error === 'network') {
          addToast('網路連線不穩定/語音伺服器連線受限，語音辨識已中斷。推薦使用下方「手動鍵盤輸入門」進行完美比對與翻譯！');
        } else if (event.error !== 'no-speech') {
          addToast(`錄音發生錯誤：${event.error}。推薦使用下方手動鍵盤輸入唷！`);
        }
        // 'no-speech' is recoverable — keep recording and let onend restart it.
        // Any other error is fatal, so stop trying to auto-restart.
        if (event.error !== 'no-speech') {
          shouldKeepRecordingRef.current = false;
        }
        liveRecognitionActiveRef.current = false;
        const stillRecording = whisperRecordingActiveRef.current;
        setIsRecording(stillRecording);
        isActualRecordingRef.current = stillRecording;
      };

      recognition.onend = () => {
        liveRecognitionActiveRef.current = false;
        setInterimTranscript('');
        // Preserve an unfinished tail in the left live transcript. VAD remains
        // the only component allowed to create a history card.
        if (lastInterimRef.current.trim()) {
          const clean = lastInterimRef.current.trim();
          const next = `${liveDraftTranscriptRef.current} ${clean}`.trim();
          liveDraftTranscriptRef.current = next;
          setLiveDraftTranscript(next);
          lastInterimRef.current = '';
        }
        // The API often ends on its own after a pause or ~60s. If the user still
        // wants to record, restart it so it doesn't silently stop mid-session.
        if (shouldKeepRecordingRef.current) {
          try {
            recognition.start();
            return;
          } catch (err) {
            console.warn('Auto-restart failed, retrying shortly', err);
            setTimeout(() => {
              if (shouldKeepRecordingRef.current) {
                try { recognition.start(); } catch (e) { console.error('Restart failed', e); }
              }
            }, 300);
            return;
          }
        }
        const stillRecording = whisperRecordingActiveRef.current;
        isActualRecordingRef.current = stillRecording;
        setIsRecording(stillRecording);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  // Apply locale changes to the live recognizer. If recording, stop it so onend
  // auto-restarts a fresh session using the newly selected accent model.
  useEffect(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    rec.lang = selectedLang;
    if (liveRecognitionActiveRef.current) {
      try { rec.stop(); } catch (e) { console.warn('lang switch restart failed', e); }
    }
  }, [selectedLang]);

  // Switching engine: stop whatever is recording. Whisper is NOT auto-loaded —
  // the user must click the download button manually.
  useEffect(() => {
    if (isActualRecordingRef.current) {
      shouldKeepRecordingRef.current = false;
      try { recognitionRef.current?.stop(); } catch {}
      stopWhisperRecording();
    }
  }, [recognitionMode, stopWhisperRecording]);

  // Tear down the Whisper worker and audio graph on unmount.
  useEffect(() => () => {
    try { stopWhisperRecording(); } catch {}
    whisperWorkerRef.current?.terminate();
    whisperWorkerRef.current = null;
  }, [stopWhisperRecording]);

  const startLiveRecognition = useCallback(() => {
    if (liveRecognitionActiveRef.current) return true;
    if (!recognitionRef.current) {
      addToast('您的瀏覽器不支援語音辨識功能。推薦使用下方的「手動鍵盤輸入」！');
      return false;
    }
    try {
      setError(null);
      setSpeechErrorDetected(null);
      shouldKeepRecordingRef.current = true; // keep recording across auto-ends
      recognitionRef.current.start();
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes('already started')) {
        liveRecognitionActiveRef.current = true;
        setIsRecording(true);
        isActualRecordingRef.current = true;
        return true;
      }
      console.error('Start recognition error:', err);
      setSpeechErrorDetected('start-failed');
      addToast(recognitionModeRef.current === 'dual'
        ? '即時草稿啟動失敗；Whisper 正式轉錄仍會繼續。'
        : '麥克風啟動失敗，請至下方手動輸入欄進行法醫比對與翻譯。');
      return false;
    }
  }, [addToast]);

  const startRecording = useCallback(() => {
    if (liveRecognitionActiveRef.current || whisperRecordingActiveRef.current) return;
    setLiveDraftTranscript('');
    liveDraftTranscriptRef.current = '';
    lastDraftLengthRef.current = 0;
    consumedInterimRef.current = '';
    lastInterimRef.current = '';
    setInterimTranscript('');

    if (roomIdRef.current) {
      // Room mode: VAD always runs regardless of recognitionMode.
      // Clips (base64 PCM) are relayed to Firebase for the room's Whisper
      // transcriber to process. Web Speech still runs for the live draft
      // display on the left panel (unless the user picked whisper-only).
      if (recognitionMode !== 'whisper') startLiveRecognition();
      void startWhisperRecording();
      return;
    }

    // Solo mode: respect the user's chosen recognition engine.
    if (recognitionMode === 'whisper') {
      void startWhisperRecording();
      return;
    }
    if (recognitionMode === 'live') {
      startLiveRecognition();
      void startWhisperRecording();
      return;
    }
    // Dual: Web Speech draft + Whisper for authoritative transcript/translation.
    startLiveRecognition();
    if (!whisperReadyRef.current) {
      pendingDualWhisperStartRef.current = true;
      addToast('即時草稿已開始；Whisper 模型就緒後會自動加入正式轉錄。', 'info');
    } else {
      void startWhisperRecording();
    }
  }, [addToast, recognitionMode, startLiveRecognition, startWhisperRecording]);

  useEffect(() => {
    if (
      recognitionMode === 'dual'
      && whisperState === 'ready'
      && pendingDualWhisperStartRef.current
      && liveRecognitionActiveRef.current
      && !whisperRecordingActiveRef.current
    ) {
      pendingDualWhisperStartRef.current = false;
      void startWhisperRecording();
    }
  }, [recognitionMode, startWhisperRecording, whisperState]);

  const stopRecording = useCallback(() => {
    shouldKeepRecordingRef.current = false;
    pendingDualWhisperStartRef.current = false;
    if (liveRecognitionActiveRef.current && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.error('Stop recognition error:', err);
      }
    }
    if (whisperRecordingActiveRef.current || vadRef.current) stopWhisperRecording();
    liveRecognitionActiveRef.current = false;
    whisperRecordingActiveRef.current = false;
    isActualRecordingRef.current = false;
    setIsRecording(false);
    setInterimTranscript('');
  }, [stopWhisperRecording]);

  const toggleRecording = () => {
    if (liveRecognitionActiveRef.current || whisperRecordingActiveRef.current) stopRecording(); else startRecording();
  };

  // Keep live refs so the room command listener always calls the current fns.
  const startRecordingRef = useRef(startRecording);
  const stopRecordingRef = useRef(stopRecording);
  useEffect(() => { startRecordingRef.current = startRecording; stopRecordingRef.current = stopRecording; });
  const recognitionModeRef = useRef<RecognitionMode>(recognitionMode);
  useEffect(() => { recognitionModeRef.current = recognitionMode; });

  // A remote "start" may request a mode; we begin once that engine is ready.
  const pendingStartRef = useRef<RecognitionMode | null>(null);
  const tryStartPending = useCallback(() => {
    const want = pendingStartRef.current;
    if (!want || isActualRecordingRef.current) return;
    if (roomIdRef.current) {
      // Room mode: VAD always runs — no need to wait for mode switch or model.
      pendingStartRef.current = null;
      startRecordingRef.current();
      return;
    }
    if (recognitionModeRef.current !== want) return;           // wait for the mode switch to apply
    if ((want === 'whisper' || want === 'dual') && !whisperReadyRef.current) return;
    pendingStartRef.current = null;
    startRecordingRef.current();
  }, []);
  // Retry the pending start when the mode applies or Whisper finishes loading.
  useEffect(() => { tryStartPending(); }, [recognitionMode, whisperState, tryStartPending]);

  // Report this device's recording state + current recognition mode to the room.
  useEffect(() => {
    if (roomId) setMemberRecording(roomId, deviceIdRef.current, isRecording);
    // Clear live transcript when recording stops
    if (!isRecording && roomId) clearLiveTranscript(roomId, deviceIdRef.current);
  }, [isRecording, roomId]);
  useEffect(() => {
    if (roomId) setMemberMeta(roomId, deviceIdRef.current, { recMode: recognitionMode });
  }, [roomId, recognitionMode]);

  // Debounced publish of live interim text to the room so others can see it.
  useEffect(() => {
    if (!roomId || !isRecording) return;
    const text = (liveDraftTranscript + (liveDraftTranscript && interimTranscript ? ' ' : '') + interimTranscript).trim();
    if (liveTranscriptDebounceRef.current) clearTimeout(liveTranscriptDebounceRef.current);
    liveTranscriptDebounceRef.current = setTimeout(() => {
      setLiveTranscript(roomId, deviceIdRef.current, text, deviceLabelRef.current);
    }, 150);
  }, [interimTranscript, liveDraftTranscript, roomId, isRecording]);

  // Obey start/stop commands sent from other devices in the room.
  useEffect(() => {
    if (!roomId) return;
    let lastTs = Date.now();
    const unsub = subscribeCommand(roomId, deviceIdRef.current, (cmd) => {
      if (cmd.ts <= lastTs) return; // ignore the pre-existing/stale command
      lastTs = cmd.ts;
      if (cmd.action === 'start') {
        const mode: RecognitionMode = cmd.mode === 'dual'
          ? 'dual'
          : cmd.mode === 'whisper'
            ? 'whisper'
            : cmd.mode === 'live'
              ? 'live'
              : recognitionModeRef.current;
        pendingStartRef.current = mode;
        if (mode !== recognitionModeRef.current) setRecognitionMode(mode);
        setTimeout(() => tryStartPending(), 0); // covers the already-in-mode case
        addToast(`${cmd.from} 要求本機開始收音（${mode === 'dual' ? '雙軌' : mode === 'whisper' ? '高精準' : '即時'}）`, 'info');
      } else if (cmd.action === 'stop') {
        pendingStartRef.current = null;
        stopRecordingRef.current();
        addToast(`${cmd.from} 要求本機停止收音`, 'info');
      }
    });
    return () => unsub();
  }, [roomId, addToast, tryStartPending]);

  // Advertise whether this device can serve as the room's Whisper transcriber
  // (model loaded + not a phone), and elect the lowest-id capable device.
  const canWhisperHere = whisperState === 'ready' && !IS_IOS;
  useEffect(() => {
    if (roomId) setMemberMeta(roomId, deviceIdRef.current, { canWhisper: canWhisperHere });
  }, [roomId, canWhisperHere]);
  const activeTranscriber = useMemo(() => {
    const cap = roomMembers.filter(m => m.canWhisper).sort((a, b) => a.id.localeCompare(b.id));
    return cap[0] || null;
  }, [roomMembers]);
  const activeTranscriberRef = useRef(activeTranscriber);
  useEffect(() => { activeTranscriberRef.current = activeTranscriber; });

  // The elected room transcriber subscribes only when Whisper is ready.
  // Re-subscribing replays still-existing RTDB clips, so clips captured while
  // the model was loading are not lost. The claim set prevents duplicate jobs.
  useEffect(() => {
    if (!roomId || whisperState !== 'ready') return;
    if (!activeTranscriber || activeTranscriber.id !== deviceIdRef.current) return;
    const unsubscribe = subscribeClips(roomId, (key, clip) => {
      if (claimedRoomClipKeysRef.current.has(key)) return;
      claimedRoomClipKeysRef.current.add(key);
      try {
        const audio = base64Pcm16ToFloat32(clip.audio);
        const jobId = ++whisperJobRef.current;
        clipJobsRef.current.set(jobId, {
          key, segmentId: clip.segmentId, mode: clip.mode,
          deviceId: clip.deviceId, deviceLabel: clip.deviceLabel, ts: clip.ts,
        });
        enqueueWhisperJob(jobId, audio);
      } catch (error) {
        claimedRoomClipKeysRef.current.delete(key);
        console.error('clip transcribe failed', error);
      }
    });
    return unsubscribe;
  }, [activeTranscriber, enqueueWhisperJob, roomId, whisperState]);

  // Pick a provider this device can actually translate with: prefer the
  // selected engine if it has a key, otherwise fall back to ANY key the
  // device holds. This way "has a key" doesn't depend on the chosen engine.
  const keyInfo = useMemo(() => {
    const s = aiSettings;
    const opts: { provider: 'openai' | 'claude' | 'gemini'; key: string; model: string }[] = [
      { provider: 'openai', key: s.openaiKey, model: s.openaiModel },
      { provider: 'claude', key: s.claudeKey, model: s.claudeModel },
      { provider: 'gemini', key: s.geminiKey, model: s.geminiModel },
    ];
    const selected = opts.find(o => o.provider === s.provider && o.key);
    return selected || opts.find(o => o.key) || null;
  }, [aiSettings]);
  const hasUsableKey = !!keyInfo;
  const keyInfoRef = useRef(keyInfo);
  useEffect(() => { keyInfoRef.current = keyInfo; });

  // Translate a piece of text with a specific provider/key (room translator path).
  const translateWith = useCallback(async (info: NonNullable<typeof keyInfo>, text: string): Promise<string> => {
    const sys = 'You are a professional translator. Translate the English into natural, fluent Traditional Chinese (Taiwan style). The text may be a partial or incomplete fragment captured from live speech — still translate whatever is given as faithfully as possible, even if it is only a sentence fragment. Always return a translation; never refuse, never explain, never return an empty string. Return ONLY the translated Chinese — no quotes, no notes, no JSON.';
    if (info.provider === 'openai') return (await callOpenAI(info.key, info.model, text, sys)).trim();
    if (info.provider === 'claude') return (await callClaude(info.key, info.model, text, sys)).trim();
    const client = getGeminiClient(info.key);
    const r = await client.models.generateContent({ model: info.model, contents: text, config: { systemInstruction: sys } });
    return (r.text || '').trim();
  }, [getGeminiClient]);

  // Whether this device can serve as the room's translator under the current
  // mode: AI needs a key; browser needs Translator API support; off needs none.
  const browserAvail = useMemo(() => browserTranslateAvailable(), []);
  useEffect(() => {
    if (!browserAvail) {
      setBrowserTranslatorState('unavailable');
      return;
    }
    getBrowserTranslatorAvailability()
      .then(setBrowserTranslatorState)
      .catch(() => setBrowserTranslatorState('unknown'));
  }, [browserAvail]);

  const prepareBrowserTranslator = useCallback(async (): Promise<boolean> => {
    if (!browserAvail) {
      setBrowserTranslatorState('unavailable');
      addToast('此裝置不支援 Chrome 內建翻譯。此功能目前僅支援新版桌面版 Chrome。', 'error');
      return false;
    }
    try {
      setBrowserTranslatorProgress(0);
      setBrowserTranslatorState('downloading');
      // Must be invoked directly from the click event: Chrome requires user
      // activation before it can create/download the language pack.
      await getBrowserTranslator((progress) => {
        setBrowserTranslatorProgress(progress);
        setBrowserTranslatorState(progress >= 100 ? 'available' : 'downloading');
      });
      setBrowserTranslatorProgress(100);
      setBrowserTranslatorState('available');
      addToast('瀏覽器內建英翻中已就緒，後續不會使用 AI API。', 'success');
      return true;
    } catch (error) {
      console.error('Browser translator initialization failed', error);
      setBrowserTranslatorState('unavailable');
      addToast(error instanceof Error ? `內建翻譯啟動失敗：${error.message}` : '內建翻譯啟動失敗', 'error');
      return false;
    }
  }, [addToast, browserAvail]);

  const chooseSoloTranslateMode = useCallback((mode: TranslateMode) => {
    if (mode === 'ai') {
      setTranslateMode('ai');
      return;
    }
    void prepareBrowserTranslator().then((ready) => {
      if (ready) setTranslateMode('browser');
    });
  }, [prepareBrowserTranslator]);

  const chooseRoomTranslateMode = useCallback((mode: TranslateMode) => {
    if (!roomId || !isRoomCreatorRef.current) return;
    if (mode === 'ai') {
      setRoomConfig(roomId, { translateMode: 'ai' });
      return;
    }
    void prepareBrowserTranslator().then((ready) => {
      if (ready) setRoomConfig(roomId, { translateMode: 'browser' });
    });
  }, [prepareBrowserTranslator, roomId]);

  const deviceCanTranslate = effectiveTranslateMode === 'browser'
    ? browserTranslatorState === 'available'
    : hasUsableKey;

  // Publish this device's translate capability + the provider/source it'd use.
  useEffect(() => {
    if (roomId) setMemberMeta(roomId, deviceIdRef.current, {
      hasKey: deviceCanTranslate,
      provider: effectiveTranslateMode === 'browser' ? 'browser' : (keyInfo?.provider || ''),
    });
  }, [roomId, deviceCanTranslate, effectiveTranslateMode, keyInfo]);

  // Elect one capable device as the room's translator (smallest id).
  const activeTranslator = useMemo(() => {
    const capable = roomMembers.filter(m => m.hasKey).sort((a, b) => a.id.localeCompare(b.id));
    return capable[0] || null;
  }, [roomMembers]);

  // If this device is the elected translator, translate untranslated segments
  // and sync the result. Skipped entirely when the room mode is "off".
  const translatingKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!roomIdRef.current) return;
    if (!activeTranslator || activeTranslator.id !== deviceIdRef.current) return;
    const info = keyInfoRef.current;
    const mode = effectiveTranslateMode;
    for (const h of history) {
      if (
        h.status === 'translating'
        && !!h.original.trim()
        && (h.translated === undefined || h.translated === null || h.translated === '')
        && !translatingKeysRef.current.has(h.id)
      ) {
        translatingKeysRef.current.add(h.id);
        const segId = h.id;
        const job = mode === 'browser' ? browserTranslate(h.original)
          : (info ? translateWith(info, h.original) : Promise.reject(new Error('no key')));
        const src = transLabelFor(mode, mode === 'browser' ? null : info);
        job
          .then((t) => {
            if (roomIdRef.current) updateSegment(roomIdRef.current, segId, {
              translated: t || '[翻譯失敗]',
              translatedBy: src,
              status: t ? 'completed' : 'failed',
            });
          })
          .catch((e) => {
            console.error('room translate failed', e);
            if (roomIdRef.current) updateSegment(roomIdRef.current, segId, {
              translated: '[翻譯失敗，請檢查翻譯設定/金鑰]',
              status: 'failed',
            });
          })
          .finally(() => translatingKeysRef.current.delete(segId));
      }
    }
  }, [history, activeTranslator, translateWith, effectiveTranslateMode]);

  const handleSaveSegmentEdit = async (id: string) => {
    const text = editingText.trim();
    if (!text) {
      addToast('段落原始英文文本不得為空。', 'info');
      return;
    }

    // Set segment to loading state to give dynamic micro-interactions feedback
    setHistory(prev => prev.map(item => item.id === id ? { ...item, original: text, translated: undefined } : item));
    setEditingId(null);
    setEditingText('');

    try {
      addToast('正在依據修改文本重新進行口音與比對翻譯中...', 'info');
      await translateSegment(text, id);
      addToast('段落原始稿修正與比對翻譯成功！', 'success');
    } catch (err) {
      console.error('Re-translating edited segment error:', err);
      addToast('重新比對翻譯失敗。', 'error');
    }
  };

  // Check if new items are added while the user was scrolled down to flag it on the button
  useEffect(() => {
    if (history.length > 0) {
      const scrollContainer = scrollRef.current;
      if (scrollContainer) {
        if (scrollContainer.scrollTop > 80) {
          setHasNewItems(true);
        }
      }
    }
  }, [history]);

  const scrollToTop = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
      setHasNewItems(false);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setShowScrollTop(target.scrollTop > 120);
    if (target.scrollTop <= 50) {
      setHasNewItems(false);
    }
  };

  const handleClear = () => {
    setTranslatedText('');
    setHistory([]);
    setSummary('');
    setDetectedAccent(null);
    setError(null);
    setLiveDraftTranscript('');
    liveDraftTranscriptRef.current = '';
    setInterimTranscript('');
    // In a room, clearing wipes the shared transcript for everyone.
    if (roomIdRef.current && isFirebaseConfigured()) {
      clearRoomSegments(roomIdRef.current);
      addToast('已清除房間內所有裝置的記錄', 'success');
    } else {
      addToast('已成功清除所有記錄', 'success');
    }
  };

  const handleForceStop = () => {
    translationIdRef.current++;
    setTranslatedText('');
    setInterimTranscript('');
    setIsTranslating(false);
  };

  const activeLangLabel = LANGUAGES.find(l => l.code === selectedLang)?.label || selectedLang;
  const whisperActivityLabel = whisperActivity === 'speech'
    ? '偵測到語音，請繼續說'
    : whisperActivity === 'transcribing'
      ? `正在轉錄${whisperPendingJobsRef.current > 1 ? `（${whisperPendingJobsRef.current} 段排隊）` : '…'}`
      : whisperActivity === 'listening'
        ? '正在等待語音'
        : '高精準模式待命';

  // When any device (local or remote) is recording, the left panel switches to
  // a continuous full-transcript view.
  const someoneRecording = isRecording || roomMembers.some(m => m.recording);
  useEffect(() => {
    if (someoneRecording && liveScrollRef.current) {
      liveScrollRef.current.scrollTop = liveScrollRef.current.scrollHeight;
    }
  }, [history, interimTranscript, someoneRecording]);

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-zinc-900 font-sans selection:bg-indigo-100 selection:text-indigo-900 flex flex-col lg:h-screen overflow-x-hidden lg:overflow-hidden">
      
      {/* Toast Notification System */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] flex flex-col gap-2 w-full max-w-sm px-4 pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className={cn(
                "p-4 rounded-xl shadow-2xl flex items-center gap-3 pointer-events-auto border",
                toast.type === 'error' ? "bg-red-600 text-white border-red-500" : 
                toast.type === 'success' ? "bg-green-600 text-white border-green-500" : 
                "bg-zinc-800 text-white border-zinc-700"
              )}
            >
              {toast.type === 'error' ? <XCircle className="w-5 h-5 shrink-0" /> : <Info className="w-5 h-5 shrink-0" />}
              <p className="text-sm font-semibold leading-tight">{toast.message}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Floating logo + menu button (same side, top-right) */}
      <header className="fixed top-0 right-0 z-40 pointer-events-none">
        <div className="flex items-center gap-2 px-3 sm:px-5 py-2 pointer-events-auto">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 bg-indigo-600 rounded-md flex items-center justify-center shadow-sm flex-shrink-0">
              <Zap className="w-3 h-3 text-white fill-white" />
            </div>
            <h1 className="text-[11px] font-extrabold tracking-tight text-zinc-400">
              Swift<span className="text-indigo-600">⚡</span>
            </h1>
          </div>

          {/* Hamburger trigger */}
          <button
            onClick={() => setIsMenuOpen((v) => !v)}
            aria-label="開啟選單"
            aria-expanded={isMenuOpen}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-bold transition-all shadow-sm",
              isMenuOpen
                ? "bg-indigo-600 border-indigo-700 text-white shadow-md"
                : "bg-white/80 backdrop-blur-sm border-zinc-200/60 text-zinc-600 hover:bg-white"
            )}
          >
            {isMenuOpen ? <X className="w-3.5 h-3.5" /> : <Menu className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Dropdown menu — all header controls live here */}
        <AnimatePresence>
          {isMenuOpen && (
            <>
              {/* click-away backdrop */}
              <div className="pointer-events-auto fixed inset-0 z-40" onClick={() => setIsMenuOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className="pointer-events-auto absolute right-0 top-full mt-2 mr-3 sm:mr-5 w-[min(92vw,320px)] bg-white border border-zinc-200 rounded-2xl shadow-2xl z-50 p-4 flex flex-col gap-4"
              >
                {/* Provider + model */}
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" /> AI 引擎與模型
                  </label>
                  <select
                    value={aiSettings.provider}
                    onChange={(e) => setAiSettings(prev => ({ ...prev, provider: e.target.value as AISettings['provider'] }))}
                    className="w-full py-2.5 px-3 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-bold text-indigo-700 outline-none focus:border-indigo-500 cursor-pointer hover:bg-zinc-100 transition-all"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="claude">Claude</option>
                    <option value="gemini">Gemini</option>
                  </select>
                  <select
                    value={aiSettings.provider === 'gemini' ? aiSettings.geminiModel :
                           aiSettings.provider === 'openai' ? aiSettings.openaiModel : aiSettings.claudeModel}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAiSettings(prev => ({
                        ...prev,
                        ...(prev.provider === 'gemini' ? { geminiModel: v } :
                            prev.provider === 'openai' ? { openaiModel: v } : { claudeModel: v }),
                      }));
                    }}
                    className="w-full py-2.5 px-3 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-semibold text-zinc-700 outline-none focus:border-indigo-500 cursor-pointer hover:bg-zinc-100 transition-all"
                  >
                    {PROVIDER_MODELS[aiSettings.provider].map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>

                <div className="h-px bg-zinc-100" />

                {/* User-selectable workspace blocks */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                      <LayoutDashboard className="w-3.5 h-3.5" /> 顯示區塊
                    </label>
                    <button
                      type="button"
                      onClick={() => setVisibleBlocks(DEFAULT_VISIBLE_BLOCKS)}
                      className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800"
                    >
                      全部顯示
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([
                      ['voiceControls', '即時逐字稿'],
                      ['timeline', '翻譯紀錄'],
                    ] as [keyof VisibleBlocks, string][]).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleVisibleBlock(key)}
                        aria-pressed={visibleBlocks[key]}
                        className={cn(
                          "px-2.5 py-2 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 transition-colors",
                          visibleBlocks[key]
                            ? "bg-indigo-50 border-indigo-100 text-indigo-700"
                            : "bg-zinc-50 border-zinc-200 text-zinc-400"
                        )}
                      >
                        {visibleBlocks[key] ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[9px] leading-relaxed text-zinc-400">設定會保存在此瀏覽器，下次開啟仍會沿用。</p>
                </div>

                <div className="h-px bg-zinc-100" />

                {/* Actions */}
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={() => { setIsMemoryOpen(true); setIsMenuOpen(false); }}
                    className="w-full px-3 py-2.5 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 font-bold text-xs rounded-xl transition-all flex items-center gap-2 border border-indigo-100"
                  >
                    <Brain className="w-4 h-4 text-indigo-600" /> 記憶設定
                  </button>
                  <button
                    onClick={() => { setIsSettingsOpen(true); setIsMenuOpen(false); }}
                    className="w-full px-3 py-2.5 text-zinc-700 bg-zinc-100 hover:bg-zinc-200 font-bold text-xs rounded-xl transition-all flex items-center gap-2 border border-zinc-200/50"
                  >
                    <Settings className="w-4 h-4" /> 設定（API 金鑰）
                  </button>
                  <button
                    onClick={() => { setIsFullViewOpen(true); setIsMenuOpen(false); }}
                    className="w-full px-3 py-2.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold text-xs rounded-xl transition-all flex items-center gap-2 border border-indigo-100"
                  >
                    <FileText className="w-4 h-4" /> 整頁整理
                  </button>
                  <button
                    onClick={() => { setIsRoomOpen(true); setIsMenuOpen(false); }}
                    className={cn(
                      "w-full px-3 py-2.5 font-bold text-xs rounded-xl transition-all flex items-center gap-2 border",
                      roomId
                        ? "text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-100"
                        : "text-zinc-700 bg-zinc-100 hover:bg-zinc-200 border-zinc-200/50"
                    )}
                  >
                    <Wifi className="w-4 h-4" /> 多裝置連線{roomId ? `（房間 ${roomId} · ${roomMembers.length}）` : ''}
                  </button>
                  <button
                    onClick={() => { handleClear(); setIsMenuOpen(false); }}
                    className="w-full px-3 py-2.5 text-red-500 bg-red-50 hover:bg-red-100 font-bold text-xs rounded-xl transition-all flex items-center gap-2 border border-red-100"
                  >
                    <Trash2 className="w-4 h-4" /> 清除歷史紀錄
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </header>

      {/* Main Split-Screen Workspace */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-visible lg:overflow-hidden max-w-7xl w-full mx-auto">

        {/* Left Side: Live Console (控台) — resizable width on wide screens.
            While recording, it becomes a continuous full-transcript view. */}
        {showLeftPanel && (
        <section
          style={isWideLayout && visibleBlocks.timeline ? { width: leftWidth, flexShrink: 0, flexGrow: 0 } : undefined}
          className={cn(
            "border-b lg:border-b-0 border-zinc-200/80 bg-zinc-50/60 flex flex-col z-10",
            !visibleBlocks.timeline && "flex-1 min-w-0",
            someoneRecording && visibleBlocks.voiceControls
              ? "p-3 sm:p-4 overflow-hidden"
              : "p-3 sm:p-5 lg:p-6 gap-4 lg:gap-5 overflow-visible lg:overflow-y-auto"
          )}
        >

        {someoneRecording && visibleBlocks.voiceControls ? (
          /* ===== Continuous full transcript (recording) ===== */
          <div className="flex flex-col min-h-0 h-[45vh] lg:h-full">
            {/* pr-24 on mobile keeps the stop button clear of the top-right floating header */}
            <div className="flex items-center justify-between mb-3 flex-none pr-24 sm:pr-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                <div className="min-w-0">
                  <h2 className="text-xs font-black text-zinc-500 uppercase tracking-widest truncate">完整逐字稿 · 收音中</h2>
                  {isRecording && recognitionMode !== 'live' && (
                    <p className="text-[10px] font-bold text-emerald-600 mt-0.5">{whisperActivityLabel}</p>
                  )}
                </div>
              </div>
              {isRecording ? (
                <button onClick={() => stopRecording()} className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 flex items-center gap-1">
                  <MicOff className="w-3 h-3" /> 停止本機
                </button>
              ) : (
                <button onClick={() => startRecording()} className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100 flex items-center gap-1">
                  <Mic className="w-3 h-3" /> 本機也收音
                </button>
              )}
            </div>
            <div ref={liveScrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 space-y-2">
              {history.length === 0 && !interimTranscript ? (
                <p className="text-sm text-zinc-300 mt-8 text-center select-none">開始講話，逐字稿會在此連續顯示…</p>
              ) : (
                <>
                  {[...history].reverse().map(h => {
                    if (h.mode === 'whisper') {
                      if (h.hasFinal) return null;
                      return (
                        <div key={h.id} data-seg-id={h.id} className="px-1 -mx-1 py-1 space-y-2">
                          <div className="h-3 bg-zinc-200 rounded-full animate-pulse w-3/4" />
                          <div className="h-3 bg-zinc-200 rounded-full animate-pulse w-1/2" />
                        </div>
                      );
                    }
                    const displayText = h.draftOriginal || h.original;
                    if (!displayText) {
                      if (h.hasFinal) return null;
                      return (
                        <div key={h.id} data-seg-id={h.id} className="px-1 -mx-1 py-1 space-y-2">
                          <div className="h-3 bg-zinc-200 rounded-full animate-pulse w-3/4" />
                          <div className="h-3 bg-zinc-200 rounded-full animate-pulse w-1/2" />
                        </div>
                      );
                    }
                    return (
                      <p
                        key={h.id}
                        data-seg-id={h.id}
                        style={{ fontSize: transFontPx }}
                        className={cn(
                          "leading-relaxed rounded px-1 -mx-1 transition-colors duration-300",
                          highlightedSegId === h.id
                            ? "text-indigo-700 bg-indigo-50 ring-1 ring-indigo-200"
                            : "text-zinc-700"
                        )}
                      >
                        <span className="text-[10px] font-bold text-zinc-400 mr-1.5 align-middle">
                          {h.deviceLabel || deviceLabelRef.current}：
                        </span>
                        {displayText}
                      </p>
                    );
                  })}
                  {/* Live interim text from other recording devices in the room */}
                  {Object.entries(roomLiveTranscripts)
                    .filter(([id, lt]) => id !== deviceIdRef.current && lt.text)
                    .map(([id, lt]) => (
                      <p key={id} style={{ fontSize: transFontPx }} className="leading-relaxed text-blue-500 italic">
                        <span className="text-[10px] font-bold text-blue-300 mr-1.5 align-middle not-italic">
                          {lt.label || '裝置'}：
                        </span>
                        {lt.text}
                      </p>
                    ))
                  }
                  {recognitionMode !== 'whisper' && (liveDraftTranscript.slice(lastDraftLengthRef.current).trim() || interimTranscript) && (
                    <p style={{ fontSize: transFontPx }} className="leading-relaxed text-indigo-500 italic">
                      <span className="text-[10px] font-bold text-indigo-300 mr-1.5 not-italic">{deviceLabelRef.current}：</span>
                      {liveDraftTranscript.slice(lastDraftLengthRef.current).trim()}
                      {liveDraftTranscript.slice(lastDraftLengthRef.current).trim() && interimTranscript ? ' ' : ''}
                      {interimTranscript}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <>
          {visibleBlocks.voiceControls && (
          <>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-ping" />
            <h2 className="text-xs font-black text-zinc-400 uppercase tracking-widest">
              即時聽寫與動態翻譯
            </h2>
          </div>

          {/* Quick Mic Control panel */}
          <div className="bg-white border border-zinc-200/80 rounded-3xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-zinc-400 font-mono">SPEECH INPUT</p>
                <p className="text-sm font-bold text-zinc-800 flex items-center gap-1.5 mt-1">
                  <Globe className="w-4 h-4 text-zinc-500" />
                  發音目標：{activeLangLabel}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={cn(
                  "text-[9px] px-2 py-0.5 rounded-full font-bold",
                  isRecording
                    ? (recognitionMode !== 'live' ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600")
                    : "bg-zinc-100 text-zinc-500"
                )}>
                  {isRecording ? "正在接收..." : "錄音閒置"}
                </span>
                <span className={cn(
                  "text-[9px] px-2 py-0.5 rounded-full font-bold",
                  effectiveTranslateMode === 'browser' && browserTranslatorState === 'available'
                    ? "bg-sky-50 text-sky-700"
                    : "bg-violet-50 text-violet-700"
                )}>
                  {effectiveTranslateMode === 'browser' && browserTranslatorState === 'available'
                    ? '🌐 Chrome 內建翻譯'
                    : effectiveTranslateMode === 'browser'
                      ? '🌐 內建翻譯未就緒'
                      : `✨ ${modelDisplayName(aiSettings.provider, aiSettings.provider === 'gemini' ? aiSettings.geminiModel : aiSettings.provider === 'openai' ? aiSettings.openaiModel : aiSettings.claudeModel)}`}
                </span>
              </div>
            </div>

            {/* Recognition engine toggle */}
            <div className="grid grid-cols-3 gap-0.5 p-0.5 rounded-xl border border-zinc-200 bg-zinc-100 text-[10px] sm:text-[11px] font-extrabold select-none">
              <button
                type="button"
                onClick={() => setRecognitionMode('dual')}
                className={cn(
                  "px-1.5 py-1.5 rounded-lg flex items-center justify-center gap-1 transition-all",
                  recognitionMode === 'dual' ? "bg-white text-violet-700 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                ⚡🎯 雙軌
              </button>
              <button
                type="button"
                onClick={() => setRecognitionMode('live')}
                className={cn(
                  "px-1.5 py-1.5 rounded-lg flex items-center justify-center gap-1 transition-all",
                  recognitionMode === 'live' ? "bg-white text-indigo-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                ⚡ 即時
              </button>
              <button
                type="button"
                onClick={() => setRecognitionMode('whisper')}
                className={cn(
                  "px-1.5 py-1.5 rounded-lg flex items-center justify-center gap-1 transition-all",
                  recognitionMode === 'whisper' ? "bg-white text-emerald-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                🎯 高精準
              </button>
            </div>

            {recognitionMode === 'dual' && (
              <p className="text-[10px] text-violet-600 bg-violet-50 border border-violet-100 rounded-xl p-2.5 leading-relaxed">
                建議模式：左側用 Web Speech 顯示低延遲草稿；右側只採用 Whisper 校正版進行翻譯與正式存檔。
              </p>
            )}

            {recognitionMode !== 'live' && IS_IOS && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[10px] text-amber-700 leading-relaxed">
                ⚠️ iPhone / iPad 目前不支援本機 Whisper。請改用「即時」模式，或在房間中讓桌機負責轉錄。
              </div>
            )}

            {recognitionMode !== 'live' && !IS_IOS && whisperState === 'idle' && (
              <div className="space-y-2">
                <p className="text-[10px] text-zinc-400 leading-relaxed">
                  高精準模式在瀏覽器本機執行 Whisper（口音更準、音訊不離開裝置）。首次需下載約 145MB 模型。
                </p>
                <button
                  onClick={loadWhisperModel}
                  className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
                >
                  ⬇ 下載 Whisper 模型
                </button>
              </div>
            )}

            {recognitionMode !== 'live' && !IS_IOS && whisperState === 'loading' && (
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-bold text-zinc-500">
                  <span>模型下載中…首次較久請稍候</span><span>{whisperProgress}%</span>
                </div>
                <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-600 transition-all duration-300" style={{ width: `${whisperProgress}%` }} />
                </div>
              </div>
            )}

            {recognitionMode !== 'live' && !IS_IOS && whisperState === 'error' && (
              <button onClick={loadWhisperModel} className="text-[11px] font-bold text-red-600 underline self-start">
                模型載入失敗，點此重試
              </button>
            )}

            {/* Kinetic visual wave when recording — colour-coded by engine
                (live = indigo, Whisper high-accuracy = emerald). */}
            {isRecording && (
              <div className="flex items-center justify-center gap-1 py-1.5 bg-zinc-50 rounded-xl border border-zinc-100">
                <span className={cn("w-1.5 h-4 rounded-full animate-bounce [animation-delay:-0.4s]", recognitionMode !== 'live' ? "bg-emerald-500" : "bg-indigo-500")} />
                <span className={cn("w-1.5 h-6 rounded-full animate-bounce [animation-delay:-0.2s]", recognitionMode !== 'live' ? "bg-emerald-600" : "bg-indigo-600")} />
                <span className={cn("w-1.5 h-8 rounded-full animate-bounce", recognitionMode !== 'live' ? "bg-emerald-600" : "bg-indigo-600")} />
                <span className={cn("w-1.5 h-5 rounded-full animate-bounce [animation-delay:-0.3s]", recognitionMode !== 'live' ? "bg-emerald-500" : "bg-indigo-500")} />
                <span className="w-1.5 h-3 bg-zinc-300 rounded-full animate-bounce [animation-delay:-0.1s]" />
              </div>
            )}

            {/* Action record toggle button */}
            {(() => {
              // In a room we capture+relay (no local model needed); only solo
              // Whisper must wait for the model before recording.
              const whisperBusy = recognitionMode === 'whisper' && !roomId && !IS_IOS && whisperState !== 'ready';
              return (
                <button
                  onClick={toggleRecording}
                  disabled={whisperBusy}
                  className={cn(
                    "w-full py-4 px-6 rounded-2xl transition-all duration-300 flex items-center justify-center gap-3 font-bold text-sm shadow-sm border",
                    whisperBusy
                      ? "bg-zinc-200 text-zinc-400 border-zinc-200 cursor-not-allowed"
                      : isRecording
                        ? "bg-red-500 hover:bg-red-600 text-white border-red-600 shadow-md shadow-red-100"
                        : recognitionMode !== 'live'
                          ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700 shadow-lg shadow-emerald-100"
                          : "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-700 shadow-lg shadow-indigo-100"
                  )}
                >
                  {whisperBusy ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>{whisperState === 'error' ? 'Whisper 載入失敗' : 'Whisper 載入中…'}</span>
                    </>
                  ) : isRecording ? (
                    <>
                      <MicOff className="w-5 h-5 animate-pulse" />
                      <span>停止聽寫 & 儲存此句</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-5 h-5" />
                      <span>{recognitionMode === 'dual' ? '開始雙軌辨識' : recognitionMode === 'whisper' ? '開啟麥克風（高精準）' : '開啟麥克風 開始錄音'}</span>
                    </>
                  )}
                </button>
              );
            })()}

            {/* Real-time Listening Transcript Section — only the live (Web Speech)
                engine streams interim words; Whisper transcribes per utterance. */}
            {(recognitionMode === 'live' || recognitionMode === 'dual') && (isRecording || interimTranscript || liveDraftTranscript) && (
              <div className="mt-3 p-3.5 bg-zinc-50 border border-zinc-200/60 rounded-2xl space-y-2 animate-fade-in">
                <div className="flex items-center gap-2">
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                  </span>
                  <span className="text-[10px] font-black uppercase text-zinc-400 tracking-wider font-mono flex items-center gap-1">
                    {recognitionMode === 'dual' ? '左側即時草稿（不送翻譯）' : '即時收錄中 (Live listening...)'}
                  </span>
                </div>
                <div className="text-xs text-zinc-800 leading-relaxed font-sans italic break-words min-h-[24px]">
                  {liveDraftTranscript || interimTranscript ? (
                    <span className="text-zinc-900 font-semibold not-italic">
                      <span className="text-[10px] text-zinc-400 mr-1.5">{deviceLabelRef.current}：</span>
                      {liveDraftTranscript}{liveDraftTranscript && interimTranscript ? ' ' : ''}{interimTranscript}
                    </span>
                  ) : (
                    <span className="text-zinc-400 animate-pulse">請開始講話，即時轉錄文字會顯示在此處...</span>
                  )}
                </div>
              </div>
            )}

            {/* Whisper has no streaming interim — show a listening hint instead. */}
            {recognitionMode !== 'live' && isRecording && (
              <div className="mt-3 p-3 bg-indigo-50/50 border border-indigo-100 rounded-2xl flex items-center gap-2.5 animate-fade-in">
                <span className="flex h-2 w-2 relative shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                </span>
                <span className="text-[11px] text-zinc-500 font-medium leading-relaxed">
                  {whisperActivityLabel}。講完一句並停頓約 {Math.max(0.2, whisperPauseMs / 1000).toFixed(1)} 秒後會自動切句；完成後會繼續收音。
                </span>
              </div>
            )}
          </div>

          </>
          )}

          {/* Transcript history — always visible for cross-panel highlight */}
          {history.length > 0 && (
            <div ref={liveScrollRef} className="overflow-y-auto max-h-[35vh] space-y-1 -mx-1">
              {[...history].reverse().map(h => {
                if (h.mode === 'whisper') {
                  if (h.hasFinal) return null;
                  return (
                    <div key={h.id} data-seg-id={h.id} className="px-2 py-1 space-y-2">
                      <div className="h-3 bg-zinc-200 rounded-full animate-pulse w-3/4" />
                      <div className="h-3 bg-zinc-200 rounded-full animate-pulse w-1/2" />
                    </div>
                  );
                }
                const displayText = h.draftOriginal || h.original;
                if (!displayText) {
                  if (h.hasFinal) return null;
                  return (
                    <div key={h.id} data-seg-id={h.id} className="px-2 py-1 space-y-2">
                      <div className="h-3 bg-zinc-200 rounded-full animate-pulse w-3/4" />
                      <div className="h-3 bg-zinc-200 rounded-full animate-pulse w-1/2" />
                    </div>
                  );
                }
                return (
                  <p
                    key={h.id}
                    data-seg-id={h.id}
                    style={{ fontSize: transFontPx }}
                    className={cn(
                      "leading-relaxed px-2 py-0.5 rounded-lg transition-colors duration-300 cursor-default",
                      highlightedSegId === h.id
                        ? "text-indigo-700 bg-indigo-50 ring-1 ring-indigo-200"
                        : "text-zinc-500"
                    )}
                  >
                    <span className="text-[10px] font-bold text-zinc-400 mr-1.5 align-middle">
                      {h.deviceLabel || deviceLabelRef.current}：
                    </span>
                    {displayText}
                  </p>
                );
              })}
            </div>
          )}

          {/* Browser Speech Compatibility Tips */}
          {speechErrorDetected && (
            <div className="bg-amber-50/80 border border-amber-200/60 p-4 rounded-3xl text-[11px] text-amber-800 leading-relaxed shadow-sm">
              💡 <strong>麥克風/語音連線提示：</strong>
              <span className="block mt-1">偵測到語音輸入限制（{speechErrorDetected === 'network' ? '網路語音服務中斷' : speechErrorDetected}）。請依上方錯誤提示檢查 HTTPS、網站麥克風權限及其他錄音程式；也可暫時使用手動輸入。</span>
            </div>
          )}
          </>
        )}
        </section>
        )}

        {/* Draggable divider — only when both panels are visible */}
        {isWideLayout && showLeftPanel && visibleBlocks.timeline && (
          <div
            onMouseDown={startPanelDrag}
            role="separator"
            aria-orientation="vertical"
            title="拖曳調整左右寬度"
            className="hidden lg:flex shrink-0 w-1.5 cursor-col-resize group relative items-center justify-center bg-zinc-200/70 hover:bg-indigo-400 transition-colors"
          >
            <div className="absolute flex items-center justify-center w-4 h-10 rounded-md bg-white border border-zinc-200 shadow-sm group-hover:border-indigo-400 transition-colors">
              <GripVertical className="w-3.5 h-3.5 text-zinc-400 group-hover:text-indigo-500" />
            </div>
          </div>
        )}

        {/* Right Side: Finalized Timeline (對話時間軸歷史記錄) */}
        {visibleBlocks.timeline && (
        <section className="flex-1 min-w-0 min-h-[65vh] lg:min-h-0 bg-white p-3 sm:p-3.5 md:p-4.5 lg:pt-9 flex flex-col overflow-hidden relative">
          
          <div className="flex-none flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 border-b border-zinc-100 pb-2">
            <div>
              <h2 className="text-sm font-bold text-zinc-805 flex items-center gap-1.5">
                <ListChecks className="w-4 h-4 text-indigo-600" />
                {recognitionMode === 'dual' ? 'Whisper 校正版與翻譯' : '課堂與會議歷史逐字稿'}
              </h2>
              <p className="text-[10px] text-zinc-400 mt-0.5">
                {recognitionMode === 'dual'
                  ? '右側只接收 Whisper 高精準結果；左側即時草稿不會送入翻譯或正式存檔'
                  : '點擊上方錄音，已翻譯完成的每個完整段落將在下方獨立存檔'}
              </p>
            </div>
            
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              {/* Chinese translation font size */}
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg border border-zinc-200 bg-zinc-100 select-none" title="調整中文翻譯字級">
                <button
                  type="button"
                  onClick={() => setTransSizeIdx(i => Math.max(0, i - 1))}
                  disabled={transSizeIdx === 0}
                  aria-label="縮小翻譯字級"
                  className="px-1.5 py-1 rounded-md text-[11px] font-extrabold text-zinc-500 hover:text-indigo-600 disabled:opacity-30 transition-colors"
                >
                  A−
                </button>
                <span className="text-[10px] font-extrabold text-indigo-600 min-w-[1.6rem] text-center">{TRANS_FONT_SIZES[transSizeIdx].label}</span>
                <button
                  type="button"
                  onClick={() => setTransSizeIdx(i => Math.min(TRANS_FONT_SIZES.length - 1, i + 1))}
                  disabled={transSizeIdx === TRANS_FONT_SIZES.length - 1}
                  aria-label="放大翻譯字級"
                  className="px-1.5 py-1 rounded-md text-[14px] font-extrabold text-zinc-500 hover:text-indigo-600 disabled:opacity-30 transition-colors"
                >
                  A+
                </button>
              </div>

              <span className="text-[10px] font-mono text-zinc-400 bg-zinc-100 px-2.5 py-1.5 rounded-lg font-bold">
                共計：{history.length} 個片段
              </span>
            </div>
          </div>

          <div 
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-2.5"
          >
            {history.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-zinc-300 text-center">
                <FileText className="w-14 h-14 mb-3 opacity-25" />
                <p className="text-sm font-semibold text-zinc-400">尚無完整的翻譯記錄</p>
                <p className="text-[11px] text-zinc-400 max-w-sm mt-1 px-8">
                  開始錄音並朗讀英文，每當您暫停一秒或說完一句，AI 將會把完整的對照記錄累積展示在此處，您可以非常流暢地一邊看最新翻譯、一邊閱讀上面的舊歷史。
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {history.map((entry) => {
                  const isEditing = editingId === entry.id;
                  const isProcessing = !entry.hasFinal;
                  const hasDraftComparison = entry.hasFinal && !!entry.draftOriginal;
                  const isWhisperProcessing = entry.mode === 'dual' && entry.status === 'whisper-processing';
                  const mainOriginal = isWhisperProcessing
                    ? (entry.draftOriginal || entry.original || '')
                    : (entry.original || entry.draftOriginal || '');
                  const mainTranslated = isWhisperProcessing
                    ? (entry.draftTranslated || entry.translated || '等待翻譯')
                    : (entry.translated ?? (isProcessing ? entry.draftTranslated : undefined));
                  const toggleComparison = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    setHistory(prev => prev.map(h => h.id === entry.id ? { ...h, showingDraft: !h.showingDraft } : h));
                  };
                  return (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={() => {
                        setHighlightedSegId(entry.id);
                        const el = document.querySelector(`[data-seg-id="${entry.id}"]`);
                        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        setTimeout(() => setHighlightedSegId(null), 2500);
                      }}
                      className={cn(
                        "group/entry transition-all cursor-pointer rounded-xl shadow-sm overflow-hidden border",
                        isProcessing
                          ? "border-amber-200 border-l-4 border-l-amber-400"
                          : hasDraftComparison
                            ? "border-indigo-200 border-l-4 border-l-indigo-500"
                            : "border-zinc-100 hover:border-zinc-200"
                      )}
                    >
                      {/* Card header: timestamp + status badge + actions */}
                      <div className={cn(
                        "flex items-center justify-between px-3 py-1.5 border-b",
                        isProcessing ? "bg-amber-50/60 border-amber-100" : "bg-zinc-50/60 border-zinc-100"
                      )}>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-zinc-400">
                            {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          <span className={cn(
                            "text-[9px] font-bold px-1.5 py-0.5 rounded-md",
                            !entry.deviceId || entry.deviceId === deviceIdRef.current
                              ? "bg-indigo-50 text-indigo-600"
                              : "bg-emerald-50 text-emerald-600"
                          )}>{entry.deviceLabel || deviceLabelRef.current}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {isProcessing ? (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-1 select-none">
                              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse inline-block" />
                              {entry.status === 'translating'
                                ? '翻譯處理中'
                                : entry.mode === 'live'
                                  ? '翻譯處理中'
                                  : 'Whisper 處理中'}
                            </span>
                          ) : hasDraftComparison ? (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 select-none">
                              🎯 Whisper 精準版
                            </span>
                          ) : null}
                          {!isEditing && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingId(entry.id); setEditingText(entry.original); }}
                              className="text-zinc-300 hover:text-indigo-500 p-0.5 rounded hover:bg-zinc-100 transition-colors opacity-0 group-hover/entry:opacity-100"
                              title="手動修正英文內容"
                            >
                              <Edit className="w-3 h-3" />
                            </button>
                          )}
                          {mainTranslated && (
                            <button
                              onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(mainTranslated!); addToast('複製成功！', 'success'); }}
                              className="text-zinc-300 hover:text-indigo-500 p-0.5 rounded hover:bg-zinc-100 transition-colors opacity-0 group-hover/entry:opacity-100"
                              title="複製翻譯結果"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Main 2-column content */}
                      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-zinc-100">
                        {/* English column */}
                        <div className="p-2.5 md:p-3 space-y-1.5">
                          <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest select-none">
                            English{hasDraftComparison ? ' · Whisper' : ''}
                          </p>
                          {isEditing ? (
                            <div className="space-y-1.5">
                              <textarea
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                className="w-full min-h-[70px] p-2 bg-zinc-50 border border-zinc-200 rounded-lg text-xs outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all resize-y font-sans leading-relaxed shadow-inner"
                                placeholder="在此修改英文聽寫內容..."
                              />
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => handleSaveSegmentEdit(entry.id)}
                                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[9px] rounded-md transition-all flex items-center gap-1 shadow-sm"
                                >
                                  <Check className="w-2.5 h-2.5" />
                                  儲存並重新翻譯
                                </button>
                                <button
                                  onClick={() => { setEditingId(null); setEditingText(''); }}
                                  className="px-2 py-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 font-bold text-[9px] rounded-md transition-all"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-zinc-700 text-[13.5px] leading-relaxed">
                              {mainOriginal || <span className="text-zinc-300 italic text-xs">處理中…</span>}
                            </p>
                          )}
                        </div>

                        {/* Translation column */}
                        <div className="p-2.5 md:p-3 space-y-1.5">
                          <p className="text-[9px] font-bold text-indigo-600 uppercase tracking-widest select-none">Translation (TW)</p>
                          {mainTranslated ? (
                            <div className="space-y-1">
                              <p style={{ fontSize: transFontPx }} className="text-zinc-900 leading-relaxed font-bold">{mainTranslated}</p>
                              {!isProcessing && entry.translatedBy && (
                                <span className="text-[9px] text-zinc-400 font-medium select-none">{entry.translatedBy}</span>
                              )}
                              {isProcessing && (
                                <span className="text-[9px] text-amber-500 font-medium select-none">
                                  {entry.mode === 'dual' ? '⚡ 初步翻譯（等待 Whisper）' : '依設定翻譯中'}
                                </span>
                              )}
                            </div>
                          ) : entry.mode === 'dual' ? (
                            <p style={{ fontSize: transFontPx }} className="text-zinc-500 leading-relaxed font-bold">
                              等待翻譯
                            </p>
                          ) : (
                            <div className="flex items-center gap-1.5 text-indigo-400 font-medium py-1">
                              <div className="flex gap-1">
                                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></span>
                              </div>
                              <span className="text-[11.5px] italic">
                                {entry.status === 'translating' || entry.mode === 'live' ? '翻譯中...' : 'Whisper 處理中...'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Draft comparison expandable section */}
                      {hasDraftComparison && (
                        <>
                          <button
                            onClick={toggleComparison}
                            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-zinc-400 hover:text-zinc-600 border-t border-zinc-100 hover:bg-zinc-50/80 transition-colors select-none"
                          >
                            <span className="text-[8px]">{entry.showingDraft ? '▲' : '▼'}</span>
                            {entry.showingDraft ? '收起即時草稿比對' : '查看即時草稿比對'}
                            <span className="ml-auto text-[9px] font-normal text-zinc-300 normal-case">Web Speech + 瀏覽器翻譯</span>
                          </button>
                          {entry.showingDraft && (
                            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-amber-100 border-t border-amber-100 bg-amber-50/40">
                              <div className="p-2.5 md:p-3 space-y-1">
                                <p className="text-[9px] font-bold text-amber-600 uppercase tracking-widest select-none">⚡ 即時草稿 (Web Speech)</p>
                                <p className="text-amber-900/80 text-[13px] leading-relaxed">{entry.draftOriginal}</p>
                              </div>
                              <div className="p-2.5 md:p-3 space-y-1">
                                <p className="text-[9px] font-bold text-amber-600 uppercase tracking-widest select-none">⚡ 瀏覽器翻譯</p>
                                {entry.draftTranslated ? (
                                  <p style={{ fontSize: transFontPx }} className="text-amber-900/80 leading-relaxed font-bold">{entry.draftTranslated}</p>
                                ) : (
                                  <p className="text-amber-300 italic text-xs">—</p>
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Floating Scroll to Top button */}
          <AnimatePresence>
            {showScrollTop && (
              <motion.button
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 15 }}
                onClick={scrollToTop}
                className={cn(
                  "absolute bottom-4 right-4 z-50 px-3.5 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-lg transition-all border",
                  hasNewItems 
                    ? "bg-indigo-600 border-indigo-700 text-white hover:bg-indigo-700 shadow-indigo-100 animate-bounce" 
                    : "bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50 shadow-zinc-100/50"
                )}
                title="回到最頂端閱讀新內容"
              >
                <ArrowUp className="w-3.5 h-3.5" />
                {hasNewItems ? "✨ 回到頂端 (有新譯文)" : "回到最頂端"}
              </motion.button>
            )}
          </AnimatePresence>
        </section>
        )}

        {!showLeftPanel && !visibleBlocks.timeline && (
          <div className="flex-1 min-h-[60vh] flex items-center justify-center p-6">
            <div className="max-w-sm text-center bg-white border border-zinc-200 rounded-3xl p-6 shadow-sm">
              <EyeOff className="w-10 h-10 mx-auto text-zinc-300 mb-3" />
              <h2 className="font-extrabold text-zinc-700">目前所有區塊都已隱藏</h2>
              <p className="text-xs text-zinc-400 mt-1 mb-4">可從右上角選單重新選擇要顯示的工作區塊。</p>
              <button
                type="button"
                onClick={() => setVisibleBlocks(DEFAULT_VISIBLE_BLOCKS)}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700"
              >
                恢復預設顯示
              </button>
            </div>
          </div>
        )}

      </main>

      {/* MULTI-DEVICE ROOM MODAL */}
      <AnimatePresence>
        {isRoomOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setIsRoomOpen(false)}
            className="fixed inset-0 z-[200] bg-zinc-950/40 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
            >
              <div className="p-4 sm:p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-md font-extrabold text-zinc-800 flex items-center gap-2">
                    <Wifi className="w-5 h-5 text-indigo-600" /> 多裝置即時連線
                  </h2>
                  <button onClick={() => setIsRoomOpen(false)} className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded-lg hover:bg-zinc-100">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {!isFirebaseConfigured() ? (
                  <div className="space-y-3">
                    <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-[11.5px] text-amber-800 leading-relaxed space-y-1.5">
                      <p className="font-bold">啟用多裝置連線需要你自己的 Firebase（一次性設定，免費）：</p>
                      <p>1. 到 <span className="font-mono">console.firebase.google.com</span> 建立專案</p>
                      <p>2. 「建構 → Realtime Database」→ 建立資料庫（測試模式）</p>
                      <p>3. 專案設定 → 你的應用程式 → 點 <span className="font-mono">&lt;/&gt;</span> 註冊 Web App</p>
                      <p>4. 把它給的整段 <span className="font-mono">firebaseConfig = {`{...}`}</span> 貼到下面</p>
                    </div>
                    <textarea
                      value={fbConfigInput}
                      onChange={(e) => setFbConfigInput(e.target.value)}
                      placeholder={'貼上整段，例如：\nconst firebaseConfig = {\n  apiKey: "AIza...",\n  databaseURL: "https://xxx.firebasedatabase.app",\n  ...\n};'}
                      rows={7}
                      className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl text-[11px] font-mono outline-none focus:border-indigo-500 resize-none"
                    />
                    <button
                      onClick={() => {
                        const cfg = parseFirebaseConfig(fbConfigInput);
                        if (!cfg) {
                          addToast('解析失敗：請確認貼上的內容含 apiKey 與 databaseURL（需先建立 Realtime Database）。', 'error');
                          return;
                        }
                        saveFirebaseConfig(cfg);
                        addToast('Firebase 設定已儲存，重新整理套用…', 'success');
                        setTimeout(() => window.location.reload(), 800);
                      }}
                      className="w-full px-3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl"
                    >
                      儲存並啟用
                    </button>
                  </div>
                ) : roomId ? (
                  <div className="space-y-4">
                    <div className="text-center p-4 rounded-2xl bg-zinc-50 border border-zinc-200">
                      <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">房間代碼</p>
                      <p className="text-3xl font-black text-indigo-600 tracking-widest mt-1">{roomId}</p>
                      <div className="flex items-center justify-center gap-1.5 mt-2 text-[11px] font-bold">
                        <span className={cn("inline-block w-1.5 h-1.5 rounded-full", roomConnected ? "bg-green-500" : "bg-zinc-300")} />
                        <span className={roomConnected ? "text-green-600" : "text-zinc-400"}>{roomConnected ? "已連線" : "連線中…"}</span>
                      </div>
                    </div>

                    <div className="flex flex-col items-center gap-2">
                      <img
                        alt="加入房間 QR"
                        className="w-40 h-40 rounded-xl border border-zinc-200 bg-white"
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`${window.location.origin}${window.location.pathname}?room=${roomId}`)}`}
                      />
                      <p className="text-[11px] text-zinc-500">手機掃描 QR，或用下方連結加入</p>
                    </div>

                    <button
                      onClick={() => {
                        const link = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
                        navigator.clipboard.writeText(link);
                        addToast('已複製分享連結', 'success');
                      }}
                      className="w-full px-3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2"
                    >
                      <Copy className="w-4 h-4" /> 複製分享連結
                    </button>

                    {/* Translation method — the room creator decides for everyone */}
                    <div>
                      <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">
                        翻譯方式{isRoomCreatorRef.current ? '（你是房主，可調整）' : '（由房主決定）'}
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {(['ai', 'browser'] as TranslateMode[]).map((m) => {
                          const label = m === 'ai' ? 'AI 翻譯' : '瀏覽器內建';
                          const active = effectiveTranslateMode === m;
                          const editable = isRoomCreatorRef.current;
                          return (
                            <button
                              key={m}
                              type="button"
                              disabled={!editable}
                              onClick={() => chooseRoomTranslateMode(m)}
                              className={cn(
                                "px-2 py-2 rounded-xl border text-[11px] font-bold transition-all",
                                active ? "bg-indigo-600 border-indigo-700 text-white" : "bg-white border-zinc-200 text-zinc-600",
                                editable ? "hover:bg-zinc-50" : "opacity-90 cursor-default"
                              )}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                      {effectiveTranslateMode === 'browser' && !browserAvail && (
                        <p className="text-[10px] text-amber-600 mt-1">⚠️ 本機瀏覽器不支援內建翻譯;需房間內有支援的裝置(較新版 Chrome)才會翻。</p>
                      )}
                      {effectiveTranslateMode === 'browser' && browserTranslatorState !== 'available' && browserAvail && (
                        <p className="text-[10px] text-amber-600 mt-1">
                          {browserTranslatorState === 'downloading'
                            ? `正在準備內建翻譯語言包${browserTranslatorProgress ? `（${browserTranslatorProgress}%）` : '…'}`
                            : '內建翻譯尚未啟用，請由房主再點一次「瀏覽器內建」。'}
                        </p>
                      )}
                    </div>

                    <div>
                      <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" /> 已連線裝置（{roomMembers.length}）
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {roomMembers.length === 0 ? (
                          <span className="text-[11px] text-zinc-400">尚無其他裝置，請在另一台開啟連結</span>
                        ) : roomMembers.map(m => {
                          const isSelf = m.id === deviceIdRef.current;
                          return (
                            <div key={m.id} className={cn(
                              "flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border",
                              isSelf ? "bg-indigo-50 border-indigo-100" : "bg-zinc-50 border-zinc-200"
                            )}>
                              <span className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-700 min-w-0 flex-wrap">
                                <span className={cn("inline-block w-1.5 h-1.5 rounded-full shrink-0", m.recording ? "bg-red-500 animate-pulse" : "bg-zinc-300")} />
                                <span className="truncate">{m.label}{isSelf ? '（本機）' : ''}</span>
                                <span className="text-[10px] font-normal text-zinc-400">{m.recording ? '收音中' : '閒置'}</span>
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-500 whitespace-nowrap">
                                  {m.recMode === 'dual' ? '⚡🎯 雙軌' : m.recMode === 'whisper' ? '🎯 高精準' : '⚡ 即時'}
                                </span>
                                {m.hasKey && (
                                  <span className={cn(
                                    "text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap",
                                    activeTranslator?.id === m.id ? "bg-indigo-600 text-white" : "bg-zinc-200 text-zinc-500"
                                  )}>
                                    {m.provider === 'browser' ? '🌐 Chrome 內建' : `🔑 ${m.provider === 'openai' ? 'OpenAI' : m.provider === 'claude' ? 'Claude' : m.provider === 'gemini' ? 'Gemini' : '金鑰'}`}
                                    {activeTranslator?.id === m.id ? ' · 翻譯中' : ''}
                                  </span>
                                )}
                              </span>
                              {!isSelf && (
                                m.recording ? (
                                  <button
                                    onClick={() => sendCommand(roomId, m.id, 'stop', deviceLabelRef.current)}
                                    className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-md border text-red-600 bg-red-50 border-red-100 hover:bg-red-100 transition-colors"
                                  >
                                    ⏹ 停止
                                  </button>
                                ) : (
                                  <div className="flex gap-1 shrink-0">
                                    <button
                                      onClick={() => sendCommand(roomId, m.id, 'start', deviceLabelRef.current, 'dual')}
                                      title="遙控此裝置用雙軌模式收音"
                                      className="text-[10px] font-bold px-1.5 py-1 rounded-md border text-violet-700 bg-violet-50 border-violet-100 hover:bg-violet-100 transition-colors"
                                    >
                                      ⚡🎯
                                    </button>
                                    <button
                                      onClick={() => sendCommand(roomId, m.id, 'start', deviceLabelRef.current, 'live')}
                                      title="遙控此裝置用即時模式收音"
                                      className="text-[10px] font-bold px-1.5 py-1 rounded-md border text-indigo-600 bg-indigo-50 border-indigo-100 hover:bg-indigo-100 transition-colors"
                                    >
                                      ⚡ 即時
                                    </button>
                                    <button
                                      onClick={() => sendCommand(roomId, m.id, 'start', deviceLabelRef.current, 'whisper')}
                                      title="遙控此裝置用高精準(Whisper)模式收音"
                                      className="text-[10px] font-bold px-1.5 py-1 rounded-md border text-emerald-700 bg-emerald-50 border-emerald-100 hover:bg-emerald-100 transition-colors"
                                    >
                                      🎯 高精準
                                    </button>
                                  </div>
                                )
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {activeTranscriber ? (
                        <p className="text-[10px] mt-2 leading-relaxed px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 font-bold">
                          🎯 轉錄由 {activeTranscriber.label}{activeTranscriber.id === deviceIdRef.current ? '（本機）' : ''} 負責（高精準模式收音的音訊會送它用 Whisper 轉文字）
                        </p>
                      ) : (
                        <p className="text-[10px] mt-2 leading-relaxed px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 font-bold">
                          ⚠️ 房間內沒有可轉錄的裝置。請在一台桌機/筆電上把引擎切到「🎯 高精準」並等模型載入,它就會成為轉錄者(手機高精準收音才有文字)。
                        </p>
                      )}
                      {activeTranslator ? (
                        <p className="text-[10px] mt-1.5 leading-relaxed px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 font-bold">
                          目前翻譯由 {activeTranslator.label}{activeTranslator.id === deviceIdRef.current ? '（本機）' : ''} 提供
                          （{activeTranslator.provider === 'browser' ? 'Chrome 內建翻譯' : activeTranslator.provider === 'openai' ? 'OpenAI' : activeTranslator.provider === 'claude' ? 'Claude' : activeTranslator.provider === 'gemini' ? 'Gemini' : '金鑰'}）
                        </p>
                      ) : (
                        <p className="text-[10px] mt-2 leading-relaxed px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 font-bold">
                          ⚠️ 房間內目前沒有任何裝置提供 API 金鑰，內容會收錄但無法翻譯。請至少一台在「設定」填入金鑰。
                        </p>
                      )}
                      <p className="text-[10px] text-zinc-400 mt-1.5 leading-relaxed">提示：可在這裡遠端控制另一台裝置開始/停止收音。</p>
                    </div>

                    <button onClick={() => { leaveRoom(); }} className="w-full px-3 py-2.5 text-red-500 bg-red-50 hover:bg-red-100 font-bold text-xs rounded-xl border border-red-100">
                      離開房間
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-[12px] text-zinc-500 leading-relaxed">
                      建立一個房間，手機和電腦加入同一個房間後，兩邊都能收音，內容會即時同步並標明來源裝置。
                    </p>
                    <button onClick={createRoom} className="w-full px-3 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl flex items-center justify-center gap-2">
                      <Wifi className="w-4 h-4" /> 建立新房間
                    </button>
                    <div className="flex items-center gap-2">
                      <div className="h-px flex-1 bg-zinc-100" /><span className="text-[10px] text-zinc-400">或加入現有房間</span><div className="h-px flex-1 bg-zinc-100" />
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={joinCodeInput}
                        onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                        placeholder="輸入房間代碼"
                        className="flex-1 p-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-mono tracking-widest outline-none focus:border-indigo-500"
                      />
                      <button
                        onClick={() => { if (joinCodeInput.trim()) { joinRoom(joinCodeInput); setJoinCodeInput(''); } }}
                        className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-900 text-white font-bold text-xs rounded-xl"
                      >
                        加入
                      </button>
                    </div>
                  </div>
                )}

                {isFirebaseConfigured() && !roomId && (
                  <button
                    onClick={() => {
                      clearFirebaseConfig();
                      addToast('已清除 Firebase 設定，重新整理…', 'info');
                      setTimeout(() => window.location.reload(), 600);
                    }}
                    className="text-[10px] text-zinc-400 hover:text-red-500 underline self-start"
                  >
                    重新設定 / 更換 Firebase
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SYSTEM SETTINGS MODAL / DIALOG */}
      <AnimatePresence>
        {isSettingsOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-zinc-950/40 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-xl rounded-3xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]"
            >
              {/* Header */}
              <div className="flex-none p-4 sm:p-6 border-b border-zinc-100 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-indigo-600 animate-pulse" />
                  <div>
                    <h2 className="text-md font-extrabold text-zinc-800">系統即時翻譯與 AI 引擎設定</h2>
                    <p className="text-[10px] text-zinc-400 mt-0.5 font-normal">配置預設語音口音、自訂 API 金鑰和模型運算核心</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded-xl hover:bg-zinc-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Toggle Subtabs */}
              <div className="flex-none px-3 sm:px-6 py-2 bg-zinc-50/50 border-b border-zinc-100 flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setSettingsTab('speech')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-xs font-black transition-all",
                    settingsTab === 'speech' ? "bg-white text-indigo-600 shadow-sm border border-zinc-200/50" : "text-zinc-500 hover:text-zinc-700"
                  )}
                >
                  🎙️ 預設語音口音
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsTab('ai')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-xs font-black transition-all",
                    settingsTab === 'ai' ? "bg-white text-indigo-600 shadow-sm border border-zinc-200/50" : "text-zinc-500 hover:text-zinc-700"
                  )}
                >
                  ✨ AI 引擎與 API 金鑰選擇
                </button>
              </div>

              {/* Forms Body scrollable */}
              <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-5 custom-scrollbar">
                
                {settingsTab === 'speech' ? (
                  <div className="space-y-4">
                    {/* Target dialiect accent manually selecting */}
                    <div>
                      <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                        錄音口音預設 (Preselected Accent/Dialect)
                      </label>
                      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
                        {LANGUAGES.map((lang) => (
                          <button
                            key={lang.code}
                            type="button"
                            onClick={() => {
                              setSelectedLang(lang.code);
                              addToast(`預設檢索口音已改為：${lang.label}`, 'info');
                            }}
                            className={cn(
                              "px-3 py-2.5 rounded-xl border text-xs font-bold flex items-center gap-2.5 transition-all",
                              selectedLang === lang.code 
                                ? "bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm"
                                : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                            )}
                          >
                            <span className="text-sm">{lang.flag}</span>
                            <span>{lang.label}</span>
                            {selectedLang === lang.code && <Check className="w-3.5 h-3.5 ml-auto text-indigo-600" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Auto-switch recognition accent toggle */}
                    <div className="flex items-start justify-between gap-3 p-3.5 rounded-2xl border border-zinc-200 bg-zinc-50/60">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-zinc-700">自動切換辨識口音</p>
                        <p className="text-[11px] text-zinc-500 leading-relaxed mt-0.5">
                          錄音中若 AI 以高信心（≥80%）判斷你講的是其他口音，會自動把辨識引擎切到該口音，讓後續更聽得準。
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={autoSwitchAccent}
                        onClick={() => setAutoSwitchAccent(v => !v)}
                        className={cn(
                          "shrink-0 mt-0.5 w-11 h-6 rounded-full p-0.5 transition-colors",
                          autoSwitchAccent ? "bg-indigo-600" : "bg-zinc-300"
                        )}
                      >
                        <span className={cn(
                          "block w-5 h-5 rounded-full bg-white shadow transition-transform",
                          autoSwitchAccent ? "translate-x-5" : "translate-x-0"
                        )} />
                      </button>
                    </div>

                    {/* Whisper (high-accuracy) capture parameters */}
                    <div className="p-3.5 rounded-2xl border border-zinc-200 bg-zinc-50/60 space-y-3">
                      <p className="text-xs font-bold text-zinc-700">🎯 高精準（Whisper）收音參數</p>

                      <p className="text-[10px] text-zinc-400 -mt-1">由 Silero VAD 偵測語音切句。調整需重新開始收音才套用。</p>
                      <div>
                        <div className="flex justify-between text-[11px] font-bold text-zinc-500">
                          <span>語音偵測門檻（越低越靈敏）</span><span>{vadThreshold.toFixed(2)}</span>
                        </div>
                        <input type="range" min={0.2} max={0.8} step={0.05} value={vadThreshold}
                          onChange={(e) => setVadThreshold(Number(e.target.value))}
                          className="w-full accent-indigo-600" />
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] font-bold text-zinc-500">
                          <span>停頓多久算一句斷句</span><span>{whisperPauseMs} ms</span>
                        </div>
                        <input type="range" min={300} max={2000} step={50} value={whisperPauseMs}
                          onChange={(e) => setWhisperPauseMs(Number(e.target.value))}
                          className="w-full accent-indigo-600" />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-zinc-500 mb-1">辨識模型（越大越準、下載越大越慢）</label>
                        <select value={whisperModel} onChange={(e) => setWhisperModel(e.target.value)}
                          className="w-full p-2 bg-white border border-zinc-200 rounded-xl text-xs outline-none focus:border-indigo-500">
                          <option value="Xenova/whisper-tiny">Tiny（最快 · ~75MB）</option>
                          <option value="Xenova/whisper-base">Base（推薦 · ~145MB）</option>
                          <option value="Xenova/whisper-small">Small（最準 · ~480MB）</option>
                        </select>
                        <p className="text-[10px] text-zinc-400 mt-1">更換模型會重新下載並重載。</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => { setVadThreshold(0.5); setWhisperPauseMs(700); }}
                        className="text-[11px] font-bold text-indigo-600 underline"
                      >
                        回復預設值
                      </button>
                    </div>

                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Translation method */}
                    <div>
                      <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                        翻譯方式 {roomId && '（已連房間，實際以房主設定為準）'}
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {(['ai', 'browser'] as TranslateMode[]).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => chooseSoloTranslateMode(m)}
                            className={cn(
                              "px-2 py-2.5 rounded-xl border text-xs font-bold transition-all",
                              translateMode === m ? "bg-indigo-600 border-indigo-700 text-white shadow-sm" : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                            )}
                          >
                            {m === 'ai' ? 'AI 翻譯' : '瀏覽器內建'}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-zinc-400 mt-1.5 leading-relaxed">
                        {translateMode === 'browser'
                          ? browserTranslatorState === 'available'
                            ? '✅ Chrome 內建翻譯已就緒（免金鑰、裝置端處理，不會呼叫 AI API）。'
                            : browserTranslatorState === 'downloading'
                              ? `正在下載或載入英翻中語言包${browserTranslatorProgress ? `（${browserTranslatorProgress}%）` : '…'}`
                              : browserAvail
                                ? '⚠️ 尚未啟用。請再點一次「瀏覽器內建」，由點擊動作授權建立語言包。'
                                : '⚠️ 此裝置不支援；目前僅支援新版桌面版 Chrome，不支援手機瀏覽器。'
                          : '使用下方選擇的 AI 引擎與金鑰翻譯（含口音特徵分析）。'}
                      </p>
                    </div>

                    {/* Provider selecting */}
                    <div>
                      <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                        即時翻譯大語言模型運算核心 (API Provider)
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {(['gemini', 'openai', 'claude'] as const).map((provider) => (
                          <button
                            key={provider}
                            type="button"
                            onClick={() => setAiSettings(prev => ({ ...prev, provider }))}
                            className={cn(
                              "py-3 rounded-2xl border text-xs font-extrabold flex flex-col items-center gap-1.5 transition-all uppercase tracking-wider",
                              aiSettings.provider === provider 
                                ? "bg-indigo-600 border-indigo-700 text-white shadow-lg shadow-indigo-100"
                                : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                            )}
                          >
                            <span>
                              {provider === 'gemini' ? 'Google' : provider === 'openai' ? 'OpenAI' : 'Claude'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="h-px bg-zinc-100 my-2" />

                    {/* Rendering dynamic fields depending on provider */}
                    {aiSettings.provider === 'gemini' && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-bold text-zinc-500 mb-1.5 flex items-center gap-1.5">
                            <Key className="w-3.5 h-3.5 text-zinc-400" />
                            自訂 Google Gemini API Key (選填)
                          </label>
                          <input
                            type="password"
                            placeholder="如果不設定，將預設使用系統免費提供的 Gemini 專用引擎"
                            value={aiSettings.geminiKey}
                            onChange={(e) => setAiSettings(prev => ({ ...prev, geminiKey: e.target.value }))}
                            className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl text-xs outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-zinc-500 mb-1.5">
                            指定 Gemini 運算模型 (Model)
                          </label>
                          <select
                            value={aiSettings.geminiModel}
                            onChange={(e) => setAiSettings(prev => ({ ...prev, geminiModel: e.target.value }))}
                            className="w-full p-3 bg-white border border-zinc-200 rounded-xl text-xs outline-none focus:border-indigo-500 shadow-sm"
                          >
                            {PROVIDER_MODELS.gemini.map((m) => (
                              <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {aiSettings.provider === 'openai' && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-bold text-zinc-500 mb-1.5 flex items-center gap-1.5">
                            <Key className="w-3.5 h-3.5 text-zinc-400" />
                            自訂 OpenAI API Key (必填)
                          </label>
                          <input
                            type="password"
                            placeholder="sk-..."
                            value={aiSettings.openaiKey}
                            onChange={(e) => setAiSettings(prev => ({ ...prev, openaiKey: e.target.value }))}
                            className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl text-xs outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-zinc-500 mb-1.5">
                            指定 OpenAI 運算模型 (Model)
                          </label>
                          <select
                            value={aiSettings.openaiModel}
                            onChange={(e) => setAiSettings(prev => ({ ...prev, openaiModel: e.target.value }))}
                            className="w-full p-3 bg-white border border-zinc-200 rounded-xl text-xs outline-none focus:border-indigo-500 shadow-sm"
                          >
                            {PROVIDER_MODELS.openai.map((m) => (
                              <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {aiSettings.provider === 'claude' && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-bold text-zinc-500 mb-1.5 flex items-center gap-1.5">
                            <Key className="w-3.5 h-3.5 text-zinc-400" />
                            自訂 Anthropic Claude API Key (必填)
                          </label>
                          <input
                            type="password"
                            placeholder="sk-ant-..."
                            value={aiSettings.claudeKey}
                            onChange={(e) => setAiSettings(prev => ({ ...prev, claudeKey: e.target.value }))}
                            className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl text-xs outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-zinc-500 mb-1.5">
                            指定 Claude 運算模型 (Model)
                          </label>
                          <select
                            value={aiSettings.claudeModel}
                            onChange={(e) => setAiSettings(prev => ({ ...prev, claudeModel: e.target.value }))}
                            className="w-full p-3 bg-white border border-zinc-200 rounded-xl text-xs outline-none focus:border-indigo-500 shadow-sm"
                          >
                            {PROVIDER_MODELS.claude.map((m) => (
                              <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    <div className="p-3 bg-zinc-50 rounded-2xl border border-zinc-150 text-[10px] text-zinc-400 leading-normal">
                      🔒 隱私與安全性保障：所有自訂 API 金鑰均僅保存在您的本地瀏覽器快取 (Local Storage) 中。每次發送翻譯與摘要時，將在您的裝置本地直接與 API 接口對接，完全不經過任何第三方雲端伺服器，安全無虞、绝不外洩。
                    </div>

                  </div>
                )}

              </div>

              {/* Footer */}
              <div className="flex-none p-4 bg-zinc-50 border-t border-zinc-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsOpen(false);
                    addToast('設定儲存成功', 'success');
                  }}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-100 transition-colors"
                >
                  確認保存設定
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SESSION MEMORY SETTINGS MODAL / DIALOG */}
      <AnimatePresence>
        {isMemoryOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-zinc-950/40 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-xl rounded-3xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]"
            >
              {/* Header */}
              <div className="flex-none p-4 sm:p-6 border-b border-zinc-100 flex items-center justify-between gap-3 bg-zinc-50/50">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 bg-indigo-50 rounded-xl flex items-center justify-center border border-indigo-100">
                    <Brain className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold text-zinc-805">課堂與對話主題記憶大綱設定</h2>
                    <p className="text-[10px] text-zinc-400 font-normal mt-0.5">配置英中縮音與專業學術/科技名詞對照記憶（100% 獨立自適應）</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsMemoryOpen(false)}
                  className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded-xl hover:bg-zinc-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Body */}
              <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-5 custom-scrollbar bg-white">
                
                {/* Live AI Recommendation Panel */}
                {(() => {
                  const fullSpeechText = history.map(h => h.original).join(' ') + ' ' + liveDraftTranscript + ' ' + interimTranscript;
                  const { recommendedId, matchedWords } = analyzeSessionMemory(fullSpeechText);
                  const recPreset = CONTEXT_PRESETS.find(p => p.id === recommendedId);
                  const currentPreset = CONTEXT_PRESETS.find(p => p.text === sessionContext);
                  
                  if (!fullSpeechText.trim()) {
                    return (
                      <div className="bg-zinc-50 border border-zinc-100 p-4 rounded-2xl flex items-center gap-3">
                        <span className="text-lg">✨</span>
                        <p className="text-[11px] text-zinc-500 leading-normal">
                          <strong>系統探針：</strong> 正在開啟麥克風聽寫等待接收。當您開始說話或貼上文本，AI 將自動辨識內容特徵並在此推薦最適切的口音名詞記憶！
                        </p>
                      </div>
                    );
                  }

                  if (recPreset) {
                    const isAlreadySelected = currentPreset && currentPreset.id === recommendedId;
                    return (
                      <div className={cn(
                        "p-4 rounded-2xl border flex flex-col gap-2.5 transition-all",
                        isAlreadySelected 
                          ? "bg-emerald-50/50 border-emerald-200/60" 
                          : "bg-indigo-50/75 border-indigo-200/60"
                      )}>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase tracking-wider text-indigo-700 flex items-center gap-1">
                            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                            智慧推薦特徵 (Smart Recommendation)
                          </span>
                          <span className={cn(
                            "text-[9px] px-2 py-0.5 rounded-full font-bold border",
                            isAlreadySelected 
                              ? "bg-emerald-100/60 text-emerald-700 border-emerald-200" 
                              : "bg-indigo-100 text-indigo-700 border-indigo-200"
                          )}>
                            {isAlreadySelected ? "目前使用中" : "強烈推薦套用"}
                          </span>
                        </div>
                        
                        <div>
                          <p className="text-xs text-zinc-705 leading-relaxed font-semibold">
                            系統在累積的英語對白中，比對到了「<strong>{matchedWords.join(', ')}</strong>」等關鍵術語。
                          </p>
                          <p className="text-[11px] text-zinc-400 mt-1 leading-normal">
                            建議口音與專業名詞記憶：<strong>{recPreset.icon} {recPreset.label}</strong>（{recPreset.text.substring(0, 50)}...）
                          </p>
                        </div>

                        {!isAlreadySelected && (
                          <button
                            type="button"
                            onClick={() => {
                              setSessionContext(recPreset.text);
                              addToast(`已成功套用系統推薦：${recPreset.label}`, 'success');
                            }}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[11px] py-2 px-4 rounded-xl transition-all shadow-md shadow-indigo-100 flex items-center justify-center gap-1.5 self-start"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>一鍵套用此推薦記憶</span>
                          </button>
                        )}
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* Preset List Selection */}
                <div>
                  <label className="block text-xs font-bold text-zinc-450 uppercase tracking-wider mb-2.5">
                    快速選擇內建對白主題記憶模組 (Standard Memories)
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {CONTEXT_PRESETS.map((preset) => {
                      const isSelected = sessionContext === preset.text;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            setSessionContext(preset.text);
                            addToast(`已切換至主題背景：${preset.label}`, 'success');
                          }}
                          className={cn(
                            "p-3 rounded-2xl border text-left transition-all flex items-start gap-3 relative overflow-hidden group/item",
                            isSelected 
                              ? "bg-indigo-50 border-indigo-500 ring-2 ring-indigo-500/10" 
                              : "bg-zinc-50 hover:bg-zinc-100/50 border-zinc-200"
                          )}
                        >
                          <span className="text-2xl leading-none">{preset.icon}</span>
                          <div className="space-y-0.5">
                            <span className="text-xs font-bold text-zinc-800 flex items-center gap-1.5">
                              {preset.label}
                            </span>
                            <p className="text-[10px] text-zinc-500 leading-relaxed font-normal line-clamp-2">
                              {preset.text}
                            </p>
                          </div>
                          {isSelected && (
                            <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-indigo-600 flex items-center justify-center">
                              <Check className="w-2.5 h-2.5 text-white" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="h-px bg-zinc-100" />

                {/* Customized text box */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold text-zinc-450 uppercase tracking-wider">
                      ✍️ 自訂獨立大綱與背景名詞記憶段落 (Custom Memory)
                    </label>
                    <button
                      onClick={() => {
                        setSessionContext('');
                        addToast('大綱背景記憶已完整擦除', 'info');
                      }}
                      className="text-[9px] font-bold text-zinc-400 hover:text-red-500 transition-colors uppercase"
                    >
                      清空記憶
                    </button>
                  </div>
                  <textarea
                    placeholder="在此貼上或自由編寫自訂專屬課堂/會議大綱背景。例如：特定專有名詞縮讀對照、講者個人背景引言、或是期待翻譯時加強特定用詞等..."
                    value={sessionContext}
                    onChange={(e) => setSessionContext(e.target.value)}
                    className="w-full h-28 p-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl text-xs outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all font-sans leading-relaxed shadow-inner placeholder:text-zinc-450"
                  />
                  <span className="block text-[10px] text-zinc-400 mt-1 leading-normal">
                    💡 提示：在上方自訂或選擇好背景大綱後，AI 會自動在每次接收錄音時，將該大綱載入至語意神經網絡中，這能有效提高縮語、口音特色以及在特定情境下的名詞精準比對深度。
                  </span>
                </div>

              </div>

              {/* Footer */}
              <div className="flex-none p-4 bg-zinc-50 border-t border-zinc-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setIsMemoryOpen(false);
                    addToast('大綱記憶配置成功', 'success');
                  }}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-100 transition-colors"
                >
                  確認保存設定
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FULL TRANSCIPT VIEW & SUMMARY MODAL */}
      <AnimatePresence>
        {isFullViewOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-zinc-950/40 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-4xl h-full max-h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="flex-none p-6 border-b border-zinc-100">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-zinc-800">課堂/對話內容總整理報告</h2>
                    <p className="text-xs text-zinc-400 mt-1 block">
                      {sessionContext ? `主題大綱背景：${sessionContext}` : '未配置大綱主題背景'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        const content = activeTab === 'transcript' ? getFullTranscript() : summary;
                        navigator.clipboard.writeText(content);
                        addToast(`已複製${activeTab === 'transcript' ? '全文' : '摘要'}內容`, 'success');
                      }}
                      className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-100"
                    >
                      <Copy className="w-4 h-4" />
                      複製{activeTab === 'transcript' ? '全文' : '摘要'}
                    </button>
                    <button 
                      onClick={() => setIsFullViewOpen(false)}
                      className="p-2 text-zinc-400 hover:text-zinc-600 transition-colors"
                    >
                      <X className="w-6 h-6" />
                    </button>
                  </div>
                </div>

                <div className="flex bg-zinc-100 p-1 rounded-xl w-fit">
                  <button 
                    onClick={() => setActiveTab('transcript')}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2",
                      activeTab === 'transcript' ? "bg-white text-indigo-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                    )}
                  >
                    <FileText className="w-4 h-4" />
                    中英對照逐字稿
                  </button>
                  <button 
                    onClick={() => {
                      setActiveTab('summary');
                      if (!summary) generateSummary();
                    }}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2",
                      activeTab === 'summary' ? "bg-white text-indigo-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                    )}
                  >
                    <Sparkles className="w-4 h-4" />
                    AI 重點精煉摘要
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 md:p-10 bg-zinc-50/30">
                {activeTab === 'transcript' ? (
                  <div className="space-y-8">
                    {history.length === 0 ? (
                      <div className="h-40 flex flex-col items-center justify-center text-zinc-300">
                        <FileText className="w-16 h-16 mb-4 opacity-20" />
                        <p>目前尚無錄音歷史內容</p>
                      </div>
                    ) : (
                      [...history].reverse().map((entry) => (
                        <div key={entry.id} className="space-y-3">
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] font-mono text-zinc-400 bg-zinc-100 px-2 py-1 rounded">
                              {new Date(entry.timestamp).toLocaleTimeString()}
                            </span>
                            <div className="h-px flex-1 bg-zinc-100" />
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-6">
                            <p className="text-zinc-600 leading-relaxed text-sm">{entry.original}</p>
                            <p style={{ fontSize: transFontPx }} className="text-zinc-900 font-bold leading-relaxed">{entry.translated || '...'}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="max-w-2xl mx-auto">
                    {isSummarizing ? (
                      <div className="flex flex-col items-center justify-center h-40 text-indigo-500 gap-4">
                        <motion.div 
                          animate={{ rotate: 360 }}
                          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        >
                          <Sparkles className="w-12 h-12 animate-pulse" />
                        </motion.div>
                        <p className="text-sm font-bold animate-pulse">正在精煉對話重點中，請稍候...</p>
                      </div>
                    ) : summary ? (
                      <div className="prose prose-zinc prose-indigo max-w-none">
                        <div className="bg-white p-8 rounded-3xl border border-zinc-100 shadow-sm whitespace-pre-wrap leading-relaxed text-zinc-800">
                          {summary}
                        </div>
                        <button 
                          onClick={generateSummary}
                          className="mt-6 text-zinc-400 hover:text-indigo-600 transition-colors text-xs font-bold flex items-center gap-2 mx-auto"
                        >
                          <ArrowRightLeft className="w-3 h-3" />
                          重新產生本堂摘要
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-40 text-zinc-300 gap-4">
                        <ListChecks className="w-12 h-12 opacity-20" />
                        <p>點擊上方標籤開始生成摘要</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              <div className="flex-none p-4 bg-zinc-50 border-t border-zinc-100 text-center">
                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">
                  End of Transcript · SwiftTranscript Lightning ⚡
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e2e2e7;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #d1d1d6;
        }
      `}</style>
    </div>
  );
}
