import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CircularProgress } from "@/components/ui/circular-progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Hash } from "lucide-react";

interface DonationStats {
  totalRaised: number;
  goal: number;
  percentage: number;
}

const DonationProgress = () => {
  const [stats, setStats] = useState<DonationStats>({
    totalRaised: 0,
    goal: 10000, // $10,000 goal
    percentage: 0
  });
  const [isLoading, setIsLoading] = useState(true);

  const fetchDonationStats = async () => {
    try {
      // Get all transactions (top-ups and payments)
      const { data: transactions, error: transactionError } = await supabase
        .from('transactions')
        .select('amount, type');

      if (transactionError) {
        console.error('Error fetching transactions:', transactionError);
        toast.error('Failed to load donation statistics');
        return;
      }

      // Calculate total from all positive transactions (top-ups contribute to donations)
      const totalRaised = transactions
        ?.filter(t => t.type === 'topup')
        .reduce((sum, transaction) => sum + Number(transaction.amount), 0) || 0;

      const percentage = Math.min(100, (totalRaised / stats.goal) * 100);

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

  useEffect(() => {
    fetchDonationStats();

    // Set up real-time subscription for transaction updates
    const channel = supabase
      .channel('donation-progress')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions'
        },
        () => {
          fetchDonationStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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
    <div className="container mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">
          Donation <span className="text-primary">Progress</span>
        </h1>
        <p className="text-xl text-muted-foreground">
          Help us reach our goal to support aspiring dancers
        </p>
      </div>

      {/* Progress Circle */}
      <div className="flex justify-center mb-12">
        <div className="relative">
          <CircularProgress
            value={stats.percentage}
            size={300}
            strokeWidth={12}
            className="drop-shadow-lg"
          >
            <div className="text-center">
              <img 
                src="/lovable-uploads/39450c63-d438-4b34-97b6-ee61d75c29dd.png" 
                alt="Pink D Logo" 
                className="w-24 h-24 mx-auto object-contain"
              />
            </div>
          </CircularProgress>
        </div>
      </div>

      {/* Progress Text */}
      <div className="text-center mb-12">
        <div className="text-6xl font-bold text-primary mb-2">
          {Math.round(stats.percentage)}% <span className="text-foreground">Complete</span>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
        <Card className="text-center">
          <CardHeader>
            <CardTitle className="text-primary">Total Raised</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              ${stats.totalRaised.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card className="text-center">
          <CardHeader>
            <CardTitle className="text-primary">Goal</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              ${stats.goal.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="text-center">
          <CardHeader>
            <CardTitle className="text-primary">Remaining</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              ${Math.max(0, stats.goal - stats.totalRaised).toFixed(2)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Description */}
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
    </div>
  );
};

export default DonationProgress;