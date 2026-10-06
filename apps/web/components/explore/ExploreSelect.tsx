"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Compact toolbar dropdown in the site's dark scheme: short, sharp-cornered, label on the left. */
export function ExploreSelect({ label, value, onChange, options, disabled }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)} disabled={disabled}>
      <SelectTrigger
        aria-label={label}
        className="h-8 w-auto gap-1.5 rounded-[6px] border-white/[0.09] bg-[#111316] px-2.5 text-[12px] font-medium text-zinc-200 shadow-none transition-colors hover:border-white/20 hover:bg-[#16181c] focus-visible:ring-1 focus-visible:ring-white/30 data-[popup-open]:border-white/25 data-[popup-open]:bg-[#16181c] dark:bg-[#111316] dark:hover:bg-[#16181c]"
      >
        <span className="text-zinc-500">{label}</span>
        <SelectValue>{(v: string | null) => options.find((o) => o.value === v)?.label ?? ""}</SelectValue>
      </SelectTrigger>
      <SelectContent
        alignItemWithTrigger={false}
        sideOffset={6}
        align="start"
        className="w-auto min-w-[10rem] rounded-[8px] border border-white/10 bg-[#121417] p-1 text-[12px] text-zinc-200 shadow-[0_24px_50px_-16px_rgba(0,0,0,0.9)] ring-0"
      >
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="rounded-[5px] py-1.5 pl-2 pr-7 text-[12px] focus:bg-white/[0.07] focus:text-white">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
