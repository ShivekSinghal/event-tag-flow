import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useFlyingCards } from "@/hooks/use-flying-cards";
import { useStaffPermissions } from "@/hooks/use-staff-permissions";
import { nfcManager, allowTypedTag } from "@/utils/nfc";
import { FindWalletFallback, LOOKUP_REFERENCE_TAG, type FoundWallet } from "@/components/wallet/FindWalletFallback";
import { TagIdentifier } from "@/components/wallet/TagIdentifier";
import { formatCoins, getCoinBalance } from "@/lib/coins";
import { useWalletOperation } from "@/hooks/use-wallet-operation";
import { WalletOperationStatus } from "@/components/wallet/WalletOperationStatus";
import { PosSaleControls } from "@/components/wallet/PosSaleControls";
import { InsufficientCoinsNotice } from "@/components/wallet/InsufficientCoinsNotice";
import { useEffect, useMemo, useRef, useState } from "react";
import { Package, CreditCard, DollarSign, Scan, AlertCircle, ArrowRight, CheckCircle, Calculator, Ticket } from "lucide-react";

interface Game {
  id: string;
  name: string;
  description: string;
  price: number;
  studio: string;
  available: boolean;
  // Round format (see migration 20260906090000): how many paid players a round needs, team size,
  // and whether the winner gets a Pinkredible.
  players_min?: number;
  players_max?: number | null;
  team_size?: number;
  awards_pinkredible?: boolean;
}

// Games with a Pinkredible prize, or that need several players, are run as rounds on this phone:
// each player pays into the round, it starts once the minimum is in, and closing it awards one
// Pinkredible to the winner (the captain for team games). No refunds if a round never fills.
const isRoundGame = (game: Game) => Boolean(game.awards_pinkredible) || (game.players_min ?? 1) > 1;

type RoundPlayer = { wallet_id: string; name: string; band_hint: string; paid_at: string };
type GameRound = {
  round_id: string;
  game_id: string | null;
  game_name: string;
  entry_coins: number;
  players_needed: number;
  players_max: number | null;
  team_size: number;
  awards_pinkredible: boolean;
  status: string;
  players_paid: number;
  can_start: boolean;
  is_full: boolean;
  players: RoundPlayer[];
};

const parseRound = (data: unknown): GameRound | null => {
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  if (typeof r.round_id !== "string") return null;
  return {
    round_id: r.round_id,
    game_id: typeof r.game_id === "string" ? r.game_id : null,
    game_name: String(r.game_name ?? "Game"),
    entry_coins: Number(r.entry_coins ?? 0),
    players_needed: Number(r.players_needed ?? 1),
    players_max: typeof r.players_max === "number" ? r.players_max : null,
    team_size: Number(r.team_size ?? 1),
    awards_pinkredible: Boolean(r.awards_pinkredible),
    status: String(r.status ?? "open"),
    players_paid: Number(r.players_paid ?? 0),
    can_start: Boolean(r.can_start),
    is_full: Boolean(r.is_full),
    players: Array.isArray(r.players)
      ? (r.players as Array<Record<string, unknown>>).map((p) => ({
          wallet_id: String(p.wallet_id),
          name: String(p.name ?? "Player"),
          band_hint: String(p.band_hint ?? ""),
          paid_at: String(p.paid_at ?? ""),
        }))
      : [],
  };
};

interface DrinkItem {
  id: string;
  name: string;
  price: number;
  category: string;
}

interface CustomItem {
  id: string;
  name: string;
  type: "food" | "game";
  price: number;
  categoryRef: string;
}

interface PosItem {
  id: string;
  name: string;
  category: "drink" | "food" | "custom_food" | "custom_game";
  coin_price: number;
  active: boolean;
  display_order: number;
}

type PosSection = "games" | "drinks" | "food" | "custom-games";

interface ScannedWallet {
  id: string;
  attendeeName: string;
  attendeePhone: string;
  tagId: string;
  currentBalance: number;
  status: string;
}

function getErrorDetail(error: unknown, key: "message" | "code" | "details" | "hint") {
  return typeof error === "object" && error !== null && key in error
    ? String((error as Record<string, unknown>)[key] || "")
    : "";
}

export default function POS() {
  const walletOperation = useWalletOperation();
  const { toast } = useToast();
  const { addCard } = useFlyingCards();
  const {
    gamePermissions,
    hasFoodPermission,
    hasDrinksPermission,
    isLoading: permissionsLoading,
  } = useStaffPermissions();
  const [isScanning, setIsScanning] = useState(false);
  // "Can't scan?" support: the sale that is waiting for a band, and a generation counter so a
  // scan that is abandoned in favour of the phone lookup can never charge a second time.
  const pendingSaleRef = useRef<{ price: number; itemName: string; gameId: string | null; transactionType: string } | null>(null);
  const scanGenerationRef = useRef(0);
  const paymentInFlightRef = useRef(false);
  const [lookupActive, setLookupActive] = useState(false);
  const [lookupKey, setLookupKey] = useState(0);

  useEffect(() => () => {
    scanGenerationRef.current += 1;
    roundScanGenerationRef.current += 1;
    pendingSaleRef.current = null;
    nfcManager.stopScanning();
  }, []);
  const roundScanGenerationRef = useRef(0);
  const [scannedWallet, setScannedWallet] = useState<ScannedWallet | null>(null);
  const [insufficientCoins, setInsufficientCoins] = useState<{ balance: number; required: number; walletId: string } | null>(null);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [selectedDrink, setSelectedDrink] = useState<DrinkItem | null>(null);
  const [selectedCustomItem, setSelectedCustomItem] = useState<CustomItem | null>(null);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [showCustomAmountInput, setShowCustomAmountInput] = useState(false);
  const [calculatorItems, setCalculatorItems] = useState<{ name: string; price: number; quantity: number }[]>([]);
  const [showCalculator, setShowCalculator] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [games, setGames] = useState<Game[]>([]);
  const [drinkItems, setDrinkItems] = useState<DrinkItem[]>([]);
  const [foodItems, setFoodItems] = useState<DrinkItem[]>([]);
  const [customItems, setCustomItems] = useState<CustomItem[]>([]);
  const [isLoadingGames, setIsLoadingGames] = useState(false);
  const [activeSection, setActiveSection] = useState<PosSection>("games");
  // The game round open on this phone (players pay in, then one winner gets the Pinkredible).
  const [activeRound, setActiveRound] = useState<GameRound | null>(null);
  const [isPickingWinner, setIsPickingWinner] = useState(false);
  const [roundTypedTag, setRoundTypedTag] = useState("");
  const [isAwarding, setIsAwarding] = useState(false);

  // A phone that reloads mid-round picks its open round back up.
  useEffect(() => {
    let cancelled = false;
    supabase.rpc("my_open_game_rounds").then(({ data }) => {
      if (cancelled || !Array.isArray(data) || data.length === 0) return;
      const round = parseRound(data[0]);
      if (round) setActiveRound(round);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasCustomGames = useMemo(
    () => gamePermissions.some((game) => ["Dunk a Company Member", "Karaoke"].includes(game.name)),
    [gamePermissions],
  );
  const availableSections = useMemo<PosSection[]>(() => {
    const sections: PosSection[] = [];
    if (gamePermissions.length > 0) sections.push("games");
    if (hasCustomGames) sections.push("custom-games");
    if (hasDrinksPermission) sections.push("drinks");
    if (hasFoodPermission) sections.push("food");
    return sections;
  }, [gamePermissions.length, hasCustomGames, hasDrinksPermission, hasFoodPermission]);
  const permittedGameIds = useMemo(() => gamePermissions.map((game) => game.id), [gamePermissions]);

  useEffect(() => {
    const fetchPosItems = async () => {
      const { data, error } = await supabase
        .from("pos_items")
        .select("*")
        .eq("active", true)
        .order("display_order", { ascending: true });

      if (error) {
        toast({
          title: "Item Prices Unavailable",
          description: "Could not load Pink'd Coin item prices.",
          variant: "destructive",
        });
        return;
      }

      const items = (data || []) as PosItem[];
      setDrinkItems(
        items
          .filter((item) => item.category === "drink")
          .map((item) => ({ id: item.id, name: item.name, price: item.coin_price, category: "Drinks" })),
      );
      setFoodItems(
        items
          .filter((item) => item.category === "food")
          .map((item) => ({ id: item.id, name: item.name, price: item.coin_price, category: "Food" })),
      );
      setCustomItems(
        items
          .filter((item) => item.category === "custom_food" || item.category === "custom_game")
          .map((item) => ({
            id: item.id,
            name: item.name,
            type: item.category === "custom_game" ? "game" : "food",
            price: item.coin_price,
            categoryRef: item.category,
          })),
      );
    };

    fetchPosItems();
  }, [toast]);

  // Handle section switching based on permissions
  useEffect(() => {
    if (!permissionsLoading && availableSections.length > 0 && !availableSections.includes(activeSection)) {
      setActiveSection(availableSections[0]);
    }
  }, [activeSection, availableSections, permissionsLoading]);

  // Load games from database with actual prices
  useEffect(() => {
    let isCurrent = true;

    const fetchGames = async () => {
      if (!permissionsLoading) {
        if (permittedGameIds.length > 0) {
          setIsLoadingGames(true);
          const { data: gamesData, error } = await supabase
            .from("games")
            .select("*")
            .in("id", permittedGameIds)
            .eq("available", true);

          if (isCurrent && !error && gamesData) {
            // Filter out games that should only appear as custom amount items
            const regularGames = gamesData.filter((g) => !["Dunk a Company Member", "Karaoke"].includes(g.name));

            setGames(
              regularGames.map((g) => ({
                id: g.id,
                name: g.name,
                description: g.description || "",
                price: typeof g.price === "string" ? parseFloat(g.price) : g.price,
                studio: g.studio,
                available: g.available,
                players_min: g.players_min,
                players_max: g.players_max,
                team_size: g.team_size,
                awards_pinkredible: g.awards_pinkredible,
              })),
            );
          }
        } else if (isCurrent) {
          setGames([]);
        }
        if (isCurrent) setIsLoadingGames(false);
      }
    };

    void fetchGames();
    return () => {
      isCurrent = false;
    };
  }, [permissionsLoading, permittedGameIds]);

  const handleGameSelect = async (game: Game) => {
    walletOperation.clearRejectedResult();
    if (!game.available) {
      toast({
        title: "Game Not Available",
        description: `${game.name} is currently sold out.`,
        variant: "destructive",
      });
      return;
    }

    if (isScanning || isProcessing) {
      return;
    }

    setSelectedGame(game);
    setSelectedDrink(null);
    setSelectedCustomItem(null);
    setShowCustomAmountInput(false);

    if (isRoundGame(game)) {
      // Round games: open (or resume) this phone's round, then scan players one by one.
      setIsProcessing(true);
      try {
        const { data, error } = await supabase.rpc("open_game_round", { p_game_id: game.id });
        if (error) throw error;
        const round = parseRound(data);
        if (!round) throw new Error("Could not open the round");
        setActiveRound(round);
        setIsPickingWinner(false);
        toast({
          title: `${game.name} · round open`,
          description: `${round.players_paid} of ${round.players_needed} players paid. Scan each player's band to take their ${formatCoins(round.entry_coins)} entry.`,
        });
      } catch (error) {
        toast({ title: "Could not open the round", description: getErrorDetail(error, "message") || "Try again.", variant: "destructive" });
        setSelectedGame(null);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    toast({
      title: "Scanning Started",
      description: `Selected ${game.name} (${formatCoins(game.price)}). Please scan the customer's NFC tag.`,
    });

    // Automatically start NFC scanning
    await handleScanForPayment(game.price, `${game.name}`, game.id, "games");
  };

  const handleDrinkSelect = async (drink: DrinkItem) => {
    if (isScanning || isProcessing) {
      return;
    }

    setSelectedDrink(drink);
    setSelectedGame(null);
    setSelectedCustomItem(null);
    setShowCustomAmountInput(false);
    toast({
      title: "Scanning Started",
      description: `Selected ${drink.name} (${formatCoins(drink.price)}). Please scan the customer's NFC tag.`,
    });

    // Automatically start NFC scanning
    await handleScanForPayment(drink.price, `${drink.name}`, null, "drinks");
  };

  const handleCustomItemSelect = async (item: CustomItem) => {
    if (isScanning || isProcessing) {
      return;
    }

    setSelectedCustomItem(item);
    setSelectedGame(null);
    setSelectedDrink(null);
    setShowCustomAmountInput(false);
    setCustomAmount(item.price.toString());
    toast({
      title: "Scanning Started",
      description: `Selected ${item.name} (${formatCoins(item.price)}). Please scan the customer's NFC tag.`,
    });

    const itemType = item.type === "game" ? "games" : "food";
    await handleScanForPayment(item.price, item.name, null, itemType);
  };

  const handleCustomAmountConfirm = async () => {
    if (!selectedCustomItem || !customAmount) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount.",
        variant: "destructive",
      });
      return;
    }

    const amount = parseFloat(customAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount greater than 0.",
        variant: "destructive",
      });
      return;
    }

    setShowCustomAmountInput(false);
    toast({
      title: "Scanning Started",
      description: `Selected ${selectedCustomItem.name} (${formatCoins(amount)}). Please scan the customer's NFC tag.`,
    });

    // Automatically start NFC scanning
    const itemType = selectedCustomItem.type === "game" ? "games" : "food";
    await handleScanForPayment(amount, selectedCustomItem.name, null, itemType);
  };

  const handleScanForPayment = async (
    price: number,
    itemName: string,
    gameId: string | null,
    transactionType: string = "food",
  ) => {
    if (paymentInFlightRef.current) return;
    setLookupActive(false);
    walletOperation.clearRejectedResult();
    setInsufficientCoins(null);
    setScannedWallet(null);
    setLookupKey((key) => key + 1);
    setIsScanning(true);
    pendingSaleRef.current = { price, itemName, gameId, transactionType };
    const generation = ++scanGenerationRef.current;

    try {
      const result = await nfcManager.startScanning();

      // The staffer switched to the phone lookup while this scan was open: ignore whatever it returns.
      if (generation !== scanGenerationRef.current) return;

      if (result.success) {
        // Fetch wallet data from Supabase based on tag ID
        const { data: wallet, error } = await supabase.from("wallets").select("*").eq("tag_id", result.tagId).single();
        if (generation !== scanGenerationRef.current) return;

        if (error || !wallet) {
          toast({
            title: "No Wallet Found",
            description: `NFC tag ${result.tagId} scanned but no wallet is linked to this tag. Please issue this tag first.`,
            variant: "destructive",
          });
          return;
        }

        // Check if wallet is blocked
        if (wallet.status === "blocked") {
          toast({
            title: "Tag Blocked",
            description: `This NFC tag has been blocked and cannot be used for transactions. Contact admin for assistance.`,
            variant: "destructive",
          });
          return;
        }

        // Format wallet data for UI
        const formattedWallet = {
          id: wallet.id,
          attendeeName: wallet.attendee_name,
          attendeePhone: wallet.attendee_phone,
          tagId: wallet.tag_id,
          currentBalance: getCoinBalance(wallet),
          status: wallet.status,
        };

        setScannedWallet(formattedWallet);

        // Immediately process the payment
        await processPayment(formattedWallet, price, itemName, gameId, transactionType, false, generation);
      } else {
        toast({
          title: "Scanning Failed",
          description: result.error || "Could not scan NFC tag. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      if (generation !== scanGenerationRef.current) return;
      toast({
        title: "Scanning Failed",
        description: "Could not scan NFC tag. Please try again.",
        variant: "destructive",
      });
    } finally {
      if (generation === scanGenerationRef.current) setIsScanning(false);
    }
  };

  const cancelSaleScan = () => {
    if (paymentInFlightRef.current) return false;
    walletOperation.clearRejectedResult();
    setInsufficientCoins(null);
    scanGenerationRef.current += 1;
    nfcManager.stopScanning();
    setIsScanning(false);
    setLookupActive(true);
  };

  const retrySaleScan = () => {
    const sale = pendingSaleRef.current;
    if (!sale || paymentInFlightRef.current) return;
    void handleScanForPayment(sale.price, sale.itemName, sale.gameId, sale.transactionType);
  };

  // "Can't scan? Find by phone": same sale, same processPayment, band picked from the lookup.
  const handleLookupSelect = async (found: FoundWallet) => {
    const sale = pendingSaleRef.current;
    if (!sale || paymentInFlightRef.current) return;

    // Abandon the open NFC scan and take over with the confirmed wallet.
    cancelSaleScan();
    const generation = scanGenerationRef.current;

    try {
      const { data: wallet, error } = await supabase.from("wallets").select("*").eq("id", found.wallet_id).single();
      if (generation !== scanGenerationRef.current || sale !== pendingSaleRef.current) return;
      if (error || !wallet || wallet.status === "blocked") {
        toast({
          title: "Band unavailable",
          description: error?.message || "That band is blocked or could not be loaded.",
          variant: "destructive",
        });
        return;
      }

      const formattedWallet = {
        id: wallet.id,
        attendeeName: wallet.attendee_name,
        attendeePhone: wallet.attendee_phone,
        tagId: wallet.tag_id,
        currentBalance: getCoinBalance(wallet),
        status: wallet.status,
      };
      setScannedWallet(formattedWallet);
      await processPayment(formattedWallet, sale.price, sale.itemName, sale.gameId, sale.transactionType, true, generation);
    } catch (error) {
      if (generation !== scanGenerationRef.current) return;
      toast({ title: "Band unavailable", description: getErrorDetail(error, "message") || "Please try the lookup again.", variant: "destructive" });
    }
  };

  const processPayment = async (
    wallet: ScannedWallet,
    price: number,
    itemName: string,
    gameId: string | null,
    transactionType: string,
    viaLookup: boolean,
    generation: number,
  ) => {
    if (generation !== scanGenerationRef.current || !pendingSaleRef.current || paymentInFlightRef.current || walletOperation.blocked) return;
    setInsufficientCoins(null);
    if (price > wallet.currentBalance) {
      setInsufficientCoins({ balance: wallet.currentBalance, required: price, walletId: wallet.id });
      toast({
        title: "Insufficient Pink'd Coins",
        description: `Balance: ${formatCoins(wallet.currentBalance)} | Required: ${formatCoins(price)}`,
        variant: "destructive",
      });
      return;
    }

    // Claim synchronously: React state alone cannot block two callbacks in one tick.
    paymentInFlightRef.current = true;
    setIsProcessing(true);

    try {
      await walletOperation.submit({
        kind: "spend",
        wallet_id: wallet.id,
        coin_amount: Math.round(price),
        transaction_type: transactionType,
        item_name: itemName,
        item_category: transactionType,
        game_id: gameId,
        reference: `${transactionType.toUpperCase()}_${gameId || selectedDrink?.id || selectedCustomItem?.id || Date.now()}${viaLookup ? ` ${LOOKUP_REFERENCE_TAG}` : ""}`,
      });
      // The durable operation panel owns recovery and the receipt, even after a refresh.
      resetTransaction();
    } catch (error) {
      console.error("Payment processing error:", error);
      console.error("Error details:", {
        message: getErrorDetail(error, "message"),
        code: getErrorDetail(error, "code"),
        details: getErrorDetail(error, "details"),
        hint: getErrorDetail(error, "hint"),
      });

      toast({
        title: "Payment status unknown",
        description: "Check the saved payment before trying another charge.",
        variant: "destructive",
      });
    } finally {
      paymentInFlightRef.current = false;
      setIsProcessing(false);
    }
  };

  const findWalletByTag = async (tagId: string) => {
    const tag = tagId.trim().toUpperCase();
    const { data, error } = await supabase
      .from("wallets")
      .select("id, attendee_name, status")
      .eq("tag_id", tag)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      toast({ title: "Band not registered", description: `No wallet for tag ${tag}. Issue the band first.`, variant: "destructive" });
      return null;
    }
    return data;
  };

  const scanBand = async () => {
    nfcManager.stopScanning();
    return nfcManager.startScanning();
  };

  const cancelRoundScan = () => {
    if (paymentInFlightRef.current) return false;
    roundScanGenerationRef.current += 1;
    nfcManager.stopScanning();
    setIsScanning(false);
    setLookupActive(true);
  };

  /** Takes one player's entry into the open round through NFC, typed test tag, or confirmed lookup. */
  const payRoundPlayer = async (walletId: string, attendeeName: string, viaLookup = false, generation = roundScanGenerationRef.current) => {
    const roundId = activeRound?.round_id;
    if (!roundId || paymentInFlightRef.current || generation !== roundScanGenerationRef.current) return;
    paymentInFlightRef.current = true;
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.rpc("pay_game_round", {
        p_round_id: roundId,
        p_wallet_id: walletId,
        p_via_phone_lookup: viaLookup,
      });
      if (error) throw error;
      roundScanGenerationRef.current += 1;
      setIsScanning(false);
      const round = parseRound(data);
      if (!round) throw new Error("Round update missing");
      const paid = data as { paid_name?: string; new_coin_balance?: number };
      setActiveRound(round);
      toast({
        title: `${paid.paid_name ?? attendeeName} is in`,
        description: `${formatCoins(round.entry_coins)} taken · balance ${formatCoins(Number(paid.new_coin_balance ?? 0))}. ${round.players_paid} of ${round.players_needed} players paid.`,
      });
      addCard({ amount: round.entry_coins, name: paid.paid_name ?? attendeeName, studio: round.game_name, type: "sale" });
    } catch (error) {
      toast({ title: "Could not take the entry", description: getErrorDetail(error, "message") || "Try again.", variant: "destructive" });
    } finally {
      paymentInFlightRef.current = false;
      setIsProcessing(false);
    }
  };

  const payPlayerByTag = async (tagId: string, scanGeneration?: number) => {
    if (paymentInFlightRef.current) return;
    if (scanGeneration === undefined) cancelRoundScan();
    const generation = scanGeneration ?? roundScanGenerationRef.current;
    const wallet = await findWalletByTag(tagId);
    if (generation !== roundScanGenerationRef.current) return;
    if (wallet) await payRoundPlayer(wallet.id, wallet.attendee_name, false, generation);
  };

  const handleRoundLookupSelect = async (found: FoundWallet) => {
    if (paymentInFlightRef.current) return;
    cancelRoundScan();
    await payRoundPlayer(found.wallet_id, found.attendee_name, true);
  };

  const scanPlayerForRound = async () => {
    if (isScanning || paymentInFlightRef.current || !activeRound) return;
    setLookupActive(false);
    setLookupKey((key) => key + 1);
    const generation = ++roundScanGenerationRef.current;
    setIsScanning(true);
    try {
      const result = await scanBand();
      if (generation !== roundScanGenerationRef.current) return;
      if (result.success && result.tagId) {
        await payPlayerByTag(result.tagId, generation);
      } else {
        toast({ title: "Scan failed", description: result.error || "Could not read the band. Try again.", variant: "destructive" });
      }
    } catch (error) {
      if (generation !== roundScanGenerationRef.current) return;
      console.error("Player scan error:", error);
      toast({ title: "Scan failed", description: "Could not read the band. Try again.", variant: "destructive" });
    } finally {
      if (generation === roundScanGenerationRef.current) setIsScanning(false);
    }
  };

  /** Closes the round and puts one Pinkredible on the winner's (captain's) band. */
  const awardWinner = async (walletId: string) => {
    if (!activeRound || paymentInFlightRef.current) return;
    cancelRoundScan();
    paymentInFlightRef.current = true;
    setIsAwarding(true);
    try {
      const { data, error } = await supabase.rpc("award_game_round", { p_round_id: activeRound.round_id, p_winner_wallet_id: walletId });
      if (error) throw error;
      const result = data as { winner_name: string; awarded: number; pinkredibles: number; code: string | null; game_name: string };
      toast({
        title: result.awarded > 0 ? "Pinkredible awarded" : "Round closed",
        description:
          result.awarded > 0
            ? `${result.winner_name} won ${result.game_name}. Now ${result.pinkredibles} on code ${result.code}, visible on their coins page.`
            : `${result.winner_name} won ${result.game_name}.`,
      });
      if (result.awarded > 0) addCard({ amount: 1, name: result.winner_name, studio: "Pinkredible", type: "sale" });
      setActiveRound(null);
      setIsPickingWinner(false);
      setSelectedGame(null);
    } catch (error) {
      toast({ title: "Could not close the round", description: getErrorDetail(error, "message") || "Try again.", variant: "destructive" });
    } finally {
      paymentInFlightRef.current = false;
      setIsAwarding(false);
    }
  };

  const awardWinnerByTag = async (tagId: string) => {
    const generation = roundScanGenerationRef.current;
    const wallet = await findWalletByTag(tagId).catch((error) => {
      toast({ title: "Lookup failed", description: getErrorDetail(error, "message") || "Try again.", variant: "destructive" });
      return null;
    });
    if (generation !== roundScanGenerationRef.current) return;
    if (wallet) await awardWinner(wallet.id);
  };

  const scanWinnerBand = async () => {
    if (isScanning || paymentInFlightRef.current) return;
    const generation = ++roundScanGenerationRef.current;
    setIsScanning(true);
    try {
      const result = await scanBand();
      if (generation !== roundScanGenerationRef.current) return;
      if (result.success && result.tagId) {
        await awardWinnerByTag(result.tagId);
      } else {
        toast({ title: "Scan failed", description: result.error || "Could not read the band. Try again.", variant: "destructive" });
      }
    } catch (error) {
      if (generation !== roundScanGenerationRef.current) return;
      console.error("Winner scan error:", error);
      toast({ title: "Scan failed", description: "Could not read the band. Try again.", variant: "destructive" });
    } finally {
      if (generation === roundScanGenerationRef.current) setIsScanning(false);
    }
  };

  const closeRoundNoWinner = async () => {
    if (!activeRound || paymentInFlightRef.current) return;
    cancelRoundScan();
    paymentInFlightRef.current = true;
    setIsProcessing(true);
    try {
      const { error } = await supabase.rpc("close_game_round", {
        p_round_id: activeRound.round_id,
        p_reason: activeRound.can_start ? "no winner" : "not enough players",
      });
      if (error) throw error;
      toast({ title: "Round closed", description: "No Pinkredible awarded. Entries are not refunded." });
      setActiveRound(null);
      setIsPickingWinner(false);
      setSelectedGame(null);
    } catch (error) {
      toast({ title: "Could not close the round", description: getErrorDetail(error, "message") || "Try again.", variant: "destructive" });
    } finally {
      paymentInFlightRef.current = false;
      setIsProcessing(false);
    }
  };

  const resetTransaction = () => {
    setInsufficientCoins(null);
    scanGenerationRef.current += 1;
    roundScanGenerationRef.current += 1;
    nfcManager.stopScanning();
    setIsScanning(false);
    setLookupActive(false);
    pendingSaleRef.current = null;
    setSelectedGame(null);
    setSelectedDrink(null);
    setSelectedCustomItem(null);
    setScannedWallet(null);
    setShowCustomAmountInput(false);
    setCustomAmount("");
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4 px-4 sm:px-6 lg:px-8">
      <WalletOperationStatus operation={walletOperation} showSpendReceipt={false} />
      <PosSaleControls operation={walletOperation} saleInProgress={isScanning || isProcessing || isAwarding || lookupActive || Boolean(activeRound || pendingSaleRef.current)} />
      {insufficientCoins && <InsufficientCoinsNotice {...insufficientCoins} />}
      <fieldset disabled={walletOperation.blocked} className="min-w-0 space-y-4 disabled:opacity-60">
      {/* Header */}
      <div className="text-center py-4">
        <div className="flex items-center justify-center space-x-3 mb-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Point of Sale</h1>
        </div>
        <p className="text-sm sm:text-base text-muted-foreground mt-2">
          Tap items, scan NFC tag, deduct Pink'd Coins instantly
        </p>
      </div>

      {/* Check if user has any permissions */}
      {!permissionsLoading && gamePermissions.length === 0 && !hasFoodPermission && !hasDrinksPermission && (
        <Card className="shadow-card">
          <CardContent className="text-center py-8">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No Access Permissions</h3>
            <p className="text-muted-foreground">
              You don't have access to any POS sections. Please contact an admin to assign you permissions for games,
              food, or drinks.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Show sections only if user has permissions */}
      {!permissionsLoading &&
        (gamePermissions.length > 0 || hasFoodPermission || hasDrinksPermission || hasCustomGames) && (
          <>
            {/* Section Tabs */}
            <div className="flex flex-wrap justify-center gap-2 px-4">
              {gamePermissions.length > 0 && (
                <Button
                  variant={activeSection === "games" ? "default" : "outline"}
                  onClick={() => setActiveSection("games")}
                  className="flex items-center space-x-2 text-xs sm:text-sm"
                  size="sm"
                >
                  <Package className="w-3 h-3 sm:w-4 sm:h-4" />
                  <span className="hidden xs:inline">Games</span>
                  <span className="xs:hidden">🎮</span>
                </Button>
              )}
              {hasDrinksPermission && (
                <Button
                  variant={activeSection === "drinks" ? "default" : "outline"}
                  onClick={() => setActiveSection("drinks")}
                  className="flex items-center space-x-2 text-xs sm:text-sm"
                  size="sm"
                >
                  <CreditCard className="w-3 h-3 sm:w-4 sm:h-4" />
                  <span className="hidden xs:inline">Drinks</span>
                  <span className="xs:hidden">🥤</span>
                </Button>
              )}
              {hasCustomGames && (
                <Button
                  variant={activeSection === "custom-games" ? "default" : "outline"}
                  onClick={() => setActiveSection("custom-games")}
                  className="flex items-center space-x-2 text-xs sm:text-sm"
                  size="sm"
                >
                  <DollarSign className="w-3 h-3 sm:w-4 sm:h-4" />
                  <span className="hidden xs:inline">Custom Games</span>
                  <span className="xs:hidden">🎯</span>
                </Button>
              )}
              {hasFoodPermission && (
                <Button
                  variant={activeSection === "food" ? "default" : "outline"}
                  onClick={() => setActiveSection("food")}
                  className="flex items-center space-x-2 text-xs sm:text-sm"
                  size="sm"
                >
                  <DollarSign className="w-3 h-3 sm:w-4 sm:h-4" />
                  <span className="hidden xs:inline">Food & Custom</span>
                  <span className="xs:hidden">🍽️</span>
                </Button>
              )}
            </div>

            {/* Transaction Flow */}
            <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-4 text-xs sm:text-sm text-muted-foreground px-4">
              <div
                className={`flex items-center space-x-2 ${selectedGame || selectedDrink || selectedCustomItem ? "text-success" : "text-muted-foreground"}`}
              >
                <div
                  className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full ${selectedGame || selectedDrink || selectedCustomItem ? "bg-success" : "bg-muted"}`}
                />
                <span>Select Item</span>
              </div>
              <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4 rotate-90 sm:rotate-0" />
              <div
                className={`flex items-center space-x-2 ${scannedWallet ? "text-success" : selectedGame || selectedDrink || selectedCustomItem ? "text-foreground" : "text-muted-foreground"}`}
              >
                <div
                  className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full ${scannedWallet ? "bg-success" : selectedGame || selectedDrink || selectedCustomItem ? "bg-primary" : "bg-muted"}`}
                />
                <span>Scan NFC Tag</span>
              </div>
              <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4 rotate-90 sm:rotate-0" />
              <div
                className={`flex items-center space-x-2 ${scannedWallet && !isProcessing ? "text-success" : "text-muted-foreground"}`}
              >
                <div
                  className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full ${scannedWallet && !isProcessing ? "bg-success" : "bg-muted"}`}
                />
                <span>Payment Complete</span>
              </div>
            </div>

            <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 lg:gap-8">
              {/* Main Content Area */}
              <div className="lg:col-span-2 order-1 lg:order-1">
                <Card className="shadow-card">
                  <CardHeader className="pb-4">
                    <CardTitle className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                      <div className="flex items-center space-x-2">
                        {activeSection === "games" && <Package className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />}
                        {activeSection === "drinks" && <CreditCard className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />}
                        {activeSection === "food" && <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />}
                        {activeSection === "custom-games" && (
                          <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                        )}
                        <span className="text-sm sm:text-base">
                          {activeSection === "games" && "Available Games"}
                          {activeSection === "drinks" && "Drinks Menu"}
                          {activeSection === "food" && "Food & Custom Items"}
                          {activeSection === "custom-games" && "Custom Game Items"}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        {(selectedGame || selectedDrink || selectedCustomItem) && (
                          <Button variant="outline" size="sm" onClick={resetTransaction} className="text-xs">
                            Reset
                          </Button>
                        )}
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {/* Games Section */}
                    {activeSection === "games" && (
                      <>
                        {isLoadingGames ? (
                          <div className="text-center py-8">
                            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                            <p className="text-muted-foreground">Loading games...</p>
                          </div>
                        ) : games.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">
                            <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                            <p>No games available</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 gap-3">
                            {games.map((game) => (
                              <div
                                key={game.id}
                                className={`flex items-center justify-between p-3 sm:p-4 border rounded-lg transition-smooth ${
                                  selectedGame?.id === game.id
                                    ? "bg-primary/10 border-primary"
                                    : game.available
                                      ? "hover:bg-secondary/50 cursor-pointer active:bg-secondary/70"
                                      : "bg-destructive/5 border-destructive/20 cursor-not-allowed opacity-60"
                                }`}
                                onClick={() => game.available && handleGameSelect(game)}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center space-x-2">
                                    <span className="font-medium text-foreground text-sm sm:text-base truncate">
                                      {game.name}
                                    </span>
                                    {selectedGame?.id === game.id && (
                                      <Badge variant="default" className="text-xs shrink-0">
                                        ✓ Selected
                                      </Badge>
                                    )}
                                    {!game.available && (
                                      <Badge variant="destructive" className="text-xs shrink-0">
                                        ❌ Sold Out
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs sm:text-sm text-muted-foreground mt-1">{game.description}</p>
                                </div>
                                <div className="text-right shrink-0 ml-2">
                                  <span className="font-bold text-sm sm:text-lg text-success">
                                    {formatCoins(game.price)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {/* Drinks Section */}
                    {activeSection === "drinks" && (
                      <div className="grid grid-cols-1 gap-3">
                        {drinkItems.map((drink) => (
                          <div
                            key={drink.id}
                            className={`flex items-center justify-between p-3 sm:p-4 border rounded-lg transition-smooth cursor-pointer active:bg-secondary/70 ${
                              selectedDrink?.id === drink.id ? "bg-primary/10 border-primary" : "hover:bg-secondary/50"
                            }`}
                            onClick={() => handleDrinkSelect(drink)}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2">
                                <span className="font-medium text-foreground text-sm sm:text-base truncate">
                                  {drink.name}
                                </span>
                                {selectedDrink?.id === drink.id && (
                                  <Badge variant="default" className="text-xs shrink-0">
                                    ✓ Selected
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs sm:text-sm text-muted-foreground mt-1">{drink.category}</div>
                            </div>
                            <div className="text-right shrink-0 ml-2">
                              <span className="font-bold text-sm sm:text-lg text-success">
                                {formatCoins(drink.price)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Food & Custom Section */}
                    {activeSection === "food" && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <Calculator className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                          <h3 className="text-base sm:text-lg font-medium">Food Items</h3>
                        </div>

                        {/* Food Calculator (always visible) */}
                        <Card className="border-primary/20">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base sm:text-lg">Food Calculator</CardTitle>
                            <p className="text-xs sm:text-sm text-muted-foreground">
                              Add multiple dishes to calculate total before payment
                            </p>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {/* Dish Dropdown */}
                            <div className="space-y-2">
                              <Label htmlFor="dish-select" className="text-xs sm:text-sm">
                                Select Dish
                              </Label>
                              <Select
                                onValueChange={(value) => {
                                  const foodItem = foodItems.find((item) => item.id === value);
                                  if (!foodItem) return;
                                  setCalculatorItems([
                                    ...calculatorItems,
                                    { name: foodItem.name, price: foodItem.price, quantity: 1 },
                                  ]);
                                }}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Choose a dish to add" />
                                </SelectTrigger>
                                <SelectContent>
                                  {foodItems.map((item) => (
                                    <SelectItem key={item.id} value={item.id}>
                                      {item.name} - {formatCoins(item.price)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Calculator Items List */}
                            {calculatorItems.length > 0 && (
                              <div className="space-y-2">
                                <h4 className="font-medium text-sm sm:text-base">Added Items:</h4>
                                {calculatorItems.map((item, index) => (
                                  <div
                                    key={index}
                                    className="flex items-center justify-between p-2 sm:p-3 border rounded-lg"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-sm sm:text-base truncate">{item.name}</div>
                                      <div className="text-xs sm:text-sm text-muted-foreground">
                                        {formatCoins(item.price)} each
                                      </div>
                                    </div>
                                    <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          const newItems = [...calculatorItems];
                                          if (newItems[index].quantity > 1) {
                                            newItems[index].quantity -= 1;
                                            setCalculatorItems(newItems);
                                          }
                                        }}
                                        className="w-6 h-6 sm:w-8 sm:h-8 p-0 text-xs"
                                      >
                                        -
                                      </Button>
                                      <span className="w-6 sm:w-8 text-center text-xs sm:text-sm">{item.quantity}</span>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          const newItems = [...calculatorItems];
                                          newItems[index].quantity += 1;
                                          setCalculatorItems(newItems);
                                        }}
                                        className="w-6 h-6 sm:w-8 sm:h-8 p-0 text-xs"
                                      >
                                        +
                                      </Button>
                                      <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => {
                                          setCalculatorItems(calculatorItems.filter((_, i) => i !== index));
                                        }}
                                        className="w-6 h-6 sm:w-8 sm:h-8 p-0 text-xs"
                                      >
                                        ×
                                      </Button>
                                    </div>
                                  </div>
                                ))}

                                {/* Total and Pay */}
                                <div className="border-t pt-4">
                                  <div className="flex justify-between items-center mb-4">
                                    <span className="text-base sm:text-lg font-bold">Total:</span>
                                    <span className="text-lg sm:text-2xl font-bold text-primary">
                                      {formatCoins(calculatorItems.reduce((total, item) => total + item.price * item.quantity, 0))}
                                    </span>
                                  </div>
                                  <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                                    <Button
                                      variant="outline"
                                      onClick={() => setCalculatorItems([])}
                                      className="flex-1 text-xs sm:text-sm"
                                      size="sm"
                                    >
                                      Clear All
                                    </Button>
                                    <Button
                                      onClick={() => {
                                        const total = calculatorItems.reduce(
                                          (sum, item) => sum + item.price * item.quantity,
                                          0,
                                        );
                                        const itemNames = calculatorItems
                                          .map((item) => `${item.name} (${item.quantity}x)`)
                                          .join(", ");
                                        handleScanForPayment(total, itemNames, null);
                                      }}
                                      disabled={calculatorItems.length === 0}
                                      className="flex-1 text-sm sm:text-base h-12 sm:h-10"
                                      size="default"
                                    >
                                      Scan & Pay
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {customItems
                            .filter((item) => {
                              // Show food items if user has food permission
                              if (item.type === "food") return hasFoodPermission;
                              // Don't show game items here - they are in Custom Games section
                              return false;
                            })
                            .map((item) => (
                              <div
                                key={item.id}
                                className={`flex items-center justify-between p-4 border rounded-lg transition-smooth cursor-pointer ${
                                  selectedCustomItem?.id === item.id
                                    ? "bg-primary/10 border-primary"
                                    : "hover:bg-secondary/50"
                                }`}
                                onClick={() => handleCustomItemSelect(item)}
                              >
                                <div>
                                  <div className="flex items-center space-x-2">
                                    <span className="font-medium text-foreground">{item.name}</span>
                                    {selectedCustomItem?.id === item.id && (
                                      <Badge variant="default" className="text-xs">
                                        Selected
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="text-sm text-muted-foreground capitalize">{item.type}</div>
                                </div>
                                <div className="text-sm font-medium text-primary">{formatCoins(item.price)}</div>
                              </div>
                            ))}
                        </div>

                        {/* Custom Coin Input */}
                        {showCustomAmountInput && selectedCustomItem && (
                          <Card className="border-primary/20">
                            <CardHeader>
                              <CardTitle className="text-lg">Enter Pink'd Coins for {selectedCustomItem.name}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              {/* Predefined Amount Buttons for Games */}
                              {selectedCustomItem.type === "game" && (
                                <div>
                                  <p className="text-sm text-muted-foreground mb-3">Quick Select Coins:</p>
                                  <div className="grid grid-cols-4 gap-2 mb-4">
                                    {[1, 50, 100, 200, 500, 1000, 2000].map((amount) => (
                                      <Button
                                        key={amount}
                                        variant={customAmount === amount.toString() ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setCustomAmount(amount.toString())}
                                        className="h-12"
                                      >
                                        {formatCoins(amount)}
                                      </Button>
                                    ))}
                                  </div>
                                  <div className="text-center text-sm text-muted-foreground mb-3">
                                    Or enter custom coin amount:
                                  </div>
                                </div>
                              )}

                              <div className="flex items-center space-x-4">
                                <div className="flex-1">
                                  <Input
                                    type="number"
                                    placeholder="Enter Pink'd Coins"
                                    value={customAmount}
                                    onChange={(e) => setCustomAmount(e.target.value)}
                                    min="0"
                                    step="1"
                                  />
                                </div>
                                <Button
                                  onClick={handleCustomAmountConfirm}
                                  disabled={!customAmount || parseFloat(customAmount) <= 0}
                                >
                                  Confirm & Scan
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    )}

                    {/* Custom Games Section */}
                    {activeSection === "custom-games" && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-3">
                          {customItems
                            .filter((item) => {
                              // Only show game-type custom items that the user has specific permission for
                              if (item.type === "game") {
                                return gamePermissions.some((game) => game.name === item.name);
                              }
                              return false;
                            })
                            .map((item) => (
                              <div
                                key={item.id}
                                className={`flex items-center justify-between p-3 sm:p-4 border rounded-lg transition-smooth cursor-pointer active:bg-secondary/70 ${
                                  selectedCustomItem?.id === item.id
                                    ? "bg-primary/10 border-primary"
                                    : "hover:bg-secondary/50"
                                }`}
                                onClick={() => handleCustomItemSelect(item)}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center space-x-2">
                                    <span className="font-medium text-foreground text-sm sm:text-base truncate">
                                      {item.name}
                                    </span>
                                    {selectedCustomItem?.id === item.id && (
                                      <Badge variant="default" className="text-xs shrink-0">
                                        Selected
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="text-xs sm:text-sm text-muted-foreground mt-1 capitalize">
                                    {item.type}
                                  </div>
                                </div>
                                <div className="text-xs sm:text-sm font-medium text-primary shrink-0">
                                  {formatCoins(item.price)}
                                </div>
                              </div>
                            ))}
                        </div>

                        {/* Custom Coin Input */}
                        {showCustomAmountInput && selectedCustomItem && (
                          <Card className="border-primary/20">
                            <CardHeader>
                              <CardTitle className="text-lg">Enter Pink'd Coins for {selectedCustomItem.name}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              {/* Predefined Amount Buttons for Games */}
                              {selectedCustomItem.type === "game" && (
                                <div>
                                  <p className="text-sm text-muted-foreground mb-3">Quick Select Coins:</p>
                                  <div className="grid grid-cols-4 gap-2 mb-4">
                                    {[1, 50, 100, 200, 500, 1000, 2000].map((amount) => (
                                      <Button
                                        key={amount}
                                        variant={customAmount === amount.toString() ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setCustomAmount(amount.toString())}
                                        className="h-12"
                                      >
                                        {formatCoins(amount)}
                                      </Button>
                                    ))}
                                  </div>
                                  <div className="text-center text-sm text-muted-foreground mb-3">
                                    Or enter custom coin amount:
                                  </div>
                                </div>
                              )}

                              <div className="flex items-center space-x-4">
                                <div className="flex-1">
                                  <Input
                                    type="number"
                                    placeholder="Enter Pink'd Coins"
                                    value={customAmount}
                                    onChange={(e) => setCustomAmount(e.target.value)}
                                    min="0"
                                    step="1"
                                  />
                                </div>
                                <Button
                                  onClick={handleCustomAmountConfirm}
                                  disabled={!customAmount || parseFloat(customAmount) <= 0}
                                >
                                  Confirm & Scan
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Transaction Panel */}
              <div className="order-2 lg:order-2">
                <div className="sticky top-4 space-y-4">
                  {/* Selected Item */}
                  {(selectedGame || selectedDrink || selectedCustomItem) && (
                    <Card className="shadow-card border-primary/20">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center space-x-2 text-sm sm:text-base">
                          <CreditCard className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                          <span>Selected Item</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 sm:p-4">
                          <div className="font-medium text-foreground text-sm sm:text-base">
                            {selectedGame?.name || selectedDrink?.name || selectedCustomItem?.name}
                          </div>
                          <div className="text-xs sm:text-sm text-muted-foreground mb-3">
                            {selectedGame?.description ||
                              selectedDrink?.category ||
                              `${selectedCustomItem?.type} - Pink'd Coin price`}
                          </div>
                          <div className="flex items-center justify-between pt-3 border-t border-primary/20">
                            <span className="text-xs sm:text-sm font-medium text-muted-foreground">Price</span>
                            <span className="text-base sm:text-lg font-bold text-primary">
                              {selectedGame && formatCoins(selectedGame.price)}
                              {selectedDrink && formatCoins(selectedDrink.price)}
                              {selectedCustomItem && customAmount && formatCoins(customAmount)}
                              {selectedCustomItem && !customAmount && (
                                <span className="text-muted-foreground text-xs">Enter coins below</span>
                              )}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* NFC Scanner */}
                  <Card className="shadow-card">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center space-x-2 text-sm sm:text-base">
                        <Scan className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                        <span>Customer Payment</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {activeRound ? (
                        <div className="text-center py-4 text-xs sm:text-sm text-muted-foreground">
                          Round in progress: take entries and pick the winner in the {activeRound.game_name} card.
                        </div>
                      ) : selectedGame || selectedDrink || (selectedCustomItem && customAmount) ? (
                        <div className="text-center py-4">
                          {isProcessing ? (
                            <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-2 text-primary">
                              <div className="w-5 h-5 sm:w-6 sm:h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                              <span className="font-medium text-xs sm:text-sm">Processing Payment...</span>
                            </div>
                          ) : isScanning ? (
                            <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-2 text-primary">
                              <div className="w-5 h-5 sm:w-6 sm:h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                              <span className="font-medium text-xs sm:text-sm">Scanning for NFC Tag...</span>
                            </div>
                          ) : (
                            <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-2 text-muted-foreground">
                              <div className="relative">
                                <Scan className="w-5 h-5 sm:w-6 sm:h-6" />
                              </div>
                              <span className="font-medium text-xs sm:text-sm">
                                {lookupActive ? "Find the customer by phone, name or order reference" : "Scan stopped. Retry NFC or find the customer below."}
                              </span>
                            </div>
                          )}
                          {!isProcessing && pendingSaleRef.current && (
                            <div className="text-left">
                              {!isScanning && (
                                <Button variant="outline" className="w-full mt-3" onClick={retrySaleScan}>
                                  <Scan className="w-4 h-4 mr-2" />
                                  {lookupActive ? "Scan NFC instead" : "Retry NFC scan"}
                                </Button>
                              )}
                              <FindWalletFallback key={lookupKey} onSelect={handleLookupSelect} onLookupStart={cancelSaleScan} />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 flex items-start space-x-2">
                          <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                          <span className="text-xs sm:text-sm text-warning">
                            {showCustomAmountInput
                              ? "Enter amount to continue"
                              : "Select an item to start payment process"}
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Game round: players pay in, then one winner gets the Pinkredible */}
                  {activeRound && (
                    <Card className="shadow-card border-primary/30">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center space-x-2 text-sm sm:text-base">
                          <Ticket className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                          <span>{activeRound.game_name} · round</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="text-xs sm:text-sm">
                          <b>{activeRound.players_paid} of {activeRound.players_needed}</b> players paid
                          {activeRound.players_max ? ` (max ${activeRound.players_max})` : ""} · {formatCoins(activeRound.entry_coins)} each
                          {activeRound.team_size > 1 ? ` · teams of ${activeRound.team_size}` : ""}
                        </div>
                        {activeRound.players.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {activeRound.players.map((player) => (
                              <Badge key={player.wallet_id} variant="secondary" className="font-normal">
                                {player.name}
                                {player.band_hint ? <span className="text-muted-foreground"> ···{player.band_hint}</span> : null}
                              </Badge>
                            ))}
                          </div>
                        ) : null}

                        {!isPickingWinner ? (
                          <>
                            <Button className="w-full" onClick={scanPlayerForRound} disabled={isScanning || isProcessing || activeRound.is_full}>
                              <Scan className="w-4 h-4 mr-2" />
                              {isScanning ? "Scanning…" : isProcessing ? "Taking entry…" : activeRound.is_full ? "Round is full" : lookupActive ? "Scan NFC instead" : "Scan the next player to pay"}
                            </Button>
                            {lookupActive && !isProcessing && (
                              <p className="text-sm text-muted-foreground">Find the customer by phone, name or order reference</p>
                            )}
                            {!isProcessing && !activeRound.is_full ? (
                              <FindWalletFallback
                                key={lookupKey}
                                onSelect={handleRoundLookupSelect}
                                onLookupStart={cancelRoundScan}
                              />
                            ) : null}
                            {allowTypedTag() && !activeRound.is_full ? (
                              <form
                                className="flex gap-2"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  if (roundTypedTag.trim().length < 4) return;
                                  void payPlayerByTag(roundTypedTag);
                                  setRoundTypedTag("");
                                }}
                              >
                                <Input
                                  value={roundTypedTag}
                                  onChange={(event) => setRoundTypedTag(event.target.value)}
                                  placeholder="Type a player's tag ID (test mode, no NFC on this device)"
                                  autoComplete="off"
                                  className="text-sm"
                                />
                                <Button type="submit" variant="outline" size="sm" disabled={isProcessing}>Use</Button>
                              </form>
                            ) : null}
                            <Button
                              variant={activeRound.can_start ? "default" : "outline"}
                              className="w-full"
                              onClick={() => {
                                if (cancelRoundScan() === false) return;
                                setIsPickingWinner(true);
                              }}
                              disabled={!activeRound.can_start || isProcessing}
                            >
                              {activeRound.can_start
                                ? "Game over · pick the winner"
                                : `Need ${activeRound.players_needed - activeRound.players_paid} more to start`}
                            </Button>
                            <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={closeRoundNoWinner} disabled={isProcessing}>
                              Close round without a winner · no refunds
                            </Button>
                          </>
                        ) : (
                          <>
                            <p className="text-xs sm:text-sm text-muted-foreground">
                              {activeRound.awards_pinkredible
                                ? "One Pinkredible (₹100 off course registration) goes on the winner's band. Team game: the captain's band. Tap the winner, or scan their band."
                                : "Tap the winner, or scan their band."}
                            </p>
                            <div className="grid gap-2">
                              {activeRound.players.map((player) => (
                                <Button key={player.wallet_id} variant="outline" className="justify-between" onClick={() => awardWinner(player.wallet_id)} disabled={isAwarding}>
                                  <span>{player.name}</span>
                                  {player.band_hint ? <span className="text-muted-foreground">···{player.band_hint}</span> : null}
                                </Button>
                              ))}
                            </div>
                            <Button className="w-full" onClick={scanWinnerBand} disabled={isAwarding || isScanning}>
                              <Scan className="w-4 h-4 mr-2" />
                              {isScanning ? "Scanning…" : isAwarding ? "Awarding…" : "Scan the winner's band"}
                            </Button>
                            {allowTypedTag() ? (
                              <form
                                className="flex gap-2"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  if (roundTypedTag.trim().length < 4) return;
                                  void awardWinnerByTag(roundTypedTag);
                                  setRoundTypedTag("");
                                }}
                              >
                                <Input
                                  value={roundTypedTag}
                                  onChange={(event) => setRoundTypedTag(event.target.value)}
                                  placeholder="Type the winner's tag ID (test mode)"
                                  autoComplete="off"
                                  className="text-sm"
                                />
                                <Button type="submit" variant="outline" size="sm" disabled={isAwarding}>Use</Button>
                              </form>
                            ) : null}
                            <Button variant="ghost" size="sm" className="w-full" onClick={() => setIsPickingWinner(false)} disabled={isAwarding}>
                              Back
                            </Button>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Scanned Wallet Display */}
                  {scannedWallet && (
                    <Card className="shadow-card border-success/20">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center space-x-2 text-sm sm:text-base">
                          <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-success" />
                          <span>Customer Wallet</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="bg-success/10 border border-success/20 rounded-lg p-3 sm:p-4">
                          <div className="flex items-center space-x-3 mb-3">
                            <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-success shrink-0" />
                            <div className="min-w-0">
                              <div className="font-medium text-foreground text-sm sm:text-base truncate">
                                {scannedWallet.attendeeName}
                              </div>
                              <div className="text-xs sm:text-sm text-muted-foreground"><TagIdentifier tagId={scannedWallet.tagId} /></div>
                            </div>
                          </div>
                          <div className="flex items-center justify-between pt-3 border-t border-success/20">
                            <span className="text-xs sm:text-sm font-medium text-muted-foreground">Balance</span>
                            <span className="text-base sm:text-lg font-bold text-success">
                              {formatCoins(scannedWallet.currentBalance)}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </fieldset>
    </div>
  );
}
