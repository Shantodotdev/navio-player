import {
  ArrowRight,
  Check,
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
import { usePlatform } from "../hooks/usePlatform";
import type { DesktopPlatform } from "../hooks/usePlatform";
import { ProductPreview } from "./ProductPreview";

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
export function LandingPage() {
  const operatingSystem = usePlatform();

  return (
    <div className="site-shell">
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
    <header className="site-header">
      <a className="brand" href="#top" aria-label="Navio home">
        <img src="/navio-logo.png" alt="" />
        <span>Navio</span>
      </a>
      <nav className="site-nav" aria-label="Main navigation">
        <a href="#features">Features</a>
        <a href="#privacy">Privacy</a>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </nav>
      <DownloadLink
        className="header-download"
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
    <section className="hero" id="top">
      <div className="hero-glow" aria-hidden="true" />
      <div className="hero-copy">
        <h1>Your media, finally in one place.</h1>
        <p>
          A private desktop player for your music, videos, playlists, and
          downloads. No accounts. No cloud library. Just your media, on your
          device.
        </p>
        <div className="hero-actions">
          <DownloadLink operatingSystem={operatingSystem} />
          <a className="secondary-link" href="#features">
            Explore features <ArrowRight size={16} />
          </a>
        </div>
        <div className="download-note">
          <span>
            <Check size={13} /> Free and open source
          </span>
          <span>Version 0.1.0 · {operatingSystem ?? "Desktop"}</span>
        </div>
      </div>

      <div className="hero-preview-wrap">
        <ProductPreview />
      </div>

      <div className="principles" aria-label="Navio product principles">
        <span>
          <LockKeyhole size={15} /> No account required
        </span>
        <span>
          <ShieldCheck size={15} /> Local-first by default
        </span>
        <span>
          <Sparkles size={15} /> Built for everyday media
        </span>
      </div>
    </section>
  );
}

/** Explains the core product capabilities in a simple editorial sequence. */
function FeatureSection() {
  return (
    <section
      className="feature-section"
      id="features"
      aria-label="Navio features"
    >
      <div className="section-intro">
        <p>Everything you need</p>
        <h2>One player. Your whole collection.</h2>
        <span>
          Navio brings playback, organization, and downloading into one focused
          desktop experience.
        </span>
      </div>

      <div className="feature-list">
        {features.map((feature) => (
          <article className="feature-row" key={feature.number}>
            <span className="feature-number">{feature.number}</span>
            <div className="feature-icon">{feature.icon}</div>
            <div className="feature-copy">
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </div>
            <span className="feature-detail">{feature.detail}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

/** Highlights the local-first privacy model without overstating security guarantees. */
function PrivacySection() {
  return (
    <section className="privacy-section" id="privacy">
      <div className="privacy-visual" aria-hidden="true">
        <div className="privacy-orbit orbit-one" />
        <div className="privacy-orbit orbit-two" />
        <div className="privacy-core">
          <img src="/navio-logo.png" alt="" />
        </div>
        <div className="privacy-node node-one">
          <ListMusic size={16} />
        </div>
        <div className="privacy-node node-two">
          <Globe2 size={16} />
        </div>
        <div className="privacy-node node-three">
          <LockKeyhole size={16} />
        </div>
      </div>
      <div className="privacy-copy">
        <p>Private by design</p>
        <h2>Your library stays yours.</h2>
        <span>
          Navio works locally and doesn’t require an account or remote
          application backend. Your scanned folders, playlists, and playback
          history stay on your computer.
        </span>
        <ul>
          <li>
            <Check size={15} /> No sign-up or profile
          </li>
          <li>
            <Check size={15} /> No media uploads
          </li>
          <li>
            <Check size={15} /> Local library storage
          </li>
        </ul>
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
    <section className="download-section" id="download">
      <div className="download-mark">
        <img src="/navio-logo.png" alt="" />
      </div>
      <h2>Make your media feel at home.</h2>
      <p>
        Download Navio and bring your videos, music, playlists, and saved media
        together.
      </p>
      <DownloadLink operatingSystem={operatingSystem} />
      <span>
        Free · Open source · {operatingSystem ?? "Windows, macOS, and Linux"}
      </span>
    </section>
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
  return (
    <a
      className={`download-button ${compact ? "compact" : ""} ${className}`}
      href={DOWNLOAD_URL}
    >
      <Download size={compact ? 15 : 17} />
      {operatingSystem ? `Download for ${operatingSystem}` : "Download Navio"}
    </a>
  );
}

/** Renders repository and product links at the bottom of the page. */
function SiteFooter() {
  return (
    <footer className="site-footer">
      <a className="brand footer-brand" href="#top" aria-label="Navio home">
        <img src="/navio-logo.png" alt="" />
        <span>Navio</span>
      </a>
      <p>Local media, thoughtfully played.</p>
      <div className="footer-links">
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">
          <Github size={15} /> GitHub
        </a>
        <a href="#features">Features</a>
        <a href="#privacy">Privacy</a>
      </div>
      <span className="copyright">© 2026 Navio</span>
    </footer>
  );
}
