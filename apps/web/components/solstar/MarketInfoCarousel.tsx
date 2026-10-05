"use client";
import { Children, useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
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
  const [playing, setPlaying] = useState(true);
  const [interacting, setInteracting] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!playing || interacting || reduced || slides.length < 2) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % slides.length),
      8000,
    );
    return () => clearInterval(timer);
  }, [playing, interacting, reduced, slides.length, index]);
  function move(direction: number) {
    setPlaying(false);
    setIndex((i) => (i + direction + slides.length) % slides.length);
  }
  return (
    <section
      aria-label="Coin information"
      aria-roledescription="carousel"
      className="border-t border-white/10 font-sans"
      onMouseEnter={() => setInteracting(true)}
      onMouseLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setInteracting(false);
      }}
    >
      <div className="flex items-center gap-1 px-4 pt-4">
        <h2 className="mr-auto text-xs font-medium text-zinc-200">
          {labels[index]}
        </h2>
        <button
          type="button"
          aria-label="Previous information"
          onClick={() => move(-1)}
          className="rounded-md p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          aria-label={
            playing ? "Pause information rotation" : "Play information rotation"
          }
          onClick={() => setPlaying((p) => !p)}
          className="rounded-md p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"
        >
          {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
        </button>
        <button
          type="button"
          aria-label="Next information"
          onClick={() => move(1)}
          className="rounded-md p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      {slides.map((slide, i) => (
        <div
          key={labels[i]}
          hidden={i !== index}
          role="group"
          aria-roledescription="slide"
          aria-label={`${i + 1} of ${slides.length}: ${labels[i]}`}
        >
          {slide}
        </div>
      ))}
      <div className="flex justify-center gap-1.5 pb-4">
        {slides.map((_, i) => (
          <button
            key={labels[i]}
            type="button"
            aria-label={`Show ${labels[i]}`}
            aria-current={i === index ? "true" : undefined}
            onClick={() => {
              setPlaying(false);
              setIndex(i);
            }}
            className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-[#d7ff00]" : "w-1.5 bg-white/20"}`}
          />
        ))}
      </div>
    </section>
  );
}
