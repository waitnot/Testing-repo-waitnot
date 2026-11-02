/**
 * StaffPinLogin — Shared-device login experience
 *
 * Flow:
 *  1. Enter restaurant ID (or auto-detect from URL) → fetch staff profiles
 *  2. Staff selects their profile card
 *  3. Enter 4–6 digit PIN
 *  4. Authenticate → navigate to staff-dashboard
 *
 * Fallback: "Email & Password Login" link → /staff-login
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, KeyRound, Mail, RefreshCw } from 'lucide-react';
import axios from '../config/axios.js';
import { secureSet, secureRemove } from '../utils/secureStorage.js';
import PinKeypad from '../components/PinKeypad.jsx';

// Colour palette for staff avatars (cycles by staff id)
const AVATAR_COLORS = [
  'bg-red-500',   'bg-orange-500', 'bg-amber-500',
  'bg-green-500', 'bg-teal-500',   'bg-blue-500',
  'bg-indigo-500','bg-purple-500', 'bg-pink-500',
];

function avatarColor(id) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

// ── Step 1: Restaurant selector ───────────────────────────────────────────────
function RestaurantStep({ onSelect }) {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');

  useEffect(() => {
    axios.get('/api/restaurants')
      .then(({ data }) => { setRestaurants(data); })
      .catch(() => setError('Failed to load restaurants'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex flex-col items-center gap-3 py-12">
      <div className="w-8 h-8 border-3 border-red-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-gray-500">Loading…</p>
    </div>
  );

  if (error) return <p className="text-red-500 text-sm text-center">{error}</p>;

  return (
    <div className="w-full space-y-3">
      <p className="text-sm font-medium text-gray-500 text-center mb-4">Select your restaurant</p>
      {restaurants.map(r => (
        <button
          key={r._id}
          onClick={() => onSelect(r)}
          className="w-full flex items-center gap-4 p-4 rounded-2xl border border-gray-200 bg-white hover:border-red-300 hover:bg-red-50 transition-all text-left"
        >
          {r.image
            ? <img src={r.image} alt={r.name} className="w-12 h-12 rounded-xl object-cover shrink-0" />
            : <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <span className="text-red-600 font-bold text-lg">{r.name[0]}</span>
              </div>
          }
          <div>
            <p className="font-semibold text-gray-800">{r.name}</p>
            <p className="text-xs text-gray-400">{r.address || r.email}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Step 2: Staff profile selection ──────────────────────────────────────────
function ProfileStep({ restaurant, onSelect, onBack }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  useEffect(() => {
    axios.get(`/api/pin/restaurant/${restaurant._id}/profiles`)
      .then(({ data }) => setProfiles(data))
      .catch(() => setError('Failed to load staff'))
      .finally(() => setLoading(false));
  }, [restaurant._id]);

  if (loading) return (
    <div className="flex flex-col items-center gap-3 py-12">
      <div className="w-7 h-7 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error) return <p className="text-red-500 text-sm text-center">{error}</p>;

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between mb-2">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700">
          <ChevronLeft size={16} /> Back
        </button>
        <p className="text-sm font-semibold text-gray-700">{restaurant.name}</p>
        <div className="w-12" />
      </div>

      <p className="text-sm font-medium text-gray-500 text-center">Who are you?</p>

      <div className="grid grid-cols-2 gap-3">
        {profiles.map(p => (
          <button
            key={p.id}
            onClick={() => onSelect(p)}
            className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-gray-200 bg-white
                       hover:border-red-300 hover:bg-red-50 transition-all"
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

      {profiles.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-4">No active staff found.</p>
      )}
    </div>
  );
}

// ── Step 3: PIN entry ─────────────────────────────────────────────────────────
function PinStep({ restaurant, profile, onBack, onSuccess }) {
  const [pin, setPin]         = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (pin.length < 4) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.post('/api/pin/login', {
        staffId: profile.id,
        pin,
      });

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

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (pin.length === 6) handleSubmit();
  }, [pin, handleSubmit]);

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between mb-2">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700">
          <ChevronLeft size={16} /> Back
        </button>
        <p className="text-sm font-semibold text-gray-700">{restaurant.name}</p>
        <div className="w-12" />
      </div>

      {/* Profile summary */}
      <div className="flex flex-col items-center gap-2 py-2">
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
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();

  // step: 'restaurant' | 'profile' | 'pin'
  const [step, setStep]           = useState('restaurant');
  const [restaurant, setRestaurant] = useState(null);
  const [profile, setProfile]     = useState(null);

  // If restaurantId query param is set, skip restaurant step
  useEffect(() => {
    const rid = searchParams.get('restaurantId');
    if (rid) {
      axios.get('/api/restaurants').then(({ data }) => {
        const r = data.find(x => x._id === rid);
        if (r) { setRestaurant(r); setStep('profile'); }
      }).catch(() => {});
    }
  }, [searchParams]);

  // Clear stale auth on mount
  useEffect(() => {
    localStorage.removeItem('staffToken');
    localStorage.removeItem('staffData');
    delete axios.defaults.headers.common['Authorization'];
    secureRemove('staffToken').catch(() => {});
    secureRemove('staffData').catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-red-50 flex flex-col items-center justify-start py-10 px-4">

      {/* Header */}
      <div className="mb-8 flex flex-col items-center gap-2">
        <div className="w-14 h-14 bg-red-500 rounded-2xl flex items-center justify-center shadow-lg">
          <KeyRound className="text-white w-7 h-7" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">WaitNot</h1>
        <p className="text-sm text-gray-500">Staff Quick Login</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-6">

        {step === 'restaurant' && (
          <RestaurantStep
            onSelect={r => { setRestaurant(r); setStep('profile'); }}
          />
        )}

        {step === 'profile' && restaurant && (
          <ProfileStep
            restaurant={restaurant}
            onSelect={p => {
              if (!p.hasPin) {
                // No PIN set — redirect to email/password login
                navigate('/staff-login');
                return;
              }
              setProfile(p);
              setStep('pin');
            }}
            onBack={() => setStep('restaurant')}
          />
        )}

        {step === 'pin' && restaurant && profile && (
          <PinStep
            restaurant={restaurant}
            profile={profile}
            onBack={() => setStep('profile')}
            onSuccess={() => navigate('/staff-dashboard')}
          />
        )}
      </div>

      {/* Footer links */}
      <div className="mt-6 flex flex-col items-center gap-2">
        <button
          onClick={() => navigate('/staff-login')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-red-600 transition-colors"
        >
          <Mail size={14} />
          Email & password login
        </button>
        <button
          onClick={() => navigate('/restaurant-login')}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Restaurant owner login
        </button>
      </div>
    </div>
  );
}
