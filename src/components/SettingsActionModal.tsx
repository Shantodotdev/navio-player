interface SettingsActionModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  error?: string;
  actions: Array<{ label: string; value: boolean; destructive?: boolean }>;
  onConfirm: (value: boolean) => void;
  onClose: () => void;
}

/** Renders a persistent settings confirmation shell with Navio's standard modal transitions. */
export function SettingsActionModal({
  isOpen,
  title,
  description,
  error,
  actions,
  onConfirm,
  onClose,
}: SettingsActionModalProps) {
  return (
    <div
      onClick={onClose}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 select-none transition-opacity duration-200 ${
        isOpen
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0"
      }`}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={`w-full max-w-md space-y-4 rounded-2xl border border-white/10 bg-[#0e0e12]/85 p-6 shadow-2xl backdrop-blur-sm transition-all duration-200 ${
          isOpen ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
      >
        <h3 className="text-xl font-medium text-zinc-200">{title}</h3>
        <p className="text-sm leading-relaxed text-zinc-400">{description}</p>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer px-4 py-2 text-base text-zinc-400 transition-colors hover:text-zinc-200"
          >
            Cancel
          </button>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => onConfirm(action.value)}
              className={`cursor-pointer rounded-lg px-4 py-2 text-base font-medium transition-colors ${
                action.destructive
                  ? "bg-red-500/85 text-white hover:bg-red-400"
                  : "bg-brand text-zinc-200 shadow shadow-brand-glow hover:bg-brand-light"
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
