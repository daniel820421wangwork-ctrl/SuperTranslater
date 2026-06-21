// Firebase web app config is supplied by each user through the UI and stored in
// localStorage — nothing is hardcoded. The config is safe to keep client-side;
// real access control comes from Realtime Database security rules.
export type FbConfig = {
  apiKey: string;
  authDomain?: string;
  databaseURL: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  measurementId?: string;
};

const KEY = 'swift_firebase_config';

export const loadFirebaseConfig = (): FbConfig | null => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    return cfg && cfg.databaseURL && cfg.apiKey ? cfg : null;
  } catch {
    return null;
  }
};

export const saveFirebaseConfig = (cfg: FbConfig): void => {
  localStorage.setItem(KEY, JSON.stringify(cfg));
};

export const clearFirebaseConfig = (): void => {
  localStorage.removeItem(KEY);
};

export const isFirebaseConfigured = (): boolean => !!loadFirebaseConfig();

// Leniently parse a pasted Firebase snippet (const firebaseConfig = {...}) into
// a config object, tolerating quoted/unquoted keys and single/double quotes.
export const parseFirebaseConfig = (text: string): FbConfig | null => {
  const fields = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'];
  const out: Record<string, string> = {};
  for (const f of fields) {
    const m = text.match(new RegExp(f + '\\s*:\\s*[\'"]([^\'"]+)[\'"]'));
    if (m) out[f] = m[1];
  }
  return out.databaseURL && out.apiKey ? (out as FbConfig) : null;
};
