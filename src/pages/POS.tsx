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
import { useAwardOperation } from "@/hooks/use-award-operation";
import { WalletOperationStatus } from "@/components/wallet/WalletOperationStatus";
import { PosSaleControls } from "@/components/wallet/PosSaleControls";
import { InsufficientCoinsNotice } from "@/components/wallet/InsufficientCoinsNotice";
import { useEffect, useMemo, useRef, useState } from "react";
import { Package, CreditCard, DollarSign, Scan, AlertCircle, ArrowRight, CheckCircle, Calculator, Trophy } from "lucide-react";

import { ActivityPicker, type Activity as Game } from "@/components/wallet/ActivityPicker";
import { parseDonationCoins } from "@/lib/activities";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";


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

type PosSection = "games" | "drinks" | "food";

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
  const awardOperation = useAwardOperation();
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
    pendingSaleRef.current = null;
    nfcManager.stopScanning();
  }, []);
  const [scannedWallet, setScannedWallet] = useState<ScannedWallet | null>(null);
  const [insufficientCoins, setInsufficientCoins] = useState<{ balance: number; required: number; walletId: string } | null>(null);
  const [donationGame, setDonationGame] = useState<Game | null>(null);
  const [donationAmount, setDonationAmount] = useState("150");
  const donationConfirmRef = useRef(false);
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
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<PosSection>("games");
  // Award a Pinkredible to a winner: pick the game (trophy button), scan the winner, confirm.
  const [awardGame, setAwardGame] = useState<Game | null>(null);
  const awardGameRef = useRef<Game | null>(null);
  const awardSubmitRef = useRef(false);
  const [eligibleEntries, setEligibleEntries] = useState<{ transaction_id: string; created_at: string; coin_amount: number }[]>([]);
  const [awardEntry, setAwardEntry] = useState("");
  const [awardLookupKey, setAwardLookupKey] = useState(0);
  const [awardCandidate, setAwardCandidate] = useState<ScannedWallet | null>(null);
  const [isAwardScanning, setIsAwardScanning] = useState(false);
  const [isAwarding, setIsAwarding] = useState(false);
  const lastAward = awardOperation.receipt ? { name: awardOperation.receipt.first_name, game: awardOperation.receipt.game, pinkredibles: awardOperation.receipt.pinkredibles, code: awardOperation.receipt.code } : null;

  const availableSections = useMemo<PosSection[]>(() => {
    const sections: PosSection[] = [];
    if (gamePermissions.length > 0) sections.push("games");
    if (hasDrinksPermission) sections.push("drinks");
    if (hasFoodPermission) sections.push("food");
    return sections;
  }, [gamePermissions.length, hasDrinksPermission, hasFoodPermission]);
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
          .filter((item) => item.category === "custom_food")
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
          setGamesError(null);
          const { data: gamesData, error } = await supabase
            .from("games")
            .select("id, name, description, price, studio, available, awards_pinkredible, activity_group, pricing_mode")
            .in("id", permittedGameIds)
            .eq("available", true);

          if (isCurrent && !error && gamesData) {
            setGames(
              gamesData.map((g) => ({
                id: g.id,
                name: g.name,
                description: g.description || "",
                price: typeof g.price === "string" ? parseFloat(g.price) : g.price,
                studio: g.studio,
                available: g.available,
                activity_group: g.activity_group,
                pricing_mode: g.pricing_mode,
                awardsPinkredible: g.awards_pinkredible,
              })),
            );
          } else if (isCurrent && error) {
            setGames([]);
            setGamesError("Activities could not load. Confirm the activity setup migration is installed, then refresh this page.");
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
    if (game.pricing_mode === "free") return;
    if (!game.available) {
      toast({
        title: "Game Not Available",
        description: `${game.name} is currently sold out.`,
        variant: "destructive",
      });
      return;
    }

    if (isScanning || isProcessing || awardGameRef.current || awardOperation.blocked) {
      return;
    }

    if (walletOperation.blocked || paymentInFlightRef.current) return;
    if (game.pricing_mode === "donation") {
      resetTransaction();
      donationConfirmRef.current = false;
      setDonationAmount(String(Math.max(150, game.price)));
      setDonationGame(game);
      return;
    }
    setSelectedGame(game);
    setSelectedDrink(null);
    setSelectedCustomItem(null);
    setShowCustomAmountInput(false);

    toast({
      title: "Scanning Started",
      description: `Selected ${game.name} (${formatCoins(game.price)}). Please scan the customer's NFC tag.`,
    });

    // Automatically start NFC scanning
    await handleScanForPayment(game.price, `${game.name}`, game.id, "games");
  };

  const handleDrinkSelect = async (drink: DrinkItem) => {
    if (isScanning || isProcessing || awardGameRef.current || awardOperation.blocked) {
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
    if (isScanning || isProcessing || awardGameRef.current || awardOperation.blocked) {
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
    if (awardGameRef.current || awardOperation.blocked) return;
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
    if (paymentInFlightRef.current || awardGameRef.current || awardOperation.blocked) return;
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
    if (!Number.isSafeInteger(price) || price <= 0 || price > 2147483647) {
      toast({ title: "Invalid amount", description: "Coins must be a positive whole number.", variant: "destructive" });
      return;
    }
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
        coin_amount: price,
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

  const walletToScanned = (wallet: { id: string; attendee_name: string; attendee_phone: string; tag_id: string; status: string; event_order_id: string | null; coin_balance: number | null; balance: number }): ScannedWallet => ({
    id: wallet.id,
    attendeeName: wallet.attendee_name,
    attendeePhone: wallet.attendee_phone,
    tagId: wallet.tag_id,
    currentBalance: getCoinBalance(wallet),
    status: wallet.status,
  });

  const stopAwardScan = () => {
    if (awardSubmitRef.current || awardOperation.blocked) return false;
    scanGenerationRef.current += 1;
    nfcManager.stopScanning();
    setIsAwardScanning(false);
    setAwardCandidate(null);
    setEligibleEntries([]);
    setAwardEntry("");
    return true;
  };

  const loadAwardCandidate = async (wallet: Parameters<typeof walletToScanned>[0], generation: number, game: Game) => {
    if (generation !== scanGenerationRef.current || awardGameRef.current?.id !== game.id) return;
    if (wallet.status !== "active") throw new Error("This band is not active");
    const { data, error } = await supabase.rpc("eligible_pinkredible_entries", { p_wallet_id: wallet.id, p_game_id: game.id });
    if (generation !== scanGenerationRef.current || awardGameRef.current?.id !== game.id) return;
    if (error) throw error;
    const entries = (data || []) as typeof eligibleEntries;
    setAwardCandidate(walletToScanned(wallet));
    setEligibleEntries(entries);
    setAwardEntry(entries[0]?.transaction_id || "");
  };

  const startAward = async (game: Game) => {
    if (isScanning || isProcessing || isAwardScanning || awardSubmitRef.current || awardOperation.blocked || walletOperation.blocked || pendingSaleRef.current || awardGameRef.current) return;
    if (!game.available || !game.awardsPinkredible) return;
    const generation = ++scanGenerationRef.current;
    nfcManager.stopScanning();
    awardGameRef.current = game;
    setAwardGame(game); setAwardCandidate(null); setEligibleEntries([]); setAwardEntry("");
    setAwardLookupKey(k => k + 1);
    setIsAwardScanning(true);
    try {
      const result = await nfcManager.startScanning();
      if (generation !== scanGenerationRef.current) return;
      if (!result.success) return;
      const { data: wallet, error } = await supabase.from("wallets").select("*").eq("tag_id", result.tagId).single();
      if (generation !== scanGenerationRef.current) return;
      if (error || !wallet) throw new Error("That band is not registered");
      await loadAwardCandidate(wallet, generation, game);
    } catch (error) {
      if (generation === scanGenerationRef.current) toast({ title: "Winner unavailable", description: getErrorDetail(error, "message") || "Try the confirmed lookup.", variant: "destructive" });
    } finally {
      if (generation === scanGenerationRef.current) setIsAwardScanning(false);
    }
  };

  const handleAwardLookup = async (found: FoundWallet) => {
    const game = awardGameRef.current;
    if (!game || !stopAwardScan()) return;
    const generation = scanGenerationRef.current;
    try {
      const { data: wallet, error } = await supabase.from("wallets").select("*").eq("id", found.wallet_id).single();
      if (generation !== scanGenerationRef.current) return;
      if (error || !wallet) throw new Error("Band unavailable");
      await loadAwardCandidate(wallet, generation, game);
    } catch (error) {
      if (generation === scanGenerationRef.current) toast({ title: "Winner unavailable", description: getErrorDetail(error, "message"), variant: "destructive" });
    }
  };

  const cancelAward = () => {
    if (!stopAwardScan()) return;
    awardGameRef.current = null;
    setAwardGame(null);
  };

  const confirmAward = async () => {
    const game = awardGameRef.current;
    if (!game || !awardCandidate || !awardEntry || awardSubmitRef.current || awardOperation.blocked || walletOperation.blocked) return;
    awardSubmitRef.current = true; setIsAwarding(true);
    const generation = ++scanGenerationRef.current;
    nfcManager.stopScanning();
    try {
      const outcome = await awardOperation.submit({ wallet_id: awardCandidate.id, game_id: game.id, entry_transaction_id: awardEntry });
      if (generation !== scanGenerationRef.current) return;
      if (outcome?.status === "succeeded") {
        awardGameRef.current = null; setAwardGame(null); setAwardCandidate(null); setEligibleEntries([]); setAwardEntry("");
        toast({ title: "Pinkredible awarded", description: `${outcome.first_name} · ${outcome.code}` });
      } else if (outcome?.status === "rejected") {
        toast({ title: "Award not issued", description: outcome.message, variant: "destructive" });
      }
    } finally { awardSubmitRef.current = false; if (generation === scanGenerationRef.current) setIsAwarding(false); }
  };

  const resetTransaction = () => {
    setInsufficientCoins(null);
    scanGenerationRef.current += 1;
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
      <Dialog open={Boolean(donationGame)} onOpenChange={open => { if (!open) setDonationGame(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{donationGame?.name}</DialogTitle>
            <DialogDescription>Minimum {Math.max(150, donationGame?.price ?? 150)} Pink'D Coins</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={event => {
            event.preventDefault();
            if (!donationGame || donationConfirmRef.current || walletOperation.blocked) return;
            const amount = parseDonationCoins(donationAmount, donationGame.price);
            if (amount === null) return;
            donationConfirmRef.current = true;
            const game = donationGame;
            setDonationGame(null);
            setSelectedGame({ ...game, price: amount });
            void handleScanForPayment(amount, game.name, game.id, "games");
          }}>
            <Label htmlFor="donation-coins">Donation in coins</Label>
            <Input id="donation-coins" type="text" inputMode="numeric" autoFocus
              value={donationAmount} onChange={event => setDonationAmount(event.target.value)} />
            {parseDonationCoins(donationAmount, donationGame?.price ?? 150) === null &&
              <p role="alert" className="text-sm text-destructive">Enter whole coins, at least {Math.max(150, donationGame?.price ?? 150)}.</p>}
            <Button type="submit" className="w-full" disabled={parseDonationCoins(donationAmount, donationGame?.price ?? 150) === null || walletOperation.blocked}>
              <Scan className="mr-2 h-4 w-4" /> Continue to band
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <WalletOperationStatus operation={walletOperation} showSpendReceipt={false} />
      {awardOperation.error && <p role="alert" className="border border-primary p-3">{awardOperation.error}</p>}
      {awardOperation.pending && <section className="space-y-2 border border-primary p-3" aria-label="Pending Pinkredible award"><p>Award outcome needs confirmation. No new charge or award will be started.</p><Button disabled={awardOperation.busy} onClick={async () => {
        const result = await awardOperation.submit();
        if (result) { awardGameRef.current = null; setAwardGame(null); setAwardCandidate(null); setEligibleEntries([]); }
      }}>Check / Retry safely</Button></section>}
      <PosSaleControls operation={walletOperation} saleInProgress={isScanning || isProcessing || isAwarding || lookupActive || awardOperation.blocked || Boolean(awardGame || pendingSaleRef.current)} />
      {insufficientCoins && <InsufficientCoinsNotice {...insufficientCoins} />}
      <fieldset disabled={walletOperation.blocked || awardOperation.blocked} className="min-w-0 space-y-4 disabled:opacity-60">
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
        (gamePermissions.length > 0 || hasFoodPermission || hasDrinksPermission) && (
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
                        <span className="text-sm sm:text-base">
                          {activeSection === "games" && "Available Games"}
                          {activeSection === "drinks" && "Drinks Menu"}
                          {activeSection === "food" && "Food & Custom Items"}
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
                        ) : gamesError ? (
                          <p role="alert" className="p-3 text-destructive">{gamesError}</p>
                        ) : games.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">
                            <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                            <p>No games available</p>
                          </div>
                        ) : (
                          <ActivityPicker games={games} selectedId={selectedGame?.id}
                            disabled={isScanning || isProcessing || isAwardScanning || Boolean(awardGame) || awardOperation.blocked || walletOperation.blocked}
                            onSelect={game => void handleGameSelect(game)} onAward={game => void startAward(game)} />
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
                              // Games are loaded only from the canonical games table.
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
                      {selectedGame || selectedDrink || (selectedCustomItem && customAmount) ? (
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

                  {/* Award Pinkredible: scan the winner, confirm */}
                  {awardGame && (
                    <Card className="shadow-card border-primary/40">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center space-x-2 text-sm sm:text-base">
                          <Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                          <span>Winner · {awardGame.name}</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {awardCandidate ? (
                          <>
                            <div className="text-center">
                              <div className="text-xs uppercase tracking-wider text-muted-foreground">Give 1 Pinkredible to</div>
                              <div className="text-2xl font-extrabold leading-tight">{awardCandidate.attendeeName}</div>
                              <div className="text-xs text-muted-foreground">band ···{awardCandidate.tagId.slice(-3)}</div>
                            </div>
                            <label className="block text-sm">Eligible paid entry<select aria-label="Eligible paid entry" value={awardEntry} disabled={isAwarding} onChange={e => setAwardEntry(e.target.value)} className="mt-1 h-11 w-full border bg-background px-2">
                              {!eligibleEntries.length && <option value="">No unused, unvoided payment for this game</option>}
                              {eligibleEntries.map(entry => <option key={entry.transaction_id} value={entry.transaction_id}>{entry.transaction_id.slice(0, 8)} · {formatCoins(entry.coin_amount)} · {new Date(entry.created_at).toLocaleTimeString("en-IN")}</option>)}
                            </select></label>
                            <div className="grid grid-cols-2 gap-2">
                              <Button type="button" variant="outline" className="h-12" onClick={() => setAwardCandidate(null)} disabled={isAwarding}>
                                Not them
                              </Button>
                              <Button type="button" className="h-12 font-bold" onClick={() => void confirmAward()} disabled={isAwarding || !awardEntry}>
                                {isAwarding ? "Awarding…" : "Award 🏆"}
                              </Button>
                            </div>
                            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={cancelAward} disabled={isAwarding}>
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center justify-center space-x-2 py-2 text-primary">
                              {isAwardScanning && <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
                              <span className="font-medium text-xs sm:text-sm">
                                {isAwardScanning ? "Scan the winner's band…" : "Tap Cancel or find the winner by phone"}
                              </span>
                            </div>
                            <div className="text-left">
                              <FindWalletFallback key={awardLookupKey} onSelect={handleAwardLookup} onLookupStart={stopAwardScan} disabled={isAwarding || awardOperation.blocked} />
                            </div>
                            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={cancelAward}>
                              Cancel
                            </Button>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {lastAward && !awardGame && (
                    <Card className="shadow-card border-primary/30">
                      <CardContent className="py-4 text-center">
                        <div className="text-xs uppercase tracking-wider text-muted-foreground">Last Pinkredible · {lastAward.game}</div>
                        <div className="text-lg font-bold">{lastAward.name}</div>
                        <div className="text-sm text-muted-foreground">
                          now has <b className="text-foreground">{lastAward.pinkredibles}</b> · code <span className="font-mono">{lastAward.code}</span>
                        </div>
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
