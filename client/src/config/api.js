// API base URL — auto-detected from current origin
// Web (deployed or local dev via proxy): empty string = same origin
// Native Capacitor/Electron: explicit Render production URL
const _isCapacitor = typeof window !== 'undefined' && (
  window.Capacitor?.isNativePlatform?.() || window.location?.protocol === 'capacitor:'
);
const _isElectron = typeof window !== 'undefined' && window.navigator?.userAgent?.includes('Electron');
const _isLocalDev = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
  !_isCapacitor && !_isElectron;

export const API_BASE_URL = (_isCapacitor || _isElectron)
  ? 'https://waitnot-restaurant1.onrender.com'
  : _isLocalDev
    ? 'http://localhost:5001'
    : window.location.origin;
