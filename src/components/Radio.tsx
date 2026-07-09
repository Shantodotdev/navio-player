interface RadioProps {
  /// True if the radio button is selected.
  checked: boolean;
  /// Callback triggered when the radio button is toggled.
  onChange: (checked: boolean) => void;
  /// Disables interactions if true.
  disabled?: boolean;
  /// Additional custom CSS classes.
  className?: string;
}

export function Radio({
  checked,
  onChange,
  disabled = false,
  className = "",
}: RadioProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`w-5 h-5 flex items-center justify-center rounded-full border transition-all duration-150 cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand/40 focus:ring-offset-1 focus:ring-offset-[#0e0e12] ${
        checked
          ? "bg-brand border-brand shadow-md shadow-brand-glow hover:bg-brand-light hover:border-brand-light"
          : "bg-black/40 border-white/10 hover:border-white/20"
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${className}`}
    >
      {/* Inner Dot Indicator */}
      <div
        className={`w-2.5 h-2.5 rounded-full bg-white transition-all duration-200 transform ${
          checked ? "scale-100 opacity-100" : "scale-50 opacity-0"
        }`}
      />
    </button>
  );
}
