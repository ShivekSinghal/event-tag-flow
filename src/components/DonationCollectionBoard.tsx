import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Heart, Maximize, Minimize, RefreshCw, Download } from "lucide-react";
import { contributionTier, DONATION_GOAL_INR, formatCollection, type DonationSnapshot } from "@/lib/donationProgress";
import { downloadSalesReport } from "@/lib/donationTransactionExport";
import "./DonationCollectionBoard.css";

interface Props {
  snapshot: DonationSnapshot;
  error: string | null;
  loading: boolean;
  live: boolean;
  refresh: () => void;
}

export function DonationCollectionBoard({ snapshot, error, loading, live, refresh }: Props) {
  const board = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const particle = useRef<HTMLDivElement>(null);
  const displayRef = useRef(snapshot.total_inr);
  const previousTarget = useRef(snapshot.total_inr);
  const journeyStarted = useRef<number | null>(null);
  const [displayed, setDisplayed] = useState(snapshot.total_inr);
  const [flight, setFlight] = useState<{ amount: number; tier: string } | null>(null);
  const [celebrating, setCelebrating] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [screenError, setScreenError] = useState("");
  const total = snapshot.total_inr;

  useEffect(() => {
    const before = previousTarget.current;
    previousTarget.current = total;
    if (before === total) return;
    let stopped = false, frame = 0, timer = 0;
    let animation: Animation | undefined;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const from = displayRef.current;
    const delta = total - from;
    const tier = contributionTier(delta);
    const update = (value: number) => { displayRef.current = value; setDisplayed(value); };
    const settle = () => {
      if (stopped) return;
      setFlight(null); setCelebrating(null);
      journeyStarted.current = null;
      update(total);
    };
    const arrive = () => {
      if (stopped) return;
      setFlight(null);
      setMessage(formatCollection(delta) + " rupees in new top-ups. Total " + formatCollection(total) + " rupees.");
      if (media.matches) { settle(); return; }
      setCelebrating(tier);
      const duration = tier === "celebration" ? 1800 : tier === "ripple" ? 1200 : 850;
      const start = performance.now();
      const count = (time: number) => {
        if (stopped) return;
        const progress = Math.min(1, (time - start) / duration);
        update(from + delta * (1 - Math.pow(1 - progress, 3)));
        if (progress < 1) frame = requestAnimationFrame(count);
        else {
          journeyStarted.current = null;
          timer = window.setTimeout(() => setCelebrating(null), 900);
        }
      };
      frame = requestAnimationFrame(count);
    };
    const motionChanged = () => {
      if (!media.matches) return;
      animation?.cancel(); cancelAnimationFrame(frame); window.clearTimeout(timer); settle();
    };
    media.addEventListener("change", motionChanged);
    if (delta <= 0 || total < before || document.hidden || media.matches) {
      settle(); setMessage(total < before ? "Collection total reconciled." : "Collection total updated.");
    } else {
      setCelebrating(null);
      // A busy stream changes the destination, not the original flight deadline.
      journeyStarted.current ??= performance.now();
      const flightDuration = Math.max(0, (tier === "celebration" ? 2300 : 1850) - (performance.now() - journeyStarted.current));
      if (flightDuration === 0) arrive();
      else {
        setFlight({ amount: delta, tier });
        frame = requestAnimationFrame(() => {
          const b = board.current?.getBoundingClientRect(), r = ring.current?.getBoundingClientRect(), el = particle.current;
          if (!b || !r || !el || !el.animate) { arrive(); return; }
          const side = total % 2 === 0 ? 1 : -1, half = el.offsetWidth / 2;
          const outsideX = side < 0 ? r.left - b.left - half - 24 : r.right - b.left + half + 24;
          const x = Math.max(half + 8, Math.min(b.width - half - 8, outsideX)), y = b.height - 36;
          const endX = r.left - b.left + r.width / 2 + side * r.width * .42;
          const endY = r.top - b.top + r.height * .7;
          const pose = (left: number, top: number, scale: number) => "translate(" + left + "px, " + top + "px) translate(-50%, -50%) scale(" + scale + ")";
          animation = el.animate([
            { transform: pose(x, y, .7), opacity: 0, offset: 0 },
            { transform: pose(x, y - 50, 1), opacity: 1, offset: .15 },
            { transform: pose(x, endY + 55, 1), opacity: 1, offset: .65 },
            { transform: pose(endX, endY, 1), opacity: 1, offset: .88 },
            { transform: pose(endX, endY, .3), opacity: 0, offset: 1 },
          ], { duration: flightDuration, easing: "cubic-bezier(.2,.65,.3,1)", fill: "forwards" });
          void animation.finished.then(arrive).catch(() => {});
        });
      }
    }
    return () => {
      stopped = true; animation?.cancel(); cancelAnimationFrame(frame); window.clearTimeout(timer);
      media.removeEventListener("change", motionChanged);
    };
  }, [total]);

  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === board.current);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  const toggleFullscreen = async () => {
    setScreenError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (board.current?.requestFullscreen) await board.current.requestFullscreen();
      else setScreenError("Fullscreen is not supported by this browser.");
    } catch { setScreenError("Fullscreen could not open. Please try again."); }
  };
  const percentage = Math.min(100, displayed / DONATION_GOAL_INR * 100), circumference = 2 * Math.PI * 164;
  return (
    <div ref={board} className="collection-board" data-celebration={celebrating || undefined}>
      <header className="collection-header">
        <img src="/pinkd-logo.png" alt="PINK'D" />
        <div className="collection-status" data-stale={Boolean(error)}><span aria-hidden="true" />{error ? "Updates paused" : live ? "Live collections" : "Auto-refreshing"}</div>
        <div className="collection-actions">
          <button title="Refresh total" aria-label="Refresh total" onClick={refresh} disabled={loading}><RefreshCw size={18} className={loading ? "collection-spin" : ""} /></button>
          <button title="Download transaction report" aria-label="Download transaction report" onClick={() => void downloadSalesReport("excel")}><Download size={18} /></button>
          <button title={fullscreen ? "Exit fullscreen" : "Fullscreen"} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}</button>
        </div>
      </header>
      {(error || snapshot.unpriced_topups > 0 || screenError) && <div className="collection-warning" role="status">{error || screenError || snapshot.unpriced_topups + " top-up(s) have no recorded INR amount and are excluded. Reconciliation required."}</div>}
      <section className="collection-centre" aria-label="Donation progress">
        <p className="collection-eyebrow">TOTAL COLLECTED</p>
        <h1 className="collection-total"><span>₹</span><span data-testid="collection-total">{formatCollection(Math.round(displayed * 100) / 100)}</span></h1>
        <p className="collection-goal">Towards our <strong>₹10,00,000</strong> goal</p>
        <div className="collection-ring" ref={ring} role="progressbar" aria-label="Confirmed collections towards goal" aria-valuemin={0} aria-valuemax={DONATION_GOAL_INR} aria-valuenow={Math.min(total, DONATION_GOAL_INR)} aria-valuetext={"₹" + formatCollection(total) + " collected of ₹10,00,000"}>
          <svg viewBox="0 0 360 360" aria-hidden="true"><circle className="collection-track" cx="180" cy="180" r="164" /><circle className="collection-fill" cx="180" cy="180" r="164" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percentage / 100)} /></svg>
          <div className="collection-logo"><img src="/pinkd-progress-logo.png" alt="Hashtag for Dance" /></div>
          {celebrating && <div className="collection-ripples" aria-hidden="true"><i /><i />{celebrating === "celebration" && <i />}</div>}
          {celebrating === "celebration" && <div className="collection-confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ "--angle": i * 20 + "deg", "--delay": i % 3 * 70 + "ms" } as CSSProperties} />)}</div>}
        </div>
        <p className="collection-percent"><strong>{percentage.toFixed(1)}%</strong> of our goal</p>
        <p className="collection-remaining">{displayed >= DONATION_GOAL_INR ? "Goal reached. Thank you for keeping it going." : "₹" + formatCollection(Math.max(0, Math.round((DONATION_GOAL_INR - displayed) * 100) / 100)) + " to go"}</p>
        <p className="collection-thanks" data-active={Boolean(celebrating)}>{celebrating === "celebration" ? "A big boost for dance. Thank you!" : "Thank you for moving us forward."}</p>
        <div className="collection-cause"><Heart size={18} /><p>Every rupee after costs goes to <strong>dance scholarships.</strong></p></div>
      </section>
      <footer className="collection-footer"><span>I danced. I played. I gave back.</span><span>Updated {new Date(snapshot.generated_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></footer>
      {flight && <div ref={particle} className="collection-flying" data-tier={flight.tier} aria-hidden="true"><strong>+₹{formatCollection(Math.round(flight.amount * 100) / 100)}</strong><span>New top-ups</span></div>}
      <p className="sr-only" aria-live="polite" aria-atomic="true">{message}</p>
    </div>
  );
}
