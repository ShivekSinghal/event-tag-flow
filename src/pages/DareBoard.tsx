import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Flag, Gamepad2, GlassWater, List, LockKeyhole, Maximize, Minimize, RefreshCw, Sparkles, UtensilsCrossed } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DARE_MILESTONES, crossedDares, dareCheckpoint, dareNumber, dareTime, dareProgressSchema } from '@/lib/dareBoard';
import DareContributionLog from '@/components/DareContributionLog';
import './DareBoard.css';

export default function DareBoard() {
  const { user, isAdmin } = useAuth();
  const root = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const previous = useRef<number | null>(null);
  const celebrated = useRef(new Set<number>());
  const returnFocus = useRef<HTMLElement | null>(null);
  const [queue, setQueue] = useState<number[]>([]);
  const [replay, setReplay] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [screenError, setScreenError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [showLog, setShowLog] = useState(false);
  const [logCursors, setLogCursors] = useState<{ p_before_created_at: string; p_before_id: string }[]>([]);
  const logCursor = logCursors[logCursors.length - 1];
  const query = useQuery({
    queryKey: ['dare-board-progress', user?.id, logCursor],
    enabled: isAdmin,
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) controller.abort();
      const timer = window.setTimeout(abort, 8000);
      try {
        const { data, error } = await supabase.rpc('get_dare_board_progress', logCursor ?? {}).abortSignal(controller.signal);
        if (error) throw error;
        return dareProgressSchema.parse(data);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    },
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
    retry: false,
    placeholderData: keepPreviousData,
    gcTime: 0,
  });
  const total = query.data?.total_coins;
  const checkpoint = dareCheckpoint(total ?? 0);
  const stale = query.isError || (query.dataUpdatedAt > 0 && now - query.dataUpdatedAt > 30000);
  const active = replay ?? queue[0];
  const activePicker = query.data?.milestone_pickers.find(p => p.milestone === active);
  const activeValid = active !== undefined && total !== undefined && active <= total && activePicker !== undefined;
  const latestPicker = query.data?.milestone_pickers.at(-1);
  const overlayOpen = showLog || activeValid;

  useEffect(() => {
    if (!overlayOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, [overlayOpen]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const onFullscreen = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => { clearInterval(timer); document.removeEventListener('fullscreenchange', onFullscreen); };
  }, []);

  useEffect(() => {
    if (total === undefined) return;
    // Initial snapshots do not celebrate historical sales; refunds never ratchet the financial total.
    if (previous.current === null) {
      DARE_MILESTONES.filter(value => value <= total).forEach(value => celebrated.current.add(value));
    } else {
      const crossed = crossedDares(previous.current, total).filter(value => !celebrated.current.has(value));
      crossed.forEach(value => celebrated.current.add(value));
      setQueue(current => [...current.filter(value => value <= total), ...crossed]);
    }
    previous.current = total;
    setReplay(current => current !== null && current > total ? null : current);
  }, [total]);

  useEffect(() => {
    if (!activeValid) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => returnFocus.current?.focus();
  }, [activeValid]);

  useEffect(() => {
    if (activeValid) closeButton.current?.focus();
  }, [active, activeValid]);

  function dismiss() {
    if (replay !== null) setReplay(null);
    else setQueue(current => current.slice(1));
  }

  function closeLog() {
    setShowLog(false);
    setLogCursors([]);
  }

  function olderContributions() {
    const last = query.data?.recent_transactions.at(-1);
    if (last && !query.isFetching && !stale) setLogCursors(current => [...current, { p_before_created_at: last.created_at, p_before_id: last.transaction_id }]);
  }

  async function toggleFullscreen() {
    setScreenError('');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (root.current?.requestFullscreen) await root.current.requestFullscreen();
      else setScreenError('Fullscreen is unavailable in this browser.');
    } catch { setScreenError('Could not open fullscreen. Please try again.'); }
  }

  return <section ref={root} className={`dare-board${overlayOpen ? ' has-overlay' : ''}`} aria-label="Dare Board">
    <header className="dare-topline">
      <img src="/media/pinkd-logo.png" alt="Pink'd" className="dare-logo" />
      <span className={`dare-live ${stale ? 'is-stale' : ''}`} role="status">
        <span />{query.data ? (stale ? 'Reconnecting' : 'Live progress') : query.isError ? 'Connection unavailable' : 'Connecting'}
      </span>
      <div className="dare-tools">
        <button type="button" title="Refresh progress" aria-label="Refresh progress" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={19} className={query.isFetching ? 'dare-spin' : ''} /></button>
        <button type="button" title={fullscreen ? 'Exit fullscreen' : 'Project fullscreen'} aria-label={fullscreen ? 'Exit fullscreen' : 'Project fullscreen'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}</button>
      </div>
    </header>

    <div className="dare-stage">
      <div className="dare-heading"><p>PLAY. FUEL. UNLOCK.</p><h1>DARE <span>BOARD</span></h1></div>
      <div className="dare-score-layout">
        <div className="dare-score">
          <p className="dare-caption">THE CROWD'S TOTAL</p>
          <strong data-testid="dare-total">{total === undefined ? '--' : dareNumber(total)}</strong>
          <p className="dare-unit">PINK'D COINS SPENT</p>
          <div className="dare-sources">
            {[{ Icon: Gamepad2, label: 'Tier 1', value: query.data?.tier_1_coins }, { Icon: UtensilsCrossed, label: 'Food', value: query.data?.food_coins }, { Icon: GlassWater, label: 'Bar', value: query.data?.bar_coins }].map(({ Icon, label, value }) =>
              <div key={label}><span><Icon size={16} />{label}</span><b>{value === undefined ? '--' : dareNumber(value)}</b></div>)}
          </div>
        </div>
        <div className="dare-next">
          <div className="dare-next-label"><Flag size={18} /><span>{checkpoint.next === undefined ? 'ALL DARES UNLOCKED' : `NEXT CHECKPOINT / ${String(checkpoint.completed + 1).padStart(2, '0')}`}</span></div>
          <strong>{dareNumber(checkpoint.next ?? DARE_MILESTONES[DARE_MILESTONES.length - 1])}</strong>
          <span className="dare-next-unit">PINK'D COINS</span>
          <div className="dare-meter" role="progressbar" aria-label="Progress to next checkpoint" aria-valuemin={0} aria-valuemax={100} aria-valuenow={total === undefined ? undefined : Math.floor(checkpoint.percent)}><span style={{ width: `${total === undefined ? 0 : checkpoint.percent}%` }} /></div>
          <p>{total === undefined ? 'Waiting for live progress' : checkpoint.next === undefined ? 'Every checkpoint. Every dare. Unlocked.' : <><b>{dareNumber(checkpoint.remaining)}</b> coins to the next dare</>}</p>
        </div>
      </div>

      <div className="dare-road-heading"><span>THE DARE TRAIL</span><span>{total === undefined ? '--' : checkpoint.completed} / 11 UNLOCKED</span></div>
      <ol className="dare-trail" aria-label="Milestones">
        {DARE_MILESTONES.map((milestone, index) => {
          const unlocked = total !== undefined && total >= milestone;
          const next = total !== undefined && checkpoint.next === milestone;
          return <li key={milestone} className={`${unlocked ? 'is-unlocked' : ''} ${next ? 'is-next' : ''}`}>
            <button type="button" disabled={!unlocked || stale} aria-label={`${dareNumber(milestone)} coins: ${unlocked ? 'open unlocked dare' : 'locked'}`} onClick={() => setReplay(milestone)}>
              <span className="dare-node">{unlocked ? <Check /> : next ? <Flag /> : <LockKeyhole />}</span>
              <b>{dareNumber(milestone)}</b><small>{unlocked ? 'UNLOCKED' : next ? 'UP NEXT' : `DARE ${String(index + 1).padStart(2, '0')}`}</small>
            </button>
          </li>;
        })}
      </ol>
      {latestPicker && <div className="dare-last-picker"><Sparkles size={18} /><span>Latest card picker: <b>{latestPicker.first_name}</b>{latestPicker.studio ? ` · ${latestPicker.studio}` : ''}</span><strong>{dareNumber(latestPicker.milestone)} checkpoint</strong></div>}
      <section className="dare-contributions" aria-label="Recent contributions">
        <header><h2>RECENT CONTRIBUTIONS</h2><button type="button" onClick={() => setShowLog(true)}><List size={16} />Transaction log</button></header>
        <div className="dare-contribution-feed">
          {query.data?.latest_transactions.map(entry => <div key={entry.transaction_id} className={entry.voided ? 'is-voided' : ''}>
            <div><b>{entry.first_name}</b><span>{entry.studio || 'Studio not recorded'}</span></div>
            <strong>{entry.voided ? 'Voided' : `+${dareNumber(entry.coins)}`}</strong>
            <p>{entry.item_name} · {dareTime(entry.created_at)}</p>
          </div>)}
          {query.data?.latest_transactions.length === 0 && <p className="dare-contribution-empty">Your first contribution starts the trail.</p>}
          {!query.data && <p className="dare-contribution-empty">Waiting for confirmed contributions.</p>}
        </div>
      </section>
      <footer className="dare-footer"><p><Sparkles size={17} />PICK A CARD. GIVE THE DARE.</p><span>{query.data ? `Updated ${new Date(query.data.as_of).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · Net of voids` : 'Tier 1 games + food + bar'}</span></footer>
      {(query.isError || stale || screenError) && <p className="dare-error" role="alert">{screenError || (query.data ? 'Progress is temporarily offline. Showing the last confirmed total.' : 'Live progress is unavailable. Check the connection and Dare Board backend setup, then refresh.')}</p>}
    </div>

    {showLog && !activeValid && <DareContributionLog data={query.data} isFetching={query.isFetching} stale={stale} page={logCursors.length} onOlder={olderContributions} onNewer={() => setLogCursors(current => current.slice(0, -1))} onClose={closeLog} />}
    {activeValid && <div className="dare-reveal" role="dialog" aria-modal="true" aria-labelledby="dare-reveal-title" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); dismiss(); } if (event.key === 'Tab') { event.preventDefault(); closeButton.current?.focus(); } }}>
      <div className="dare-reveal-art" aria-hidden="true" />
      <div className="dare-reveal-content" key={active}>
        <span className="dare-caption">{replay !== null ? 'UNLOCKED CHECKPOINT' : 'MILESTONE UNLOCKED'}</span>
        <strong className="dare-reveal-amount">{dareNumber(active)}</strong><span>PINK'D COINS</span>
        <h2 id="dare-reveal-title">Dare <em>unlocked.</em></h2>
        <div className="dare-cue"><Sparkles /><div><span>YOUR CARD PICKER</span><p><b>{activePicker.first_name}</b></p>{activePicker.studio && <span>{activePicker.studio}</span>}<p>Pick a card. Give the dare.</p></div><Sparkles /></div>
        <p className="dare-picker-payment">{activePicker.item_name} · +{dareNumber(activePicker.coins)} coins · {dareTime(activePicker.created_at)} IST</p>
        {stale && <p role="status">Live connection interrupted. Last confirmed checkpoint.</p>}
        <button type="button" ref={closeButton} onClick={dismiss}>{replay === null && queue.length > 1 ? 'Next unlocked dare' : 'Back to the board'}<ArrowRight size={20} /></button>
      </div>
    </div>}
  </section>;
}
