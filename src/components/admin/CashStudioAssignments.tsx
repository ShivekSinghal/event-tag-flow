import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function CashStudioAssignments() {
  const [managers, setManagers] = useState<{ id: string; full_name: string | null; email: string }[]>([]);
  const [studios, setStudios] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<{ user_id: string; studio: string }[]>([]);
  const [manager, setManager] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const load = useCallback(async () => {
    try {
      const m = await supabase.from("profiles").select("id,full_name,email").eq("role", "studio_manager");
      const s = await supabase.from("cash_studios").select("name").order("name");
      const a = await supabase.from("cash_manager_studios").select("user_id,studio");
      if (m.error || s.error || a.error) throw new Error("Could not load studio assignments");
      setManagers(m.data || []); setStudios((s.data || []).map(row => row.name)); setAssignments(a.data || []); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Assignments unavailable"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const change = async (studio: string, enabled: boolean) => {
    if (!manager || guard.current) return;
    guard.current = true; setBusy(true);
    try {
      const result = enabled ? await supabase.from("cash_manager_studios").upsert({ user_id: manager, studio }, { onConflict: "user_id,studio", ignoreDuplicates: true }) : await supabase.from("cash_manager_studios").delete().eq("user_id", manager).eq("studio", studio);
      if (result.error) throw result.error;
      await load();
    } catch { setError("Assignment change not confirmed. Reload before trying again."); }
    finally { guard.current = false; setBusy(false); }
  };
  return <details className="border-t pt-4">
    <summary className="cursor-pointer font-semibold">Manager studio assignments</summary>
    {error && <p role="alert" className="my-2 text-destructive">{error}</p>}
    <label className="mt-3 block">Manager<select aria-label="Manager" value={manager} disabled={busy} onChange={e => setManager(e.target.value)} className="mt-1 block h-10 w-full border bg-background px-2">
      <option value="">Select manager</option>{managers.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
    </select></label>
    {manager && <div className="mt-3 grid gap-2 sm:grid-cols-2">{studios.map(studio => <label key={studio} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={assignments.some(a => a.user_id === manager && a.studio === studio)} disabled={busy} onChange={e => void change(studio, e.target.checked)} />{studio}</label>)}</div>}
  </details>;
}
