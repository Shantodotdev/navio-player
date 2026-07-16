import {
  ArrowRight,
  Check,
  CircleCheck,
  Download,
  FolderSearch,
  Github,
  Globe2,
  ListMusic,
  LockKeyhole,
  MonitorDown,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { DesktopPlatform } from "../lib/platform.functions";

const DOWNLOAD_URL =
  "https://github.com/Shantodotdev/navio-player/releases/latest";
const GITHUB_URL = "https://github.com/Shantodotdev/navio-player";

const features = [
  {
    number: "01",
    icon: <Play size={22} />,
    title: "Play without compromise",
    description:
      "Move from music to full-resolution video in the same polished player, with fast seeking and controls that stay out of your way.",
    detail: "Audio and video, beautifully handled",
  },
  {
    number: "02",
    icon: <FolderSearch size={22} />,
    title: "A library that builds itself",
    description:
      "Point Navio at your folders. It reads your media, organizes the details, and keeps everything ready without uploading a single file.",
    detail: "Automatic local folder scanning",
  },
  {
    number: "03",
    icon: <MonitorDown size={22} />,
    title: "Save media in a few clicks",
    description:
      "Download individual videos, audio tracks, or complete playlists, then play them immediately from your local collection.",
    detail: "Built-in video and playlist downloader",
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
        <PrivacySection />
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
    <header className="relative z-20 mx-auto grid h-20.5 w-[calc(100%-48px)] max-w-295 grid-cols-[1fr_auto] items-center border-b border-white/10 max-sm:h-17.5 max-sm:w-[calc(100%-30px)] md:grid-cols-[1fr_auto_1fr]">
      <BrandLink />
      <nav
        className="hidden items-center gap-8 text-[15px] text-zinc-300 md:flex"
        aria-label="Main navigation"
      >
        <a className="transition-colors hover:text-white" href="#features">
          Features
        </a>
        <a className="transition-colors hover:text-white" href="#privacy">
          Privacy
        </a>
        <a
          className="transition-colors hover:text-white"
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
      </nav>
      <DownloadLink
        className="justify-self-end"
        compact
        operatingSystem={operatingSystem}
      />
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
        className="mt-12 flex w-[min(100%,920px)] justify-center divide-x divide-white/10 border-y border-white/10 max-sm:flex-col max-sm:divide-x-0 max-sm:divide-y"
        aria-label="Navio product principles"
      >
        <Principle
          icon={<LockKeyhole size={15} />}
          label="No account required"
        />
        <Principle
          icon={<ShieldCheck size={15} />}
          label="Local-first by default"
        />
        <Principle
          icon={<Sparkles size={15} />}
          label="Built for everyday media"
        />
      </div>
    </section>
  );
}

/** Renders one concise product principle. */
function Principle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex min-h-17.5 flex-1 items-center justify-center gap-2 text-xs text-zinc-400 max-sm:min-h-13.5 [&_svg]:text-[#b62648]">
      {icon} {label}
    </span>
  );
}

/** Explains the core product capabilities in a simple editorial sequence. */
function FeatureSection() {
  return (
    <section
      className="mx-auto w-[calc(100%-48px)] max-w-270 py-44 max-sm:w-[calc(100%-30px)] max-sm:py-30"
      id="features"
      aria-label="Navio features"
    >
      <div className="mb-19.25 max-w-167.5 max-sm:mb-13">
        <SectionLabel>Everything you need</SectionLabel>
        <h2 className="text-[clamp(2.6rem,5vw,4.6rem)] leading-[1.02] tracking-[-0.065em] text-balance max-sm:text-[clamp(2.6rem,13vw,4rem)]">
          One player. Your whole collection.
        </h2>
        <p className="mt-6 max-w-140 text-base leading-7 text-zinc-400">
          Navio brings playback, organization, and downloading into one focused
          desktop experience.
        </p>
      </div>

      <div className="border-t border-white/10">
        {features.map((feature) => (
          <article
            className="grid grid-cols-[55px_60px_minmax(280px,1fr)_minmax(190px,0.62fr)] items-start gap-6.5 border-b border-white/10 py-11.5 max-sm:grid-cols-[42px_1fr] max-sm:gap-4.5 max-sm:py-9 md:max-lg:grid-cols-[42px_52px_1fr]"
            key={feature.number}
          >
            <span className="text-[11px] text-zinc-600 max-sm:col-span-full">
              {feature.number}
            </span>
            <div className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-[#ce274f]/20 bg-[#b51f43]/10 text-[#dc2d57]">
              {feature.icon}
            </div>
            <div>
              <h3 className="mb-3 text-[21px] tracking-[-0.035em] max-sm:text-[19px]">
                {feature.title}
              </h3>
              <p className="max-w-[520px] text-sm leading-6 text-zinc-400">
                {feature.description}
              </p>
            </div>
            <span className="pt-1.5 text-xs leading-5 text-zinc-500 max-lg:hidden">
              {feature.detail}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

/** Highlights the local-first privacy model without overstating security guarantees. */
function PrivacySection() {
  return (
    <section
      className="mx-auto grid min-h-[660px] w-[calc(100%_-_48px)] max-w-[1180px] grid-cols-[minmax(360px,1fr)_minmax(360px,0.85fr)] items-center gap-[100px] overflow-hidden rounded-[22px] border border-white/10 bg-[radial-gradient(circle_at_16%_50%,rgba(143,18,50,0.16),transparent_38%),linear-gradient(145deg,#0b0b0e,#08080a)] p-[82px] max-sm:w-[calc(100%_-_30px)] max-sm:grid-cols-1 max-sm:gap-9 max-sm:px-6 max-sm:py-12 md:max-lg:grid-cols-2 md:max-lg:gap-12 md:max-lg:p-[52px]"
      id="privacy"
    >
      <PrivacyVisual />
      <div>
        <SectionLabel>Private by design</SectionLabel>
        <h2 className="text-[clamp(2.6rem,5vw,4.6rem)] leading-[1.02] tracking-[-0.065em] text-balance max-sm:text-[clamp(2.6rem,13vw,4rem)]">
          Your library stays yours.
        </h2>
        <p className="mt-6 text-[15px] leading-7 text-zinc-400">
          Navio works locally and doesn’t require an account or remote
          application backend. Your scanned folders, playlists, and playback
          history stay on your computer.
        </p>
        <ul className="mt-8 grid gap-3 p-0 text-[13px] text-zinc-300">
          <PrivacyPoint>No sign-up or profile</PrivacyPoint>
          <PrivacyPoint>No media uploads</PrivacyPoint>
          <PrivacyPoint>Local library storage</PrivacyPoint>
        </ul>
      </div>
    </section>
  );
}

/** Renders the decorative local-first privacy illustration. */
function PrivacyVisual() {
  return (
    <div
      className="relative mx-auto aspect-square w-[min(100%,430px)] max-sm:w-[min(100%,340px)]"
      aria-hidden="true"
    >
      <div className="absolute left-1/2 top-1/2 h-[58%] w-[58%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />
      <div className="absolute left-1/2 top-1/2 h-[92%] w-[92%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/10 opacity-70" />
      <div className="absolute left-1/2 top-1/2 z-10 flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[29px] border border-[#ff517a]/25 bg-[linear-gradient(145deg,rgba(192,29,68,0.15),rgba(62,9,24,0.25))] shadow-[0_0_80px_rgba(181,31,67,0.18),inset_0_1px_rgba(255,255,255,0.08)]">
        <img className="h-[67px] w-[67px]" src="/navio-logo.png" alt="" />
      </div>
      <PrivacyNode className="left-[47%] top-[17%]">
        <ListMusic size={16} />
      </PrivacyNode>
      <PrivacyNode className="bottom-[28%] right-[5%]">
        <Globe2 size={16} />
      </PrivacyNode>
      <PrivacyNode className="bottom-[11%] left-[17%] text-[#d72a54]">
        <LockKeyhole size={16} />
      </PrivacyNode>
    </div>
  );
}

/** Renders one orbiting privacy illustration node. */
function PrivacyNode({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <div
      className={`absolute z-20 flex h-10 w-10 items-center justify-center rounded-[11px] border border-white/10 bg-[#111116] text-zinc-500 shadow-[0_10px_30px_rgba(0,0,0,0.4)] ${className}`}
    >
      {children}
    </div>
  );
}

/** Renders one privacy guarantee. */
function PrivacyPoint({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <Check className="text-[#57b883]" size={15} /> {children}
    </li>
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
      className="mx-auto flex w-[calc(100%_-_48px)] max-w-[950px] flex-col items-center py-[180px] text-center max-sm:w-[calc(100%_-_30px)] max-sm:py-[125px]"
      id="download"
    >
      <div className="mb-9 flex h-[70px] w-[70px] items-center justify-center rounded-[20px] border border-[#ff4b76]/20 bg-[#b51f43]/10 shadow-[0_0_70px_rgba(181,31,67,0.15)]">
        <img className="h-[47px] w-[47px]" src="/navio-logo.png" alt="" />
      </div>
      <h2 className="max-w-[720px] text-[clamp(2.6rem,5vw,4.6rem)] leading-[1.02] tracking-[-0.065em] text-balance max-sm:text-[clamp(2.6rem,13vw,4rem)]">
        Make your media feel at home.
      </h2>
      <p className="mb-8 mt-6 max-w-[560px] text-base leading-7 text-zinc-400">
        Download Navio and bring your videos, music, playlists, and saved media
        together.
      </p>
      <DownloadLink operatingSystem={operatingSystem} />
      <ProductTags />
    </section>
  );
}

/** Renders a small uppercase section label. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 text-[11px] tracking-[0.14em] text-[#ed315e] uppercase">
      {children}
    </p>
  );
}

/** Renders the product's permanent availability highlights. */
function ProductTags() {
  return (
    <div
      className="mt-[22px] flex flex-wrap items-center justify-center gap-2.5"
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
    <span className="inline-flex min-h-[34px] items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-[13px] text-[13px] text-zinc-400">
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
function BrandLink({ footer = false }: { footer?: boolean }) {
  return (
    <a
      className={`inline-flex w-max items-center gap-2.5 text-lg tracking-[-0.04em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ed315e] ${footer ? "[grid-area:brand]" : "justify-self-start"}`}
      href="#top"
      aria-label="Navio home"
    >
      <img
        className="h-[29px] w-[29px] object-contain"
        src="/navio-logo.png"
        alt=""
      />
      <span>Navio</span>
    </a>
  );
}

/** Renders repository and product links at the bottom of the page. */
function SiteFooter() {
  return (
    <footer className="mx-auto grid min-h-[120px] w-[calc(100%_-_48px)] max-w-[1180px] grid-cols-[auto_1fr_auto] grid-rows-2 items-center gap-x-6 border-t border-white/10 max-sm:w-[calc(100%_-_30px)] max-sm:grid-cols-[1fr_auto] max-sm:grid-rows-none max-sm:gap-3 max-sm:py-8">
      <BrandLink footer />
      <p className="self-end text-xs text-zinc-500 max-sm:col-span-full max-sm:self-auto">
        Local media, thoughtfully played.
      </p>
      <div className="row-span-2 flex items-center gap-6 text-xs text-zinc-400 max-sm:row-span-1 [&_a]:transition-colors [&_a]:hover:text-white">
        <a
          className="inline-flex items-center gap-1.5"
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
        >
          <Github size={15} /> GitHub
        </a>
        <a className="max-sm:hidden" href="#features">
          Features
        </a>
        <a className="max-sm:hidden" href="#privacy">
          Privacy
        </a>
      </div>
      <span className="self-start text-[10px] text-zinc-600 max-sm:col-span-full max-sm:self-auto">
        © 2026 Navio
      </span>
    </footer>
  );
}
