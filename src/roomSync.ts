// Realtime multi-device sync over Firebase Realtime Database.
// Each "room" holds a shared transcript; every device publishes its own
// captured/translated segments and subscribes to everyone else's.
import { initializeApp, getApps } from 'firebase/app';
import {
  getDatabase, ref, push, update, remove, set,
  onChildAdded, onChildChanged, onValue, onDisconnect, type Database,
} from 'firebase/database';

export type LiveTranscript = { text: string; label: string; ts: number };
import { loadFirebaseConfig } from './firebaseConfig';

export type RoomSegment = {
  original: string;
  translated: string | null;
  deviceId: string;
  deviceLabel: string;
  ts: number;
  translatedBy?: string;
};

let db: Database | null = null;

const getDb = (): Database | null => {
  const cfg = loadFirebaseConfig();
  if (!cfg) return null;
  try {
    if (!getApps().length) initializeApp(cfg);
    if (!db) db = getDatabase();
    return db;
  } catch (e) {
    console.error('Firebase init failed', e);
    return null;
  }
};

// Push a new segment; returns its generated key (or null if offline/unconfigured).
export const pushSegment = (roomId: string, seg: RoomSegment): string | null => {
  const d = getDb();
  if (!d) return null;
  const r = push(ref(d, `rooms/${roomId}/segments`));
  set(r, seg).catch((e) => console.error('pushSegment failed', e));
  return r.key;
};

export const updateSegment = (roomId: string, key: string, fields: Partial<RoomSegment>): void => {
  const d = getDb();
  if (!d) return;
  update(ref(d, `rooms/${roomId}/segments/${key}`), fields).catch((e) => console.error('updateSegment failed', e));
};

export const clearRoomSegments = (roomId: string): void => {
  const d = getDb();
  if (!d) return;
  remove(ref(d, `rooms/${roomId}/segments`)).catch((e) => console.error('clearRoomSegments failed', e));
};

// Subscribe to segment additions/changes. Returns an unsubscribe function.
export const subscribeSegments = (
  roomId: string,
  onAdd: (key: string, seg: RoomSegment) => void,
  onChange: (key: string, seg: RoomSegment) => void,
): (() => void) => {
  const d = getDb();
  if (!d) return () => {};
  const segRef = ref(d, `rooms/${roomId}/segments`);
  const offAdd = onChildAdded(segRef, (snap) => onAdd(snap.key as string, snap.val() as RoomSegment));
  const offChange = onChildChanged(segRef, (snap) => onChange(snap.key as string, snap.val() as RoomSegment));
  return () => { offAdd(); offChange(); };
};

// Register this device's presence; auto-removed on disconnect.
export const joinPresence = (roomId: string, deviceId: string, label: string): void => {
  const d = getDb();
  if (!d) return;
  const meRef = ref(d, `rooms/${roomId}/members/${deviceId}`);
  set(meRef, { label, ts: Date.now(), recording: false }).catch((e) => console.error('joinPresence failed', e));
  onDisconnect(meRef).remove().catch(() => {});
};

// Report whether this device is currently recording.
export const setMemberRecording = (roomId: string, deviceId: string, recording: boolean): void => {
  const d = getDb();
  if (!d) return;
  update(ref(d, `rooms/${roomId}/members/${deviceId}`), { recording }).catch(() => {});
};

// Report member metadata (translate capability/provider, current recording mode).
export const setMemberMeta = (roomId: string, deviceId: string, meta: { hasKey?: boolean; provider?: string; recMode?: string; canWhisper?: boolean }): void => {
  const d = getDb();
  if (!d) return;
  update(ref(d, `rooms/${roomId}/members/${deviceId}`), meta).catch(() => {});
};

// Send a start/stop command to another device. For 'start', an optional
// recognition mode ('live' | 'whisper') tells the target how to record.
export const sendCommand = (roomId: string, targetDeviceId: string, action: 'start' | 'stop', from: string, mode?: 'dual' | 'live' | 'whisper'): void => {
  const d = getDb();
  if (!d) return;
  set(ref(d, `rooms/${roomId}/commands/${targetDeviceId}`), { action, ts: Date.now(), from, mode: mode || null }).catch(() => {});
};

// Listen for commands addressed to this device.
export const subscribeCommand = (
  roomId: string,
  deviceId: string,
  cb: (cmd: { action: 'start' | 'stop'; ts: number; from: string; mode?: 'dual' | 'live' | 'whisper' | null }) => void,
): (() => void) => {
  const d = getDb();
  if (!d) return () => {};
  return onValue(ref(d, `rooms/${roomId}/commands/${deviceId}`), (snap) => {
    const v = snap.val();
    if (v && v.action && v.ts) cb(v);
  });
};

export const leavePresence = (roomId: string, deviceId: string): void => {
  const d = getDb();
  if (!d) return;
  remove(ref(d, `rooms/${roomId}/members/${deviceId}`)).catch(() => {});
};

export const subscribeMembers = (
  roomId: string,
  cb: (members: { id: string; label: string; recording: boolean; hasKey: boolean; provider: string; recMode: string; canWhisper: boolean }[]) => void,
): (() => void) => {
  const d = getDb();
  if (!d) return () => {};
  return onValue(ref(d, `rooms/${roomId}/members`), (snap) => {
    const val = snap.val() || {};
    cb(Object.keys(val).map((id) => ({
      id,
      label: val[id]?.label || '裝置',
      recording: !!val[id]?.recording,
      hasKey: !!val[id]?.hasKey,
      provider: val[id]?.provider || '',
      recMode: val[id]?.recMode || 'live',
      canWhisper: !!val[id]?.canWhisper,
    })));
  });
};

// ----- Audio clip relay (capturer uploads short clips; transcriber consumes) -----
export type RoomClip = { audio: string; deviceId: string; deviceLabel: string; ts: number };

export const pushClip = (roomId: string, clip: RoomClip): void => {
  const d = getDb();
  if (!d) return;
  const r = push(ref(d, `rooms/${roomId}/clips`));
  set(r, clip).catch((e) => console.error('pushClip failed', e));
};

export const subscribeClips = (
  roomId: string,
  onAdd: (key: string, clip: RoomClip) => void,
): (() => void) => {
  const d = getDb();
  if (!d) return () => {};
  return onChildAdded(ref(d, `rooms/${roomId}/clips`), (snap) => onAdd(snap.key as string, snap.val() as RoomClip));
};

export const deleteClip = (roomId: string, key: string): void => {
  const d = getDb();
  if (!d) return;
  remove(ref(d, `rooms/${roomId}/clips/${key}`)).catch(() => {});
};

// Room-level config (e.g. translation method), set by the room creator.
export const setRoomConfig = (roomId: string, config: { translateMode: string }): void => {
  const d = getDb();
  if (!d) return;
  update(ref(d, `rooms/${roomId}/config`), config).catch(() => {});
};

export const subscribeRoomConfig = (
  roomId: string,
  cb: (config: { translateMode?: string } | null) => void,
): (() => void) => {
  const d = getDb();
  if (!d) return () => {};
  return onValue(ref(d, `rooms/${roomId}/config`), (snap) => cb(snap.val()));
};

// Live (interim) transcript for a recording device — cleared when they stop.
export const setLiveTranscript = (roomId: string, deviceId: string, text: string, deviceLabel: string): void => {
  const d = getDb();
  if (!d) return;
  update(ref(d, `rooms/${roomId}/live/${deviceId}`), { text, label: deviceLabel, ts: Date.now() }).catch(() => {});
};

export const clearLiveTranscript = (roomId: string, deviceId: string): void => {
  const d = getDb();
  if (!d) return;
  remove(ref(d, `rooms/${roomId}/live/${deviceId}`)).catch(() => {});
};

export const subscribeLiveTranscripts = (
  roomId: string,
  cb: (transcripts: Record<string, LiveTranscript>) => void,
): (() => void) => {
  const d = getDb();
  if (!d) return () => {};
  return onValue(ref(d, `rooms/${roomId}/live`), (snap) => cb((snap.val() as Record<string, LiveTranscript>) || {}));
};

// Connection state to the Firebase backend (true = online).
export const subscribeConnection = (cb: (connected: boolean) => void): (() => void) => {
  const d = getDb();
  if (!d) return () => {};
  return onValue(ref(d, '.info/connected'), (snap) => cb(snap.val() === true));
};
