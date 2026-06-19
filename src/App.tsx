import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { 
  Languages, Copy, Check, Info, Zap, Trash2, 
  ArrowRightLeft, Mic, MicOff, XCircle, StopCircle, 
  FileText, X, Sparkles, ListChecks, Sliders, Settings, Key, Globe, Brain, RefreshCw,
  Edit, ArrowUp
} from 'lucide-react';
import { cn } from './lib/utils';

// Language configuration
const LANGUAGES = [
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
  const [history, setHistory] = useState<{id: string, original: string, translated?: string, timestamp: number}[]>([]);
  
  // Speech Recognition States
  const [isRecording, setIsRecording] = useState(false);
  const isActualRecordingRef = useRef(false);
  // True while the user wants continuous recording — lets us auto-restart the
  // Web Speech API when it ends on its own (silence/timeout) instead of pausing.
  const shouldKeepRecordingRef = useRef(false);
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

  const translationIdRef = useRef(0);
  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Backup settings to localStorage
  useEffect(() => {
    localStorage.setItem('swift_transcript_ai_settings_v2', JSON.stringify(aiSettings));
  }, [aiSettings]);

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
          setDetectedAccent({ 
            code: matchingLang.code, 
            label: matchingLang.label,
            reason: data.reasoning || '語音特徵比對結果',
            wordCount: text.split(' ').length,
            traits: data.profile_traits || [],
            confidence: data.confidence || 50
          });
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

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
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
          const segmentId = Math.random().toString(36).substring(7);
          const newEntry = {
            id: segmentId,
            original: finalText.trim(),
            timestamp: Date.now()
          };
          
          setHistory(prev => [newEntry, ...prev]);
          translateSegment(finalText, segmentId);
        }
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
  }, [selectedLang]);

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      addToast('您的瀏覽器不支援語音辨識功能。推薦使用下方的「手動鍵盤輸入」！');
      return;
    }

    if (isActualRecordingRef.current) {
      try {
        shouldKeepRecordingRef.current = false; // user-initiated stop: don't auto-restart
        recognitionRef.current.stop();
      } catch (err) {
        console.error('Stop recognition error:', err);
      }
    } else {
      try {
        setError(null);
        setSpeechErrorDetected(null);
        shouldKeepRecordingRef.current = true; // keep recording across auto-ends
        recognitionRef.current.start();
      } catch (err) {
        // Ignore "already started" error if it somehow still happens
        if (err instanceof Error && err.message.includes('already started')) {
          console.warn('Recognition already started, ignoring.');
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
    }
  };

  const submitManualText = async () => {
    const text = manualInputText.trim();
    if (!text) {
      addToast('請輸入要翻譯與分析的英文文本。', 'info');
      return;
    }

    setIsTranslating(true);
    const segmentId = Math.random().toString(36).substring(7);
    const newEntry = {
      id: segmentId,
      original: text,
      timestamp: Date.now()
    };
    
    // Add to history list immediately
    setHistory(prev => [newEntry, ...prev]);
    setManualInputText(''); // clear input

    try {
      await translateSegment(text, segmentId);
      addToast('手動段落翻譯與口音特徵比對完成！', 'success');
    } catch (err) {
      console.error('Manual translate error:', err);
      addToast('翻譯或分析發生意外錯誤。', 'error');
    } finally {
      setIsTranslating(false);
    }
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
    addToast('已成功清除所有記錄', 'success');
  };

  const handleForceStop = () => {
    translationIdRef.current++;
    setTranslatedText('');
    setInterimTranscript('');
    setIsTranslating(false);
  };

  const activeLangLabel = LANGUAGES.find(l => l.code === selectedLang)?.label || selectedLang;

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

      {/* Top Application Header */}
      <header className="bg-white border-b border-zinc-200 px-6 py-4 shadow-sm z-40 flex-none">
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
          
          <div className="flex items-center gap-2">
            {/* Quick Provider & Model switcher (always visible) */}
            <div className="flex items-center gap-1.5 mr-1">
              <span className="hidden sm:inline-block w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
              <select
                value={aiSettings.provider}
                onChange={(e) => setAiSettings(prev => ({ ...prev, provider: e.target.value as AISettings['provider'] }))}
                title="切換 AI 平台"
                className="py-2 px-2 bg-zinc-100 border border-zinc-200 rounded-xl text-xs font-bold text-indigo-700 outline-none focus:border-indigo-500 cursor-pointer hover:bg-zinc-200 transition-all"
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
                title="切換模型"
                className="max-w-[160px] py-2 px-2 bg-zinc-100 border border-zinc-200 rounded-xl text-xs font-semibold text-zinc-700 outline-none focus:border-indigo-500 cursor-pointer hover:bg-zinc-200 transition-all truncate"
              >
                {PROVIDER_MODELS[aiSettings.provider].map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            {/* Menu Actions */}
            <button 
              onClick={() => setIsMemoryOpen(true)}
              className="px-3.5 py-2 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 hover:text-indigo-850 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 border border-indigo-100"
              title="配置口音學術名詞、自訂課堂或會議大綱背景記憶"
            >
              <Brain className="w-3.5 h-3.5 text-indigo-600" />
              <span>記憶設定</span>
            </button>
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="px-3.5 py-2 text-zinc-600 bg-zinc-100 hover:bg-zinc-200 hover:text-indigo-600 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 border border-zinc-200/50"
              title="配置自訂 API 金鑰與模型運算核心"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>設定</span>
            </button>
            <button 
              onClick={() => setIsFullViewOpen(true)}
              className="px-3.5 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-semibold text-xs rounded-xl transition-all flex items-center gap-1.5 border border-indigo-100"
              title="開啓會議全文中英逐字稿及 AI 重點摘要"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>整頁整理</span>
            </button>
            <button 
              onClick={handleClear}
              className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
              title="清除目前所有錄音歷史與快取記錄"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Split-Screen Workspace */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden max-w-7xl w-full mx-auto">
        
        {/* Left Side: Live Console (控台) */}
        <section className="w-full lg:w-[420px] shrink-0 border-b lg:border-b-0 lg:border-r border-zinc-200/80 bg-zinc-50/60 p-6 flex flex-col gap-5 overflow-y-auto z-10">
          
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
                isRecording ? "bg-red-50 text-red-600" : "bg-zinc-100 text-zinc-500"
              )}>
                {isRecording ? "正在接收..." : "錄音閒置"}
              </span>
            </div>

            {/* Kinetic visual wave when recording */}
            {isRecording && (
              <div className="flex items-center justify-center gap-1 py-1.5 bg-zinc-50 rounded-xl border border-zinc-100">
                <span className="w-1.5 h-4 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.4s]" />
                <span className="w-1.5 h-6 bg-indigo-600 rounded-full animate-bounce [animation-delay:-0.2s]" />
                <span className="w-1.5 h-8 bg-indigo-600 rounded-full animate-bounce" />
                <span className="w-1.5 h-5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-3 bg-zinc-300 rounded-full animate-bounce [animation-delay:-0.1s]" />
              </div>
            )}

            {/* Action record toggle button */}
            <button
              onClick={toggleRecording}
              className={cn(
                "w-full py-4 px-6 rounded-2xl transition-all duration-300 flex items-center justify-center gap-3 font-bold text-sm shadow-sm border",
                isRecording 
                  ? "bg-red-500 hover:bg-red-600 text-white border-red-600 shadow-md shadow-red-100" 
                  : "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-700 shadow-lg shadow-indigo-100"
              )}
            >
              {isRecording ? (
                <>
                  <MicOff className="w-5 h-5 animate-pulse" />
                  <span>停止聽寫 & 儲存此句</span>
                </>
              ) : (
                <>
                  <Mic className="w-5 h-5" />
                  <span>開啟麥克風 開始錄音</span>
                </>
              )}
            </button>

            {/* Real-time Listening Transcript Section */}
            {(isRecording || interimTranscript) && (
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
        </section>

        {/* Right Side: Finalized Timeline (對話時間軸歷史記錄) - Completely Unobstructed! */}
        <section className="flex-1 bg-white p-3.5 md:p-4.5 flex flex-col overflow-hidden relative">
          
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
              {/* Compact / Comfortable density toggle */}
              <button
                onClick={() => setIsCompact(!isCompact)}
                className="text-[10px] font-extrabold flex items-center gap-1 px-2 py-1 rounded-lg border border-zinc-250 bg-white hover:bg-zinc-50 text-zinc-600 shadow-sm transition-all select-none"
                title={isCompact ? "切換成舒適卡片模式" : "切換成緊湊高密度模式"}
              >
                <span>{isCompact ? "⚡️ 緊湊高密度" : "📖 舒適卡片"}</span>
              </button>
              
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
                              <p className="text-zinc-900 text-[13px] leading-relaxed font-bold">{entry.translated}</p>
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
                                <p className="text-zinc-900 text-[13.5px] leading-relaxed font-bold">{entry.translated}</p>
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

                  </div>
                ) : (
                  <div className="space-y-4">
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
                            <p className="text-zinc-900 font-bold leading-relaxed">{entry.translated || '...'}</p>
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
