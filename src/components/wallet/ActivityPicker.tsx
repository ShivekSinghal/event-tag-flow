import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { activityGroups } from "@/lib/activities";
import { formatCoins } from "@/lib/coins";
import type { Tables } from "@/integrations/supabase/types";

export type Activity = Pick<Tables<"games">,
  "id" | "name" | "description" | "price" | "studio" | "available" | "activity_group" | "pricing_mode"> & {
  awardsPinkredible: boolean;
};

export function ActivityPicker({ games, selectedId, disabled, onSelect, onAward }: {
  games: Activity[];
  selectedId?: string;
  disabled: boolean;
  onSelect: (game: Activity) => void;
  onAward: (game: Activity) => void;
}) {
  return <div className="space-y-6">
    {activityGroups.map(group => {
      const activities = games.filter(game => game.activity_group === group.value);
      if (!activities.length) return null;
      return <section key={group.value} aria-label={group.label} className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">{group.label}</h3>
        {activities.map(game => <div key={game.id}
          className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${selectedId === game.id ? "border-primary bg-primary/10" : "border-border"}`}>
          <div className="min-w-0 flex-1 basis-40">
            <p className="font-medium break-words">{game.name}</p>
            {game.description && <p className="text-xs text-muted-foreground">{game.description}</p>}
            <p className="text-sm text-success">
              {game.pricing_mode === "free" ? "Free" : `${game.pricing_mode === "donation" ? "From " : ""}${formatCoins(game.price)}`}
            </p>
          </div>
          {game.pricing_mode !== "free" && <div className="flex items-center gap-2">
            <Button variant="outline" disabled={disabled || !game.available} onClick={() => onSelect(game)}
              aria-label={`${game.pricing_mode === "donation" ? "Donate to" : "Select"} ${game.name}`}>
              {game.pricing_mode === "donation" ? "Donate" : "Select"}
            </Button>
            {game.awardsPinkredible && game.pricing_mode === "fixed" && <Button size="icon" variant="outline"
              disabled={disabled || !game.available} onClick={() => onAward(game)}
              title={`Award Pinkredible for ${game.name}`} aria-label={`Award Pinkredible for ${game.name}`}>
              <Trophy className="h-4 w-4" />
            </Button>}
          </div>}
        </div>)}
      </section>;
    })}
  </div>;
}
