/** Brand mark — a CSS shield/chevron (no image dependency) + the Tilik wordmark. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold ${className}`}>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
        <path
          d="M12 2 3 6v6c0 5 3.8 8.4 9 10 5.2-1.6 9-5 9-10V6l-9-4Z"
          fill="currentColor"
          opacity="0.18"
        />
        <path
          d="m8 12 3 3 5-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[15px] tracking-tight">Tilik</span>
    </span>
  );
}
