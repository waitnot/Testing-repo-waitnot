/**
 * PinKeypad — reusable numeric PIN input component
 * Props:
 *   pin        {string}   current PIN value
 *   onPin      {fn}       (newPin) => void
 *   onSubmit   {fn}       () => void
 *   onClear    {fn}       () => void
 *   loading    {bool}
 *   error      {string}
 *   maxLen     {number}   default 6
 *   label      {string}   prompt text
 */
import { Backspace } from 'lucide-react';

const KEYS = [
  ['1','2','3'],
  ['4','5','6'],
  ['7','8','9'],
  ['',  '0', 'del'],
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
  const handleKey = (k) => {
    if (loading) return;
    if (k === 'del') {
      onPin(pin.slice(0, -1));
    } else if (k === '' ) {
      // empty cell — no action
    } else {
      if (pin.length < maxLen) {
        const next = pin + k;
        onPin(next);
      }
    }
  };

  // Auto-submit when PIN reaches maxLen
  // Caller can also use the "→" submit button
  const dots = Array.from({ length: maxLen }, (_, i) => (
    <div
      key={i}
      className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
        i < pin.length
          ? 'bg-red-500 border-red-500 scale-110'
          : 'bg-transparent border-gray-300'
      }`}
    />
  ));

  return (
    <div className="flex flex-col items-center gap-4 select-none w-full max-w-xs mx-auto">
      {/* Label */}
      <p className="text-sm font-medium text-gray-500">{label}</p>

      {/* PIN dots */}
      <div className="flex items-center gap-3 py-2">
        {dots}
      </div>

      {/* Error */}
      {error && (
        <div className="w-full text-center text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Keypad grid */}
      <div className="grid grid-cols-3 gap-3 w-full">
        {KEYS.flat().map((k, idx) => {
          if (k === '') return <div key={idx} />;

          if (k === 'del') {
            return (
              <button
                key={idx}
                onClick={() => handleKey('del')}
                disabled={loading || pin.length === 0}
                className="aspect-square flex items-center justify-center rounded-2xl bg-gray-100 text-gray-600 text-lg font-semibold
                           active:scale-95 transition-transform disabled:opacity-30
                           hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-red-300"
                aria-label="Delete"
              >
                <Backspace size={20} />
              </button>
            );
          }

          return (
            <button
              key={idx}
              onClick={() => handleKey(k)}
              disabled={loading}
              className="aspect-square flex items-center justify-center rounded-2xl bg-white border border-gray-200
                         text-gray-800 text-2xl font-semibold shadow-sm
                         active:scale-95 active:bg-red-50 active:border-red-300 transition-all
                         hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-300
                         disabled:opacity-50"
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
        className="w-full py-3.5 rounded-2xl bg-red-500 text-white font-bold text-base
                   hover:bg-red-600 active:scale-95 transition-all
                   disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-2"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Verifying…
          </span>
        ) : (
          'Confirm PIN'
        )}
      </button>

      {/* Clear */}
      {onClear && pin.length > 0 && (
        <button
          onClick={onClear}
          className="text-sm text-gray-400 hover:text-gray-600 underline"
        >
          Clear
        </button>
      )}
    </div>
  );
}
