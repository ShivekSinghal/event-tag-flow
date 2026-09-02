import { Link } from "react-router-dom";
import { ArrowLeft, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

const logoImage = "/pinkd-logo.png";
const supportEmail = "universal@hashtag.dance";

type PolicyPageProps = {
  type: "contact" | "terms" | "refunds";
};

const policyContent = {
  contact: {
    eyebrow: "Contact Us",
    title: "Pink'D Event Support",
    description:
      "For booking, payment, event pass, or Pink'D Coin queries, reach out to the Pink'D event support team.",
    sections: [
      {
        title: "Support Email",
        body: (
          <a className="text-primary underline underline-offset-4" href={`mailto:${supportEmail}`}>
            {supportEmail}
          </a>
        ),
      },
      {
        title: "Support Scope",
        body: "We can help with event bookings, payment status, package selection, NFC wallet questions, Pink'D Coins, and manual payment follow-ups.",
      },
      {
        title: "Response Time",
        body: "We aim to respond as soon as possible. For urgent event-day payment issues, please contact the event registration desk directly.",
      },
    ],
  },
  terms: {
    eyebrow: "Terms & Conditions",
    title: "Pink'D Event Booking Terms",
    description:
      "These terms apply to Pink'D event pass, intensive, party entry, group booking, and Pink'D Coin purchases made through this website.",
    sections: [
      {
        title: "Products And Pricing",
        body: "All event packages, services, and Pink'D Coin packs are displayed on the booking page with prices in INR. Prices may change only when updated by the event admin before purchase.",
      },
      {
        title: "Booking Confirmation",
        body: "A booking is treated as confirmed only after successful payment verification or manual confirmation by the Pink'D team. Pending orders are not final confirmations.",
      },
      {
        title: "Pink'D Coins",
        body: "Pink'D Coins are event-use credits for eligible games and activities at the party. Event booking revenue and NFC wallet Pink'D Coins remain separate in the system.",
      },
      {
        title: "Customer Details",
        body: "Customers must provide accurate name, phone, email, studio, package, and quantity details so the team can validate entry and support payment follow-up.",
      },
      {
        title: "Event Rules",
        body: "Entry and participation are subject to venue rules, event capacity, package eligibility, and instructions shared by the Pink'D event team.",
      },
    ],
  },
  refunds: {
    eyebrow: "Refunds & Cancellations",
    title: "Refund And Cancellation Policy",
    description:
      "This policy explains how Pink'D event booking cancellations, refunds, and payment issues are handled.",
    sections: [
      {
        title: "Cancellation Requests",
        body: `For cancellation or booking changes, contact ${supportEmail} with your name, phone number, email, and order reference.`,
      },
      {
        title: "Refund Review",
        body: "Refunds are reviewed case by case based on event rules, payment status, package usage, and timing of the request. Approved refunds are returned to the original payment method where possible.",
      },
      {
        title: "Processing Timeline",
        body: "Once approved, refund processing timelines depend on the payment gateway, bank, or card network. Manual follow-up may be required for failed or pending payments.",
      },
      {
        title: "No Duplicate Credits",
        body: "If an order includes Pink'D Coins, refunds or cancellations will be checked against any coin usage before approval. Used benefits may be adjusted from the refund amount.",
      },
      {
        title: "Failed Payments",
        body: "If payment is deducted but the booking is not confirmed, contact support with the payment reference so the team can verify and update the order.",
      },
    ],
  },
} satisfies Record<PolicyPageProps["type"], {
  eyebrow: string;
  title: string;
  description: string;
  sections: Array<{ title: string; body: string | JSX.Element }>;
}>;

export default function PolicyPage({ type }: PolicyPageProps) {
  const content = policyContent[type];

  return (
    <main className="min-h-screen bg-[#050307] text-white">
      <section className="border-b border-white/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
          <Link to="/" className="inline-flex items-center gap-3">
            <img src={logoImage} alt="Pink'D" className="h-10 w-auto max-w-[9rem] object-contain" />
          </Link>
          <Button asChild variant="outline" className="border-white/15 bg-white/[0.06] text-white hover:bg-white/10 hover:text-white">
            <Link to="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="mb-8 max-w-3xl">
          <div className="mb-4 inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-primary">
            <ShieldCheck className="mr-2 h-3.5 w-3.5" />
            {content.eyebrow}
          </div>
          <h1 className="text-4xl font-black leading-tight sm:text-5xl">{content.title}</h1>
          <p className="mt-4 text-base leading-7 text-white/68 sm:text-lg">{content.description}</p>
          <p className="mt-3 text-sm text-white/48">Last updated: September 2, 2026</p>
        </div>

        <div className="grid gap-4">
          {content.sections.map((section) => (
            <article key={section.title} className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <h2 className="text-lg font-black text-white">{section.title}</h2>
              <div className="mt-2 text-sm leading-6 text-white/68">{section.body}</div>
            </article>
          ))}
        </div>

        <div className="mt-8 rounded-lg border border-primary/25 bg-primary/10 p-5">
          <div className="flex items-start gap-3">
            <Mail className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <div className="font-black">Need help?</div>
              <p className="mt-1 text-sm leading-6 text-white/68">
                Email <a className="text-primary underline underline-offset-4" href={`mailto:${supportEmail}`}>{supportEmail}</a> for booking and payment support.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
