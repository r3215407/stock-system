"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import BrandLogo from "@/components/BrandLogo";
import { currentStrategy } from "@/lib/strategies";

const links = [{ href: "/", label: "今日选股" }, { href: "/evaluate", label: "个股评分" }, { href: "/positions", label: "仓位方案" }];

export default function AppHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ticketMode = true;
  const headerClassName = ticketMode
    ? "relative z-50 border-b border-white/15 bg-[#07142F]/95 text-white backdrop-blur-xl"
    : "sticky top-0 z-50 border-b border-[#102C3A]/10 bg-[#F7F8F6]/95 backdrop-blur-xl";
  const activeLinkClassName = ticketMode
    ? "border border-white/15 bg-white/10 text-white"
    : "bg-white text-[#102C3A] shadow-sm";
  const idleLinkClassName = ticketMode
    ? "text-[#AAB8D4] hover:text-white"
    : "text-[#5C7580] hover:text-[#102C3A]";

  return (
    <header className={headerClassName} data-app-header>
      <div className="mx-auto flex h-[68px] w-full max-w-[1500px] items-center gap-5 px-4 sm:px-5 lg:px-5">
        <BrandLogo className={ticketMode ? "text-white" : "text-[#102C3A]"} />
        <nav className="hidden h-full items-center gap-1 md:flex" aria-label="主导航">
          {links.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return <Link className={`inline-flex h-10 items-center px-3 text-sm font-semibold ${active ? activeLinkClassName : idleLinkClassName}`} href={link.href} key={link.href}>{link.label}</Link>;
          })}
        </nav>
        <div className="ml-auto hidden items-center gap-4 md:flex">
          <span className={ticketMode ? "border border-[#B69BD0]/40 bg-[#B69BD0]/15 px-3 py-1.5 text-xs font-semibold text-[#E3D6EE]" : "rounded-full border border-[#5661D9]/20 bg-[#F1F0FF] px-3 py-1.5 text-xs font-semibold text-[#665FB5]"}>{currentStrategy.shortName}</span>
          <form action="/evaluate" className={ticketMode ? "flex h-10 items-center border border-white/20 bg-white/5 px-3 focus-within:border-[#D8C9E8]" : "flex h-10 items-center rounded-xl border border-[#102C3A]/15 bg-white px-3 focus-within:border-[#5661D9]"}>
            <input aria-label="搜索股票代码" className={ticketMode ? "w-32 bg-transparent text-sm text-white outline-none placeholder:text-[#8292B2]" : "w-32 bg-transparent text-sm outline-none placeholder:text-[#8AA0AA]"} inputMode="numeric" maxLength={6} name="symbol" pattern="[0-9]{6}" placeholder="搜索股票代码" required />
            <button className={ticketMode ? "ml-2 text-xs font-semibold text-[#E3D6EE]" : "ml-2 text-xs font-semibold text-[#1E5A70]"} type="submit">搜索</button>
          </form>
        </div>
        <button aria-expanded={open} aria-label="打开菜单" className={ticketMode ? "ml-auto grid size-10 place-items-center border border-white/20 bg-white/5 text-white md:hidden" : "ml-auto grid size-10 place-items-center rounded-xl border border-[#102C3A]/15 bg-white md:hidden"} onClick={() => setOpen(!open)} type="button">{open ? "×" : "☰"}</button>
      </div>
      {open ? <div className={ticketMode ? "border-t border-white/15 bg-[#07142F] px-4 py-4 md:hidden" : "border-t border-[#102C3A]/10 bg-white px-4 py-4 md:hidden"}>
        <nav className="grid gap-1">{links.map((link) => <Link className={ticketMode ? "px-3 py-3 text-sm font-semibold text-white" : "rounded-xl px-3 py-3 text-sm font-semibold text-[#102C3A]"} href={link.href} key={link.href} onClick={() => setOpen(false)}>{link.label}</Link>)}</nav>
        <form action="/evaluate" className={ticketMode ? "mt-3 flex border border-white/20 p-1" : "mt-3 flex rounded-xl border border-[#102C3A]/15 p-1"}><input className={ticketMode ? "min-w-0 flex-1 bg-transparent px-3 text-sm text-white outline-none placeholder:text-[#8292B2]" : "min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"} inputMode="numeric" maxLength={6} name="symbol" placeholder="搜索股票代码" required /><button className={ticketMode ? "bg-[#BD2D37] px-4 text-sm font-semibold text-white" : "rounded-lg bg-[#102C3A] px-4 text-sm font-semibold text-white"}>搜索</button></form>
      </div> : null}
    </header>
  );
}
