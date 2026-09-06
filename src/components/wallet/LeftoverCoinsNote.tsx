/**
 * Leftover-coin policy (decided 5 Sep, Ayushi + Manas): unspent Pink'd Coins at close are
 * donated to the Hashtag scholarship fund. No refunds on coins.
 *
 * Two variants, same fact:
 *   <LeftoverCoinsNote variant="coins" />    → /coins, directly under the coin packs
 *   <LeftoverCoinsNote variant="booking" />  → booking page, inside the Party card
 */

type Props = { variant: "coins" | "booking"; className?: string };

export function LeftoverCoinsNote({ variant, className = "" }: Props) {
  if (variant === "booking") {
    return (
      <p className={`text-xs leading-relaxed text-white/60 ${className}`}>
        Pink'd Coins are yours to play with all night. Whatever's left on your band when the music stops is
        donated to the Hashtag scholarship fund — nothing goes to waste, and no refunds are needed.
      </p>
    );
  }
  return (
    <div
      className={`mt-4 flex items-start gap-2 rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-white/60 ${className}`}
    >
      <span aria-hidden="true">💗</span>
      <p>
        Coins don't expire during the party. Anything unspent at close is donated to the scholarship fund.{" "}
        <span className="text-white/80">No refunds on coins.</span>
      </p>
    </div>
  );
}

export default LeftoverCoinsNote;
