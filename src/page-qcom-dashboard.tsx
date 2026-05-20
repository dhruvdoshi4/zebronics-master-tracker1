import { QCOM_CHANNEL_LABELS, type QuickCommerceChannel } from "./tenants";
import { EmptyState, PageTitle } from "./ui";

export function QcomDashboardPage({ channel }: { channel: QuickCommerceChannel }) {
  const channelName = QCOM_CHANNEL_LABELS[channel];

  return (
    <div className="space-y-6">
      <PageTitle
        title={`${channelName} dashboard`}
        subtitle="Quick commerce PO, sellout, and ratings — same layout as marketplace dashboards, wired up next."
      />
      <EmptyState
        title={`${channelName} data coming soon`}
        description="Sign in is routed to Quick Commerce. Uploads and charts for Zepto, Blinkit, Big Basket, and Instamart will mirror the Amazon / Flipkart experience."
      />
    </div>
  );
}
