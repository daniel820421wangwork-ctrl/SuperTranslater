// On-device translation via Chrome's built-in Translator API (no API key,
// runs locally). Only available on supporting browsers (recent Chrome).
type BuiltinTranslator = { translate: (t: string) => Promise<string> };

let cached: BuiltinTranslator | null = null;
const SOURCE = 'en';
const TARGET = 'zh-Hant';

// Whether the API surface exists at all (model may still need a download).
export const browserTranslateAvailable = (): boolean => {
  const w = self as any;
  return typeof w.Translator !== 'undefined' || !!(w.translation && w.translation.createTranslator);
};

export const getBrowserTranslator = async (): Promise<BuiltinTranslator> => {
  if (cached) return cached;
  const w = self as any;
  if (w.Translator && typeof w.Translator.create === 'function') {
    cached = await w.Translator.create({ sourceLanguage: SOURCE, targetLanguage: TARGET });
    return cached!;
  }
  if (w.translation && typeof w.translation.createTranslator === 'function') {
    cached = await w.translation.createTranslator({ sourceLanguage: SOURCE, targetLanguage: TARGET });
    return cached!;
  }
  throw new Error('此瀏覽器不支援內建翻譯（需較新版 Chrome 並下載語言包）');
};

export const browserTranslate = async (text: string): Promise<string> => {
  const t = await getBrowserTranslator();
  return (await t.translate(text)).trim();
};
