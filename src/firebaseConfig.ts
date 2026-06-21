// Firebase web app config. Safe to expose in the frontend — real access control
// is enforced by Realtime Database security rules, not by hiding this object.
//
// Paste the config object from Firebase console → Project settings → Your apps.
// The app works fine solo until this is filled in; multi-device sync needs it.
export const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME',
  databaseURL: 'REPLACE_ME',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};

export const isFirebaseConfigured = (): boolean =>
  !!firebaseConfig.databaseURL && !firebaseConfig.databaseURL.includes('REPLACE_ME');
