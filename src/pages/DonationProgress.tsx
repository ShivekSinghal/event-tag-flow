import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CircularProgress } from "@/components/ui/circular-progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Maximize, Minimize, Download, FileText } from "lucide-react";
import { useFlyingCards } from "@/hooks/use-flying-cards";
import { formatCoins, formatInr, getCoinAmount } from "@/lib/coins";
import * as XLSX from 'xlsx';


interface DonationStats {
  totalRaised: number;
  goal: number;
  percentage: number;
}

const DonationProgress = () => {
  const { addCard, FlyingCards, DonationDots, dotsCount, loadExistingTransactions } = useFlyingCards();
  const [stats, setStats] = useState<DonationStats>({
    totalRaised: 0,
    goal: 1000000, // Real-money donation goal in INR
    percentage: 0
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lastTransactionId, setLastTransactionId] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);

  const fetchDonationStats = useCallback(async (showGratitude = false) => {
    try {
      // Get all transactions with wallet information for names and studio
      const { data: transactions, error: transactionError } = await supabase
        .from('transactions')
        .select(`
          id,
          amount,
          inr_amount,
          coin_amount,
          type,
          created_at,
          wallets(attendee_name, studio)
        `)
        .order('created_at', { ascending: false });

      if (transactionError) {
        console.error('Error fetching transactions:', transactionError);
        toast.error('Failed to load donation statistics');
        return;
      }

      console.log('Fetched transactions:', transactions?.length, 'transactions');
      
      // Calculate real money collected from coin purchases/top-ups.
      const totalRaised = transactions
        ?.reduce((sum, transaction) => {
          if (transaction.type === 'load' || transaction.type === 'coin_purchase') {
            return sum + Number((transaction as any).inr_amount ?? transaction.amount ?? 0);
          }
          return sum;
        }, 0) || 0;

      console.log('Calculated total raised:', totalRaised);

      const percentage = Math.min(100, (totalRaised / stats.goal) * 100);

      // On initial load, show existing top-up transactions as dots
      if (!showGratitude && transactions) {
        const existingTopUps = transactions.filter(t => t.type === 'load' || t.type === 'coin_purchase');
        loadExistingTransactions(existingTopUps);
      }

      // Show gratitude and flying animation for new transactions (both top-ups and payments)
      if (showGratitude && transactions && transactions.length > 0) {
        const latestTransaction = transactions[0]; // Get the most recent transaction
        if (latestTransaction && latestTransaction.id !== lastTransactionId) {
          const walletData = latestTransaction.wallets as any;
          const latestCoins = getCoinAmount(latestTransaction as any);
          const latestInr = Number((latestTransaction as any).inr_amount ?? latestTransaction.amount ?? 0);
          
          // Add flying card for both top-ups and payments
          addCard({
            amount: latestCoins,
            name: walletData?.attendee_name || 'Anonymous',
            studio: walletData?.studio || 'Unknown',
            type: latestTransaction.type === 'load' || latestTransaction.type === 'coin_purchase' ? "topup" : "sale"
          });
          
          // Show different messages for top-ups vs payments
          if (latestTransaction.type === 'load' || latestTransaction.type === 'coin_purchase') {
            toast.success(
              `🙏 Thank you ${walletData?.attendee_name || 'Anonymous'} from ${walletData?.studio || 'Unknown'} for your contribution of ${formatInr(latestInr)}. ${formatCoins(latestCoins)} were credited.`,
              { duration: 6000 }
            );
          } else {
            toast.success(
              `💃 ${walletData?.attendee_name || 'Anonymous'} from ${walletData?.studio || 'Unknown'} spent ${formatCoins(Math.abs(latestCoins))}.`,
              { duration: 4000 }
            );
          }
          setLastTransactionId(latestTransaction.id);
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
  }, [stats.goal, lastTransactionId, addCard, loadExistingTransactions]);

  const downloadSalesReport = async (format: 'csv' | 'excel' = 'csv', startAfter: number = 0) => {
    try {
      // Fetch ALL transactions by removing limit and using pagination if needed
      let allTransactions: any[] = [];
      let hasMore = true;
      let page = 0;
      const pageSize = 1000;

      while (hasMore) {
        const { data: transactions, error } = await supabase
          .from('transactions')
          .select(`
            id,
            amount,
            inr_amount,
            coin_amount,
            item_name,
            item_category,
            type,
            description,
            reference,
            created_at,
            wallets(attendee_name, attendee_phone, studio),
            games(name, price)
          `)
          .order('created_at', { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
          console.error('Error fetching transactions:', error);
          toast.error('Failed to fetch transaction data');
          return;
        }

        if (!transactions || transactions.length === 0) {
          hasMore = false;
        } else {
          allTransactions = [...allTransactions, ...transactions];
          hasMore = transactions.length === pageSize;
          page++;
        }
      }

      // Filter transactions if startAfter is specified
      const filteredTransactions = startAfter > 0 ? allTransactions.slice(startAfter) : allTransactions;
      
      console.log(`Fetched ${allTransactions.length} total transactions, using ${filteredTransactions.length} after filtering`);

      // Format data for export
      const headers = [
        'Transaction ID',
        'Date', 
        'Type',
        'INR Paid',
        "Pink'D Coins",
        'Description',
        'Reference',
        'Attendee Name',
        'Phone',
        'Studio',
        'Item Name',
        'Item Category',
        'Game Name',
        "Game Price (Pink'D Coins)"
      ];

      const data = filteredTransactions.map(transaction => {
        const walletData = transaction.wallets as any;
        const gameData = transaction.games as any;
        
        const inrPaid = transaction.inr_amount ? Number(transaction.inr_amount) : '';
        const coinAmount = getCoinAmount(transaction);
        
        return [
          transaction.id,
          new Date(transaction.created_at).toLocaleString(),
          transaction.type,
          inrPaid,
          coinAmount,
          transaction.description,
          transaction.reference || '',
          walletData?.attendee_name || '',
          walletData?.attendee_phone || '',
          walletData?.studio || '',
          transaction.item_name || '',
          transaction.item_category || '',
          gameData?.name || '',
          gameData?.price || ''
        ];
      });

      if (format === 'excel') {
        console.log('Generating Excel file...');
        try {
          // Create Excel workbook
          const wb = XLSX.utils.book_new();
          const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
          
          // Auto-size columns
          const colWidths = headers.map((_, i) => {
            const maxLength = Math.max(
              headers[i].length,
              ...data.map(row => String(row[i] || '').length)
            );
            return { wch: Math.min(maxLength + 2, 50) };
          });
          ws['!cols'] = colWidths;
          
          XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
          
          // Generate buffer and create blob
          const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
          const blob = new Blob([excelBuffer], { 
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
          });
          
          const filename = `transactions_${startAfter > 0 ? `after_${startAfter}_` : ''}${new Date().toISOString().split('T')[0]}.xlsx`;
          
          // Try multiple download approaches for better compatibility
          if ((window.navigator as any).msSaveOrOpenBlob) {
            // IE/Edge fallback
            (window.navigator as any).msSaveOrOpenBlob(blob, filename);
            toast.success(`Excel report downloaded with ${filteredTransactions.length} transactions`);
          } else {
            // Modern browsers with enhanced approach
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            
            link.href = url;
            link.download = filename;
            link.style.display = 'none';
            
            // Force the link to be focusable and trigger click
            link.setAttribute('target', '_blank');
            document.body.appendChild(link);
            
            // Add a small delay to ensure proper attachment
            setTimeout(() => {
              try {
                // Try triggering click event
                const clickEvent = new MouseEvent('click', {
                  view: window,
                  bubbles: true,
                  cancelable: false
                });
                link.dispatchEvent(clickEvent);
                
                // Alternative trigger method
                if (typeof link.click === 'function') {
                  link.click();
                }
                
                console.log('Excel file download triggered successfully');
                toast.success(`Excel report downloaded with ${filteredTransactions.length} transactions`);
              } catch (error) {
                console.error('Download click failed:', error);
                // Fallback: try direct URL navigation
                window.open(url, '_blank');
                toast.success(`Excel report generated - check your downloads folder`);
              } finally {
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
              }
            }, 100);
          }
          return;
        } catch (error) {
          console.error('Error generating Excel file:', error);
          toast.error('Failed to generate Excel file. Please try again.');
          return;
        }
      }
      // CSV Export (fallback)
      const csvData = data;

      // Convert to CSV string with BOM for proper encoding
      const csvContent = [
        headers.join(','),
        ...csvData.map(row => 
          row.map(field => {
            // Handle different field types properly
            if (field === null || field === undefined) return '';
            const stringField = String(field);
            // Escape quotes and wrap in quotes if contains comma, quote, or newline
            if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
              return `"${stringField.replace(/"/g, '""')}"`;
            }
            return stringField;
          }).join(',')
        )
      ].join('\n');

      console.log(`Generated CSV with ${csvData.length} rows`);
      console.log('First few lines of CSV:', csvContent.split('\n').slice(0, 3));

      // Add BOM for proper Excel compatibility
      const BOM = '\uFEFF';
      const csvWithBOM = BOM + csvContent;

      // Create blob and download with more robust approach
      const blob = new Blob([csvWithBOM], { 
        type: 'text/csv;charset=utf-8;' 
      });
      
      const filename = `sales_report_${startAfter > 0 ? `after_${startAfter}_` : ''}${new Date().toISOString().split('T')[0]}.csv`;
      
      // Try multiple download approaches for better compatibility
      if ((window.navigator as any).msSaveOrOpenBlob) {
        // IE/Edge fallback
        (window.navigator as any).msSaveOrOpenBlob(blob, filename);
        toast.success(`CSV report downloaded with ${filteredTransactions.length} transactions`);
      } else {
        // Modern browsers
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        
        // Ensure the link is properly attached and triggered
        document.body.appendChild(link);
        
        // Add a small delay to ensure proper attachment
        setTimeout(() => {
          try {
            link.click();
            console.log('Download triggered successfully');
            toast.success(`CSV report downloaded with ${filteredTransactions.length} transactions`);
          } catch (error) {
            console.error('Download click failed:', error);
            toast.error('Download failed - please try again');
          } finally {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }
        }, 100);
      }
    } catch (error) {
      console.error('Error generating CSV report:', error);
      toast.error('Failed to generate CSV report');
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

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-[99999] bg-background overflow-hidden flex flex-col h-screen">
        {/* Flying Cards and Donation Dots */}
        <FlyingCards />
        <DonationDots showLabels={showLabels} />
        
        {/* Fullscreen Control Buttons */}
        <div className="absolute top-4 right-4 z-50 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadSalesReport('excel')}
          >
            <Download className="w-4 h-4 mr-1" />
            Excel (All)
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadSalesReport('excel', 1000)}
          >
            <FileText className="w-4 h-4 mr-1" />
            Excel (1000+)
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowLabels(!showLabels)}
          >
            {showLabels ? 'Hide Names' : 'Show Names'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleFullscreen}
          >
            <Minimize className="w-4 h-4" />
            Exit
          </Button>
        </div>

        {/* Content Container - Full Height */}
        <div className="flex-1 flex flex-col justify-center items-center p-8 space-y-8">
          {/* Heading */}
          <div className="text-center">
            <h1 className="text-6xl font-bold mb-6 text-white">
              I Danced, I Played, I Gave Back
            </h1>
          </div>

          {/* Progress Circle */}
          <div className="flex justify-center">
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
                    className="w-32 h-32 mx-auto object-contain"
                  />
                </div>
              </CircularProgress>
            </div>
          </div>

          {/* Progress Text */}
          <div className="text-center">
            <div className="text-5xl font-bold text-primary mb-4">
              {Math.round(stats.percentage)}% <span className="text-foreground">Complete</span>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-3 gap-6 max-w-4xl w-full">
            <Card className="text-center">
              <CardHeader className="pb-3 pt-4">
                <CardTitle className="text-primary text-base">Total Raised</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 pb-4">
                <div className="text-2xl font-bold">
                  {formatInr(stats.totalRaised)}
                </div>
              </CardContent>
            </Card>

            <Card className="text-center">
              <CardHeader className="pb-3 pt-4">
                <CardTitle className="text-primary text-base">Goal</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 pb-4">
                <div className="text-2xl font-bold">
                  {formatInr(stats.goal)}
                </div>
              </CardContent>
            </Card>

            <Card className="text-center">
              <CardHeader className="pb-3 pt-4">
                <CardTitle className="text-primary text-base">Remaining</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 pb-4">
                <div className="text-2xl font-bold">
                  {formatInr(Math.max(0, stats.goal - stats.totalRaised))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-8 relative overflow-hidden">
      {/* Flying Cards and Donation Dots */}
      <FlyingCards />
      <DonationDots showLabels={showLabels} />
      
      {/* Header with Controls */}
      {!isFullscreen && (
        <div className="text-center mb-12 relative">
          <div className="absolute top-0 right-0 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadSalesReport('excel')}
            >
              <Download className="w-4 h-4 mr-1" />
              Excel (All)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadSalesReport('excel', 1000)}
            >
              <FileText className="w-4 h-4 mr-1" />
              Excel (1000+)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLabels(!showLabels)}
            >
              {showLabels ? 'Hide Names' : 'Show Names'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleFullscreen}
            >
              <Maximize className="w-4 h-4" />
              Fullscreen
            </Button>
          </div>
          <h1 className="text-4xl font-bold mb-4">
            Donation <span className="text-primary">Progress</span>
          </h1>
          <p className="text-xl text-muted-foreground">
            Help us reach our goal to support aspiring dancers
          </p>
        </div>
      )}

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
                className="w-32 h-32 mx-auto object-contain"
              />
            </div>
          </CircularProgress>
          
          {/* Show latest donor info if available */}
          {dotsCount > 0 && (
            <div className="absolute -bottom-16 left-1/2 transform -translate-x-1/2 text-center">
              <div className="text-white text-sm bg-black/20 rounded-lg px-3 py-1 backdrop-blur-sm">
                Latest donation received!
              </div>
            </div>
          )}
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
              {formatInr(stats.totalRaised)}
            </div>
          </CardContent>
        </Card>

        <Card className="text-center">
          <CardHeader>
            <CardTitle className="text-primary">Goal</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {formatInr(stats.goal)}
            </div>
          </CardContent>
        </Card>

        <Card className="text-center">
          <CardHeader>
            <CardTitle className="text-primary">Remaining</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {formatInr(Math.max(0, stats.goal - stats.totalRaised))}
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
