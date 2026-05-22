/** Network DOC formula for QCom channel dashboards. */
export function QcomNetworkDocExplanation({ className }: { className?: string }) {
  return (
    <p className={className ?? "text-sm text-zinc-500"}>
      Cumulative DRR = Zepto DRR + Blinkit DRR + Big Basket DRR + Instamart DRR (same ASIN).
      Network DOC = (HO + Gurgaon + all channel inventory) ÷ cumulative DRR, rounded down.
      Rows below 90 days are highlighted.
    </p>
  );
}
