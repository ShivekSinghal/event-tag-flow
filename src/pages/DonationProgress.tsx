import { useAuth } from "@/contexts/AuthContext";
import { useDonationProgress } from "@/hooks/use-donation-progress";
import { DonationCollectionBoard } from "@/components/DonationCollectionBoard";
import { Button } from "@/components/ui/button";
export default function DonationProgress() {
  const { isAdmin } = useAuth();
  const { snapshot, error, loading, live, refresh } = useDonationProgress(isAdmin);
  if (!isAdmin) return <p role="alert">Admin access is required to view collection totals.</p>;
  if (!snapshot) return <section className="py-16 text-center space-y-4" aria-busy={loading}>
    <h1 className="text-2xl font-bold">Donation Progress</h1>
    <p role="status">{error || "Loading confirmed collections..."}</p>
    {error && <Button onClick={refresh} disabled={loading}>Retry</Button>}
  </section>;
  return <DonationCollectionBoard snapshot={snapshot} error={error} loading={loading} live={live} refresh={refresh} />;
}
