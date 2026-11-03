/**
 * StaffPinLogin — Device-bound shared tablet login
 *
 * SECURITY MODEL:
 *  - This device is bound to the restaurant that last logged in via
 *    /restaurant-login. The restaurant ID is read from localStorage.
 *  - The restaurant selector is NOT shown — staff can only see profiles
 *    for the restaurant this device belongs to.
 *  - If no restaurant is bound, the page shows a "Setup required" screen
 *    directing the owner to log in first.
 *  - PIN brute-force is rate-limited on the server (5 attempts → lockout).
 *
 * Flow:
 *  1. Read restaurantId from localStorage ('restaurantId')  →  if missing, show setup screen
 *  2. Fetch staff profiles for THAT restaurant only
 *  3. Staff selects their profile card
 *  4. Enter 4–6 digit PIN
 *  5. Authenticate → navigate to /staff-dashboard
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, KeyRound, Mail, AlertTriangle, Settings } from 'lucide-react';
import axios from '../config/axios.js';
import { secureSet, secureRemove } from '../utils/secureStorage.js';
import PinKeypad from '../components/PinKeypad.jsx';

// ── Avatar colours (cycle by staff id) ───────────────────────────────────────
const AVATAR_COLORS = [
  'bg-red-500',    'bg-orange-500', 'bg-amber-500',
  'bg-green-500',  'bg-teal-500',   'bg-blue-500',
  'bg-indigo-500', 'bg-purple-500', 'bg-pink-500',
];
function avatarColor(id) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

// ── Setup required screen ─────────────────────────────────────────────────────
function SetupRequired({ onGoToOwnerLogin }) {
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
        <AlertTriangle className="w-8 h-8 text-amber-500" />
      </div>
      <div>
        <h2 className="font-bold text-gray-800 text-lg">Device not set up</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-xs">
          This device isn't linked to a restaurant yet. The restaurant owner needs to
          log in once to bind this device.
        </p>
      </div>
      <button
        onClick={onGoToOwnerLogin}
        className="flex items-center gap-2 px-5 py-2.5 bg-red-500 text-white rounded-xl font-semibold text-sm hover:bg-red-600 transition-colors"
      >
        <Settings size={16} />
        Owner Login to Set Up
      </button>
    </div>
  );
}

// ── Staff profile grid ────────────────────────────────────────────────────────
function ProfileStep({ restaurant, profiles, loading, onSelect }) {
  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <div className="w-7 h-7 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-400">Loading staff…</p>
      </div>
    );
  }

  if (profiles.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-gray-400">No active staff found for this restaurant.</p>
        <p className="text-xs text-gray-400 mt-1">Add staff from the Restaurant Dashboard → Staff tab.</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      {/* Restaurant header */}
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

      {/* Staff grid */}
      <div className="grid grid-cols-2 gap-3">
        {profiles.map(p => (
          <button
            key={p.id}
            onClick={() => onSelect(p)}
            className={`flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all
              ${p.hasPin
                ? 'border-gray-200 bg-white hover:border-red-300 hover:bg-red-50'
                : 'border-dashed border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
              }`}
            disabled={!p.hasPin}
            title={!p.hasPin ? 'No PIN set — ask manager to set a PIN' : ''}
          >
            <div className={`w-14 h-14 rounded-full ${avatarColor(p.id)} flex items-center justify-center text-white font-bold text-xl`}>
              {p.initials}
            </div>
            <div className="text-center">
              <p className="font-semibold text-gray-800 text-sm leading-tight">{p.name}</p>
              <p className="text-xs text-gray-400 capitalize">{p.role}{p.waiterNumber ? ` · ${p.waiterNumber}` : ''}</p>
              {!p.hasPin && (
                <p className="text-xs text-amber-500 mt-0.5">No PIN set</p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── PIN entry ─────────────────────────────────────────────────────────────────
function PinStep({ restaurant, profile, onBack, onSuccess }) {
  const [pin, setPin]         = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (pin.length < 4) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.post('/api/pin/login', { staffId: profile.id, pin });

      // Persist session
      localStorage.setItem('staffToken', data.token);
      localStorage.setItem('staffData', JSON.stringify(data.staff));
      axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
      axios.defaults.headers['Authorization'] = `Bearer ${data.token}`;
      try {
        await secureSet('staffToken', data.token);
        await secureSet('staffData', JSON.stringify(data.staff));
      } catch (_) {}

      onSuccess();
    } catch (err) {
      const msg = err.response?.data?.error || 'Incorrect PIN';
      setError(msg);
      setPin('');
    } finally {
      setLoading(false);
    }
  }, [pin, profile.id, onSuccess]);

  // Auto-submit at 6 digits
  useEffect(() => {
    if (pin.length === 6) handleSubmit();
  }, [pin, handleSubmit]);

  return (
    <div className="w-full space-y-4">
      {/* Back + restaurant name */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700">
          <ChevronLeft size={16} /> Back
        </button>
        <p className="text-xs font-semibold text-gray-500">{restaurant?.name}</p>
        <div className="w-14" />
      </div>

      {/* Profile avatar */}
      <div className="flex flex-col items-center gap-2 py-1">
        <div className={`w-16 h-16 rounded-full ${avatarColor(profile.id)} flex items-center justify-center text-white font-bold text-2xl`}>
          {profile.initials}
        </div>
        <div className="text-center">
          <p className="font-bold text-gray-800">{profile.name}</p>
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
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function StaffPinLogin() {
  const navigate = useNavigate();

  const [step, setStep]             = useState('loading'); // 'loading' | 'setup' | 'profiles' | 'pin'
  const [restaurant, setRestaurant] = useState(null);
  const [profiles, setProfiles]     = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profile, setProfile]       = useState(null);

  // ── On mount: check device binding ─────────────────────────────────────────
  useEffect(() => {
    // Clear stale staff session
    localStorage.removeItem('staffToken');
    localStorage.removeItem('staffData');
    delete axios.defaults.headers.common['Authorization'];
    secureRemove('staffToken').catch(() => {});
    secureRemove('staffData').catch(() => {});

    // Read restaurant binding from localStorage
    const rid  = localStorage.getItem('restaurantId');
    const rdata = (() => {
      try { return JSON.parse(localStorage.getItem('restaurantData') || 'null'); } catch { return null; }
    })();

    if (!rid) {
      // No restaurant bound to this device
      setStep('setup');
      return;
    }

    // We have a restaurant — load profiles
    setRestaurant(rdata || { _id: rid, name: 'Restaurant' });
    setProfilesLoading(true);
    axios.get(`/api/pin/restaurant/${rid}/profiles`)
      .then(({ data }) => {
        setProfiles(data);
        setStep('profiles');
      })
      .catch(() => {
        // If profiles fail, still show the page but with empty list
        setProfiles([]);
        setStep('profiles');
      })
      .finally(() => setProfilesLoading(false));
  }, []);

  // ── Also fetch full restaurant info for display ─────────────────────────────
  useEffect(() => {
    const rid = localStorage.getItem('restaurantId');
    if (!rid) return;
    axios.get(`/api/restaurants/${rid}`)
      .then(({ data }) => setRestaurant(data))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-red-50 flex flex-col items-center justify-start py-10 px-4">

      {/* Header */}
      <div className="mb-8 flex flex-col items-center gap-2">
        <div className="w-14 h-14 bg-red-500 rounded-2xl flex items-center justify-center shadow-lg">
          <KeyRound className="text-white w-7 h-7" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">WaitNot</h1>
        <p className="text-sm text-gray-500">Staff Login</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-6">

        {step === 'loading' && (
          <div className="flex justify-center py-8">
            <div className="w-7 h-7 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {step === 'setup' && (
          <SetupRequired onGoToOwnerLogin={() => navigate('/restaurant-login')} />
        )}

        {step === 'profiles' && (
          <ProfileStep
            restaurant={restaurant}
            profiles={profiles}
            loading={profilesLoading}
            onSelect={p => { setProfile(p); setStep('pin'); }}
          />
        )}

        {step === 'pin' && restaurant && profile && (
          <PinStep
            restaurant={restaurant}
            profile={profile}
            onBack={() => { setProfile(null); setStep('profiles'); }}
            onSuccess={() => navigate('/staff-dashboard')}
          />
        )}
      </div>

      {/* Footer */}
      <div className="mt-6 flex flex-col items-center gap-2">
        <button
          onClick={() => navigate('/staff-login')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-red-600 transition-colors"
        >
          <Mail size={14} />
          Email & password login
        </button>

        {/* Only show this if device is already bound — owner can re-login to rebind */}
        {step !== 'setup' && (
          <button
            onClick={() => navigate('/restaurant-login')}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Switch restaurant (owner login)
          </button>
        )}
      </div>
    </div>
  );
}
