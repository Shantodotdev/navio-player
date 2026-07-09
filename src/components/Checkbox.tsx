import { Check } from "lucide-react";

interface CheckboxProps {
  /// True if the checkbox is checked.
  checked: boolean;
  /// Callback triggered when the checkbox state toggles.
  onChange: (checked: boolean) => void;
  /// Disables interactions if true.
  disabled?: boolean;
  /// Additional custom CSS classes.
  className?: string;
}

export function Checkbox({
  checked,
  onChange,
  disabled = false,
  className = "",
}: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`w-5 h-5 flex items-center justify-center rounded border transition-all duration-150 cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand/40 focus:ring-offset-1 focus:ring-offset-[#0e0e12] ${
        checked
          ? "bg-brand border-brand text-white shadow-md shadow-brand-glow hover:bg-brand-light hover:border-brand-light"
          : "bg-black/40 border-white/10 hover:border-white/20 text-transparent"
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${className}`}
    >
      <Check
        size={13}
        strokeWidth={4.5}
        className={`transition-all duration-200 transform ${
          checked
            ? "scale-100 opacity-100 rotate-0"
            : "scale-50 opacity-0 -rotate-12"
        }`}
      />
    </button>
  );
}
