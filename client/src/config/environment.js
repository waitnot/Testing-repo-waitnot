// Environment configuration for WaitNot
// Smart environment detection for different deployment scenarios

// Detect if running in Electron desktop app
const isDesktopApp = typeof window !== 'undefined' && window.navigator.userAgent.includes('Electron');

// Detect if running in development mode
const isDevelopment = process.env.NODE_ENV === 'development';

// Auto-detect the current origin for deployed environments
const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
const hostname = typeof window !== 'undefined' ? window.location.hostname : '';

// For native apps (Capacitor), use the Render production server
const isCapacitorApp = typeof window !== 'undefined' && (
  window.Capacitor?.isNativePlatform?.() ||
  window.location?.protocol === 'capacitor:'
);

// Production server URL — auto-detect based on where the app is running
// For web deployments (Render, Domain India, etc.), server and client are on the same origin
const PRODUCTION_SERVER = isCapacitorApp || isDesktopApp
  ? 'https://waitnot-restaurant1.onrender.com'
  : currentOrigin;

// Development server URL  
const DEVELOPMENT_SERVER = 'http://localhost:5001';

// Production frontend URL (for QR codes) — use current origin for web, Render for native
const PRODUCTION_FRONTEND = isCapacitorApp || isDesktopApp
  ? 'https://waitnot-restaurant1.onrender.com'
  : currentOrigin;

// Development frontend URL
const DEVELOPMENT_FRONTEND = 'http://localhost:3000';

export const getServerUrl = () => {
  if (isDesktopApp || isCapacitorApp) return PRODUCTION_SERVER;
  if (isDevelopment) return DEVELOPMENT_SERVER;
  return PRODUCTION_SERVER;
};

// Get the correct frontend URL for QR codes
export const getFrontendUrl = () => {
  // Always use the current production domain for QR codes so customers can access them
  console.log('🌐 Using production frontend for QR codes:', PRODUCTION_FRONTEND);
  return PRODUCTION_FRONTEND;
};

// Get WebSocket URL (same as server URL)
export const getWebSocketUrl = () => {
  return getServerUrl();
};

// Environment info for debugging
export const getEnvironmentInfo = () => {
  return {
    isDesktopApp,
    isCapacitorApp,
    isDevelopment,
    nodeEnv: process.env.NODE_ENV,
    protocol: typeof window !== 'undefined' ? window.location.protocol : '',
    hostname,
    userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : '',
    serverUrl: getServerUrl(),
    frontendUrl: getFrontendUrl(),
    webSocketUrl: getWebSocketUrl()
  };
};

// Log environment info on load
console.log('🔍 Environment Configuration:', getEnvironmentInfo());

// Export constants
export {
  isDesktopApp,
  isCapacitorApp,
  isDevelopment,
  PRODUCTION_SERVER,
  DEVELOPMENT_SERVER,
  PRODUCTION_FRONTEND,
  DEVELOPMENT_FRONTEND
};
