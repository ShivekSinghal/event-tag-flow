import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getCoinAmount } from "@/lib/coins";
import type { Tables } from "@/integrations/supabase/types";
import * as XLSX from "xlsx";
type SalesTransaction = Pick<
  Tables<"transactions">,
  | "id"
  | "amount"
  | "inr_amount"
  | "coin_amount"
  | "item_name"
  | "item_category"
  | "type"
  | "description"
  | "reference"
  | "created_at"
> & {
  wallets: Pick<Tables<"wallets">, "attendee_name" | "attendee_phone" | "studio"> | null;
  games: Pick<Tables<"games">, "name" | "price"> | null;
};

interface NavigatorWithBlobSave extends Navigator {
  msSaveOrOpenBlob?: (blob: Blob, defaultName?: string) => boolean;
}


export const downloadSalesReport = async (format: 'csv' | 'excel' = 'csv', startAfter: number = 0) => {
    try {
      // Fetch ALL transactions by removing limit and using pagination if needed
      let allTransactions: SalesTransaction[] = [];
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
          allTransactions = [...allTransactions, ...(transactions as SalesTransaction[])];
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
        "Pink'd Coins",
        'Description',
        'Reference',
        'Attendee Name',
        'Phone',
        'Studio',
        'Item Name',
        'Item Category',
        'Game Name',
        "Game Price (Pink'd Coins)"
      ];

      const data = filteredTransactions.map(transaction => {
        const walletData = transaction.wallets;
        const gameData = transaction.games;
        
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
          const legacyNavigator = window.navigator as NavigatorWithBlobSave;
          if (legacyNavigator.msSaveOrOpenBlob) {
            // IE/Edge fallback
            legacyNavigator.msSaveOrOpenBlob(blob, filename);
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
      const legacyNavigator = window.navigator as NavigatorWithBlobSave;
      if (legacyNavigator.msSaveOrOpenBlob) {
        // IE/Edge fallback
        legacyNavigator.msSaveOrOpenBlob(blob, filename);
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
