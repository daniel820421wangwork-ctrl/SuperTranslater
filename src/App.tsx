import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { 
  Languages, Copy, Check, Info, Zap, Trash2, 
  ArrowRightLeft, Mic, MicOff, XCircle, StopCircle, 
  FileText, X, Sparkles, ListChecks, Sliders, Settings, Key, Globe, Brain, RefreshCw,
  Edit, ArrowUp, Menu, GripVertical, Wifi, Users
} from 'lucide-react';
import { cn } from './lib/utils';
import { isFirebaseConfigured, parseFirebaseConfig, saveFirebaseConfig, clearFirebaseConfig } from './firebaseConfig';
import {
  pushSegment, updateSegment, clearRoomSegments, subscribeSegments,
  joinPresence, leavePresence, subscribeMembers, subscribeConnection,
  setMemberRecording, setMemberMeta, sendCommand, subscribeCommand,
  setRoomConfig, subscribeRoomConfig,
} from './roomSync';
import { browserTranslate, browserTranslateAvailable } from './browserTranslate';

type TranslateMode = 'ai' | 'browser';

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
  const [history, setHistory] = useState<{id: string, original: string, translated?: string, timestamp: number, deviceLabel?: string, deviceId?: string, translatedBy?: string}[]>([]);
  
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
  const [manualInputText, setManualInputText] = useState('');
  const [speechErrorDetected, setSpeechErrorDetected] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [hasNewItems, setHasNewItems] = useState(false);
  const [isCompact, setIsCompact] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // Adjustable Chinese-translation font size (index into TRANS_FONT_SIZES).
  const [transSizeIdx, setTransSizeIdx] = useState<number>(() => {
    const n = Number(localStorage.getItem('swift_trans_font_idx'));
    return Number.isInteger(n) && n >= 0 && n < TRANS_FONT_SIZES.length ? n : 0;
  });
  // When on, a high-confidence accent detection auto-switches the recognition locale.
  const [autoSwitchAccent, setAutoSwitchAccent] = useState<boolean>(
    () => localStorage.getItem('swift_auto_switch_accent') !== 'false'
  );

  // Recognition engine: 'live' = browser Web Speech (instant), 'whisper' = in-browser Whisper (accurate).
  const [recognitionMode, setRecognitionMode] = useState<'live' | 'whisper'>(
    () => (localStorage.getItem('swift_recognition_mode') === 'whisper' ? 'whisper' : 'live')
  );
  const [whisperState, setWhisperState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [whisperProgress, setWhisperProgress] = useState(0);

  const whisperWorkerRef = useRef<Worker | null>(null);
  const whisperReadyRef = useRef(false);
  const progressByFileRef = useRef<Record<string, { loaded: number; total: number }>>({});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioNodesRef = useRef<{ source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode } | null>(null);
  const whisperBufRef = useRef<Float32Array[]>([]);
  const whisperHasSpeechRef = useRef(false);
  const whisperLastVoiceRef = useRef(0);
  const whisperJobRef = useRef(0);

  // ===== Multi-device room sync =====
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomMembers, setRoomMembers] = useState<{ id: string; label: string; recording: boolean; hasKey: boolean; provider: string }[]>([]);
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
  const isRoomCreatorRef = useRef(false);
  const deviceIdRef = useRef<string>(getDeviceId());
  const deviceLabelRef = useRef<string>(detectDeviceLabel());
  const roomUnsubsRef = useRef<Array<() => void>>([]);

  // Resizable left panel width (px), only used in the wide horizontal layout.
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

  // Track whether we're in the side-by-side (lg) layout so the drag handle
  // and fixed pixel width only apply there; on mobile it stacks vertically.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = (e: MediaQueryListEvent) => setIsWideLayout(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    localStorage.setItem('swift_left_panel_width', String(leftWidth));
  }, [leftWidth]);

  useEffect(() => {
    localStorage.setItem('swift_auto_switch_accent', String(autoSwitchAccent));
  }, [autoSwitchAccent]);

  useEffect(() => {
    localStorage.setItem('swift_trans_font_idx', String(transSizeIdx));
  }, [transSizeIdx]);

  const transFontPx = TRANS_FONT_SIZES[transSizeIdx].px;

  // Drag the divider to resize the left console panel.
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
  }, [recognitionMode]);

  useEffect(() => {
    localStorage.setItem('swift_translate_mode', translateMode);
  }, [translateMode]);

  // The mode actually in effect: in a room the creator's choice wins.
  const effectiveTranslateMode: TranslateMode = roomId ? (roomTranslateMode || 'ai') : translateMode;
  const effectiveTranslateModeRef = useRef(effectiveTranslateMode);
  useEffect(() => { effectiveTranslateModeRef.current = effectiveTranslateMode; });

  // Push a finished transcript chunk into the timeline and translate it.
  // Shared by both the Web Speech and Whisper engines. In a multi-device room
  // the segment is published to Firebase (and rendered via the room listener);
  // solo, it goes straight into local state.
  const commitSegment = useCallback((text: string) => {
    const clean = text.trim();
    if (!clean) return;
    if (roomIdRef.current && isFirebaseConfigured()) {
      // Publish the raw segment; whichever device in the room holds an API key
      // (the active translator) picks it up and fills in the translation.
      pushSegment(roomIdRef.current, {
        original: clean, translated: null,
        deviceId: deviceIdRef.current, deviceLabel: deviceLabelRef.current, ts: Date.now(),
      });
    } else {
      const segmentId = Math.random().toString(36).substring(7);
      setHistory(prev => [{ id: segmentId, original: clean, timestamp: Date.now() }, ...prev]);
      const mode = effectiveTranslateModeRef.current;
      if (mode === 'browser') {
        browserTranslate(clean)
          .then(t => setHistory(prev => prev.map(h => h.id === segmentId ? { ...h, translated: t, translatedBy: transLabelFor('browser', null) } : h)))
          .catch(() => setHistory(prev => prev.map(h => h.id === segmentId ? { ...h, translated: '[翻譯失敗，此瀏覽器不支援內建翻譯]' } : h)));
      } else {
        const label = transLabelFor('ai', keyInfoRef.current);
        Promise.resolve(translateSegmentRef.current(clean, segmentId))
          .then(() => setHistory(prev => prev.map(h => h.id === segmentId ? { ...h, translatedBy: label } : h)));
      }
    }
  }, []);

  // ===== Multi-device room join / leave =====
  const leaveRoom = useCallback(() => {
    roomUnsubsRef.current.forEach((fn) => { try { fn(); } catch {} });
    roomUnsubsRef.current = [];
    if (roomIdRef.current) leavePresence(roomIdRef.current, deviceIdRef.current);
    roomIdRef.current = null;
    isRoomCreatorRef.current = false;
    setRoomId(null);
    setRoomMembers([]);
    setRoomConnected(false);
    setRoomTranslateMode(null);
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
        }];
        next.sort((a, b) => b.timestamp - a.timestamp);
        return next;
      }),
      (key, seg) => setHistory(prev => prev.map(h => h.id === key ? { ...h, translated: seg.translated ?? h.translated, translatedBy: seg.translatedBy ?? h.translatedBy } : h)),
    );
    const offMembers = subscribeMembers(id, setRoomMembers);
    const offConn = subscribeConnection(setRoomConnected);
    const offConfig = subscribeRoomConfig(id, (cfg) => {
      setRoomTranslateMode(cfg?.translateMode === 'browser' ? 'browser' : 'ai');
    });
    roomUnsubsRef.current = [offSeg, offMembers, offConn, offConfig];
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
        addToast('🎯 高精準模式就緒（Whisper 已載入）', 'success');
      } else if (msg.type === 'error') {
        whisperReadyRef.current = false;
        setWhisperState('error');
        addToast(`Whisper 載入失敗：${msg.error || '未知錯誤'}`, 'error');
      } else if (msg.type === 'result') {
        if (msg.text) commitSegment(msg.text);
      }
    };
    whisperWorkerRef.current = worker;
    return worker;
  }, [addToast, commitSegment]);

  const loadWhisperModel = useCallback(() => {
    if (whisperReadyRef.current) { setWhisperState('ready'); return; }
    const worker = ensureWhisperWorker();
    progressByFileRef.current = {};
    setWhisperProgress(0);
    setWhisperState('loading');
    const device = (navigator as any).gpu ? 'webgpu' : 'wasm';
    worker.postMessage({ type: 'load', model: WHISPER_MODEL, device });
  }, [ensureWhisperWorker]);

  // Cut the current utterance buffer and send it to Whisper.
  const flushWhisperUtterance = useCallback(() => {
    const chunks = whisperBufRef.current;
    whisperBufRef.current = [];
    whisperHasSpeechRef.current = false;
    if (!chunks.length || !audioCtxRef.current || !whisperReadyRef.current) return;
    const merged = concatFloat32(chunks);
    const audio = resampleTo16k(merged, audioCtxRef.current.sampleRate);
    if (audio.length < WHISPER_SAMPLE_RATE * 0.3) return; // ignore <0.3s blips
    const id = ++whisperJobRef.current;
    const lang = selectedLang.startsWith('en') ? 'english' : 'english';
    whisperWorkerRef.current?.postMessage({ type: 'transcribe', id, audio, language: lang }, [audio.buffer]);
  }, [selectedLang]);

  const stopWhisperRecording = useCallback(() => {
    shouldKeepRecordingRef.current = false;
    isActualRecordingRef.current = false;
    setIsRecording(false);
    setInterimTranscript('');
    if (audioNodesRef.current) {
      try { audioNodesRef.current.processor.disconnect(); } catch {}
      try { audioNodesRef.current.source.disconnect(); } catch {}
      audioNodesRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    // flush any trailing speech before tearing down
    flushWhisperUtterance();
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
  }, [flushWhisperUtterance]);

  const startWhisperRecording = useCallback(async () => {
    if (!whisperReadyRef.current) {
      addToast('Whisper 尚未載入完成，請稍候片刻再開始。', 'info');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      audioNodesRef.current = { source, processor };

      whisperBufRef.current = [];
      whisperHasSpeechRef.current = false;
      whisperLastVoiceRef.current = performance.now();

      processor.onaudioprocess = (ev: AudioProcessingEvent) => {
        const input = ev.inputBuffer.getChannelData(0);
        whisperBufRef.current.push(new Float32Array(input));
        const now = performance.now();
        const loud = frameRms(input) > 0.012;
        if (loud) { whisperHasSpeechRef.current = true; whisperLastVoiceRef.current = now; }

        const bufferedSamples = whisperBufRef.current.reduce((n, c) => n + c.length, 0);
        const bufferedSec = bufferedSamples / ctx.sampleRate;
        const silentFor = now - whisperLastVoiceRef.current;
        // Cut on a natural pause (after real speech), or force-cut a long run.
        if ((whisperHasSpeechRef.current && silentFor > 700 && bufferedSec > 0.6) || bufferedSec > 18) {
          flushWhisperUtterance();
        }
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      shouldKeepRecordingRef.current = true;
      isActualRecordingRef.current = true;
      setIsRecording(true);
      setSpeechErrorDetected(null);
    } catch (err) {
      console.error('Whisper mic error', err);
      addToast('麥克風啟動失敗，請至下方手動輸入欄。', 'error');
      stopWhisperRecording();
    }
  }, [addToast, flushWhisperUtterance, stopWhisperRecording]);

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
          commitSegment(finalText);
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
        setIsRecording(false);
        isActualRecordingRef.current = false;
      };

      recognition.onend = () => {
        isActualRecordingRef.current = false;
        setInterimTranscript('');
        // If the session ended mid-sentence, the un-finalized tail would be lost
        // — commit it so we don't drop those words.
        if (lastInterimRef.current.trim()) {
          commitSegment(lastInterimRef.current);
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
        setIsRecording(false);
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
    if (isActualRecordingRef.current) {
      try { rec.stop(); } catch (e) { console.warn('lang switch restart failed', e); }
    }
  }, [selectedLang]);

  // Switching engine: stop whatever is recording, and lazily load Whisper.
  useEffect(() => {
    if (isActualRecordingRef.current) {
      shouldKeepRecordingRef.current = false;
      try { recognitionRef.current?.stop(); } catch {}
      stopWhisperRecording();
    }
    if (recognitionMode === 'whisper' && !whisperReadyRef.current) {
      loadWhisperModel();
    }
  }, [recognitionMode, loadWhisperModel, stopWhisperRecording]);

  // Tear down the Whisper worker and audio graph on unmount.
  useEffect(() => () => {
    try { stopWhisperRecording(); } catch {}
    whisperWorkerRef.current?.terminate();
    whisperWorkerRef.current = null;
  }, [stopWhisperRecording]);

  const startRecording = useCallback(() => {
    if (isActualRecordingRef.current) return;
    if (recognitionMode === 'whisper') { startWhisperRecording(); return; }
    if (!recognitionRef.current) {
      addToast('您的瀏覽器不支援語音辨識功能。推薦使用下方的「手動鍵盤輸入」！');
      return;
    }
    try {
      setError(null);
      setSpeechErrorDetected(null);
      shouldKeepRecordingRef.current = true; // keep recording across auto-ends
      recognitionRef.current.start();
    } catch (err) {
      if (err instanceof Error && err.message.includes('already started')) {
        setIsRecording(true);
        isActualRecordingRef.current = true;
        return;
      }
      console.error('Start recognition error:', err);
      shouldKeepRecordingRef.current = false;
      setSpeechErrorDetected('start-failed');
      setIsRecording(false);
      isActualRecordingRef.current = false;
      addToast('麥克風啟動失敗，請至下方手動輸入欄進行法醫比對與翻譯。');
    }
  }, [recognitionMode, startWhisperRecording, addToast]);

  const stopRecording = useCallback(() => {
    if (recognitionMode === 'whisper') { stopWhisperRecording(); return; }
    if (isActualRecordingRef.current && recognitionRef.current) {
      try {
        shouldKeepRecordingRef.current = false; // user-initiated stop: don't auto-restart
        recognitionRef.current.stop();
      } catch (err) {
        console.error('Stop recognition error:', err);
      }
    }
  }, [recognitionMode, stopWhisperRecording]);

  const toggleRecording = () => {
    if (isActualRecordingRef.current) stopRecording(); else startRecording();
  };

  // Keep live refs so the room command listener always calls the current fns.
  const startRecordingRef = useRef(startRecording);
  const stopRecordingRef = useRef(stopRecording);
  useEffect(() => { startRecordingRef.current = startRecording; stopRecordingRef.current = stopRecording; });

  // Report this device's recording state to the room.
  useEffect(() => {
    if (roomId) setMemberRecording(roomId, deviceIdRef.current, isRecording);
  }, [isRecording, roomId]);

  // Obey start/stop commands sent from other devices in the room.
  useEffect(() => {
    if (!roomId) return;
    let lastTs = Date.now();
    const unsub = subscribeCommand(roomId, deviceIdRef.current, (cmd) => {
      if (cmd.ts <= lastTs) return; // ignore the pre-existing/stale command
      lastTs = cmd.ts;
      if (cmd.action === 'start') {
        startRecordingRef.current();
        addToast(`${cmd.from} 要求本機開始收音`, 'info');
      } else if (cmd.action === 'stop') {
        stopRecordingRef.current();
        addToast(`${cmd.from} 要求本機停止收音`, 'info');
      }
    });
    return () => unsub();
  }, [roomId, addToast]);

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
    const sys = 'You are a professional translator. Translate the English into natural, fluent Traditional Chinese (Taiwan style). Return ONLY the translated Chinese — no quotes, no JSON, no explanation.';
    if (info.provider === 'openai') return (await callOpenAI(info.key, info.model, text, sys)).trim();
    if (info.provider === 'claude') return (await callClaude(info.key, info.model, text, sys)).trim();
    const client = getGeminiClient(info.key);
    const r = await client.models.generateContent({ model: info.model, contents: text, config: { systemInstruction: sys } });
    return (r.text || '').trim();
  }, [getGeminiClient]);

  // Whether this device can serve as the room's translator under the current
  // mode: AI needs a key; browser needs Translator API support; off needs none.
  const browserAvail = useMemo(() => browserTranslateAvailable(), []);
  const deviceCanTranslate = effectiveTranslateMode === 'browser' ? browserAvail : hasUsableKey;

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
      if ((h.translated === undefined || h.translated === null || h.translated === '') && !translatingKeysRef.current.has(h.id)) {
        translatingKeysRef.current.add(h.id);
        const segId = h.id;
        const job = mode === 'browser' ? browserTranslate(h.original)
          : (info ? translateWith(info, h.original) : Promise.reject(new Error('no key')));
        const src = transLabelFor(mode, mode === 'browser' ? null : info);
        job
          .then((t) => { if (roomIdRef.current) updateSegment(roomIdRef.current, segId, { translated: t || '[翻譯失敗]', translatedBy: src }); })
          .catch((e) => {
            console.error('room translate failed', e);
            if (roomIdRef.current) updateSegment(roomIdRef.current, segId, { translated: '[翻譯失敗，請檢查翻譯設定/金鑰]' });
          })
          .finally(() => translatingKeysRef.current.delete(segId));
      }
    }
  }, [history, activeTranslator, translateWith, effectiveTranslateMode]);

  const submitManualText = async () => {
    const text = manualInputText.trim();
    if (!text) {
      addToast('請輸入要翻譯與分析的英文文本。', 'info');
      return;
    }

    // Route through commitSegment so it syncs to the room when connected.
    setManualInputText('');
    commitSegment(text);
    addToast('已送出，正在翻譯與口音比對…', 'info');
  };

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

  // When any device (local or remote) is recording, the left panel switches to
  // a continuous full-transcript view.
  const someoneRecording = isRecording || roomMembers.some(m => m.recording);
  useEffect(() => {
    if (someoneRecording && liveScrollRef.current) {
      liveScrollRef.current.scrollTop = liveScrollRef.current.scrollHeight;
    }
  }, [history, interimTranscript, someoneRecording]);

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-zinc-900 font-sans selection:bg-indigo-100 selection:text-indigo-900 flex flex-col h-screen overflow-hidden">
      
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

      {/* Top Application Header (slim bar + hamburger menu) */}
      <header className="bg-white border-b border-zinc-200 px-4 sm:px-6 py-3 shadow-sm z-40 flex-none relative">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-100 flex-shrink-0">
              <Zap className="w-5 h-5 text-white fill-white animate-pulse" />
            </div>
            <div>
              <h1 className="text-md font-extrabold tracking-tight text-zinc-800 flex items-center gap-1.5">
                SwiftTranscript <span className="text-indigo-600 font-bold">⚡</span>
              </h1>
              <p className="text-[10px] text-zinc-400 font-medium">即時法醫級語音翻譯與口音特徵比對器</p>
            </div>
          </div>

          {/* Hamburger trigger */}
          <button
            onClick={() => setIsMenuOpen((v) => !v)}
            aria-label="開啟選單"
            aria-expanded={isMenuOpen}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-all",
              isMenuOpen
                ? "bg-indigo-600 border-indigo-700 text-white shadow-md"
                : "bg-zinc-100 border-zinc-200 text-zinc-700 hover:bg-zinc-200"
            )}
          >
            {isMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            <span className="hidden sm:inline">選單</span>
          </button>
        </div>

        {/* Dropdown menu — all header controls live here */}
        <AnimatePresence>
          {isMenuOpen && (
            <>
              {/* click-away backdrop */}
              <div className="fixed inset-0 z-40" onClick={() => setIsMenuOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className="absolute right-4 sm:right-6 top-full mt-2 w-[min(92vw,320px)] bg-white border border-zinc-200 rounded-2xl shadow-2xl z-50 p-4 flex flex-col gap-4"
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
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden max-w-7xl w-full mx-auto">

        {/* Left Side: Live Console (控台) — resizable width on wide screens.
            While recording, it becomes a continuous full-transcript view. */}
        <section
          style={isWideLayout ? { width: leftWidth } : undefined}
          className={cn(
            "w-full shrink-0 border-b lg:border-b-0 border-zinc-200/80 bg-zinc-50/60 flex flex-col z-10",
            someoneRecording ? "p-4 overflow-hidden" : "p-6 gap-5 overflow-y-auto"
          )}
        >

        {someoneRecording ? (
          /* ===== Continuous full transcript (recording) ===== */
          <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center justify-between mb-3 flex-none">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                <h2 className="text-xs font-black text-zinc-500 uppercase tracking-widest truncate">完整逐字稿 · 收音中</h2>
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
                  {[...history].reverse().map(h => (
                    <p key={h.id} style={{ fontSize: transFontPx }} className="leading-relaxed text-zinc-700">
                      {h.deviceLabel && <span className="text-[10px] font-bold text-zinc-400 mr-1.5 align-middle">{h.deviceLabel}</span>}
                      {h.original}
                    </p>
                  ))}
                  {interimTranscript && (
                    <p style={{ fontSize: transFontPx }} className="leading-relaxed text-indigo-500 italic">{interimTranscript}</p>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
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
              <span className={cn(
                "text-[9px] px-2 py-0.5 rounded-full font-bold",
                isRecording
                  ? (recognitionMode === 'whisper' ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600")
                  : "bg-zinc-100 text-zinc-500"
              )}>
                {isRecording ? "正在接收..." : "錄音閒置"}
              </span>
            </div>

            {/* Recognition engine toggle */}
            <div className="flex items-center gap-0.5 p-0.5 rounded-xl border border-zinc-200 bg-zinc-100 text-[11px] font-extrabold select-none">
              <button
                type="button"
                onClick={() => setRecognitionMode('live')}
                className={cn(
                  "flex-1 px-2 py-1.5 rounded-lg flex items-center justify-center gap-1 transition-all",
                  recognitionMode === 'live' ? "bg-white text-indigo-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                ⚡ 即時
              </button>
              <button
                type="button"
                onClick={() => setRecognitionMode('whisper')}
                className={cn(
                  "flex-1 px-2 py-1.5 rounded-lg flex items-center justify-center gap-1 transition-all",
                  recognitionMode === 'whisper' ? "bg-white text-emerald-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                🎯 高精準
              </button>
            </div>

            {recognitionMode === 'whisper' && (
              <p className="text-[10px] text-zinc-400 leading-relaxed">
                高精準模式在你的瀏覽器本機執行 Whisper（口音更準、音訊不離開裝置）。首次使用需下載模型（約 145MB），之後瀏覽器會快取。
              </p>
            )}

            {recognitionMode === 'whisper' && whisperState === 'loading' && (
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-bold text-zinc-500">
                  <span>模型下載中…首次較久請稍候</span><span>{whisperProgress}%</span>
                </div>
                <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-600 transition-all duration-300" style={{ width: `${whisperProgress}%` }} />
                </div>
              </div>
            )}

            {recognitionMode === 'whisper' && whisperState === 'error' && (
              <button onClick={loadWhisperModel} className="text-[11px] font-bold text-red-600 underline self-start">
                模型載入失敗，點此重試
              </button>
            )}

            {/* Kinetic visual wave when recording — colour-coded by engine
                (live = indigo, Whisper high-accuracy = emerald). */}
            {isRecording && (
              <div className="flex items-center justify-center gap-1 py-1.5 bg-zinc-50 rounded-xl border border-zinc-100">
                <span className={cn("w-1.5 h-4 rounded-full animate-bounce [animation-delay:-0.4s]", recognitionMode === 'whisper' ? "bg-emerald-500" : "bg-indigo-500")} />
                <span className={cn("w-1.5 h-6 rounded-full animate-bounce [animation-delay:-0.2s]", recognitionMode === 'whisper' ? "bg-emerald-600" : "bg-indigo-600")} />
                <span className={cn("w-1.5 h-8 rounded-full animate-bounce", recognitionMode === 'whisper' ? "bg-emerald-600" : "bg-indigo-600")} />
                <span className={cn("w-1.5 h-5 rounded-full animate-bounce [animation-delay:-0.3s]", recognitionMode === 'whisper' ? "bg-emerald-500" : "bg-indigo-500")} />
                <span className="w-1.5 h-3 bg-zinc-300 rounded-full animate-bounce [animation-delay:-0.1s]" />
              </div>
            )}

            {/* Action record toggle button */}
            {(() => {
              const whisperBusy = recognitionMode === 'whisper' && whisperState !== 'ready';
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
                        : recognitionMode === 'whisper'
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
                      <span>{recognitionMode === 'whisper' ? '開啟麥克風（高精準）' : '開啟麥克風 開始錄音'}</span>
                    </>
                  )}
                </button>
              );
            })()}

            {/* Real-time Listening Transcript Section — only the live (Web Speech)
                engine streams interim words; Whisper transcribes per utterance. */}
            {recognitionMode === 'live' && (isRecording || interimTranscript) && (
              <div className="mt-3 p-3.5 bg-zinc-50 border border-zinc-200/60 rounded-2xl space-y-2 animate-fade-in">
                <div className="flex items-center gap-2">
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                  </span>
                  <span className="text-[10px] font-black uppercase text-zinc-400 tracking-wider font-mono flex items-center gap-1">
                    即時收錄中 (Live listening...)
                  </span>
                </div>
                <div className="text-xs text-zinc-800 leading-relaxed font-sans italic break-words min-h-[24px]">
                  {interimTranscript ? (
                    <span className="text-zinc-900 font-semibold not-italic">{interimTranscript}</span>
                  ) : (
                    <span className="text-zinc-400 animate-pulse">請開始講話，即時轉錄文字會顯示在此處...</span>
                  )}
                </div>
              </div>
            )}

            {/* Whisper has no streaming interim — show a listening hint instead. */}
            {recognitionMode === 'whisper' && isRecording && (
              <div className="mt-3 p-3 bg-indigo-50/50 border border-indigo-100 rounded-2xl flex items-center gap-2.5 animate-fade-in">
                <span className="flex h-2 w-2 relative shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                </span>
                <span className="text-[11px] text-zinc-500 font-medium leading-relaxed">聆聽中…講完一句、停頓約一秒後會自動辨識並翻譯（高精準模式無即時逐字）</span>
              </div>
            )}
          </div>

          {/* Dedicated Session Memory & Auto-Recommendation Widget */}
          <div className="bg-white border border-zinc-200/80 rounded-3xl p-5 shadow-sm space-y-3.5 shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-zinc-400 font-mono uppercase">Session Memory</p>
                <p className="text-xs font-black text-zinc-700 flex items-center gap-1.5 mt-0.5">
                  <Brain className="w-4 h-4 text-indigo-500" />
                  AI 記憶大綱設定
                </p>
              </div>
              <button
                onClick={() => setIsMemoryOpen(true)}
                className="text-[10px] font-extrabold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 px-2.5 py-1.5 rounded-lg transition-all"
              >
                配置記憶
              </button>
            </div>

            {/* Current Active Preset display */}
            <div className="p-3 bg-zinc-50 rounded-2xl border border-zinc-100/80 flex items-start gap-2.5">
              <span className="text-xl leading-none flex items-center justify-center p-2 bg-white rounded-xl border border-zinc-200/60 shadow-sm shrink-0">
                {(() => {
                  const currentPreset = CONTEXT_PRESETS.find(p => p.text === sessionContext);
                  return currentPreset ? currentPreset.icon : '📝';
                })()}
              </span>
              <div className="space-y-0.5 min-w-0">
                <span className="text-[11px] font-black text-zinc-700 block">
                  {(() => {
                    const currentPreset = CONTEXT_PRESETS.find(p => p.text === sessionContext);
                    return currentPreset ? currentPreset.label : '自訂情境資料庫';
                  })()}
                </span>
                <p className="text-[10px] text-zinc-450 truncate leading-snug">
                  {sessionContext || '目前尚未設置任何專業背景記憶大綱。'}
                </p>
              </div>
            </div>

            {/* Live Recommendation Matcher */}
            {(() => {
              const fullSpeechText = history.map(h => h.original).join(' ') + ' ' + interimTranscript;
              const { recommendedId, matchedWords } = analyzeSessionMemory(fullSpeechText);
              const currentPreset = CONTEXT_PRESETS.find(p => p.text === sessionContext);
              const recPreset = CONTEXT_PRESETS.find(p => p.id === recommendedId);

              const isActiveProfileRec = currentPreset && currentPreset.id === recommendedId;
              const hasText = fullSpeechText.trim().length > 3;

              if (recPreset && !isActiveProfileRec && hasText) {
                return (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-3 bg-gradient-to-r from-violet-50 to-indigo-50 rounded-2xl border border-indigo-150 flex flex-col gap-2 shadow-inner"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black text-violet-700 flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-violet-500 fill-violet-200 animate-spin" />
                        AI 偵測主題推薦
                      </span>
                      <span className="text-[8px] bg-white text-indigo-500 border border-indigo-100 px-1.5 py-0.5 rounded font-mono font-bold">
                        匹配
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-650 leading-relaxed">
                      語音中包含「<strong>{matchedWords.slice(0, 3).join(', ')}</strong>」等關鍵術語。建議切換至「<strong>{recPreset.label}</strong>」記憶背景以健全翻譯。
                    </p>
                    <button
                      onClick={() => {
                        setSessionContext(recPreset.text);
                        addToast(`已自動轉換對話記憶為：${recPreset.label}`, 'success');
                      }}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[10px] py-1.5 rounded-xl transition-all shadow-md shadow-indigo-100"
                    >
                      一鍵切換記憶：{recPreset.icon} {recPreset.label}
                    </button>
                  </motion.div>
                );
              } else if (hasText && recPreset) {
                return (
                  <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50/50 border border-emerald-100 p-2.5 rounded-2xl text-[10px]">
                    <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                    <span>AI 當前匹配率優良：<strong>{recPreset.label}</strong></span>
                  </div>
                );
              }
              return null;
            })()}
          </div>

          {/* Browser Speech Compatibility Tips */}
          {speechErrorDetected && (
            <div className="bg-amber-50/80 border border-amber-200/60 p-4 rounded-3xl text-[11px] text-amber-800 leading-relaxed shadow-sm">
              💡 <strong>麥克風/語音連線提示：</strong>
              <span className="block mt-1">偵測到瀏覽器語音聽寫限制 ({speechErrorDetected === 'network' ? '網路語音伺服器連線中斷/受限' : `狀態: ${speechErrorDetected}`})。別擔心！請直接在右側對話歷史清單中，對任何對話段落點擊<strong>「手動修正」</strong>重新整理儲存，AI 同樣能為您生成翻譯。</span>
            </div>
          )}
          </>
        )}
        </section>

        {/* Draggable divider — only in the side-by-side layout */}
        {isWideLayout && (
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

        {/* Right Side: Finalized Timeline (對話時間軸歷史記錄) - Completely Unobstructed! */}
        <section className="flex-1 min-w-0 bg-white p-3.5 md:p-4.5 flex flex-col overflow-hidden relative">
          
          <div className="flex-none flex items-center justify-between mb-2 border-b border-zinc-100 pb-2">
            <div>
              <h2 className="text-sm font-bold text-zinc-805 flex items-center gap-1.5">
                <ListChecks className="w-4 h-4 text-indigo-600" />
                課堂與會議歷史逐字稿
              </h2>
              <p className="text-[10px] text-zinc-400 mt-0.5">
                點擊上方錄音，已翻譯完成的每個完整段落將在下方獨立存檔
              </p>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Compact / Comfortable density toggle (segmented control) */}
              <div
                className="flex items-center gap-0.5 p-0.5 rounded-lg border border-zinc-200 bg-zinc-100 text-[10px] font-extrabold select-none"
                role="group"
                aria-label="顯示密度"
              >
                <button
                  type="button"
                  onClick={() => setIsCompact(true)}
                  title="緊湊高密度：每段佔用較少空間，一次看更多"
                  className={cn(
                    "px-2 py-1 rounded-md flex items-center gap-1 transition-all",
                    isCompact ? "bg-white text-indigo-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                  )}
                >
                  ⚡ 緊湊
                </button>
                <button
                  type="button"
                  onClick={() => setIsCompact(false)}
                  title="舒適卡片：每段獨立卡片，留白較多較好讀"
                  className={cn(
                    "px-2 py-1 rounded-md flex items-center gap-1 transition-all",
                    !isCompact ? "bg-white text-indigo-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                  )}
                >
                  📖 舒適
                </button>
              </div>

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
            className={cn(
              "flex-1 overflow-y-auto pr-1 custom-scrollbar",
              isCompact ? "space-y-0" : "space-y-2.5"
            )}
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
              <div className={isCompact ? "" : "space-y-2.5"}>
                {history.map((entry) => {
                  const isEditing = editingId === entry.id;
                  return (
                    <motion.div 
                      key={entry.id}
                      initial={{ opacity: 0, y: isCompact ? -5 : -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "group/entry transition-all",
                        isCompact 
                          ? "p-2 grid grid-cols-1 md:grid-cols-12 gap-3 items-start border-b border-zinc-100 hover:bg-zinc-50/70" 
                          : "grid grid-cols-1 md:grid-cols-2 gap-3 border border-zinc-100 p-2.5 md:p-3 rounded-xl hover:bg-zinc-50/50 hover:border-zinc-200 shadow-sm"
                      )}
                    >
                      {isCompact ? (
                        <>
                          {/* Left-hand column: Metadata (Time + Quick Action button) */}
                          <div className="md:col-span-1.5 flex md:flex-col items-center md:items-start justify-between md:justify-start gap-1 text-[10px] text-zinc-400 font-mono h-full pt-0.5 shrink-0 select-none">
                            <span className="font-semibold text-zinc-400/80">{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            {entry.deviceLabel && (
                              <span className={cn(
                                "text-[9px] font-bold px-1.5 py-0.5 rounded-md whitespace-nowrap",
                                entry.deviceId === deviceIdRef.current ? "bg-indigo-50 text-indigo-600" : "bg-emerald-50 text-emerald-600"
                              )}>{entry.deviceLabel}</span>
                            )}
                            <div className="flex md:flex-row gap-1 items-center md:mt-1 opacity-40 group-hover/entry:opacity-100 transition-opacity">
                              {!isEditing && (
                                <button
                                  onClick={() => {
                                    setEditingId(entry.id);
                                    setEditingText(entry.original);
                                  }}
                                  className="text-zinc-400 hover:text-indigo-600 p-0.5 rounded hover:bg-zinc-100/80 transition-colors"
                                  title="修正英文聽寫內容"
                                >
                                  <Edit className="w-3 h-3" />
                                </button>
                              )}
                              {entry.translated && (
                                <button 
                                  onClick={() => {
                                    navigator.clipboard.writeText(entry.translated!);
                                    addToast('複製成功！', 'success');
                                  }}
                                  className="text-zinc-400 hover:text-indigo-600 p-0.5 rounded hover:bg-zinc-100/80 transition-colors"
                                  title="複製中文翻譯"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Middle column: English */}
                          <div className="md:col-span-5.5 min-w-0">
                            {isEditing ? (
                              <div className="space-y-1.5">
                                <textarea
                                  value={editingText}
                                  onChange={(e) => setEditingText(e.target.value)}
                                  className="w-full min-h-[55px] p-2 bg-zinc-50 border border-zinc-205 rounded-lg text-xs outline-none focus:border-indigo-505 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all font-sans leading-relaxed"
                                  placeholder="在此修訂英文內容..."
                                />
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => handleSaveSegmentEdit(entry.id)}
                                    className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[9px] rounded transition-all flex items-center gap-0.5"
                                  >
                                    <Check className="w-2.5 h-2.5" />
                                    <span>儲存</span>
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingId(null);
                                      setEditingText('');
                                    }}
                                    className="px-2 py-0.5 bg-zinc-105 hover:bg-zinc-200 text-zinc-650 font-bold text-[9px] rounded transition-all"
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-zinc-750 text-[13px] leading-relaxed font-normal">{entry.original}</p>
                            )}
                          </div>

                          {/* Right column: Chinese translation */}
                          <div className="md:col-span-5 border-t border-dashed border-zinc-100 pt-1.5 md:pt-0 md:border-t-0 md:border-l md:pl-3.5 min-w-0">
                            {entry.translated ? (
                              <div className="space-y-0.5">
                                <p style={{ fontSize: transFontPx }} className="text-zinc-900 leading-relaxed font-bold">{entry.translated}</p>
                                {entry.translatedBy && <span className="text-[9px] text-zinc-400 font-medium select-none">{entry.translatedBy}</span>}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 text-indigo-400 font-medium py-0.5 select-none">
                                <div className="flex gap-0.5">
                                  <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                                  <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                                  <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce"></span>
                                </div>
                                <span className="text-[11px] italic">翻譯中...</span>
                              </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Comfortable: English card */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[9px] text-zinc-400 font-mono">
                              <span className="font-bold text-indigo-500 uppercase tracking-widest flex items-center gap-1">
                                <FileText className="w-2.5 h-2.5 text-indigo-400" />
                                English
                              </span>
                              <div className="flex items-center gap-1.5">
                                {entry.deviceLabel && (
                                  <span className={cn(
                                    "text-[9px] font-bold px-1.5 py-0.5 rounded-md",
                                    entry.deviceId === deviceIdRef.current ? "bg-indigo-50 text-indigo-600" : "bg-emerald-50 text-emerald-600"
                                  )}>{entry.deviceLabel}</span>
                                )}
                                <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                                {!isEditing && (
                                  <button
                                    onClick={() => {
                                      setEditingId(entry.id);
                                      setEditingText(entry.original);
                                    }}
                                    className="text-zinc-400 hover:text-indigo-600 transition-colors flex items-center gap-0.5 p-0.5 rounded hover:bg-zinc-100"
                                    title="修正此段落的語音聽寫內容"
                                  >
                                    <Edit className="w-2.5 h-2.5" />
                                    <span className="text-[8px] font-bold">手動修正</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {isEditing ? (
                              <div className="space-y-1.5">
                                <textarea
                                  value={editingText}
                                  onChange={(e) => setEditingText(e.target.value)}
                                  className="w-full min-h-[70px] p-2 bg-zinc-50 border border-zinc-200 rounded-lg text-xs outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all resize-y text-zinc-805 font-sans leading-relaxed shadow-inner"
                                  placeholder="在此修改英文聽寫內容..."
                                />
                                <div className="flex items-center gap-1.5 pt-0.5">
                                  <button
                                    onClick={() => handleSaveSegmentEdit(entry.id)}
                                    className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[9px] rounded-md transition-all flex items-center gap-1 shadow-sm"
                                  >
                                    <Check className="w-2.5 h-2.5" />
                                    儲存並比對翻譯
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingId(null);
                                      setEditingText('');
                                    }}
                                    className="px-2 py-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-650 font-bold text-[9px] rounded-md transition-all"
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-zinc-700 text-[13.5px] leading-relaxed font-normal">{entry.original}</p>
                            )}
                          </div>

                          {/* Comfortable: Chinese translation card */}
                          <div className="flex flex-col justify-between space-y-1 border-t md:border-t-0 md:border-l border-zinc-100 pt-2 md:pt-0 md:pl-3">
                            <div>
                              <div className="flex items-center justify-between text-[9px] text-zinc-400 font-mono mb-0.5">
                                <span className="font-bold text-indigo-600 uppercase tracking-widest">Translation (TW)</span>
                                {entry.translated && (
                                  <button 
                                    onClick={() => {
                                      navigator.clipboard.writeText(entry.translated!);
                                      addToast('複製成功！', 'success');
                                    }}
                                    className="p-1 hover:text-indigo-600 transition-colors opacity-40 group-hover/entry:opacity-100"
                                    title="複製翻譯結果"
                                  >
                                    <Copy className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                              {entry.translated ? (
                                <div className="space-y-0.5">
                                  <p style={{ fontSize: transFontPx }} className="text-zinc-900 leading-relaxed font-bold">{entry.translated}</p>
                                  {entry.translatedBy && <span className="text-[9px] text-zinc-400 font-medium select-none">{entry.translatedBy}</span>}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 text-indigo-400 font-medium py-1">
                                  <div className="flex gap-1">
                                    <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                                    <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                                    <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></span>
                                  </div>
                                  <span className="text-[11.5px] italic">法醫級精準比對翻譯中...</span>
                                </div>
                              )}
                            </div>
                          </div>
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
              <div className="p-6 space-y-5">
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
                              onClick={() => { if (editable && roomId) { setRoomConfig(roomId, { translateMode: m }); } }}
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
                                {m.hasKey && (
                                  <span className={cn(
                                    "text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap",
                                    activeTranslator?.id === m.id ? "bg-indigo-600 text-white" : "bg-zinc-200 text-zinc-500"
                                  )}>
                                    🔑 {m.provider === 'openai' ? 'OpenAI' : m.provider === 'claude' ? 'Claude' : m.provider === 'gemini' ? 'Gemini' : '金鑰'}
                                    {activeTranslator?.id === m.id ? ' · 翻譯中' : ''}
                                  </span>
                                )}
                              </span>
                              {!isSelf && (
                                <button
                                  onClick={() => sendCommand(roomId, m.id, m.recording ? 'stop' : 'start', deviceLabelRef.current)}
                                  className={cn(
                                    "shrink-0 text-[10px] font-bold px-2 py-1 rounded-md border transition-colors",
                                    m.recording
                                      ? "text-red-600 bg-red-50 border-red-100 hover:bg-red-100"
                                      : "text-emerald-700 bg-emerald-50 border-emerald-100 hover:bg-emerald-100"
                                  )}
                                >
                                  {m.recording ? '⏹ 停止收音' : '▶ 開始收音'}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {activeTranslator ? (
                        <p className="text-[10px] mt-2 leading-relaxed px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 font-bold">
                          目前翻譯由 {activeTranslator.label}{activeTranslator.id === deviceIdRef.current ? '（本機）' : ''} 提供
                          （{activeTranslator.provider === 'openai' ? 'OpenAI' : activeTranslator.provider === 'claude' ? 'Claude' : activeTranslator.provider === 'gemini' ? 'Gemini' : '金鑰'}）— 房間內任一台有金鑰即可翻譯
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
              <div className="flex-none p-6 border-b border-zinc-100 flex items-center justify-between">
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
              <div className="flex-none px-6 py-2 bg-zinc-50/50 border-b border-zinc-100 flex gap-1">
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
              <div className="flex-1 p-6 overflow-y-auto space-y-5 custom-scrollbar">
                
                {settingsTab === 'speech' ? (
                  <div className="space-y-4">
                    {/* Target dialiect accent manually selecting */}
                    <div>
                      <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                        錄音口音預設 (Preselected Accent/Dialect)
                      </label>
                      <div className="grid grid-cols-2 gap-2">
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
                            onClick={() => setTranslateMode(m)}
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
                          ? '使用瀏覽器內建翻譯（免金鑰、裝置端離線，需較新版 Chrome）。'
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
              <div className="flex-none p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
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
              <div className="flex-1 p-6 overflow-y-auto space-y-5 custom-scrollbar bg-white">
                
                {/* Live AI Recommendation Panel */}
                {(() => {
                  const fullSpeechText = history.map(h => h.original).join(' ') + ' ' + interimTranscript;
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
