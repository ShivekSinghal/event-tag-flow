export type EventPackageCategory = "intensives" | "party" | "package" | "group";

export interface EventPackageOption {
  id: string;
  name: string;
  category: EventPackageCategory;
  description: string;
  priceInr: number;
  intensiveCount?: number;
  pax?: number;
  featured?: boolean;
  active?: boolean;
  displayOrder?: number;
}

export const EVENT_TIME_SLOTS = [
  "Wednesday, Sept 9 @ 6:00 PM",
  "Wednesday, Sept 9 @ 8:00 PM",
  "Thursday, Sept 10 @ 6:00 PM",
  "Thursday, Sept 10 @ 8:00 PM",
];

export const EVENT_PACKAGE_OPTIONS: EventPackageOption[] = [
  {
    id: "one-intensive",
    name: "1 Intensive",
    category: "intensives",
    description: "Single workshop pass",
    priceInr: 1499,
    intensiveCount: 1,
  },
  {
    id: "two-intensives",
    name: "2 Intensives",
    category: "intensives",
    description: "Two workshop pass",
    priceInr: 2699,
    intensiveCount: 2,
  },
  {
    id: "four-intensives",
    name: "4 Intensives",
    category: "intensives",
    description: "Full intensive pass",
    priceInr: 4499,
    intensiveCount: 4,
  },
  {
    id: "party-entry",
    name: "Party Entry",
    category: "party",
    description: "Entry to the Pink'd party",
    priceInr: 2000,
  },
  {
    id: "four-intensives-party",
    name: "4 Intensives + Party",
    category: "package",
    description: "Full workshop pass with party access",
    priceInr: 5500,
    intensiveCount: 4,
    featured: true,
  },
  {
    id: "six-pax-four-intensives-party",
    name: "6 Pax · 4 Intensives + Party",
    category: "group",
    description: "Group booking for six attendees",
    priceInr: 30000,
    intensiveCount: 4,
    pax: 6,
  },
  {
    id: "ten-pax-four-intensives-party",
    name: "10 Pax · 4 Intensives + Party",
    category: "group",
    description: "Group booking for ten attendees",
    priceInr: 48000,
    intensiveCount: 4,
    pax: 10,
  },
];

export const EVENT_CATEGORY_LABELS: Record<EventPackageCategory, string> = {
  intensives: "Intensives",
  party: "Party",
  package: "Packages",
  group: "Group Bookings",
};

export function getEventPackage(packageId: string) {
  return EVENT_PACKAGE_OPTIONS.find((option) => option.id === packageId);
}

export function normalizeEventPackage(row: {
  id: string;
  name: string;
  category: string;
  description: string;
  price_inr: number;
  intensive_count: number | null;
  pax: number | null;
  featured: boolean;
  active: boolean;
  display_order: number;
}): EventPackageOption {
  return {
    id: row.id,
    name: row.name,
    category: row.category as EventPackageCategory,
    description: row.description,
    priceInr: Number(row.price_inr),
    intensiveCount: row.intensive_count ?? undefined,
    pax: row.pax ?? undefined,
    featured: row.featured,
    active: row.active,
    displayOrder: row.display_order,
  };
}

export function getDefaultTimeSlots(option: EventPackageOption) {
  return (option.intensiveCount || 0) >= EVENT_TIME_SLOTS.length ? EVENT_TIME_SLOTS : [];
}

export function formatEventPrice(value: number) {
  return `₹${value.toLocaleString("en-IN")}`;
}
