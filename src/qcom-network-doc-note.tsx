/** Network DOC formula for QCom channel dashboards. */
export function QcomNetworkDocExplanation({ className }: { className?: string }) {
  return (
    <p className={className ?? "text-sm text-zinc-500"}>
      Network DOC = (HO + Gurgaon + all channel inventory) ÷ (cumulative DRR across Zepto,
      Blinkit, Big Basket, Instamart), rounded down. Rows below 90 days are highlighted.
    </p>
  );
}
