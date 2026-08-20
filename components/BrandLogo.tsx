import Image from "next/image";
import Link from "next/link";

export default function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <Link
      aria-label="Glacier Signal 首页"
      className={`inline-flex min-h-11 items-center gap-3 rounded-[6px] text-[#102C3A] outline-none focus-visible:ring-2 focus-visible:ring-[#69D2E7] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F8FBFD] ${className}`}
      href="/"
    >
      <span
        aria-hidden="true"
        className="relative size-8 shrink-0 overflow-hidden rounded-[6px] border border-[#A7C8D7] bg-white shadow-[0_1px_2px_rgba(16,44,58,0.05)]"
      >
        <Image
          alt=""
          className="scale-[1.45] object-cover object-[50%_43%]"
          fill
          sizes="32px"
          src="/assets/glacier-signal-mobile.png"
        />
      </span>
      <span className="whitespace-nowrap text-[14px] leading-5 tracking-[-0.015em]">
        <span className="font-[650]">Glacier</span>
        <span className="ml-1.5 font-[550] text-[#476775]">Signal</span>
      </span>
    </Link>
  );
}
