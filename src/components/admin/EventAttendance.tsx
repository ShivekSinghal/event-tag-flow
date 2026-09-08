import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Search, Undo2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AdmissionReport, EventGuest, eventName, filterGuests } from "@/lib/eventAdmissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const time = (value: string) => new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
}).format(new Date(value));
const selectClass = "h-10 max-w-full rounded-md border border-input bg-background px-3 text-sm";

export default function EventAttendance({ data, eventNumber, onSelectEvent, stale, studio, onStudioChange }: {
  data: AdmissionReport; eventNumber: number | null;
  onSelectEvent: (event: number | null) => void; stale: boolean;
  studio: string; onStudioChange: (studio: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<EventGuest | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const submitting = useRef(false);
  const client = useQueryClient();
  const studios = useMemo(() => [...new Set(data.studios.map(row => row.studio))].sort(), [data.studios]);
  const guests = filterGuests(data.attendees, search, studio, status);
  const eventTotals = data.studios.filter(row => row.event_number === eventNumber);
  const total = eventTotals.reduce((sum, row) => sum + row.sold, 0);
  const entered = eventTotals.reduce((sum, row) => sum + row.checked_in, 0);
  const openGuest = (guest: EventGuest) => {
    setError(null); setSelected(guest); setName(guest.attendee_name ?? ""); setPhone(guest.attendee_phone ?? "");
  };
  const save = async () => {
    if (!selected || submitting.current) return;
    submitting.current = true; setSaving(true); setError(null);
    try {
      const { error: failure } = await supabase.rpc("set_event_admission_checkin", {
        p_item_id: selected.item_id, p_admission_index: selected.admission_index,
        p_event_number: selected.event_number, p_checked_in: !selected.checked_in_at,
        ...(selected.checked_in_at ? { p_expected_checked_in_at: selected.checked_in_at } : {}),
        p_attendee_name: name.trim(), p_attendee_phone: phone.trim(),
      }).abortSignal(AbortSignal.timeout(12_000));
      if (failure) throw new Error(failure.message);
      setNotice(selected.checked_in_at ? "Check-in undone." : `${name || selected.attendee_name} checked in.`);
      setSelected(null);
      await client.invalidateQueries({ queryKey: ["event-admissions"] });
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : "Could not confirm check-in status."} Refresh the list before trying again if your connection dropped.`);
      void client.invalidateQueries({ queryKey: ["event-admissions"] });
    } finally { submitting.current = false; setSaving(false); }
  };

  return <section className="min-w-0 space-y-4" aria-label="Event attendance">
    {eventNumber === null ? <>
      <h3 className="text-lg font-semibold">Studio Breakdown</h3>
      <p className="text-xs text-muted-foreground">Paid admissions by booking studio. Each cell shows entered / booked.</p>
      <Table><TableHeader><TableRow><TableHead>Studio</TableHead>
        {[1, 2, 3, 4, 0].map(number => <TableHead key={number} className="text-right">{eventName(number)}</TableHead>)}
      </TableRow></TableHeader><TableBody>
        {studios.map(value => <TableRow key={value}><TableCell className="font-medium">{value}</TableCell>
          {[1, 2, 3, 4, 0].map(number => {
            const row = data.studios.find(entry => entry.studio === value && entry.event_number === number);
            return <TableCell key={number} className="text-right"><button type="button" className="min-h-10 px-2 tabular-nums text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2"
              aria-label={`${value}, ${eventName(number)}: ${row?.checked_in ?? 0} entered of ${row?.sold ?? 0} booked`}
              onClick={() => { onStudioChange(value); onSelectEvent(number); }}>
              {row?.checked_in ?? 0} / {row?.sold ?? 0}</button></TableCell>;
          })}</TableRow>)}
        {studios.length === 0 && <TableRow><TableCell colSpan={6}>No paid admissions yet.</TableCell></TableRow>}
      </TableBody></Table>
    </> : <>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="icon" variant="outline" title="Back to sales" aria-label="Back to sales" onClick={() => { onSelectEvent(null); setSearch(""); setStatus("all"); onStudioChange("all"); setNotice(null); }}><ArrowLeft className="h-4 w-4" /></Button>
        <h3 className="text-lg font-semibold">{eventName(eventNumber)} Attendance</h3>
        <Badge variant="secondary">{entered} entered / {total} booked</Badge>
        <span className="text-sm text-muted-foreground">{total - entered} not entered</span>
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-0 flex-1 basis-60"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Search attendees" placeholder="Name, phone, email or booking reference" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
        <select className={selectClass} aria-label="Studio filter" value={studio} onChange={e => onStudioChange(e.target.value)}><option value="all">All studios</option>{studios.map(value => <option key={value}>{value}</option>)}</select>
        <select className={selectClass} aria-label="Check-in filter" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All guests</option><option value="entered">Entered</option><option value="waiting">Not entered</option></select>
      </div>
      {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
      <p className="text-xs text-muted-foreground">{guests.length} matching admissions · Studio is the buyer's booking studio · Check-in times are IST</p>
      <div className="hidden md:block"><Table><TableHeader><TableRow>
        <TableHead className="min-w-44">Guest</TableHead><TableHead>Studio</TableHead><TableHead className="min-w-52">Booking</TableHead><TableHead className="min-w-44">Entry status</TableHead><TableHead className="text-right">Action</TableHead>
      </TableRow></TableHeader><TableBody>
        {guests.map(guest => <TableRow key={`${guest.item_id}:${guest.admission_index}:${guest.event_number}`}>
          <TableCell className="whitespace-normal"><p className="font-medium">{guest.attendee_name || `Guest ${guest.admission_index} · name pending`}</p><p className="text-xs text-muted-foreground">{guest.attendee_phone || "Details required at entry"}</p></TableCell>
          <TableCell>{guest.studio}</TableCell>
          <TableCell className="whitespace-normal"><p className="font-medium">{guest.order_ref} · {guest.package_name}</p><p className="text-xs text-muted-foreground">Booked by {guest.booker_name}</p><p className="text-xs text-muted-foreground">{guest.booker_phone}</p><p className="break-all text-xs text-muted-foreground">{guest.booker_email}</p><p className="text-xs text-muted-foreground">{guest.payment_status} · {guest.payment_provider || "Payment"} · Seat {guest.admission_index}</p></TableCell>
          <TableCell>{guest.checked_in_at ? <><Badge variant="secondary"><Check className="mr-1 h-3 w-3" />Entered</Badge><p className="mt-1 text-xs">{time(guest.checked_in_at)}</p><p className="text-xs text-muted-foreground">{guest.checked_in_by || "Admin"}</p></> : <Badge variant="outline">Not entered</Badge>}</TableCell>
          <TableCell className="text-right"><Button variant={guest.checked_in_at ? "outline" : "default"} size="sm" disabled={stale || saving} onClick={() => openGuest(guest)}>
            {guest.checked_in_at ? <Undo2 className="mr-2 h-4 w-4" /> : <Users className="mr-2 h-4 w-4" />}{guest.checked_in_at ? "Undo" : "Check in"}
          </Button></TableCell>
        </TableRow>)}
        {guests.length === 0 && <TableRow><TableCell colSpan={5}>No guests match these filters.</TableCell></TableRow>}
      </TableBody></Table></div>
      <ul className="divide-y divide-border border-y border-border md:hidden" aria-label="Guest list">
        {guests.map(guest => <li key={`${guest.item_id}:${guest.admission_index}:${guest.event_number}`} className="space-y-3 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="break-words font-medium">{guest.attendee_name || `Guest ${guest.admission_index} · name pending`}</p>
              <p className="text-sm text-muted-foreground">{guest.attendee_phone || "Details required at entry"}</p></div>
            <Badge variant={guest.checked_in_at ? "secondary" : "outline"} className="shrink-0">{guest.checked_in_at ? "Entered" : "Not entered"}</Badge>
          </div>
          <p className="text-sm">{guest.studio}</p>
          <details className="text-sm"><summary className="cursor-pointer break-words py-1">{guest.order_ref} · {guest.package_name} · Seat {guest.admission_index}</summary>
            <div className="mt-2 space-y-1 text-xs text-muted-foreground"><p>Booked by {guest.booker_name}</p><p>{guest.booker_phone}</p><p className="break-all">{guest.booker_email}</p><p>{guest.payment_status} · {guest.payment_provider || "Payment"}</p></div>
          </details>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{guest.checked_in_at ? `${time(guest.checked_in_at)} · ${guest.checked_in_by || "Admin"}` : "Awaiting entry"}</p>
            <Button variant={guest.checked_in_at ? "outline" : "default"} size="sm" disabled={stale || saving} onClick={() => openGuest(guest)}>
              {guest.checked_in_at ? <Undo2 className="mr-2 h-4 w-4" /> : <Users className="mr-2 h-4 w-4" />}{guest.checked_in_at ? "Undo" : "Check in"}
            </Button>
          </div>
        </li>)}
      </ul>
      {guests.length === 0 && <p className="text-sm md:hidden">No guests match these filters.</p>}
    </>}
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open && !submitting.current) setSelected(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{selected?.checked_in_at ? "Undo check-in?" : "Confirm guest entry"}</DialogTitle>
        <DialogDescription>{selected && `${eventName(selected.event_number)} · ${selected.order_ref} · Seat ${selected.admission_index}`}</DialogDescription></DialogHeader>
        {selected?.checked_in_at ? <p className="text-sm">Mark {selected.attendee_name} as not entered?</p> : <>
          <div className="space-y-2"><Label htmlFor="admission-name">Guest name</Label><Input id="admission-name" value={name} maxLength={120} readOnly={Boolean(selected?.attendee_name)} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="admission-phone">Guest phone</Label><Input id="admission-phone" type="tel" value={phone} maxLength={40} readOnly={Boolean(selected?.attendee_phone)} onChange={e => setPhone(e.target.value)} /></div>
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button onClick={() => void save()} disabled={saving || stale || (!selected?.checked_in_at && (!name.trim() || phone.replace(/\D/g, "").length < 10))}>{saving ? "Saving..." : selected?.checked_in_at ? "Confirm undo" : "Confirm check-in"}</Button>
      </DialogContent>
    </Dialog>
  </section>;
}
