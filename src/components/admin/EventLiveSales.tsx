import { useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLiveEventSales } from "@/hooks/use-live-event-sales";
import { useEventAdmissions } from "@/hooks/use-event-admissions";
import EventAttendance from "@/components/admin/EventAttendance";
import { formatInr } from "@/lib/coins";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const numberFormat = new Intl.NumberFormat("en-IN");
const updatedFormat = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Kolkata",
});

export default function EventLiveSales() {
  const { user, isAdmin } = useAuth();
  const { data, error, isPending, isFetching, refetch } = useLiveEventSales(user?.id, isAdmin);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [eventNumber, setEventNumber] = useState<number | null>(null);
  const [studio, setStudio] = useState("all");
  const admissions = useEventAdmissions(user?.id, isAdmin, eventNumber);
  const fullscreenButton = useRef<HTMLButtonElement>(null);

  if (!isAdmin) return <p role="alert">Admin access is required to view live sales.</p>;

  const metrics = data ? [
    { label: "Intensive Admissions", value: numberFormat.format(data.totals.intensive_admissions) },
    { label: "Party Admissions", value: numberFormat.format(data.totals.party_admissions) },
    { label: "Total Admissions", value: numberFormat.format(data.totals.total_admissions) },
    { label: "Paid Orders", value: numberFormat.format(data.totals.paid_orders) },
    { label: "Event Revenue (INR)", value: formatInr(data.totals.event_revenue_inr) },
  ] : [];
  const hasWarnings = data && Object.values(data.warnings).some(Boolean);

  const report = (
    <section aria-label="Live event sales" className="min-w-0 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-xl font-bold">Live Sales</h2>
          <p className="text-sm text-muted-foreground">All-time paid event sales · Pink'd Coins excluded</p>
          {data && (
            <p className="text-xs text-muted-foreground">
              Last updated <time dateTime={data.generated_at}>{updatedFormat.format(new Date(data.generated_at))}</time> IST
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={error ? "destructive" : "secondary"}>
            {error ? "Update delayed" : isFetching ? "Refreshing" : "Live · 15s"}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => { void refetch(); void admissions.refetch(); }} disabled={isFetching || admissions.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            ref={isFullscreen ? undefined : fullscreenButton}
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label={isFullscreen ? "Exit full-screen preview" : "Open full-screen preview"}
            title={isFullscreen ? "Exit full-screen preview" : "Open full-screen preview"}
            onClick={() => setIsFullscreen(!isFullscreen)}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error.message}{data ? " Showing the last successful snapshot; these figures may be out of date." : " Sales figures are unavailable, not zero."}</p>
        </div>
      )}

      {isPending && !error && (
        <div role="status" aria-label="Loading live sales" className="space-y-4">
          <Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" />
        </div>
      )}

      {data && eventNumber === null && (
        <>
          {hasWarnings && (
            <div role="alert" className="space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="font-semibold">Booking data needs review. Admission totals may be incomplete.</p>
              {data.warnings.session_assignment_items > 0 && <p>{data.warnings.session_assignment_items} item(s) have missing, duplicate or unrecognised session assignments.</p>}
              {data.warnings.unknown_package_items > 0 && <p>{data.warnings.unknown_package_items} item(s) use an unrecognised package.</p>}
              {data.warnings.pax_items > 0 && <p>{data.warnings.pax_items} crew item(s) have missing or unexpected pax values.</p>}
              {data.warnings.incomplete_session_catalog && <p>The database does not contain all four intensive sessions.</p>}
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-5 border-y border-border py-5 sm:grid-cols-3 xl:grid-cols-5">
            {metrics.map((metric) => (
              <div key={metric.label} className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">{metric.label}</dt>
                <dd className="mt-1 break-words text-xl font-bold tabular-nums sm:text-2xl">{metric.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">Admissions are not unique people. One full pass includes four intensive admissions and one party admission.</p>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-40">Event / Time Slot</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">On Hold</TableHead>
                <TableHead className="text-right">Capacity</TableHead>
                <TableHead className="text-right">Available</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.sessions.map((session) => (
                <TableRow key={session.session_number}>
                  <TableCell className="whitespace-normal">
                    <button type="button" className="block min-h-10 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2" onClick={() => { setStudio("all"); setEventNumber(session.session_number); }}>Intensive {session.session_number}</button>
                    <span className="text-xs text-muted-foreground">{session.label}</span>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{numberFormat.format(session.sold)}</TableCell>
                  <TableCell className="text-right tabular-nums">{numberFormat.format(session.on_hold)}</TableCell>
                  <TableCell className="text-right tabular-nums">{numberFormat.format(session.capacity)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={session.available === 0 ? "font-semibold text-destructive" : ""}>{numberFormat.format(session.available)}</span>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-medium"><button type="button" className="min-h-10 text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2" onClick={() => { setStudio("all"); setEventNumber(0); }}>Party</button></TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{numberFormat.format(data.party.sold)}</TableCell>
                <TableCell className="text-right tabular-nums">{numberFormat.format(data.party.on_hold)}</TableCell>
                <TableCell className="text-right text-muted-foreground" aria-label="Party capacity not configured">—</TableCell>
                <TableCell className="text-right text-muted-foreground" aria-label="Party availability not configured">—</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">On hold: unpaid checkouts with an active reservation. Expired holds do not count as sales.</p>
        </>
      )}
      {admissions.error && <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">
        {admissions.error.message} {admissions.data && "Showing the last successful snapshot; check-in is paused until refresh succeeds."}
        {eventNumber !== null && <Button variant="link" onClick={() => setEventNumber(null)}>Back to sales</Button>}
      </div>}
      {admissions.isPending && !admissions.error && <Skeleton aria-label="Loading attendees" className="h-48 w-full" />}
      {admissions.data && <EventAttendance data={admissions.data} eventNumber={eventNumber}
        onSelectEvent={setEventNumber} studio={studio} onStudioChange={setStudio} stale={Boolean(admissions.error)} />}
    </section>
  );

  return (
    <DialogPrimitive.Root open={isFullscreen} onOpenChange={setIsFullscreen}>
      {!isFullscreen && report}
      {isFullscreen && <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 overflow-y-auto bg-background p-4 text-foreground sm:p-8"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() => fullscreenButton.current?.focus());
          }}
        >
          <DialogPrimitive.Title className="sr-only">Live Sales full-screen preview</DialogPrimitive.Title>
          {report}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>}
    </DialogPrimitive.Root>
  );
}
