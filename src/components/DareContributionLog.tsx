import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { DareProgress, dareNumber, dareTime } from '@/lib/dareBoard';

type Props = {
  data: DareProgress | undefined;
  isFetching: boolean;
  stale: boolean;
  page: number;
  onOlder: () => void;
  onNewer: () => void;
  onClose: () => void;
};

export default function DareContributionLog({ data, isFetching, stale, page, onOlder, onNewer, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return <div className="dare-log-overlay" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="dare-log-title" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab') return;
    const buttons = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? []);
    const next = buttons[(buttons.indexOf(document.activeElement as HTMLElement) + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length];
    event.preventDefault(); next?.focus();
  }}>
    <header><div><p>DARE BOARD</p><h2 id="dare-log-title">Contribution log</h2></div><button ref={close} type="button" aria-label="Close contribution log" title="Close contribution log" onClick={onClose}><X size={22} /></button></header>
    <p className="dare-log-note">Tier 1 games, food, bar, Karaoke and Busk for a Cause. Voided payments do not count. Times in IST.</p>
    {stale && <p className="dare-error" role="status">Connection interrupted. Showing the last confirmed transactions.</p>}
    <div className="dare-log-scroll" tabIndex={0} role="region" aria-label="Contribution transactions">
      <table><thead><tr><th>Guest / studio</th><th>Activity</th><th>Coins</th><th>Time</th><th>Checkpoint / status</th></tr></thead>
        <tbody>{data?.recent_transactions.map(entry => {
          const milestones = data.milestone_pickers.filter(p => p.transaction_id === entry.transaction_id);
          return <tr key={entry.transaction_id} className={entry.voided ? 'is-voided' : ''}>
            <td><b>{entry.first_name}</b><span>{entry.studio || 'Studio not recorded'}</span></td>
            <td>{entry.item_name}<span>{entry.source === 'tier_1' ? 'Tier 1' : entry.source === 'food' ? 'Food' : entry.source === 'bar' ? 'Bar' : 'Karaoke & Busk'}</span></td>
            <td>{entry.voided ? '' : '+'}{dareNumber(entry.coins)}</td>
            <td>{dareTime(entry.created_at)}<span>{new Date(entry.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })}</span></td>
            <td>{entry.voided ? <span className="dare-void-label">Voided</span> : milestones.length ? milestones.map(m => <b className="dare-log-milestone" key={m.milestone}>{dareNumber(m.milestone)} · Card picker</b>) : 'Counted'}</td>
          </tr>;
        })}</tbody>
      </table>
      {data?.recent_transactions.length === 0 && <p className="dare-log-empty">{page === 0 ? 'No contributions yet.' : 'No older contributions.'}</p>}
      {!data && <p className="dare-log-empty">Transactions are not available yet.</p>}
    </div>
    <footer><button type="button" aria-label="Newer contributions" title="Newer contributions" disabled={page === 0 || isFetching || stale} onClick={onNewer}><ArrowLeft size={20} /></button><span>{isFetching ? 'Updating...' : `Page ${page + 1}`}</span><button type="button" aria-label="Older contributions" title="Older contributions" disabled={!data?.log_has_more || isFetching || stale} onClick={onOlder}><ArrowRight size={20} /></button></footer>
  </div>;
}
