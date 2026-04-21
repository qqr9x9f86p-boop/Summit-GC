/* ============================================================
 * config.js — MAYA CRM · Summit GC
 * ============================================================
 * SETUP STEPS:
 *  1. Go to https://console.firebase.google.com
 *  2. Create a project (e.g. "maya-crm-summit-gc")
 *  3. Project Settings → Web app → Register app → Copy firebaseConfig
 *  4. Paste the values into FIREBASE_CONFIG below
 *  5. In Firestore → Create database → Start in test mode
 * ============================================================ */

window.BRAND_CONFIG = {
  BRAND_NAME:    'M.A.Y.A CRM',
  PRIMARY_COLOR: '#F59E0B',

  // ── Firebase config ────────────────────────────────────────
  FIREBASE_CONFIG: {
    apiKey:            'AIzaSyAbGIm9GDgoR6QYfKP80JpPUPEZbKaXCzA',
    authDomain:        'summitcrmdemo.firebaseapp.com',
    projectId:         'summitcrmdemo',
    storageBucket:     'summitcrmdemo.firebasestorage.app',
    messagingSenderId: '973446650978',
    appId:             '1:973446650978:web:1c8702f7d75ab4824d453b',
    measurementId:     'G-DR1B0B2ZBR',
  },
};

// Expose globals
(function () {
  const c = window.BRAND_CONFIG;
  window.FIREBASE_CONFIG = c.FIREBASE_CONFIG;
  window.BRAND_NAME      = c.BRAND_NAME;
  document.documentElement.style.setProperty('--accent', c.PRIMARY_COLOR);
})();
