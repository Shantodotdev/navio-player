interface PlayingIndicatorProps {
  /// Whether the media is actively playing (animating) or paused (static).
  isPlaying?: boolean;
  /// Size variant of the equalizer bars.
  size?: "sm" | "md" | "lg";
  /// Custom additional CSS classes.
  className?: string;
  /// Custom color override for the equalizer bars. Defaults to brand-light.
  barColorClassName?: string;
}

/**
 * Renders an animated 3-bar audio equalizer indicating currently playing/paused media.
 * When playing, the bars animate with varying heights; when paused, they show static levels.
 */
export function PlayingIndicator({
  isPlaying = true,
  size = "md",
  className = "",
  barColorClassName = "bg-brand-light",
}: PlayingIndicatorProps) {
  const containerSizeClass =
    size === "sm"
      ? "h-3 gap-[1.5px]"
      : size === "lg"
        ? "h-4.5 gap-[2.5px]"
        : "h-3.5 gap-[2px]";

  const barWidthClass =
    size === "sm" ? "w-[2px]" : size === "lg" ? "w-[3px]" : "w-[2.5px]";

  return (
    <div
      className={`inline-flex items-end justify-center ${containerSizeClass} ${className}`}
      aria-label={isPlaying ? "Currently playing" : "Currently paused"}
      title={isPlaying ? "Playing" : "Paused"}
    >
      <span
        className={`${barWidthClass} ${barColorClassName} rounded-full transition-all duration-200 ${
          isPlaying ? "animate-soundwave-1" : "h-[30%]"
        }`}
      />
      <span
        className={`${barWidthClass} ${barColorClassName} rounded-full transition-all duration-200 ${
          isPlaying ? "animate-soundwave-2" : "h-[75%]"
        }`}
      />
      <span
        className={`${barWidthClass} ${barColorClassName} rounded-full transition-all duration-200 ${
          isPlaying ? "animate-soundwave-3" : "h-[45%]"
        }`}
      />
    </div>
  );
}
