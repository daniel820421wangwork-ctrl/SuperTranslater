import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { 
  Languages, Copy, Check, Info, Zap, Trash2, 
  ArrowRightLeft, Mic, MicOff, XCircle, StopCircle, 
  FileText, X, Sparkles, ListChecks, Sliders, Settings, Key, Globe 
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
    { value: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet (推薦 - 頂尖語感)' },
    { value: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku (極速輕盈)' },
    { value: 'claude-3-opus-latest', label: 'Claude 3 Opus (文學史詩大作)' }
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

// CORS-safe API fetching helper for OpenAI via Vite proxy
const callOpenAI = async (apiKey: string, model: string, text: string, systemInstruction: string) => {
  const url = '/api/openai/v1/chat/completions';
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

// CORS-safe API fetching helper for Claude via Vite proxy
const callClaude = async (apiKey: string, model: string, text: string, systemInstruction: string) => {
  const url = '/api/anthropic/v1/messages';
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
      ],
      temperature: 0.3
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
  const [interimTranscript, setInterimTranscript] = useState('');
  const [selectedLang, setSelectedLang] = useState('en-US');

  // Multi-Provider AI Settings
  const [aiSettings, setAiSettings] = useState<AISettings>(() => {
    try {
      const saved = localStorage.getItem('swift_transcript_ai_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          provider: parsed.provider || 'gemini',
          geminiModel: parsed.geminiModel || 'gemini-3.5-flash',
          openaiModel: parsed.openaiModel || 'gpt-4o-mini',
          claudeModel: parsed.claudeModel || 'claude-3-5-sonnet-latest',
          geminiKey: parsed.geminiKey || '',
          openaiKey: parsed.openaiKey || '',
          claudeKey: parsed.claudeKey || '',
        };
      }
    } catch (e) {
      console.error('Error parsing saved settings, resetting.', e);
    }
    return {
      provider: 'gemini',
      geminiModel: 'gemini-3.5-flash',
      openaiModel: 'gpt-4o-mini',
      claudeModel: 'claude-3-5-sonnet-latest',
      geminiKey: '',
      openaiKey: '',
      claudeKey: '',
    };
  });

  const [detectedAccent, setDetectedAccent] = useState<{code: string, label: string, reason: string, wordCount: number, traits: string[], confidence: number} | null>(null);
  const [toasts, setToasts] = useState<{id: string, message: string, type: 'error' | 'success' | 'info'}[]>([]);
  const [sessionContext, setSessionContext] = useState('');
  const [isFullViewOpen, setIsFullViewOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'speech' | 'ai'>('speech');
  const [summary, setSummary] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [activeTab, setActiveTab] = useState<'transcript' | 'summary'>('transcript');

  const defaultAiRef = useRef<any>(null);
  const translationIdRef = useRef(0);
  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initialize Default fallback Gemini API
  if (!defaultAiRef.current) {
    defaultAiRef.current = new GoogleGenAI({ 
      apiKey: (process.env.GEMINI_API_KEY as string)
    });
  }

  // Backup settings to localStorage
  useEffect(() => {
    localStorage.setItem('swift_transcript_ai_settings', JSON.stringify(aiSettings));
  }, [aiSettings]);

  const getGeminiClient = useCallback((customKey?: string) => {
    const key = customKey || (process.env.GEMINI_API_KEY as string);
    return new GoogleGenAI({ apiKey: key });
  }, []);

  const addToast = useCallback((message: string, type: 'error' | 'success' | 'info' = 'error') => {
    const id = Math.random().toString(36).substring(7);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

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
        if (event.error === 'not-allowed') {
          addToast('未獲得麥克風權限，請檢查瀏覽器安全性設定。');
        } else if (event.error === 'network') {
          addToast('網路連線不穩定，語音辨識已中斷。');
        } else if (event.error !== 'no-speech') {
          addToast(`錄音發生錯誤：${event.error}`);
        }
        setIsRecording(false);
        isActualRecordingRef.current = false;
      };

      recognition.onend = () => {
        isActualRecordingRef.current = false;
        setIsRecording(false);
        setInterimTranscript('');
      };

      recognitionRef.current = recognition;
    }
  }, [selectedLang]);

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      addToast('您的瀏覽器不支援語音辨識功能。');
      return;
    }

    if (isActualRecordingRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.error('Stop recognition error:', err);
      }
    } else {
      try {
        setError(null);
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
        setIsRecording(false);
        isActualRecordingRef.current = false;
      }
    }
  };

  // Auto-scroll to top of history whenever NEW content updates
  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (scrollContainer) {
      const timeoutId = setTimeout(() => {
        scrollContainer.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [history]);

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
            {/* Show active Provider & Model */}
            <div className="hidden md:flex flex-col items-end text-[10px] text-zinc-400 font-mono mr-2">
              <span className="font-bold text-indigo-600 uppercase flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
                {aiSettings.provider}
              </span>
              <span className="max-w-[150px] truncate">
                {aiSettings.provider === 'gemini' ? aiSettings.geminiModel : 
                 aiSettings.provider === 'openai' ? aiSettings.openaiModel : aiSettings.claudeModel}
              </span>
            </div>

            {/* Menu Actions */}
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="px-3.5 py-2 text-zinc-600 bg-zinc-100 hover:bg-zinc-200 hover:text-indigo-600 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 border border-zinc-200/50"
              title="配置口音、主題背景、自訂 API 金鑰與模型"
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
          </div>

          {/* Active Live Segment Display */}
          {(history.length > 0 || interimTranscript || isRecording) ? (
            <div className="space-y-4">
              
              {/* Live Input text */}
              <div className="bg-white border border-zinc-200 p-5 rounded-2xl shadow-sm">
                <p className="text-[10px] text-zinc-400 font-mono uppercase tracking-widest flex items-center gap-2 mb-2">
                  <span className={cn("w-1.5 h-1.5 rounded-full", isRecording ? "bg-red-500 animate-pulse" : "bg-zinc-300")} />
                  即時語音 (Live Input)
                </p>
                <div className="text-zinc-800 text-base leading-relaxed min-h-[3em]">
                  {interimTranscript ? (
                    <span className="text-zinc-500 italic block">{interimTranscript}</span>
                  ) : isRecording ? (
                    <span className="text-zinc-300 animate-pulse text-sm">輕聲說話，網頁將自動分析聽寫...</span>
                  ) : (
                    <span className="text-zinc-400 text-sm">無正在聽入之語音。點擊上方按鈕開始錄取。</span>
                  )}
                </div>
              </div>

              {/* Dynamic Live Translation progress indication if needed */}
              {isTranslating && (
                <div className="bg-indigo-600 text-white p-5 rounded-2xl shadow-md relative overflow-hidden">
                  <p className="text-[10px] text-indigo-200 font-mono uppercase tracking-widest flex items-center gap-2 mb-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                    AI TRANSLATOR ACTIVE
                  </p>
                  <p className="text-sm font-medium animate-pulse">正在利用 {aiSettings.provider} 精準翻譯中...</p>
                  <motion.div 
                    initial={{ x: '-100%' }}
                    animate={{ x: '100%' }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                    className="absolute bottom-0 left-0 right-0 h-1 bg-white/30"
                  />
                </div>
              )}

            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white border border-dashed border-zinc-200 rounded-3xl opacity-60">
              <Languages className="w-10 h-10 text-zinc-300 mb-2" />
              <p className="text-xs font-bold text-zinc-600">目前尚無即時數據</p>
              <p className="text-[10px] text-zinc-400 max-w-[200px] mt-1">開啟上方聽寫按鈕，AI 將即時進行逐字翻譯與口音特徵檢索</p>
            </div>
          )}

          {/* Accent Match recommendation (AI Accent Match Widget) */}
          <AnimatePresence>
            {detectedAccent && detectedAccent.code !== selectedLang && (
              <motion.div 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-indigo-50 border border-indigo-100 p-5 rounded-3xl shadow-sm flex flex-col gap-3 shrink-0"
              >
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-indigo-600 fill-indigo-100" />
                  <span className="text-[10px] font-black uppercase text-indigo-600 tracking-wider">
                    AI 語音特徵比對建議
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-zinc-800">偵測為：{detectedAccent.label}</p>
                    <span className="text-[10px] font-black text-indigo-600 bg-white px-2 py-0.5 rounded shadow-sm border border-indigo-100">
                      {detectedAccent.confidence}% 信心
                    </span>
                  </div>
                  
                  {/* Confidence Bar */}
                  <div className="w-full h-1 bg-zinc-200 rounded-full overflow-hidden my-1.5">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${detectedAccent.confidence}%` }}
                      className="h-full bg-indigo-500"
                    />
                  </div>

                  <div className="flex flex-wrap gap-1 my-1.5">
                    {detectedAccent.traits.map((trait, i) => (
                      <span key={i} className="text-[8px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-md font-medium">
                        {trait}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-zinc-500 leading-normal">原因比對：{detectedAccent.reason}</p>
                </div>
                <button
                  onClick={() => {
                    setSelectedLang(detectedAccent.code);
                    setDetectedAccent(null);
                    addToast(`根據語音分析，已自動切換偵測為 ${detectedAccent.label}`, 'success');
                  }}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-xl text-xs font-extrabold transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  立即調整此堂課語音口音
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-auto hidden lg:block pt-4 border-t border-zinc-200/40 opacity-40">
            <p className="text-[9px] text-zinc-400 font-mono">DEVICE STATUS: CONNECTED</p>
          </div>
        </section>

        {/* Right Side: Finalized Timeline (對話時間軸歷史記錄) - Completely Unobstructed! */}
        <section className="flex-1 bg-white p-6 md:p-8 flex flex-col overflow-hidden">
          
          <div className="flex-none flex items-center justify-between mb-4 border-b border-zinc-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-indigo-600" />
                課堂與會議歷史逐字稿
              </h2>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                點擊上方錄音，已翻譯完成的每個完整段落將在下方獨立存檔
              </p>
            </div>
            <span className="text-[10px] font-mono text-zinc-400 bg-zinc-100 px-2.5 py-1 rounded-full font-bold">
              共計：{history.length} 個片段
            </span>
          </div>

          <div 
            ref={scrollRef}
            className="flex-1 overflow-y-auto pr-1 space-y-6 custom-scrollbar"
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
              <div className="space-y-4">
                {history.map((entry) => (
                  <motion.div 
                    key={entry.id}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="grid grid-cols-1 md:grid-cols-2 gap-4 group/entry border border-zinc-100 p-4 rounded-2xl hover:bg-zinc-50/50 hover:border-zinc-200 transition-all shadow-sm"
                  >
                    {/* English card */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
                        <span className="font-bold text-indigo-500 uppercase tracking-widest text-[9px]">English Input</span>
                        <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-zinc-800 text-base leading-relaxed font-normal">{entry.original}</p>
                    </div>

                    {/* Chinese translation card */}
                    <div className="flex flex-col justify-between space-y-2 border-t md:border-t-0 md:border-l border-zinc-100 pt-3 md:pt-0 md:pl-4">
                      <div>
                        <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono mb-1">
                          <span className="font-bold text-indigo-600 uppercase tracking-widest text-[9px]">Taiwan Translation</span>
                          {entry.translated && (
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText(entry.translated!);
                                addToast('複製成功！', 'success');
                              }}
                              className="p-1 hover:text-indigo-600 transition-colors opacity-40 group-hover/entry:opacity-100"
                              title="複製翻譯結果"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        {entry.translated ? (
                          <p className="text-zinc-900 text-base leading-relaxed font-bold">{entry.translated}</p>
                        ) : (
                          <div className="flex items-center gap-2 text-indigo-400 font-medium py-2">
                            <div className="flex gap-1">
                              <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                              <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                              <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce"></span>
                            </div>
                            <span className="text-sm italic">法醫級精準比對翻譯中...</span>
                          </div>
                        )}
                      </div>
                    </div>

                  </motion.div>
                ))}
              </div>
            )}
          </div>
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
                    <p className="text-[10px] text-zinc-400 mt-0.5 font-normal">配置課程描述、預設口音、自訂金鑰和多雲模型</p>
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
                  🎙️ 課程與大綱背景
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
                    {/* Session outline background */}
                    <div>
                      <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-indigo-500" />
                        課堂大綱與背景主題 (Session Context)
                      </label>
                      <textarea
                        placeholder="例如：紐西蘭教授開設的經濟學、軟體開發敏捷會議、日常咖啡廳對話..."
                        value={sessionContext}
                        onChange={(e) => setSessionContext(e.target.value)}
                        className="w-full h-24 p-3 bg-zinc-50/50 border border-zinc-200 rounded-2xl text-xs outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all resize-none shadow-inner"
                      />
                      <p className="text-[10px] text-zinc-400 leading-normal mt-1.5">
                        💡 貼心提醒：輸入「紐西蘭經濟學課程」，AI 能在翻譯時主動聯想教授可能來自紐西蘭，並對口音中的語音（例如 kiwi 語調、特定的短母音、經濟專業術語）具有超凡的校正精準度！
                      </p>
                    </div>

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
