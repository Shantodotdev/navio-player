interface SwitchProps {
  /// True if the switch is ON.
  checked: boolean;
  /// Callback triggered when the switch state toggles.
  onChange: (checked: boolean) => void;
  /// Disables interactions if true.
  disabled?: boolean;
  /// Additional custom CSS classes.
  className?: string;
}

export function Switch({
  checked,
  onChange,
  disabled = false,
  className = "",
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`w-11 h-6 shrink-0 flex items-center rounded-full p-1 transition-all duration-250 cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand/40 focus:ring-offset-1 focus:ring-offset-[#0e0e12] ${
        checked
          ? "bg-brand shadow shadow-brand-glow border border-brand"
          : "bg-black/50 border border-white/10"
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${className}`}
    >
      {/* Sliding Knob */}
      <div
        className={`w-4 h-4 rounded-full bg-white shadow-md transition-transform duration-250 ease-out transform ${
          checked ? "translate-x-[18px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}
