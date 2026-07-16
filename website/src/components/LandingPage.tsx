import {
  ArrowRight,
  CircleCheck,
  Download,
  Github,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { DesktopPlatform } from "../lib/platform.functions";

const DOWNLOAD_URL =
  "https://github.com/Shantodotdev/navio-player/releases/latest";
const GITHUB_URL = "https://github.com/Shantodotdev/navio-player";

const features = [
  {
    title: "Play without compromise",
    description:
      "Move from music to full-resolution video in the same polished player, with fast seeking and controls that stay out of your way.",
  },
  {
    title: "A library that builds itself",
    description:
      "Point Navio at your folders. It reads your media, organizes the details, and keeps everything ready without uploading a single file.",
  },
  {
    title: "Save media in a few clicks",
    description:
      "Download individual videos, audio tracks, or complete playlists, then play them immediately from your local collection.",
  },
];

/** Renders Navio's public product landing page. */
export function LandingPage({
  operatingSystem = null,
}: {
  operatingSystem?: DesktopPlatform | null;
}) {
  return (
    <div className="min-h-screen">
      <SiteHeader operatingSystem={operatingSystem} />
      <main>
        <HeroSection operatingSystem={operatingSystem} />
        <FeatureSection />
        <DownloadSection operatingSystem={operatingSystem} />
      </main>
      <SiteFooter />
    </div>
  );
}

/** Renders the compact marketing-site navigation. */
function SiteHeader({
  operatingSystem,
}: {
  operatingSystem: DesktopPlatform | null;
}) {
  return (
    <header className="relative z-20 mx-auto grid h-20.5 w-[calc(100%-48px)] max-w-295 grid-cols-[1fr_auto] items-center border-b border-white/10 max-sm:h-17.5 max-sm:w-[calc(100%-30px)]">
      <BrandLink className="justify-self-start" />
      <div className="flex items-center gap-3 justify-self-end">
        <a
          className="inline-flex min-h-9.5 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 text-sm text-zinc-200 transition-colors hover:border-white/20 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ed315e] max-sm:px-3 max-sm:text-[0]"
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
        >
          <Github size={17} /> GitHub
        </a>
        <DownloadLink compact operatingSystem={operatingSystem} />
      </div>
    </header>
  );
}

/** Introduces Navio and its primary download action. */
function HeroSection({
  operatingSystem,
}: {
  operatingSystem: DesktopPlatform | null;
}) {
  return (
    <section
      className="relative mx-auto flex w-[calc(100%-48px)] max-w-295 flex-col items-center pt-28 text-center max-sm:w-[calc(100%-30px)] max-sm:pt-19 md:max-lg:pt-23"
      id="top"
    >
      <div
        className="pointer-events-none absolute -top-48 left-1/2 h-130 w-185 max-w-[100vw] -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(163,21,58,0.18),transparent_66%)] blur-xl"
        aria-hidden="true"
      />
      <div className="relative z-10 flex max-w-205 flex-col items-center">
        <h1 className="m-0 max-w-200 text-[clamp(3.6rem,7.5vw,6.6rem)] leading-[0.94] tracking-[-0.075em] text-balance max-sm:text-[clamp(3.2rem,16vw,5rem)]">
          Your media, finally in one place.
        </h1>
        <p className="mt-7 max-w-162.5 text-[clamp(1rem,1.5vw,1.16rem)] leading-[1.72] text-zinc-300 text-balance max-sm:text-[15px]">
          A private desktop player for your music, videos, playlists, and
          downloads. No accounts. No cloud library. Just your media, on your
          device.
        </p>
        <div className="mt-9 flex items-center gap-6 max-sm:w-full max-sm:flex-col max-sm:gap-5">
          <DownloadLink
            className="max-sm:w-full"
            operatingSystem={operatingSystem}
          />
          <a
            className="inline-flex items-center gap-2 text-sm text-zinc-300 transition-colors hover:text-white [&_svg]:transition-transform hover:[&_svg]:translate-x-1"
            href="#features"
          >
            Explore features <ArrowRight size={16} />
          </a>
        </div>
        <ProductTags />
      </div>

      <div className="mt-21.5 w-[min(100%,1040px)] rounded-[17px] bg-[linear-gradient(140deg,rgba(255,255,255,0.2),rgba(181,31,67,0.18)_45%,rgba(255,255,255,0.04))] p-px shadow-[0_70px_100px_-45px_rgba(0,0,0,0.95),0_30px_100px_-50px_rgba(181,31,67,0.45)] transform-[perspective(1400px)_rotateX(1.5deg)] origin-bottom max-sm:mt-15.5">
        <img
          className="block h-auto w-full rounded-2xl"
          src="/Navio-screenshot.png"
          alt="Navio media library with video playback queue and player controls"
        />
      </div>

      <div
        className="mt-16 grid w-full max-w-190 divide-y divide-white/10 border-y border-white/10"
        aria-label="Navio product principles"
      >
        <Principle
          icon={<LockKeyhole size={20} />}
          label="No account required"
        />
        <Principle
          icon={<ShieldCheck size={20} />}
          label="Your library stays on-device"
        />
        <Principle
          icon={<Sparkles size={20} />}
          label="Music, video, and downloads in one app"
        />
      </div>
    </section>
  );
}

/** Renders one concise product principle. */
function Principle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex min-h-20 items-center gap-4 px-2 text-lg leading-7 text-zinc-200 max-sm:min-h-18 max-sm:px-1 max-sm:text-base [&_svg]:shrink-0 [&_svg]:text-[#d32952]">
      {icon} {label}
    </span>
  );
}

/** Explains the core product capabilities in a simple editorial sequence. */
function FeatureSection() {
  return (
    <section
      className="mx-auto grid w-[calc(100%-48px)] max-w-295 grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-24 pt-44 pb-16 max-lg:grid-cols-1 max-lg:gap-16 max-sm:w-[calc(100%-30px)] max-sm:gap-12 max-sm:pt-30 max-sm:pb-12"
      id="features"
      aria-label="Navio features"
    >
      <div className="max-w-120 self-start lg:sticky lg:top-24">
        <h2 className="text-[clamp(3rem,5vw,4.75rem)] leading-[1.08] tracking-[-0.04em] text-balance max-sm:text-[clamp(2.8rem,13vw,4rem)] max-sm:leading-[1.1]">
          One player. Your whole collection.
        </h2>
        <p className="mt-9 max-w-110 text-lg leading-8.5 text-zinc-400 max-sm:mt-7 max-sm:text-base max-sm:leading-7.5">
          Navio brings playback, organization, and downloading into one focused
          desktop experience.
        </p>
      </div>

      <div className="border-t border-white/10">
        {features.map((feature) => (
          <article
            className="grid grid-cols-[minmax(190px,0.75fr)_minmax(0,1fr)] gap-16 border-b border-white/10 py-16 max-sm:grid-cols-1 max-sm:gap-6 max-sm:py-11"
            key={feature.title}
          >
            <h3 className="text-[26px] leading-[1.35] tracking-[-0.015em] text-zinc-100 max-sm:text-2xl max-sm:leading-[1.35]">
              {feature.title}
            </h3>
            <p className="max-w-135 text-[17px] leading-8 text-zinc-400 max-sm:text-base max-sm:leading-7.5">
              {feature.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

/** Closes the page with a direct product download invitation. */
function DownloadSection({
  operatingSystem,
}: {
  operatingSystem: DesktopPlatform | null;
}) {
  return (
    <section
      className="mx-auto flex w-[calc(100%-48px)] max-w-237.5 flex-col items-center pt-16 pb-45 text-center max-sm:w-[calc(100%-30px)] max-sm:pt-12 max-sm:pb-31.25"
      id="download"
    >
      <div className="mb-9 flex h-17.5 w-17.5 items-center justify-center rounded-[20px] border border-[#ff4b76]/20 bg-[#b51f43]/10 shadow-[0_0_70px_rgba(181,31,67,0.15)]">
        <img className="h-11.75 w-11.75" src="/navio-logo.png" alt="" />
      </div>
      <h2 className="max-w-180 text-[clamp(2.6rem,5vw,4.6rem)] leading-[1.02] tracking-[-0.065em] text-balance max-sm:text-[clamp(2.6rem,13vw,4rem)]">
        Make your media feel at home.
      </h2>
      <p className="mb-8 mt-6 max-w-140 text-base leading-7 text-zinc-400">
        Download Navio and bring your videos, music, playlists, and saved media
        together.
      </p>
      <DownloadLink operatingSystem={operatingSystem} />
    </section>
  );
}

/** Renders the product's permanent availability highlights. */
function ProductTags() {
  return (
    <div
      className="mt-5.5 flex flex-wrap items-center justify-center gap-2.5"
      aria-label="Navio availability"
    >
      <ProductTag>Open source</ProductTag>
      <ProductTag>Free forever</ProductTag>
    </div>
  );
}

/** Renders one availability tag. */
function ProductTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex min-h-8.5 items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3.25 text-[13px] text-zinc-400">
      <CircleCheck className="text-[#5ec28c]" size={15} /> {children}
    </span>
  );
}

/** Renders the shared desktop release link with an OS-aware label. */
function DownloadLink({
  className = "",
  compact = false,
  operatingSystem,
}: {
  className?: string;
  compact?: boolean;
  operatingSystem: DesktopPlatform | null;
}) {
  const sizeClasses = compact
    ? "min-h-[38px] rounded-lg px-[15px] text-sm max-sm:min-h-9 max-sm:px-3 max-sm:text-[0]"
    : "min-h-12 rounded-[10px] px-[21px] text-sm";

  return (
    <a
      className={`inline-flex items-center justify-center gap-2 border border-[#ff668a]/25 bg-[linear-gradient(180deg,#c9234b_0%,#a7193a_100%)] text-white shadow-[0_10px_30px_rgba(131,14,43,0.24),inset_0_1px_rgba(255,255,255,0.12)] transition-[transform,box-shadow,background] hover:-translate-y-0.5 hover:bg-[linear-gradient(180deg,#dc2b57_0%,#b51f43_100%)] hover:shadow-[0_14px_36px_rgba(155,17,51,0.34),inset_0_1px_rgba(255,255,255,0.15)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ed315e] ${sizeClasses} ${className}`}
      href={DOWNLOAD_URL}
    >
      <Download size={compact ? 15 : 17} />
      {operatingSystem ? `Download for ${operatingSystem}` : "Download Navio"}
    </a>
  );
}

/** Renders the Navio brand link. */
function BrandLink({
  className = "",
  prominent = false,
}: {
  className?: string;
  prominent?: boolean;
}) {
  return (
    <a
      className={`inline-flex w-max items-center gap-2.5 tracking-[-0.04em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ed315e] ${prominent ? "text-2xl" : "text-xl"} ${className}`}
      href="#top"
      aria-label="Navio home"
    >
      <img className="h-10 w-10 object-contain" src="/navio-logo.png" alt="" />
      <span>Navio</span>
    </a>
  );
}

/** Renders repository and product links at the bottom of the page. */
function SiteFooter() {
  return (
    <footer className="mx-auto w-[calc(100%-48px)] max-w-295 border-t border-white/10 py-9 max-sm:w-[calc(100%-30px)]">
      <div className="flex min-h-16 items-center justify-between gap-10 max-sm:flex-col max-sm:items-start max-sm:gap-7">
        <BrandLink prominent />

        <nav
          className="flex items-center gap-9 text-[15px] text-zinc-300 max-sm:flex-wrap max-sm:gap-x-6 max-sm:gap-y-4 [&_a]:transition-colors [&_a]:hover:text-white"
          aria-label="Footer navigation"
        >
          <a href="#features">Features</a>
          <a href="#download">Download</a>
          <a
            className="inline-flex items-center gap-2"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
          >
            <Github size={17} /> GitHub
          </a>
        </nav>

        <span className="shrink-0 text-sm text-zinc-500">
          © 2026 Navio Player
        </span>
      </div>

      <p className="mt-7 text-center text-base text-zinc-400">
        Developed and maintained by{" "}
        <a
          className="text-[#ed315e] transition-colors hover:text-[#ff4b76]"
          href="https://krshanto.dev"
          target="_blank"
          rel="noreferrer"
        >
          KR Shanto
        </a>
      </p>
    </footer>
  );
}
