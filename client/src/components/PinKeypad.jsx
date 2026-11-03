/**
 * PinKeypad — fills available width, buttons expand to fill the grid.
 * Designed for full-screen phone layouts with no scroll.
 */

const KEYS = [
  ['1','2','3'],
  ['4','5','6'],
  ['7','8','9'],
  ['', '0', 'del'],
];

export default function PinKeypad({
  pin = '',
  onPin,
  onSubmit,
  onClear,
  loading = false,
  error = '',
  maxLen = 6,
  label = 'Enter your PIN',
}) {
  const handleKey = k => {
    if (loading) return;
    if (k === 'del') onPin(pin.slice(0, -1));
    else if (k !== '' && pin.length < maxLen) onPin(pin + k);
  };

  return (
    <div className="flex flex-col items-center gap-3 w-full select-none">

      {/* Label */}
      <p className="text-sm font-medium text-gray-500">{label}</p>

      {/* PIN dot indicators */}
      <div className="flex items-center gap-3 py-1">
        {Array.from({ length: maxLen }, (_, i) => (
          <div key={i} className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-100 ${
            i < pin.length ? 'bg-red-500 border-red-500 scale-125' : 'bg-transparent border-gray-300'
          }`} />
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="w-full text-center text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2 border border-red-100">
          {error}
        </div>
      )}

      {/* Keypad grid — buttons stretch to fill */}
      <div className="grid grid-cols-3 gap-2.5 w-full">
        {KEYS.flat().map((k, idx) => {
          if (k === '') return <div key={idx} />;

          if (k === 'del') return (
            <button
              key={idx}
              onClick={() => handleKey('del')}
              disabled={loading || pin.length === 0}
              className="h-14 flex items-center justify-center rounded-2xl bg-gray-100 text-gray-500
                         active:scale-95 active:bg-gray-200 transition-all
                         disabled:opacity-25 focus:outline-none"
              aria-label="Delete"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 5H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10l-7-7 7-7z"/>
                <path d="m13 9 6 6"/><path d="m19 9-6 6"/>
              </svg>
            </button>
          );

          return (
            <button
              key={idx}
              onClick={() => handleKey(k)}
              disabled={loading}
              className="h-14 flex items-center justify-center rounded-2xl bg-gray-50 border border-gray-200
                         text-gray-800 text-2xl font-semibold
                         active:scale-95 active:bg-red-50 active:border-red-300 transition-all
                         hover:bg-gray-100 focus:outline-none disabled:opacity-40 shadow-sm"
            >
              {k}
            </button>
          );
        })}
      </div>

      {/* Submit */}
      <button
        onClick={onSubmit}
        disabled={loading || pin.length < 4}
        className="w-full h-14 rounded-2xl bg-red-500 text-white font-bold text-base
                   hover:bg-red-600 active:scale-95 transition-all shadow-md shadow-red-200
                   disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Verifying…
          </span>
        ) : 'Confirm PIN'}
      </button>
    </div>
  );
}
