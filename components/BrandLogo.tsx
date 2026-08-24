import Link from "next/link";

export default function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <Link
      aria-label="Glacier Signal 首页"
      className={`group inline-flex min-h-10 items-center gap-2.5 text-current outline-none focus-visible:ring-2 focus-visible:ring-[#D8C9E8] focus-visible:ring-offset-2 focus-visible:ring-offset-[#07142F] ${className}`}
      href="/"
    >
      <svg aria-hidden="true" className="h-9 w-11 shrink-0 overflow-visible" fill="none" viewBox="0 0 44 36">
        <path d="M5 1.5h30l6 6v21l-6 6H5l-3-3v-27l3-3Z" fill="#F7F4ED" stroke="#D8C9E8" />
        <path d="M37.5 8.5v19" stroke="#0D1B3D" strokeDasharray="2 2" strokeWidth="1.2" />
        <path d="m8.5 25 6.8-10.3 4.2 5.8 5.8-10 7.2 14.5h-24Z" fill="#0D1B3D" />
        <path d="m12.7 21.7 2.7-4.1 1.8 2.6-1.7-.5-2.8 2Z" fill="#F7F4ED" />
        <path d="m22 20.2 3.2-5.5 2.8 5.6-2.5-1.3-3.5 1.2Z" fill="#F7F4ED" />
        <path d="M9 28.5h23" stroke="#BD2D37" strokeWidth="2" />
        <circle cx="38" cy="6" r="2.5" fill="#BD2D37" />
      </svg>
      <span className="whitespace-nowrap leading-none">
        <span className="block font-[850] tracking-[-0.03em]">Glacier Signal</span>
        <span className="mt-1 block font-['Arial_Narrow',sans-serif] text-[8px] font-bold uppercase tracking-[0.18em] text-[#AAB8D4]">Market issuance desk</span>
      </span>
    </Link>
  );
}
