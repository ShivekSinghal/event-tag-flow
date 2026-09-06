import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Search, Ticket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * Pinkredibles: the digital reward ticket for winning a paid game (1 = ₹100 off course
 * registration on hashtag.dance). Nothing is printed. Awards happen on the POS right after a
 * game sale (one per game payment, onto the winner's or captain's band). The attendee sees the
 * count and their coupon code on /coins. This page is for the team: check a code, redeem at
 * registration (admin / studio manager), and see recent movements.
 */

type CodeCheck = {
  valid: boolean;
  reason?: string;
  code?: string;
  first_name?: string;
  band_hint?: string;
  active?: boolean;
  pinkredibles?: number;
  value_inr?: number;
};

type LedgerRow = {
  id: string;
  delta: number;
  kind: string;
  game_name: string | null;
  note: string | null;
  created_at: string;
  wallets: { attendee_name: string; tag_id: string } | null;
};

type Summary = {
  awarded: number;
  redeemed: number;
  outstanding: number;
  bands_with_pinkredibles: number;
  outstanding_value_inr: number;
};

const inr = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
const plural = (n: number) => (n === 1 ? "Pinkredible" : "Pinkredibles");
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default function Pinkredibles() {
  const { toast } = useToast();
  const { isAdmin, isStudioManager } = useAuth();
  const canRedeem = isAdmin || isStudioManager;

  const [code, setCode] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [check, setCheck] = useState<CodeCheck | null>(null);
  const [redeemCount, setRedeemCount] = useState(1);
  const [redeemNote, setRedeemNote] = useState("");
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<LedgerRow[]>([]);

  const loadRecent = useCallback(async () => {
    const { data, error } = await supabase
      .from("pinkredible_ledger")
      .select("id, delta, kind, game_name, note, created_at, wallets(attendee_name, tag_id)")
      .order("created_at", { ascending: false })
      .limit(25);
    if (!error && data) setRecent(data as unknown as LedgerRow[]);
  }, []);

  const loadSummary = useCallback(async () => {
    if (!canRedeem) return;
    const { data } = await supabase.rpc("pinkredible_summary");
    if (data && typeof data === "object") setSummary(data as unknown as Summary);
  }, [canRedeem]);

  useEffect(() => {
    void loadRecent();
    void loadSummary();
  }, [loadRecent, loadSummary]);

  const checkCode = async () => {
    const value = code.trim();
    if (!value) return;
    setIsChecking(true);
    setCheck(null);
    try {
      const { data, error } = await supabase.rpc("check_pinkredible_code", { p_code: value });
      if (error) throw error;
      setCheck(data as unknown as CodeCheck);
      setRedeemCount(1);
    } catch (error) {
      toast({ title: "Could not check code", description: errorText(error), variant: "destructive" });
    } finally {
      setIsChecking(false);
    }
  };

  const redeem = async () => {
    if (!check?.valid || !check.code) return;
    setIsRedeeming(true);
    try {
      const { data, error } = await supabase.rpc("redeem_pinkredibles", {
        p_code: check.code,
        p_count: redeemCount,
        p_note: redeemNote.trim() || null,
      });
      if (error) throw error;
      const result = data as unknown as { redeemed: number; redeemed_value_inr: number; remaining: number };
      toast({
        title: `Redeemed ${result.redeemed} ${plural(result.redeemed)} (${inr(result.redeemed_value_inr)})`,
        description: result.remaining > 0 ? `${result.remaining} left on ${check.code}.` : `${check.code} is now used up.`,
      });
      setCheck(null);
      setCode("");
      setRedeemNote("");
      void loadRecent();
      void loadSummary();
    } catch (error) {
      toast({ title: "Could not redeem", description: errorText(error), variant: "destructive" });
    } finally {
      setIsRedeeming(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Ticket className="h-6 w-6 text-primary" /> Pinkredibles</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            The reward for winning a paid game: 1 Pinkredible = ₹100 off course registration. Digital only. It is awarded on the POS
            right after the game is paid for, lands on the winner's band, and the attendee sees their count and coupon code on the coins page.
          </p>
        </div>
        {summary ? (
          <div className="flex gap-3 text-sm">
            <Stat label="Awarded" value={summary.awarded} />
            <Stat label="Redeemed" value={summary.redeemed} />
            <Stat label="Outstanding" value={summary.outstanding} sub={inr(summary.outstanding_value_inr)} />
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><Search className="h-5 w-5 text-primary" /> Check or redeem a code</CardTitle>
            <CardDescription>
              {canRedeem
                ? "At course registration: type the student's code, then take off the Pinkredibles they are using."
                : "Anyone on the team can check a code. Only admins and studio managers can redeem."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void checkCode();
              }}
            >
              <Input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="PINK-XXXXXX" autoComplete="off" className="font-mono" />
              <Button type="submit" variant="outline" disabled={isChecking || !code.trim()}>
                {isChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
              </Button>
            </form>

            {check && !check.valid ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                {check.reason === "format"
                  ? "That doesn't look like a Pinkredible code. It reads PINK- followed by six letters or digits."
                  : "No Pinkredibles found for that code."}
              </div>
            ) : null}

            {check?.valid ? (
              <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
                <div>
                  <div className="font-semibold">{check.first_name} · band ···{check.band_hint}</div>
                  <div className="text-sm text-muted-foreground">
                    {check.pinkredibles} {plural(check.pinkredibles ?? 0)} available · worth {inr(check.value_inr ?? 0)}
                    {check.active === false ? " · band blocked" : ""}
                  </div>
                </div>
                {canRedeem && (check.pinkredibles ?? 0) > 0 ? (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="text-sm font-medium">Redeem</div>
                      <div className="flex items-center gap-1">
                        <Button type="button" size="sm" variant="outline" onClick={() => setRedeemCount((c) => Math.max(1, c - 1))} aria-label="Fewer">−</Button>
                        <span className="w-8 text-center font-bold tabular-nums">{redeemCount}</span>
                        <Button type="button" size="sm" variant="outline" onClick={() => setRedeemCount((c) => Math.min(check.pinkredibles ?? 1, c + 1))} aria-label="More">+</Button>
                      </div>
                      <span className="text-sm text-muted-foreground">= {inr(redeemCount * 100)} off</span>
                    </div>
                    <Input value={redeemNote} onChange={(event) => setRedeemNote(event.target.value)} placeholder="Student and course, e.g. Priya Sharma · Jazz Funk Oct batch" maxLength={200} />
                    <Button type="button" className="w-full" onClick={redeem} disabled={isRedeeming}>
                      {isRedeeming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      Redeem {redeemCount} {plural(redeemCount)}
                    </Button>
                  </>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent</CardTitle>
            <CardDescription>Awards from the game stalls and redemptions at registration.</CardDescription>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Pinkredibles awarded yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {recent.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <span className="font-medium">{row.wallets?.attendee_name ?? "Band"}</span>
                      {row.wallets?.tag_id ? <span className="text-muted-foreground"> ···{row.wallets.tag_id.slice(-3)}</span> : null}
                      <span className="text-muted-foreground">
                        {" · "}
                        {row.kind === "award" ? `won ${row.game_name ?? "a game"}` : row.kind === "redeem" ? `redeemed${row.note ? ` · ${row.note}` : ""}` : row.note}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`font-bold tabular-nums ${row.delta > 0 ? "text-success" : "text-muted-foreground"}`}>{row.delta > 0 ? `+${row.delta}` : row.delta}</span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-center min-w-[84px]">
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}{sub ? ` · ${sub}` : ""}</div>
    </div>
  );
}
