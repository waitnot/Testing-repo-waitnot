import axios from 'axios';

// Auto-detect API base URL based on where the app is running
const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
const origin = typeof window !== 'undefined' ? window.location.origin : '';

let baseURL;
if (hostname === 'localhost' || hostname === '127.0.0.1') {
  // Local dev: use local server on port 5001
  baseURL = 'http://localhost:5001';
} else {
  // Deployed (Render, Domain India, Vercel, etc.): use same origin — server serves both API and client
  baseURL = origin;
}

const isDesktopApp = typeof window !== 'undefined' && window.navigator?.userAgent?.includes('Electron');
const isCapacitorApp = typeof window !== 'undefined' && (
  window.Capacitor?.isNativePlatform?.() ||
  window.location?.protocol === 'capacitor:'
);

// Native apps need a full URL since they don't have a web origin
if (isCapacitorApp) {
  baseURL = 'https://waitnot-restaurant1.onrender.com';
}
if (isDesktopApp) {
  baseURL = 'https://waitnot-restaurant1.onrender.com';
}

const isLocalDev = (hostname === 'localhost' || hostname === '127.0.0.1') && !isDesktopApp && !isCapacitorApp;

console.log('🔧 Axios baseURL:', baseURL);

// Create axios instance with optimized defaults
const axiosInstance = axios.create({
  baseURL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

axiosInstance.interceptors.request.use(
  (config) => {
    if (isLocalDev) {
      console.log('📤 API Request:', config.method?.toUpperCase(), config.url);
    }
    if (!config.headers.Authorization) {
      const token = localStorage.getItem('staffToken') || localStorage.getItem('restaurantToken') || localStorage.getItem('adminToken');
      if (token) config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (isLocalDev) {
      console.error('❌ Response Error:', error.response?.status, error.config?.url, error.message);
    }
    if (error.response?.status === 401) {
      const isStaffPage = window.location.pathname.includes('staff');
      if (isStaffPage) {
        localStorage.removeItem('staffToken');
        localStorage.removeItem('staffData');
        if (!window.location.pathname.includes('login')) {
          window.location.href = '/staff-login';
        }
      } else {
        localStorage.removeItem('restaurantToken');
        localStorage.removeItem('adminToken');
        localStorage.removeItem('restaurantId');
        localStorage.removeItem('restaurantData');
        if (!window.location.pathname.includes('login')) {
          window.location.href = '/restaurant-login';
        }
      }
    }
    return Promise.reject(error);
  }
);

// Apply to bare axios so pages using `import axios from 'axios'` also hit the right server
axios.defaults.baseURL = baseURL;
axios.defaults.timeout = 30000;

// Wake up server on app load (for cold-start prone platforms like Render free tier)
if (!isLocalDev && !isCapacitorApp && !isDesktopApp) {
  fetch(`${baseURL}/health`).catch(() => {});
}

export default axiosInstance;
