/**
 * StaffPinLogin — Device-bound PIN login
 * Full-screen fixed layout — no scroll on any phone screen.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Mail, AlertTriangle, Settings, UserX, ChevronLeft } from 'lucide-react';
import axios from '../config/axios.js';
import { secureSet, secureRemove } from '../utils/secureStorage.js';
import PinKeypad from '../components/PinKeypad.jsx';

const isCapacitor = typeof window !== 'undefined' && (
  window.Capacitor?.isNativePlatform?.() ||
  window.location?.protocol === 'capacitor:'
);

// ── Cache helpers ─────────────────────────────────────────────────────────────
const CACHE_KEY = 'cachedStaffProfile';
function getCachedProfile() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return (p?.staffId && p?.name) ? p : null;
  } catch { return null; }
}
function setCachedProfile(d) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({
    staffId: d.staffId, name: d.name, role: d.role,
    initials: d.initials, restaurantName: d.restaurantName, hasPin: d.hasPin,
  }));
}
function clearCachedProfile() { localStorage.removeItem(CACHE_KEY); }

// ── Avatar ────────────────────────────────────────────────────────────────────
const COLORS = ['bg-red-500','bg-orange-500','bg-amber-500','bg-green-500',
                'bg-teal-500','bg-blue-500','bg-indigo-500','bg-purple-500','bg-pink-500'];
const avatarColor = id => COLORS[id % COLORS.length];

// ── Setup Required ────────────────────────────────────────────────────────────
function SetupRequired({ onGoToOwnerLogin }) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 flex-1 text-center px-4">
      <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
        <AlertTriangle className="w-8 h-8 text-amber-500" />
      </div>
      <div>
        <p className="font-bold text-gray-800 text-lg">Device not set up</p>
        <p className="text-sm text-gray-500 mt-1">The restaurant owner needs to log in once to link this device.</p>
      </div>
      <button onClick={onGoToOwnerLogin}
        className="flex items-center gap-2 px-6 py-3 bg-red-500 text-white rounded-2xl font-semibold text-sm hover:bg-red-600 active:scale-95 transition-all">
        <Settings size={16} /> Owner Login to Set Up
      </button>
    </div>
  );
}

// ── Email Lookup ──────────────────────────────────────────────────────────────
function EmailLookupStep({ onFound }) {
  const [email, setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');

  const handle = async () => {
    const t = email.trim().toLowerCase();
    if (!t) return;
    setLoading(true); setError('');
    try {
      const { data } = await axios.post('/api/pin/lookup', { email: t });
      if (!data.staffId) throw new Error('Not found');
      onFound(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Staff not found. Check your email.');
    } finally { setLoading(false); }
  };

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="text-center">
        <p className="font-semibold text-gray-700">Enter your email</p>
        <p className="text-xs text-gray-400 mt-0.5">We'll find your profile</p>
      </div>
      {error && (
        <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center">{error}</div>
      )}
      <input
        type="email" inputMode="email" autoFocus
        value={email}
        onChange={e => setEmail(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handle()}
        placeholder="your@email.com"
        className="w-full px-4 py-3.5 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-red-300 bg-gray-50"
      />
      <button onClick={handle} disabled={loading || !email.trim()}
        className="w-full py-4 bg-red-500 text-white rounded-2xl font-bold text-base hover:bg-red-600 active:scale-95 transition-all disabled:opacity-40">
        {loading
          ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Looking up…</span>
          : 'Continue →'}
      </button>
    </div>
  );
}

// ── Profile Grid ──────────────────────────────────────────────────────────────
function ProfileStep({ restaurant, profiles, loading, onSelect }) {
  if (loading) return (
    <div className="flex items-center justify-center flex-1">
      <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!profiles.length) return (
    <div className="flex items-center justify-center flex-1">
      <p className="text-sm text-gray-400 text-center">No active staff found.</p>
    </div>
  );
  return (
    <div className="flex flex-col gap-3 w-full">
      <div className="flex items-center gap-2.5 pb-3 border-b border-gray-100">
        <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
          <span className="text-red-600 font-bold text-sm">{restaurant?.name?.[0] || '?'}</span>
        </div>
        <div>
          <p className="font-bold text-gray-800 text-sm leading-tight">{restaurant?.name}</p>
          <p className="text-xs text-gray-400">Who are you?</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 overflow-y-auto">
        {profiles.map(p => (
          <button key={p.id} onClick={() => onSelect(p)} disabled={!p.hasPin}
            className={`flex flex-col items-center gap-2 py-4 px-2 rounded-2xl border transition-all
              ${p.hasPin ? 'border-gray-200 bg-white hover:border-red-300 hover:bg-red-50 active:scale-95'
                         : 'border-dashed border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'}`}>
            <div className={`w-12 h-12 rounded-full ${avatarColor(p.id)} flex items-center justify-center text-white font-bold text-lg`}>
              {p.initials}
            </div>
            <div className="text-center">
              <p className="font-semibold text-gray-800 text-sm leading-tight">{p.name}</p>
              <p className="text-xs text-gray-400 capitalize">{p.role}</p>
              {!p.hasPin && <p className="text-xs text-amber-500">No PIN set</p>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── PIN Step ──────────────────────────────────────────────────────────────────
function PinStep({ restaurant, profile, onBack, onSuccess, onClearCache, showBack }) {
  const [pin, setPin]       = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const submit = useCallback(async () => {
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
      setError(err.response?.data?.error || 'Incorrect PIN');
      setPin('');
      if (err.response?.status === 404 && onClearCache) { clearCachedProfile(); onClearCache(); }
    } finally { setLoading(false); }
  }, [pin, profile.id, onSuccess, onClearCache]);

  useEffect(() => { if (pin.length === 6) submit(); }, [pin, submit]);

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      {/* Profile identity */}
      <div className="flex flex-col items-center gap-1.5 pb-1">
        <div className={`w-14 h-14 rounded-full ${avatarColor(profile.id)} flex items-center justify-center text-white font-bold text-xl shadow-md`}>
          {profile.initials}
        </div>
        <p className="font-bold text-gray-800 text-base leading-tight">{profile.name}</p>
        <p className="text-xs text-gray-400 capitalize">{profile.role} · {restaurant?.name || profile.restaurantName}</p>
      </div>

      {/* PIN keypad */}
      <PinKeypad
        pin={pin} onPin={setPin} onSubmit={submit} onClear={() => setPin('')}
        loading={loading} error={error} maxLen={6} label="Enter your PIN"
      />

      {/* Switch account */}
      {isCapacitor && onClearCache && (
        <button onClick={() => { clearCachedProfile(); onClearCache(); }}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-500 transition-colors py-1 mt-1">
          <UserX size={13} /> Not you? Switch account
        </button>
      )}
      {showBack && (
        <button onClick={onBack}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 py-1">
          <ChevronLeft size={13} /> Back
        </button>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function StaffPinLogin() {
  const navigate = useNavigate();
  const [step, setStep]           = useState('loading');
  const [restaurant, setRestaurant] = useState(null);
  const [profiles, setProfiles]   = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profile, setProfile]     = useState(null);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    localStorage.removeItem('staffToken');
    localStorage.removeItem('staffData');
    delete axios.defaults.headers.common['Authorization'];
    secureRemove('staffToken').catch(() => {});
    secureRemove('staffData').catch(() => {});

    if (isCapacitor) {
      const cached = getCachedProfile();
      if (cached) {
        setProfile({ id: cached.staffId, name: cached.name, role: cached.role, initials: cached.initials, restaurantName: cached.restaurantName });
        setRestaurant({ name: cached.restaurantName });
        setFromCache(true);
        setStep('pin');
      } else {
        setStep('email-lookup');
      }
      return;
    }

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

  const handleCacheCleared = () => {
    setFromCache(false); setProfile(null); setRestaurant(null); setStep('email-lookup');
  };

  // ── Render — full-screen, no scroll ──────────────────────────────────────
  return (
    <div className="fixed inset-0 flex flex-col bg-gradient-to-b from-red-500 to-red-600 overflow-hidden">

      {/* ── TOP: Branding strip ─────────────────────────────────────────── */}
      <div className="flex flex-col items-center justify-center pt-8 pb-5 shrink-0">
        <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mb-2 backdrop-blur-sm">
          <KeyRound className="text-white w-6 h-6" />
        </div>
        <h1 className="text-white font-bold text-xl tracking-tight">WaitNot</h1>
        <p className="text-white/70 text-xs mt-0.5">Staff Login</p>
      </div>

      {/* ── BOTTOM: White card fills rest of screen ─────────────────────── */}
      <div className="flex-1 bg-white rounded-t-3xl flex flex-col min-h-0 overflow-hidden">

        {/* Scrollable content area (only scrolls if content truly overflows) */}
        <div className="flex-1 overflow-y-auto px-5 pt-6 pb-4">

          {step === 'loading' && (
            <div className="flex items-center justify-center h-full py-16">
              <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {step === 'setup' && (
            <SetupRequired onGoToOwnerLogin={() => navigate('/restaurant-login')} />
          )}

          {step === 'email-lookup' && (
            <EmailLookupStep
              onFound={staffInfo => {
                if (!staffInfo.hasPin) {
                  alert(`No PIN set for ${staffInfo.name}. Ask your manager to set a PIN from the dashboard.`);
                  return;
                }
                if (isCapacitor) setCachedProfile(staffInfo);
                setProfile({ id: staffInfo.staffId, name: staffInfo.name, role: staffInfo.role, initials: staffInfo.initials, restaurantName: staffInfo.restaurantName });
                setRestaurant({ name: staffInfo.restaurantName });
                setStep('pin');
              }}
            />
          )}

          {step === 'profiles' && (
            <ProfileStep
              restaurant={restaurant} profiles={profiles} loading={profilesLoading}
              onSelect={p => { setProfile(p); setStep('pin'); }}
            />
          )}

          {step === 'pin' && profile && (
            <PinStep
              restaurant={restaurant}
              profile={profile}
              showBack={!fromCache}
              onBack={() => setStep(isCapacitor ? 'email-lookup' : 'profiles')}
              onSuccess={() => navigate('/staff-dashboard')}
              onClearCache={isCapacitor ? handleCacheCleared : null}
            />
          )}
        </div>

        {/* ── Fixed footer inside card ──────────────────────────────────── */}
        <div className="shrink-0 border-t border-gray-100 px-5 py-3 flex flex-col items-center gap-1.5">
          <button onClick={() => navigate('/staff-login')}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-500 transition-colors py-1">
            <Mail size={13} /> Use email &amp; password instead
          </button>
          {!isCapacitor && step !== 'setup' && (
            <button onClick={() => navigate('/restaurant-login')}
              className="text-xs text-gray-300 hover:text-gray-500 py-0.5">
              Switch restaurant
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
