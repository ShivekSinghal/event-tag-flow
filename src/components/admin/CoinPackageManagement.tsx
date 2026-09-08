import { useCallback, useEffect, useState } from "react";
import { Coins, Package, Save, Utensils } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { formatCoins, formatInr, toIntegerCoins } from "@/lib/coins";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { activityGroups, pricingModes } from "@/lib/activities";

type CoinPackage = Tables<"coin_packages">;

type GamePrice = Pick<Tables<"games">, "id" | "name" | "price" | "available" | "activity_group" | "pricing_mode" | "awards_pinkredible">;

type PosItemPrice = Pick<Tables<"pos_items">, "id" | "name" | "category" | "coin_price" | "active" | "display_order">;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : undefined;
}

export default function CoinPackageManagement() {
  const { toast } = useToast();
  const [packages, setPackages] = useState<CoinPackage[]>([]);
  const [games, setGames] = useState<GamePrice[]>([]);
  const [posItems, setPosItems] = useState<PosItemPrice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchPricing = useCallback(async () => {
    try {
      setIsLoading(true);

      const [packageResult, gamesResult, posItemsResult] = await Promise.all([
        supabase.from("coin_packages").select("*").order("display_order", { ascending: true }),
        supabase.from("games").select("id, name, price, available, activity_group, pricing_mode, awards_pinkredible").order("name"),
        supabase.from("pos_items").select("*").order("display_order", { ascending: true }),
      ]);

      if (packageResult.error) throw packageResult.error;
      if (gamesResult.error) throw gamesResult.error;
      if (posItemsResult.error) throw posItemsResult.error;

      setPackages(packageResult.data || []);
      setGames(
        (gamesResult.data || []).map((game) => ({
          id: game.id,
          name: game.name,
          price: Number(game.price),
          available: game.available,
          activity_group: game.activity_group,
          pricing_mode: game.pricing_mode,
          awards_pinkredible: game.awards_pinkredible,
        })),
      );
      setPosItems(
        (posItemsResult.data || []).filter(item => item.category !== "custom_game").map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          coin_price: toIntegerCoins(item.coin_price),
          active: item.active,
          display_order: item.display_order,
        })),
      );
    } catch (error: unknown) {
      toast({
        title: "Pricing Load Failed",
        description: getErrorMessage(error) || "Could not load Pink'd Coin pricing.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchPricing();
  }, [fetchPricing]);

  const savePackages = async () => {
    try {
      setIsSaving(true);
      const updates = packages.map((pkg) =>
        supabase
          .from("coin_packages")
          .update({
            inr_amount: Number(pkg.inr_amount),
            coin_amount: toIntegerCoins(pkg.coin_amount),
            active: pkg.active,
            display_order: toIntegerCoins(pkg.display_order),
          })
          .eq("id", pkg.id),
      );
      const results = await Promise.all(updates);
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
      toast({ title: "Coin Packages Saved", description: "Top-up packages are updated." });
    } catch (error: unknown) {
      toast({
        title: "Save Failed",
        description: getErrorMessage(error) || "Could not save coin packages.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const saveGamePrices = async () => {
    try {
      for (const game of games) {
        if (!Number.isInteger(game.price) || game.price < 0 || game.price > 2147483647 ||
          (game.pricing_mode === "donation" && game.price < 150) ||
          (game.pricing_mode === "free" && game.price !== 0) ||
          (game.pricing_mode === "fixed" && game.available && game.price <= 0)) {
          throw new Error(`Check ${game.name}: use whole coins, zero for free activities, and at least 150 for donations.`);
        }
      }
      setIsSaving(true);
      const updates = games.map((game) =>
        supabase
          .from("games")
          .update({ price: game.price, available: game.available, activity_group: game.activity_group,
            pricing_mode: game.pricing_mode, awards_pinkredible: game.pricing_mode === "fixed" && game.awards_pinkredible })
          .eq("id", game.id),
      );
      const results = await Promise.all(updates);
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
      toast({ title: "Game Prices Saved", description: "Game prices now use Pink'd Coins." });
    } catch (error: unknown) {
      toast({
        title: "Save Failed",
        description: getErrorMessage(error) || "Could not save game prices.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const savePosItemPrices = async () => {
    try {
      setIsSaving(true);
      const updates = posItems.map((item) =>
        supabase
          .from("pos_items")
          .update({
            coin_price: toIntegerCoins(item.coin_price),
            active: item.active,
            display_order: toIntegerCoins(item.display_order),
          })
          .eq("id", item.id),
      );
      const results = await Promise.all(updates);
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
      toast({ title: "POS Prices Saved", description: "Drink, food, and custom item prices are updated." });
    } catch (error: unknown) {
      toast({
        title: "Save Failed",
        description: getErrorMessage(error) || "Could not save POS item prices.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="shadow-card">
        <CardContent className="py-8 text-center text-muted-foreground">Loading Pink'd Coin controls...</CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-card min-w-0 w-full">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Coins className="w-5 h-5 text-primary" />
          <span>Pink'd Coin Admin Console</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-8 min-w-0 px-4 sm:px-6">
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">Coin Packages</h3>
            <Button onClick={savePackages} disabled={isSaving} size="sm">
              <Save className="w-4 h-4 mr-2" />
              Save Packages
            </Button>
          </div>
          <p className="rounded-md border bg-secondary/20 px-3 py-2 text-sm text-muted-foreground">
            Confirmed ladder: ₹2,000 → 2,000 · ₹5,000 → 6,000 · ₹10,000 → 14,000 · ₹20,000 → 30,000. Inactive tiers are
            hidden from /coins.
          </p>
          <div className="grid grid-cols-1 gap-3">
            {packages.map((pkg) => (
              <div key={pkg.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end p-3 border rounded-lg">
                <div className="space-y-2">
                  <Label>INR Paid</Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={pkg.inr_amount}
                    onChange={(event) =>
                      setPackages((prev) =>
                        prev.map((row) => (row.id === pkg.id ? { ...row, inr_amount: Number(event.target.value) } : row)),
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Coins Received</Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={pkg.coin_amount}
                    onChange={(event) =>
                      setPackages((prev) =>
                        prev.map((row) => (row.id === pkg.id ? { ...row, coin_amount: toIntegerCoins(event.target.value) } : row)),
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Display Order</Label>
                  <Input
                    type="number"
                    step="1"
                    value={pkg.display_order}
                    onChange={(event) =>
                      setPackages((prev) =>
                        prev.map((row) => (row.id === pkg.id ? { ...row, display_order: toIntegerCoins(event.target.value) } : row)),
                      )
                    }
                  />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <Checkbox
                    checked={pkg.active}
                    onCheckedChange={(checked) =>
                      setPackages((prev) => prev.map((row) => (row.id === pkg.id ? { ...row, active: checked === true } : row)))
                    }
                  />
                  Active
                </label>
                <div className="md:col-span-4 text-sm text-muted-foreground">
                  {formatInr(pkg.inr_amount)} credits {formatCoins(pkg.coin_amount)}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Package className="w-4 h-4 text-primary" />
              Game Prices
            </h3>
            <Button onClick={saveGamePrices} disabled={isSaving} size="sm">
              <Save className="w-4 h-4 mr-2" />
              Save Games
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {games.map((game) => (
              <div key={game.id} className="min-w-0 flex flex-wrap items-center justify-between gap-3 p-3 border rounded-lg">
                <div className="min-w-0">
                  <div className="font-medium break-words">{game.name}</div>
                  <Badge variant={game.available ? "outline" : "destructive"} className="mt-1">
                    {game.available ? "Available" : "Sold Out"}
                  </Badge>
                </div>
                <Input
                  aria-label={`${game.name} coin price`}
                  type="number"
                  min={game.pricing_mode === "donation" ? "150" : "0"}
                  step="1"
                  className="w-32"
                  disabled={game.pricing_mode === "free"}
                  value={Number.isNaN(game.price) ? "" : game.price}
                  onChange={(event) =>
                    setGames((prev) =>
                      prev.map((row) => (row.id === game.id ? { ...row, price: event.target.value === "" ? NaN : Number(event.target.value) } : row)),
                    )
                  }
                />
                <div className="grid w-full grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1 min-w-0">
                    <Label>Activity group</Label>
                    <Select value={game.activity_group} onValueChange={group => setGames(prev => prev.map(row => {
                      if (row.id !== game.id) return row;
                      const mode = group === "free" ? "free" : group === "donations" ? "donation" : "fixed";
                      return { ...row, activity_group: group, pricing_mode: mode,
                        price: mode === "free" ? 0 : mode === "donation" ? Math.max(150, row.price || 150) : row.price,
                        awards_pinkredible: mode === "fixed" && row.awards_pinkredible };
                    }))}>
                      <SelectTrigger aria-label={`${game.name} activity group`}><SelectValue /></SelectTrigger>
                      <SelectContent>{activityGroups.map(group => <SelectItem key={group.value} value={group.value}>{group.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 min-w-0">
                    <Label>Pricing mode</Label>
                    <Select value={game.pricing_mode} onValueChange={mode => setGames(prev => prev.map(row => row.id === game.id ? {
                      ...row, pricing_mode: mode, activity_group: mode === "free" ? "free" : mode === "donation" ? "donations" : "other",
                      price: mode === "free" ? 0 : mode === "donation" ? Math.max(150, row.price || 150) : row.price,
                      awards_pinkredible: mode === "fixed" && row.awards_pinkredible,
                    } : row))}>
                      <SelectTrigger aria-label={`${game.name} pricing mode`}><SelectValue /></SelectTrigger>
                      <SelectContent>{pricingModes.map(mode => <SelectItem key={mode} value={mode}>{mode === "donation" ? "Donation (minimum)" : mode === "free" ? "Free" : "Fixed price"}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={game.available} onCheckedChange={checked => setGames(prev => prev.map(row => row.id === game.id ? { ...row, available: checked === true } : row))} />
                    Available
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Utensils className="w-4 h-4 text-primary" />
              Drink, Food, and Custom Prices
            </h3>
            <Button onClick={savePosItemPrices} disabled={isSaving} size="sm">
              <Save className="w-4 h-4 mr-2" />
              Save POS Items
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {posItems.map((item) => (
              <div key={item.id} className="grid grid-cols-1 md:grid-cols-[1fr_160px_120px_auto] gap-3 items-end p-3 border rounded-lg">
                <div className="min-w-0">
                  <div className="font-medium truncate">{item.name}</div>
                  <Badge variant="secondary" className="mt-1 capitalize">
                    {item.category.replace("_", " ")}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <Label>Coin Price</Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={item.coin_price}
                    onChange={(event) =>
                      setPosItems((prev) =>
                        prev.map((row) => (row.id === item.id ? { ...row, coin_price: toIntegerCoins(event.target.value) } : row)),
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Order</Label>
                  <Input
                    type="number"
                    step="1"
                    value={item.display_order}
                    onChange={(event) =>
                      setPosItems((prev) =>
                        prev.map((row) => (row.id === item.id ? { ...row, display_order: toIntegerCoins(event.target.value) } : row)),
                      )
                    }
                  />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <Checkbox
                    checked={item.active}
                    onCheckedChange={(checked) =>
                      setPosItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, active: checked === true } : row)))
                    }
                  />
                  Active
                </label>
              </div>
            ))}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
