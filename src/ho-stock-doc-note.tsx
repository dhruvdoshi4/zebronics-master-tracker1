/** One-line DOC formula for HO Stock (Monitor+Projector tenant). */
export function HoStockDocExplanation({ className }: { className?: string }) {
  return (
    <p className={className ?? "text-sm text-zinc-500 dark:text-zinc-400"}>
      DOC = (HO + Gurgaon + Amazon + Flipkart inventory) ÷ (Amazon DRR + Flipkart DRR), rounded
      down.
    </p>
  );
}
