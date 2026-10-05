"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const MAX_RESULTS = 8;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function SearchResults({ search, onSelect }: { search: string; onSelect: (id: string) => void }) {
  const rows = useQuery(api.solstarCatalog.listCharacters, { search: search || undefined });
  if (rows === undefined) {
    return (
      <div role="status" aria-live="polite" className="py-6 text-center text-sm text-muted-foreground">
        Searching...
      </div>
    );
  }
  if (rows.length === 0) {
    return <CommandEmpty>No results</CommandEmpty>;
  }
  return (
    <CommandGroup heading={search ? "Characters" : "Latest characters"}>
      {rows.slice(0, MAX_RESULTS).map(({ character, token }) => (
        <CommandItem
          key={character._id}
          value={character._id}
          onSelect={() => onSelect(character._id)}
        >
          <span className="truncate font-medium">{character.name}</span>
          <span className="ml-auto font-mono text-xs text-muted-foreground">${token.ticker}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

/** Top-bar search trigger + Cmd/Ctrl+K command palette over Solcameo characters. */
export function ShellSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const search = useDebounced(input.trim(), 250);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setInput("");
  }

  return (
    <>
      <Button
        variant="outline"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search characters"
        aria-keyshortcuts="Control+K Meta+K"
        className="group flex h-8 w-full max-w-xl items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-zinc-500 transition-colors duration-200 hover:border-white/20 hover:bg-white/[0.06] hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/60"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">Search tokens and characters...</span>
        <kbd className="hidden rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-zinc-400 sm:inline">
          ⌘K
        </kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Search characters"
        description="Find a character or ticker"
      >
        {/* Filtering happens server side, so cmdk's own filter is off. */}
        <CommandInputShell value={input} onValueChange={setInput}>
          <SearchResults
            search={search}
            onSelect={(id) => {
              handleOpenChange(false);
              router.push(`/market/${id}`);
            }}
          />
        </CommandInputShell>
      </CommandDialog>
    </>
  );
}

function CommandInputShell({
  value,
  onValueChange,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Command shouldFilter={false}>
      <CommandInput value={value} onValueChange={onValueChange} placeholder="Search by name or ticker..." />
      <CommandList>{children}</CommandList>
    </Command>
  );
}
