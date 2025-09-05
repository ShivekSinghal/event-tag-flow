import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CircularProgress } from "@/components/ui/circular-progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Maximize, Minimize } from "lucide-react";
import { useFlyingCards } from "@/hooks/use-flying-cards";

interface DonationStats {
  totalRaised: number;
  goal: number;
  percentage: number;
}

const DonationProgress = () => {
  const { addCard, FlyingCards, DonationDots, dotsCount } = useFlyingCards();
  const [stats, setStats] = useState<DonationStats>({
    totalRaised: 0,
    goal: 100000, // ₹1,00,000 goal
    percentage: 0
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lastTransactionId, setLastTransactionId] = useState<string | null>(null);

  const fetchDonationStats = async (showGratitude = false) => {
    try {
      // Get all transactions with wallet information for names and studio
      const { data: transactions, error: transactionError } = await supabase
        .from('transactions')
        .select(`
          id,
          amount, 
          type,
          created_at,
          wallets!inner(attendee_name, studio)
        `)
        .order('created_at', { ascending: false });

      if (transactionError) {
        console.error('Error fetching transactions:', transactionError);
        toast.error('Failed to load donation statistics');
        return;
      }

      // Calculate total from all positive transactions (top-ups contribute to donations)
      const totalRaised = transactions
        ?.filter(t => t.type === 'load')
        .reduce((sum, transaction) => sum + Number(transaction.amount), 0) || 0;

      const percentage = Math.min(100, (totalRaised / stats.goal) * 100);

      // Show gratitude and flying animation for new top-ups
      if (showGratitude && transactions && transactions.length > 0) {
        const latestTopup = transactions.find(t => t.type === 'load');
        if (latestTopup && latestTopup.id !== lastTransactionId) {
          const walletData = latestTopup.wallets as any;
          
          // Add flying card using centralized system
          addCard({
            amount: Number(latestTopup.amount),
            name: walletData?.attendee_name || 'Anonymous',
            studio: walletData?.studio || 'Unknown',
            type: "topup"
          });
          
          toast.success(
            `🙏 Thank you ${walletData?.attendee_name || 'Anonymous'} for your generous contribution of ₹${Number(latestTopup.amount).toFixed(2)}! Your support helps aspiring dancers achieve their dreams.`,
            { duration: 6000 }
          );
          setLastTransactionId(latestTopup.id);
        }
      }

      setStats(prev => ({
        ...prev,
        totalRaised,
        percentage
      }));
    } catch (error) {
      console.error('Error calculating donation stats:', error);
      toast.error('Failed to calculate donation progress');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleFullscreen = () => {
    if (!isFullscreen) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setIsFullscreen(!isFullscreen);
  };

  useEffect(() => {
    fetchDonationStats();

    // Set up real-time subscription for transaction updates
    const channel = supabase
      .channel('donation-progress-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'transactions'
        },
        (payload) => {
          console.log('New transaction received:', payload);
          // Add a small delay to ensure the transaction is fully written
          setTimeout(() => {
            fetchDonationStats(true); // Show gratitude for new transactions
          }, 500);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public', 
          table: 'transactions'
        },
        (payload) => {
          console.log('Transaction updated:', payload);
          setTimeout(() => {
            fetchDonationStats(false); // Update stats without gratitude
          }, 500);
        }
      )
      .subscribe((status) => {
        console.log('Realtime subscription status:', status);
        if (status === 'SUBSCRIBED') {
          console.log('✅ Successfully subscribed to transaction updates');
        }
      });

    return () => {
      console.log('Cleaning up realtime subscription');
      supabase.removeChannel(channel);
    };
  }, [lastTransactionId]); // Include lastTransactionId in dependencies to track latest transaction

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-4">Donation Progress</h1>
          <p className="text-xl text-muted-foreground">Loading progress...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${isFullscreen ? 'fixed inset-0 z-50 bg-background overflow-hidden' : 'container mx-auto'} ${isFullscreen ? 'p-4' : 'p-6'} ${isFullscreen ? 'space-y-4' : 'space-y-8'} relative overflow-hidden`}>
      {/* Flying Cards and Donation Dots */}
      <FlyingCards />
      <DonationDots />
      
      {/* Header with Fullscreen Toggle */}
      {!isFullscreen && (
        <div className="text-center mb-12 relative">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleFullscreen}
            className="absolute top-0 right-0"
          >
            <Maximize className="w-4 h-4" />
            Fullscreen
          </Button>
          <h1 className="text-4xl font-bold mb-4">
            Donation <span className="text-primary">Progress</span>
          </h1>
          <p className="text-xl text-muted-foreground">
            Help us reach our goal to support aspiring dancers
          </p>
        </div>
      )}

      {/* Fullscreen Exit Button */}
      {isFullscreen && (
        <Button
          variant="outline"
          size="sm"
          onClick={toggleFullscreen}
          className="absolute top-4 right-4 z-40"
        >
          <Minimize className="w-4 h-4" />
          Exit
        </Button>
      )}

      {/* Progress Circle */}
      <div className={`flex justify-center ${isFullscreen ? 'mb-4' : 'mb-12'}`}>
        <div className="relative">
          <CircularProgress
            value={stats.percentage}
            size={isFullscreen ? 200 : 300}
            strokeWidth={isFullscreen ? 8 : 12}
            className="drop-shadow-lg"
          >
            <div className="text-center">
              <img 
                src="/lovable-uploads/39450c63-d438-4b34-97b6-ee61d75c29dd.png" 
                alt="Pink D Logo" 
                className={`${isFullscreen ? 'w-20 h-20' : 'w-32 h-32'} mx-auto object-contain`}
              />
            </div>
          </CircularProgress>
        </div>
      </div>

      {/* Progress Text */}
      <div className={`text-center ${isFullscreen ? 'mb-4' : 'mb-12'}`}>
        <div className={`${isFullscreen ? 'text-3xl' : 'text-6xl'} font-bold text-primary mb-2`}>
          {Math.round(stats.percentage)}% <span className="text-foreground">Complete</span>
        </div>
      </div>

      {/* Stats Cards */}
      <div className={`grid grid-cols-1 md:grid-cols-3 gap-${isFullscreen ? '3' : '6'} max-w-4xl mx-auto ${isFullscreen ? 'mb-4' : ''}`}>
        <Card className="text-center">
          <CardHeader className={isFullscreen ? 'pb-2 pt-4' : ''}>
            <CardTitle className={`text-primary ${isFullscreen ? 'text-sm' : ''}`}>Total Raised</CardTitle>
          </CardHeader>
          <CardContent className={isFullscreen ? 'pt-0 pb-4' : ''}>
            <div className={`${isFullscreen ? 'text-xl' : 'text-3xl'} font-bold`}>
              ₹{stats.totalRaised.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card className="text-center">
          <CardHeader className={isFullscreen ? 'pb-2 pt-4' : ''}>
            <CardTitle className={`text-primary ${isFullscreen ? 'text-sm' : ''}`}>Goal</CardTitle>
          </CardHeader>
          <CardContent className={isFullscreen ? 'pt-0 pb-4' : ''}>
            <div className={`${isFullscreen ? 'text-xl' : 'text-3xl'} font-bold`}>
              ₹{stats.goal.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="text-center">
          <CardHeader className={isFullscreen ? 'pb-2 pt-4' : ''}>
            <CardTitle className={`text-primary ${isFullscreen ? 'text-sm' : ''}`}>Remaining</CardTitle>
          </CardHeader>
          <CardContent className={isFullscreen ? 'pt-0 pb-4' : ''}>
            <div className={`${isFullscreen ? 'text-xl' : 'text-3xl'} font-bold`}>
              ₹{Math.max(0, stats.goal - stats.totalRaised).toFixed(2)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Description - Hidden in fullscreen */}
      {!isFullscreen && (
        <div className="text-center max-w-2xl mx-auto">
          <Card>
            <CardContent className="pt-6">
              <p className="text-muted-foreground leading-relaxed">
                Every wallet top-up contributes to our goal of supporting aspiring dancers. 
                Your contributions help provide resources, training, and opportunities for 
                talented individuals to pursue their passion for dance.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default DonationProgress;