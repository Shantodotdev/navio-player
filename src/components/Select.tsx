import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  /// Array of select options containing a value and label.
  options: SelectOption[];
  /// Currently selected option value.
  value: string;
  /// Callback triggered when a new option is chosen.
  onChange: (value: string) => void;
  /// Optional placeholder displayed if no value is matched.
  placeholder?: string;
  /// Additional custom CSS classes for layout positioning.
  className?: string;
}

export function Select({
  options,
  value,
  onChange,
  placeholder = "Select an option...",
  className = "",
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Find the label of the currently selected option
  const selectedOption = options.find((opt) => opt.value === value);
  const displayText = selectedOption ? selectedOption.label : placeholder;

  // Close the dropdown if clicking outside of the component boundaries
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 bg-black/40 hover:bg-black/60 border border-white/5 hover:border-white/10 rounded-lg text-sm text-gray-300 font-medium transition-all text-left focus:outline-none focus:border-brand/40 focus:ring-1 focus:ring-brand/40 shadow-inner cursor-pointer"
      >
        <span className="truncate">{displayText}</span>
        <ChevronDown
          size={16}
          className={`text-gray-500 transition-transform duration-250 shrink-0 ${
            isOpen ? "rotate-180 text-brand-light" : ""
          }`}
        />
      </button>

      {/* Floating Options Panel */}
      <div
        className={`absolute z-50 left-0 right-0 mt-1.5 bg-[#0a0a0f]/98 border border-white/10 rounded-xl shadow-2xl overflow-hidden py-1.5 transition-all duration-200 origin-top transform ${
          isOpen
            ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
            : "opacity-0 scale-95 -translate-y-1.5 pointer-events-none"
        }`}
      >
        <div className="max-h-60 overflow-y-auto">
          {options.map((option) => {
            const isSelected = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={`w-full px-4 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between cursor-pointer ${
                  isSelected
                    ? "bg-brand text-white font-semibold"
                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span className="truncate">{option.label}</span>
                {isSelected && (
                  <div className="w-1.5 h-1.5 rounded-full bg-white shadow shadow-brand-glow"></div>
                )}
              </button>
            );
          })}

          {options.length === 0 && (
            <div className="px-4 py-3 text-xs text-gray-500 italic text-center">
              No options available
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
