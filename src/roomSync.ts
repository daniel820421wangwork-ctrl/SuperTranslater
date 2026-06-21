// Realtime multi-device sync over Firebase Realtime Database.
// Each "room" holds a shared transcript; every device publishes its own
// captured/translated segments and subscribes to everyone else's.
import { initializeApp, getApps } from 'firebase/app';
import {
  getDatabase, ref, push, update, remove, set,
  onChildAdded, onChildChanged, onValue, onDisconnect, type Database,
} from 'firebase/database';
import { firebaseConfig, isFirebaseConfigured } from './firebaseConfig';

export type RoomSegment = {
  original: string;
  translated: string | null;
  deviceId: string;
  deviceLabel: string;
  ts: number;
};

let db: Database | null = null;

const getDb = (): Database | null => {
  if (!isFirebaseConfigured()) return null;
  try {
    if (!getApps().length) initializeApp(firebaseConfig);
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
  set(meRef, { label, ts: Date.now() }).catch((e) => console.error('joinPresence failed', e));
  onDisconnect(meRef).remove().catch(() => {});
};

export const leavePresence = (roomId: string, deviceId: string): void => {
  const d = getDb();
  if (!d) return;
  remove(ref(d, `rooms/${roomId}/members/${deviceId}`)).catch(() => {});
};

export const subscribeMembers = (
  roomId: string,
  cb: (members: { id: string; label: string }[]) => void,
): (() => void) => {
  const d = getDb();
  if (!d) return () => {};
  return onValue(ref(d, `rooms/${roomId}/members`), (snap) => {
    const val = snap.val() || {};
    cb(Object.keys(val).map((id) => ({ id, label: val[id]?.label || '裝置' })));
  });
};

// Connection state to the Firebase backend (true = online).
export const subscribeConnection = (cb: (connected: boolean) => void): (() => void) => {
  const d = getDb();
  if (!d) return () => {};
  return onValue(ref(d, '.info/connected'), (snap) => cb(snap.val() === true));
};
