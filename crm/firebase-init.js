/* ============================================================
 * firebase-init.js
 * Initializes Firebase from window.FIREBASE_CONFIG and exposes:
 *   window.fbDb — firebase.firestore()
 * ============================================================ */
(function () {
  if (!window.firebase) { console.error('Firebase SDK failed to load.'); return; }
  if (!window.FIREBASE_CONFIG || window.FIREBASE_CONFIG.apiKey === 'REPLACE_ME') {
    console.warn('[config] Fill in FIREBASE_CONFIG in config.js before deploying.');
  }
  firebase.initializeApp(window.FIREBASE_CONFIG);
  window.fbDb      = firebase.firestore();
  window.fbStorage = firebase.storage();
})();
