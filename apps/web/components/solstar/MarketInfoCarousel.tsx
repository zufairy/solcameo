"use client";
import { Children, useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useReducedMotion } from "framer-motion";

export function MarketInfoCarousel({
  children,
  labels,
}: {
  children: ReactNode;
  labels: string[];
}) {
  const slides = Children.toArray(children);
  const [index, setIndex] = useState(0);
  const [interacting, setInteracting] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (interacting || reduced || slides.length < 2) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % slides.length),
      8000,
    );
    return () => clearInterval(timer);
  }, [interacting, reduced, slides.length, index]);
  function move(direction: number) {
    setIndex((i) => (i + direction + slides.length) % slides.length);
  }
  return (
    <section
      aria-label="Coin information"
      aria-roledescription="carousel"
      className="market-sidebar-text shrink-0 border-t border-white/10 bg-[#0b0c0e]"
      onMouseEnter={() => setInteracting(true)}
      onMouseLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setInteracting(false);
      }}
    >
      <div className="flex items-center gap-1.5 px-3 pt-2">
        <h2 className="mr-auto text-[13px] font-semibold text-white">
          {labels[index]}
        </h2>
        {([[-1, "Previous information", ChevronLeft], [1, "Next information", ChevronRight]] as const).map(([dir, label, Icon]) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            onClick={() => move(dir)}
            className="grid size-7 place-items-center rounded-lg border border-white/[0.09] bg-white/[0.03] text-zinc-400 transition-colors hover:border-white/25 hover:text-white"
          >
            <Icon className="size-3.5" strokeWidth={2.4} />
          </button>
        ))}
      </div>
      <div className="overflow-hidden">
        <div
          className="flex transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {slides.map((slide, i) => (
            <div
              key={labels[i]}
              inert={i !== index}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${slides.length}: ${labels[i]}`}
              className="h-[150px] w-full shrink-0 overflow-y-auto overscroll-contain"
            >
              {slide}
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-center gap-1.5 py-2">
        {slides.map((_, i) => (
          <button
            key={labels[i]}
            type="button"
            aria-label={`Show ${labels[i]}`}
            aria-current={i === index ? "true" : undefined}
            onClick={() => {
              setIndex(i);
            }}
            className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-[#d7ff00]" : "w-1.5 bg-white/20"}`}
          />
        ))}
      </div>
    </section>
  );
}
