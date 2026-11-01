/** Brand wordmark: text only (no icon mark). */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center font-semibold ${className}`}>
      <span className="text-[15px] tracking-tight">Tilik</span>
    </span>
  );
}
