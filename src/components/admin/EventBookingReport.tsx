import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle, Coins, Download, FileSpreadsheet, Filter, RefreshCw, Save, Ticket, Timer, Users } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import { EVENT_CATEGORY_LABELS, formatEventPrice } from "@/lib/eventPackages";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type EventOrderItem = Tables<"event_order_items">;
// `event_order_attendees` is being added alongside this change; its generated type
// lands in types.ts later, so the relation is typed loosely here.
type EventOrderAttendee = { position: number; attendee_name: string; attendee_phone: string };
type EventOrder = Tables<"event_orders"> & {
  event_order_items: EventOrderItem[] | null;
  event_order_attendees?: EventOrderAttendee[] | null;
};

const COINS_SOURCE = "coins_page";
const ORDER_SELECT_WITH_ATTENDEES = "*, event_order_items(*), event_order_attendees(*)";
const ORDER_SELECT_BASIC = "*, event_order_items(*)";

const ALL_PACKAGES = "all-packages";
const ALL_STATUSES = "all-statuses";
const SUCCESS_STATUSES = new Set(["paid", "completed"]);
const PENDING_STATUSES = new Set(["pending", "manual_payment"]);
const PAYMENT_STATUSES = ["manual_payment", "pending", "paid", "completed", "failed", "cancelled", "refunded"];

function titleCaseStatus(status: string | null) {
  return (status || "pending").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusVariant(status: string | null): "default" | "secondary" | "destructive" | "outline" {
  if (SUCCESS_STATUSES.has(status || "")) return "default";
  if (PENDING_STATUSES.has(status || "")) return "secondary";
  if ((status || "") === "cancelled" || (status || "") === "refunded") return "outline";
  return "destructive";
}

function getPackageCategoryLabel(category: string) {
  if (category === "coins") return "Pink'd Coins";
  return EVENT_CATEGORY_LABELS[category as keyof typeof EVENT_CATEGORY_LABELS] || category || "Event";
}

function shortRef(id: string | null | undefined) {
  return id ? id.slice(0, 8).toUpperCase() : "";
}

function isPartyItem(item: EventOrderItem) {
  return item.package_category === "party";
}

function formatPhaseCharged(item: EventOrderItem) {
  if (!isPartyItem(item) || !item.phase_name) return "";
  const price = item.phase_price_inr === null || item.phase_price_inr === undefined ? "" : ` ₹${Number(item.phase_price_inr)}`;
  return `${item.phase_name}${price}`;
}

function getAttendees(order: EventOrder) {
  return [...(order.event_order_attendees || [])].sort((a, b) => a.position - b.position);
}

function formatAttendees(order: EventOrder) {
  return getAttendees(order)
    .map((attendee) => `${attendee.attendee_name} (${attendee.attendee_phone})`)
    .join("; ");
}

function getOrderItems(order: EventOrder) {
  return order.event_order_items || [];
}

function getTimeSlots(value: Json) {
  return Array.isArray(value) ? value.filter((slot): slot is string => typeof slot === "string") : [];
}

function formatTimeSlots(value: Json) {
  const slots = getTimeSlots(value);
  return slots.length > 0 ? slots.join("; ") : "";
}

function getItemsSummary(order: EventOrder) {
  const items = getOrderItems(order);
  if (items.length === 0) return "No items";
  return items
    .map((item) => {
      const slots = formatTimeSlots(item.selected_time_slots);
      return `${item.quantity} x ${item.package_name}${slots ? ` (${slots})` : ""}`;
    })
    .join("; ");
}

function exportCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const escape = (field: string | number) => {
    const value = String(field ?? "");
    return value.includes(",") || value.includes('"') || value.includes("\n") ? `"${value.replace(/"/g, '""')}"` : value;
  };

  const content = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function EventBookingReport() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<EventOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [isExpiring, setIsExpiring] = useState(false);
  const [packageFilter, setPackageFilter] = useState(ALL_PACKAGES);
  const [statusFilter, setStatusFilter] = useState(ALL_STATUSES);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchOrders = useCallback(async () => {
    try {
      setIsLoading(true);
      const primary = await supabase
        .from("event_orders")
        .select(ORDER_SELECT_WITH_ATTENDEES)
        .order("created_at", { ascending: false });

      let rows: unknown = primary.data;
      let queryError = primary.error;

      if (primary.error) {
        // The attendees relation may not be deployed yet; fall back to the plain select.
        const fallback = await supabase
          .from("event_orders")
          .select(ORDER_SELECT_BASIC)
          .order("created_at", { ascending: false });
        rows = fallback.data;
        queryError = fallback.error;
      }

      if (queryError) throw queryError;
      setOrders((rows as EventOrder[] | null) || []);
    } catch (error) {
      console.error("Event order report failed:", error);
      toast({
        title: "Event Report Failed",
        description: "Could not load landing-page orders.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const expireStaleHolds = async () => {
    try {
      setIsExpiring(true);
      const { data, error } = await supabase.rpc("expire_stale_event_orders");
      if (error) throw error;
      const cancelled = Number(data ?? 0);
      toast({
        title: "Stale Holds Expired",
        description: `Cancelled ${cancelled} abandoned checkout${cancelled === 1 ? "" : "s"}`,
      });
      await fetchOrders();
    } catch (error) {
      console.error("Expire stale holds failed:", error);
      toast({
        title: "Expire Failed",
        description: error instanceof Error ? error.message : "Could not expire stale checkouts.",
        variant: "destructive",
      });
    } finally {
      setIsExpiring(false);
    }
  };

  // Build the package filter from what was actually sold, so coin packs and every real key appear.
  const packageOptions = useMemo(() => {
    const seen = new Map<string, string>();
    orders.forEach((order) => {
      getOrderItems(order).forEach((item) => {
        if (!seen.has(item.package_key)) seen.set(item.package_key, item.package_name || item.package_key);
      });
    });
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const orderDate = order.created_at || "";
      const status = order.payment_status || "pending";
      const packageMatches =
        packageFilter === ALL_PACKAGES || getOrderItems(order).some((item) => item.package_key === packageFilter);
      const statusMatches = statusFilter === ALL_STATUSES || status === statusFilter;
      const fromMatches = !dateFrom || orderDate >= `${dateFrom}T00:00:00`;
      const toMatches = !dateTo || orderDate <= `${dateTo}T23:59:59`;
      return packageMatches && statusMatches && fromMatches && toMatches;
    });
  }, [dateFrom, dateTo, orders, packageFilter, statusFilter]);

  const stats = useMemo(() => {
    const packageMap = new Map<
      string,
      { name: string; category: string; quantity: number; revenue: number; value: number }
    >();
    let ticketRevenue = 0;
    let coinRevenue = 0;
    let pendingPayments = 0;
    let successfulPayments = 0;

    filteredOrders.forEach((order) => {
      const status = order.payment_status || "pending";
      const orderIsSuccessful = SUCCESS_STATUSES.has(status);

      if (orderIsSuccessful) {
        if (order.booking_source === COINS_SOURCE) {
          coinRevenue += Number(order.total_amount_inr || 0);
        } else {
          ticketRevenue += Number(order.total_amount_inr || 0);
        }
        successfulPayments += 1;
      } else if (PENDING_STATUSES.has(status)) {
        pendingPayments += 1;
      }

      getOrderItems(order).forEach((item) => {
        const existing = packageMap.get(item.package_key) || {
          name: item.package_name || item.package_key,
          category: item.package_category,
          quantity: 0,
          revenue: 0,
          value: 0,
        };
        existing.quantity += item.quantity;
        existing.value += Number(item.line_total_inr || 0);
        if (orderIsSuccessful) {
          existing.revenue += Number(item.line_total_inr || 0);
        }
        packageMap.set(item.package_key, existing);
      });
    });

    return {
      totalOrders: filteredOrders.length,
      ticketRevenue,
      coinRevenue,
      pendingPayments,
      successfulPayments,
      packageStats: Array.from(packageMap.entries())
        .map(([packageKey, packageData]) => ({
          packageKey,
          packageName: packageData.name,
          ...packageData,
        }))
        .sort((a, b) => b.value - a.value),
    };
  }, [filteredOrders]);

  const exportHeaders = [
    "Order ID",
    "Order Ref",
    "Source",
    "Parent Order Ref",
    "Name",
    "Phone",
    "Email",
    "Studio",
    "Cart Items",
    "Packages",
    "Quantities",
    "Sessions",
    "Phase Price Charged",
    "Attendees",
    "Time Slots",
    "Total INR",
    "Payment Provider",
    "Payment Status",
    "Payment Reference",
    "Cashfree Order ID",
    "Cashfree Status",
    "Razorpay Order ID",
    "Razorpay Payment ID",
    "Razorpay Status",
    "Confirmation Email Sent At",
    "Confirmation Email ID",
    "Confirmation Email Error",
    "Paid At",
    "Created At",
  ];

  const exportRows = useMemo(
    () =>
      filteredOrders.map((order) => [
        order.id,
        shortRef(order.id),
        order.booking_source || "",
        shortRef(order.parent_order_id),
        order.customer_name,
        order.customer_phone,
        order.customer_email,
        order.customer_studio || "",
        getItemsSummary(order),
        getOrderItems(order)
          .map((item) => item.package_name || item.package_key)
          .join(" | "),
        getOrderItems(order)
          .map((item) => String(item.quantity))
          .join(" | "),
        getOrderItems(order)
          .map((item) => formatTimeSlots(item.selected_time_slots))
          .join(" | "),
        getOrderItems(order)
          .map(formatPhaseCharged)
          .filter(Boolean)
          .join(" | "),
        formatAttendees(order),
        getOrderItems(order)
          .map((item) => formatTimeSlots(item.selected_time_slots))
          .filter(Boolean)
          .join(" | "),
        Number(order.total_amount_inr || 0),
        order.payment_provider || "manual",
        order.payment_status || "pending",
        order.payment_reference || "",
        order.cashfree_order_id || "",
        order.cashfree_payment_status || order.cashfree_order_status || "",
        order.razorpay_order_id || "",
        order.razorpay_payment_id || "",
        order.razorpay_payment_status || "",
        order.confirmation_email_sent_at || "",
        order.confirmation_email_id || "",
        order.confirmation_email_error || "",
        order.paid_at || "",
        order.created_at,
      ]),
    [filteredOrders],
  );

  const handleExportCsv = () => {
    exportCsv(`pinkd-event-orders-${new Date().toISOString().slice(0, 10)}.csv`, exportHeaders, exportRows);
  };

  const handleExportExcel = () => {
    const worksheet = XLSX.utils.aoa_to_sheet([exportHeaders, ...exportRows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Event Orders");
    XLSX.writeFile(workbook, `pinkd-event-orders-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const updatePaymentStatus = async (orderId: string, paymentStatus: string) => {
    try {
      setUpdatingOrderId(orderId);
      const paidAt = SUCCESS_STATUSES.has(paymentStatus) ? new Date().toISOString() : null;
      const { error } = await supabase
        .from("event_orders")
        .update({ payment_status: paymentStatus, paid_at: paidAt })
        .eq("id", orderId);

      if (error) throw error;

      let emailSent = false;
      let emailError: string | null = null;

      if (SUCCESS_STATUSES.has(paymentStatus)) {
        const { data: emailData, error: confirmationError } = await supabase.functions.invoke(
          "event-confirmation-email",
          {
            body: { event_order_id: orderId },
          },
        );

        emailSent = Boolean(emailData?.confirmation_email_sent);
        emailError = emailData?.confirmation_email_error ? String(emailData.confirmation_email_error) : null;

        if (confirmationError && !emailError) {
          emailError = confirmationError.message;
        }
      }

      setOrders((current) =>
        current.map((order) =>
          order.id === orderId
            ? {
                ...order,
                payment_status: paymentStatus,
                paid_at: paidAt,
                confirmation_email_sent_at: emailSent ? new Date().toISOString() : order.confirmation_email_sent_at,
                confirmation_email_error: emailError,
              }
            : order,
        ),
      );
      toast({
        title: "Payment Status Updated",
        description: SUCCESS_STATUSES.has(paymentStatus)
          ? emailSent
            ? "The order is paid and the confirmation email was sent."
            : `The order is paid.${emailError ? ` Email failed: ${emailError}` : ""}`
          : "The landing-page order report is up to date.",
      });
    } catch (error) {
      console.error("Payment status update failed:", error);
      toast({
        title: "Update Failed",
        description: "Could not update this order's payment status.",
        variant: "destructive",
      });
    } finally {
      setUpdatingOrderId(null);
    }
  };

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-primary" />
            Event Bookings / Landing Page Report
          </span>
          <span className="text-sm font-normal text-muted-foreground">INR event revenue · ticket and Pink'd Coin orders</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-5">
          <div className="space-y-2 md:col-span-2">
            <Label>Package / Item</Label>
            <Select value={packageFilter} onValueChange={setPackageFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All packages" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PACKAGES}>All packages</SelectItem>
                {packageOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
                {PAYMENT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {titleCaseStatus(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>From</Label>
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>To</Label>
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={fetchOrders} disabled={isLoading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={expireStaleHolds} disabled={isExpiring || isLoading}>
            <Timer className="mr-2 h-4 w-4" />
            Expire stale holds
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={filteredOrders.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={filteredOrders.length === 0}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Excel
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: "Total Orders", value: stats.totalOrders.toString(), icon: Users },
            { label: "Ticket revenue", value: formatEventPrice(stats.ticketRevenue), icon: Ticket },
            { label: "Coin revenue", value: formatEventPrice(stats.coinRevenue), icon: Coins },
            { label: "Pending Payments", value: stats.pendingPayments.toString(), icon: Filter },
            { label: "Successful Payments", value: stats.successfulPayments.toString(), icon: CheckCircle },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-lg border bg-secondary/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">{item.label}</span>
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div className="mt-2 text-2xl font-bold">{isLoading ? "..." : item.value}</div>
              </div>
            );
          })}
        </div>

        <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Package-Wise Sales</h3>
            {stats.packageStats.length === 0 ? (
              <div className="rounded-lg border bg-secondary/20 p-4 text-sm text-muted-foreground">No package sales for these filters.</div>
            ) : (
              stats.packageStats.map((packageData) => (
                <div key={packageData.packageKey} className="rounded-lg border bg-secondary/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{packageData.packageName}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{getPackageCategoryLabel(packageData.category)}</div>
                    </div>
                    <Badge variant="outline">Qty {packageData.quantity}</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-muted-foreground">Booking Value</div>
                      <div className="font-bold">{formatEventPrice(packageData.value)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Revenue</div>
                      <div className="font-bold text-success">{formatEventPrice(packageData.revenue)}</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent Orders</h3>
            {filteredOrders.length === 0 ? (
              <div className="rounded-lg border bg-secondary/20 p-4 text-sm text-muted-foreground">No orders match these filters.</div>
            ) : (
              filteredOrders.slice(0, 10).map((order) => (
                <div key={order.id} className="rounded-lg border bg-secondary/20 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="font-semibold">{order.customer_name}</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {order.customer_phone} · {order.customer_email}
                      </div>
                      {order.customer_studio ? (
                        <div className="mt-1 text-sm font-medium text-primary">{order.customer_studio}</div>
                      ) : null}
                      {order.parent_order_id ? (
                        <Badge variant="secondary" className="mt-2 gap-1 font-normal">
                          <Coins className="h-3 w-3" />
                          Coins · for order {shortRef(order.parent_order_id)}
                        </Badge>
                      ) : null}
                      <div className="mt-2 space-y-1 text-sm">
                        {getOrderItems(order).map((item) => (
                          <div key={item.id} className="rounded-md bg-background/55 px-2 py-1">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate">{item.quantity} x {item.package_name}</span>
                              <span className="shrink-0 font-semibold">{formatEventPrice(Number(item.line_total_inr || 0))}</span>
                            </div>
                            {isPartyItem(item) && item.phase_name ? (
                              <div className="mt-1 text-xs text-muted-foreground">
                                {item.phase_name}
                                {item.phase_price_inr !== null && item.phase_price_inr !== undefined
                                  ? ` · ${formatEventPrice(Number(item.phase_price_inr))} each`
                                  : ""}
                              </div>
                            ) : null}
                            {getTimeSlots(item.selected_time_slots).length > 0 ? (
                              <div className="mt-1 text-xs text-muted-foreground">
                                {formatTimeSlots(item.selected_time_slots)}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2 sm:min-w-44 sm:text-right">
                      <div className="font-bold">{formatEventPrice(Number(order.total_amount_inr || 0))}</div>
                      <Badge variant={statusVariant(order.payment_status)}>{titleCaseStatus(order.payment_status)}</Badge>
                      <div className="text-xs text-muted-foreground">
                        {(order.payment_provider || "manual").toUpperCase()}
                        {order.cashfree_payment_status || order.razorpay_payment_status
                          ? ` · ${order.cashfree_payment_status || order.razorpay_payment_status}`
                          : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {order.confirmation_email_sent_at
                          ? `Email sent ${new Date(order.confirmation_email_sent_at).toLocaleString("en-IN")}`
                          : order.confirmation_email_error
                            ? `Email failed: ${order.confirmation_email_error}`
                            : "Email not sent yet"}
                      </div>
                      <Select
                        value={order.payment_status || "pending"}
                        onValueChange={(value) => updatePaymentStatus(order.id, value)}
                        disabled={updatingOrderId === order.id}
                      >
                        <SelectTrigger className="h-9">
                          <Save className="mr-2 h-3.5 w-3.5" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_STATUSES.map((status) => (
                            <SelectItem key={status} value={status}>
                              {titleCaseStatus(status)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{shortRef(order.id)}</span>
                    <span>{order.booking_source}</span>
                    {order.payment_reference ? <span>Ref {order.payment_reference}</span> : null}
                    {order.razorpay_order_id ? <span>Razorpay {order.razorpay_order_id}</span> : null}
                    {order.cashfree_order_id ? <span>Cashfree {order.cashfree_order_id}</span> : null}
                    <span className="flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {order.created_at ? new Date(order.created_at).toLocaleString("en-IN") : "No date"}
                    </span>
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
