"use client";

import Link from "next/link";

/** Shared secondary lab switcher rendered below the common app header.
 *  Add a new lab here to expose its tab on every development tool. */
const LABS = [
  { id: "captions", label: "Captions Lab", href: "/dev/captions-lab" },
  { id: "clips", label: "Clip Presets Lab", href: "/dev/clip-presets-lab" },
  { id: "face-detect", label: "Face Detect", href: "/dev/face-detect" },
  { id: "team-schedule", label: "Team Schedule", href: "/dev/team-schedule" },
  { id: "jev", label: "JEV", href: "/dev/jev" },
  { id: "x-cards", label: "X Share Cards", href: "/dev/x-cards" },
  { id: "post-material", label: "Post Material", href: "/dev/post-material" },
] as const;

export function LabTabs({ active }: { active: (typeof LABS)[number]["id"] }) {
  return (
    <div className="sticky top-4 z-20 mb-8 flex justify-center">
      <nav className="flex items-center gap-1 rounded-full border border-white/10 bg-[#0d0d10]/90 p-1 shadow-lg shadow-black/40 backdrop-blur-xl">
        {LABS.map((lab) => (
          <Link
            key={lab.id}
            href={lab.href}
            className={`rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition-colors ${
              lab.id === active ? "bg-white text-black" : "text-white/55 hover:text-white/85"
            }`}
          >
            {lab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
