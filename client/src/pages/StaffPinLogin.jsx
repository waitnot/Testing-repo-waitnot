/**
 * StaffPinLogin — Device-bound shared tablet login
 *
 * SECURITY MODEL:
 *  Web (tablet/browser): bound to restaurant via localStorage['restaurantId']
 *    set when restaurant owner logs in. No restaurant selector shown.
 *
 *  Capacitor APK: no restaurant owner login, so staff identifies themselves
 *    by email first → app finds their profile and restaurant → shows PIN keypad.
 *    Profile is cached in localStorage['cachedStaffProfile'] so subsequent
 *    launches skip the email step entirely.
 *    Stored: { staffId, name, role, initials, restaurantName, hasPin }
 *    Never stored: tokens, passwords, PINs.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, KeyRound, Mail, AlertTriangle, Settings, UserX } from 'lucide-react';
import axios from '../config/axios.js';
import { secureSet, secureRemove } from '../utils/secureStorage.js';
import PinKeypad from '../components/PinKeypad.jsx';

const isCapacitor = typeof window !== 'undefined' && (
  window.Capacitor?.isNativePlatform?.() ||
  window.location?.protocol === 'capacitor:'
);

// ── Cached staff profile helpers ─────────────────────────────────────────────
const CACHE_KEY = 'cachedStaffProfile';

function getCachedProfile() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Validate required fields
    if (!parsed?.staffId || !parsed?.name) return null;
    return parsed;
  } catch {
    return null;
  }
}

function setCachedProfile(data) {
  // Only store safe, non-sensitive fields
  const safe = {
    staffId:        data.staffId,
    name:           data.name,
    role:           data.role,
    initials:       data.initials,
    restaurantName: data.restaurantName,
    hasPin:         data.hasPin,
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(safe));
}

function clearCachedProfile() {
  localStorage.removeItem(CACHE_KEY);
}

// ── Avatar colours ───────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  'bg-red-500','bg-orange-500','bg-amber-500',
  'bg-green-500','bg-teal-500','bg-blue-500',
  'bg-indigo-500','bg-purple-500','bg-pink-500',
];
function avatarColor(id) { return AVATAR_COLORS[id % AVATAR_COLORS.length]; }

// ── Setup required (web only — APK skips this) ───────────────────────────────
function SetupRequired({ onGoToOwnerLogin }) {
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
        <AlertTriangle className="w-8 h-8 text-amber-500" />
      </div>
      <div>
        <h2 className="font-bold text-gray-800 text-lg">Device not set up</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-xs">
          The restaurant owner needs to log in once to link this device.
        </p>
      </div>
      <button
        onClick={onGoToOwnerLogin}
        className="flex items-center gap-2 px-5 py-2.5 bg-red-500 text-white rounded-xl font-semibold text-sm hover:bg-red-600"
      >
        <Settings size={16} /> Owner Login to Set Up
      </button>
    </div>
  );
}

// ── APK: Email lookup step ────────────────────────────────────────────────────
function EmailLookupStep({ onFound }) {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleLookup = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setLoading(true); setError('');
    try {
      const { data } = await axios.post('/api/pin/lookup', { email: trimmed });
      if (!data.staffId) throw new Error('Staff not found');
      onFound(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Staff not found. Check your email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="text-center pb-2">
        <p className="font-semibold text-gray-700 text-base">Enter your email to continue</p>
        <p className="text-xs text-gray-400 mt-0.5">You'll then enter your PIN</p>
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      <input
        type="email"
        inputMode="email"
        autoFocus
        value={email}
        onChange={e => setEmail(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleLookup()}
        placeholder="your@email.com"
        className="w-full px-4 py-3.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-red-300"
      />

      <button
        onClick={handleLookup}
        disabled={loading || !email.trim()}
        className="w-full py-3.5 bg-red-500 text-white rounded-xl font-semibold text-base hover:bg-red-600 disabled:opacity-40 transition-colors"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Looking up…
          </span>
        ) : 'Continue'}
      </button>
    </div>
  );
}

// ── Staff profile grid (web tablet) ──────────────────────────────────────────
function ProfileStep({ restaurant, profiles, loading, onSelect }) {
  if (loading) return (
    <div className="flex flex-col items-center gap-3 py-12">
      <div className="w-7 h-7 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (profiles.length === 0) return (
    <div className="text-center py-8">
      <p className="text-sm text-gray-400">No active staff found for this restaurant.</p>
    </div>
  );

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center gap-3 pb-2 border-b border-gray-100">
        {restaurant?.image
          ? <img src={restaurant.image} alt={restaurant.name} className="w-10 h-10 rounded-xl object-cover" />
          : <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
              <span className="text-red-600 font-bold text-base">{restaurant?.name?.[0] || '?'}</span>
            </div>
        }
        <div>
          <p className="font-bold text-gray-800 text-sm">{restaurant?.name}</p>
          <p className="text-xs text-gray-400">Select your profile</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {profiles.map(p => (
          <button
            key={p.id}
            onClick={() => onSelect(p)}
            disabled={!p.hasPin}
            title={!p.hasPin ? 'No PIN set — ask manager to set a PIN' : ''}
            className={`flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all
              ${p.hasPin ? 'border-gray-200 bg-white hover:border-red-300 hover:bg-red-50'
                         : 'border-dashed border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'}`}
          >
            <div className={`w-14 h-14 rounded-full ${avatarColor(p.id)} flex items-center justify-center text-white font-bold text-xl`}>
              {p.initials}
            </div>
            <div className="text-center">
              <p className="font-semibold text-gray-800 text-sm leading-tight">{p.name}</p>
              <p className="text-xs text-gray-400 capitalize">{p.role}{p.waiterNumber ? ` · ${p.waiterNumber}` : ''}</p>
              {!p.hasPin && <p className="text-xs text-amber-500 mt-0.5">No PIN set</p>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── PIN entry ─────────────────────────────────────────────────────────────────
function PinStep({ restaurant, profile, onBack, onSuccess, onClearCache }) {
  const [pin, setPin]         = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (pin.length < 4) return;
    setLoading(true); setError('');
    try {
      const { data } = await axios.post('/api/pin/login', { staffId: profile.id, pin });
      localStorage.setItem('staffToken', data.token);
      localStorage.setItem('staffData', JSON.stringify(data.staff));
      axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
      axios.defaults.headers['Authorization'] = `Bearer ${data.token}`;
      try { await secureSet('staffToken', data.token); await secureSet('staffData', JSON.stringify(data.staff)); } catch (_) {}
      onSuccess();
    } catch (err) {
      const status = err.response?.status;
      const msg    = err.response?.data?.error || 'Incorrect PIN';
      setError(msg);
      setPin('');
      // If staff no longer exists on server, clear cache and go back to email step
      if (status === 404 && onClearCache) {
        clearCachedProfile();
        onClearCache();
      }
    } finally {
      setLoading(false);
    }
  }, [pin, profile.id, onSuccess, onClearCache]);

  useEffect(() => { if (pin.length === 6) handleSubmit(); }, [pin, handleSubmit]);

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700 min-h-[44px] px-1">
          <ChevronLeft size={16} /> Back
        </button>
        <p className="text-xs font-semibold text-gray-500 truncate max-w-[140px]">{restaurant?.name || profile.restaurantName}</p>
        <div className="w-14" />
      </div>

      <div className="flex flex-col items-center gap-2 py-1">
        <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full ${avatarColor(profile.id)} flex items-center justify-center text-white font-bold text-xl sm:text-2xl`}>
          {profile.initials}
        </div>
        <div className="text-center">
          <p className="font-bold text-gray-800 text-base">{profile.name}</p>
          <p className="text-xs text-gray-400 capitalize">{profile.role}</p>
        </div>
      </div>

      <PinKeypad
        pin={pin}
        onPin={setPin}
        onSubmit={handleSubmit}
        onClear={() => setPin('')}
        loading={loading}
        error={error}
        maxLen={6}
        label="Enter your PIN"
      />

      {/* Not you? — only shown on Capacitor when a cached profile is active */}
      {isCapacitor && onClearCache && (
        <div className="flex justify-center pt-2">
          <button
            onClick={() => {
              clearCachedProfile();
              onClearCache();
            }}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-500 transition-colors py-2"
          >
            <UserX size={13} /> Not you? Switch account
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function StaffPinLogin() {
  const navigate = useNavigate();
  const [step, setStep]             = useState('loading');
  const [restaurant, setRestaurant] = useState(null);
  const [profiles, setProfiles]     = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profile, setProfile]       = useState(null);
  // Whether the current PIN step was entered from a cached profile
  const [fromCache, setFromCache]   = useState(false);

  useEffect(() => {
    // Clear stale staff session
    localStorage.removeItem('staffToken');
    localStorage.removeItem('staffData');
    delete axios.defaults.headers.common['Authorization'];
    secureRemove('staffToken').catch(() => {});
    secureRemove('staffData').catch(() => {});

    if (isCapacitor) {
      // APK: check for cached staff profile first
      const cached = getCachedProfile();
      if (cached) {
        // Skip email step — jump straight to PIN keypad
        setProfile({
          id:             cached.staffId,
          name:           cached.name,
          role:           cached.role,
          initials:       cached.initials,
          restaurantName: cached.restaurantName,
        });
        setRestaurant({ name: cached.restaurantName });
        setFromCache(true);
        setStep('pin');
      } else {
        setStep('email-lookup');
      }
      return;
    }

    // Web: use device-bound restaurant from localStorage
    const rid = localStorage.getItem('restaurantId');
    const rdata = (() => { try { return JSON.parse(localStorage.getItem('restaurantData') || 'null'); } catch { return null; } })();

    if (!rid) { setStep('setup'); return; }

    setRestaurant(rdata || { _id: rid, name: 'Restaurant' });
    setProfilesLoading(true);
    axios.get(`/api/pin/restaurant/${rid}/profiles`)
      .then(({ data }) => { setProfiles(data); setStep('profiles'); })
      .catch(() => { setProfiles([]); setStep('profiles'); })
      .finally(() => setProfilesLoading(false));
  }, []);

  useEffect(() => {
    if (isCapacitor) return;
    const rid = localStorage.getItem('restaurantId');
    if (!rid) return;
    axios.get(`/api/restaurants/${rid}`).then(({ data }) => setRestaurant(data)).catch(() => {});
  }, []);

  // Called when cache is cleared (Not you? or 404 response)
  const handleCacheCleared = () => {
    setFromCache(false);
    setProfile(null);
    setRestaurant(null);
    setStep('email-lookup');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-red-50 flex flex-col items-center justify-start py-6 sm:py-10 px-3 sm:px-4">
      {/* Header */}
      <div className="mb-5 sm:mb-8 flex flex-col items-center gap-1.5 sm:gap-2">
        <div className="w-12 h-12 sm:w-14 sm:h-14 bg-red-500 rounded-2xl flex items-center justify-center shadow-lg">
          <KeyRound className="text-white w-6 h-6 sm:w-7 sm:h-7" />
        </div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">WaitNot</h1>
        <p className="text-xs sm:text-sm text-gray-500">Staff Login</p>
      </div>

      {/* Card — full width on phones, capped at sm on larger screens */}
      <div className="w-full sm:max-w-sm bg-white sm:rounded-3xl rounded-2xl shadow-xl p-4 sm:p-6">
        {step === 'loading' && (
          <div className="flex justify-center py-8">
            <div className="w-7 h-7 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {step === 'setup' && <SetupRequired onGoToOwnerLogin={() => navigate('/restaurant-login')} />}
        {step === 'email-lookup' && (
          <EmailLookupStep
            onFound={staffInfo => {
              if (!staffInfo.hasPin) {
                alert(`No PIN set for ${staffInfo.name}. Ask your manager to set a PIN from the dashboard.`);
                return;
              }
              // Cache the profile for future launches
              if (isCapacitor) {
                setCachedProfile(staffInfo);
              }
              setProfile({ id: staffInfo.staffId, name: staffInfo.name, role: staffInfo.role, initials: staffInfo.initials, restaurantName: staffInfo.restaurantName });
              setRestaurant({ name: staffInfo.restaurantName });
              setStep('pin');
            }}
          />
        )}
        {step === 'profiles' && (
          <ProfileStep restaurant={restaurant} profiles={profiles} loading={profilesLoading}
            onSelect={p => { setProfile(p); setStep('pin'); }} />
        )}
        {step === 'pin' && profile && (
          <PinStep
            restaurant={restaurant}
            profile={profile}
            onBack={() => {
              if (fromCache) {
                // Don't go back to email when loaded from cache — use "Not you?" instead
                return;
              }
              setStep(isCapacitor ? 'email-lookup' : 'profiles');
            }}
            onSuccess={() => navigate('/staff-dashboard')}
            onClearCache={isCapacitor ? handleCacheCleared : null}
          />
        )}
      </div>

      {/* Footer links */}
      <div className="mt-4 sm:mt-6 flex flex-col items-center gap-2">
        <button onClick={() => navigate('/staff-login')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-red-600 transition-colors py-2">
          <Mail size={14} /> Email &amp; password login
        </button>
        {!isCapacitor && step !== 'setup' && (
          <button onClick={() => navigate('/restaurant-login')} className="text-xs text-gray-400 hover:text-gray-600 py-1">
            Switch restaurant (owner login)
          </button>
        )}
      </div>
    </div>
  );
}
