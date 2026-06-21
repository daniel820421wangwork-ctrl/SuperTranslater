// On-device translation via Chrome's built-in Translator API (no API key,
// runs locally). Only available on supporting browsers (recent Chrome).
type BuiltinTranslator = { translate: (t: string) => Promise<string> };
export type BrowserTranslatorAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unknown';

let cached: BuiltinTranslator | null = null;
let creating: Promise<BuiltinTranslator> | null = null;
const SOURCE = 'en';
const TARGET = 'zh-Hant';

// Whether the API surface exists at all (model may still need a download).
export const browserTranslateAvailable = (): boolean => {
  const w = self as any;
  return typeof w.Translator !== 'undefined' || !!(w.translation && w.translation.createTranslator);
};

export const getBrowserTranslatorAvailability = async (): Promise<BrowserTranslatorAvailability> => {
  const w = self as any;
  if (w.Translator && typeof w.Translator.availability === 'function') {
    return await w.Translator.availability({ sourceLanguage: SOURCE, targetLanguage: TARGET });
  }
  return browserTranslateAvailable() ? 'unknown' : 'unavailable';
};

export const getBrowserTranslator = async (
  onDownloadProgress?: (progress: number) => void,
): Promise<BuiltinTranslator> => {
  if (cached) return cached;
  if (creating) return creating;
  const w = self as any;
  if (w.Translator && typeof w.Translator.create === 'function') {
    // Call create immediately from the user's click handler. Chrome requires
    // transient user activation when a language pack may need downloading.
    creating = w.Translator.create({
      sourceLanguage: SOURCE,
      targetLanguage: TARGET,
      monitor(m: EventTarget) {
        m.addEventListener('downloadprogress', (event: Event) => {
          const loaded = Number((event as ProgressEvent).loaded || 0);
          onDownloadProgress?.(Math.round(loaded * 100));
        });
      },
    }).then((translator: BuiltinTranslator) => {
      cached = translator;
      return translator;
    }).finally(() => {
      creating = null;
    });
    return creating;
  }
  if (w.translation && typeof w.translation.createTranslator === 'function') {
    creating = w.translation.createTranslator({ sourceLanguage: SOURCE, targetLanguage: TARGET })
      .then((translator: BuiltinTranslator) => {
        cached = translator;
        return translator;
      })
      .finally(() => {
        creating = null;
      });
    return creating;
  }
  throw new Error('此瀏覽器不支援內建翻譯（需較新版 Chrome 並下載語言包）');
};

export const browserTranslate = async (text: string): Promise<string> => {
  const t = await getBrowserTranslator();
  return (await t.translate(text)).trim();
};
