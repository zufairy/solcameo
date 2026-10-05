"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Loader2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VelloNode, NodeStatus } from "@/components/builder/clipping-flow/types/clipping";
import { nodeVisual, nodeImage } from "./node-visual";

function StatusDot({ status }: { status: NodeStatus }) {
  if (status === "running")
    return <Loader2 className="size-3.5 animate-spin text-primary" />;
  if (status === "done")
    return <Check className="size-3.5" style={{ color: "var(--node-publish)" }} />;
  if (status === "error") return <X className="size-3.5 text-destructive" />;
  return <span className="size-2 rounded-full bg-muted-foreground/40" />;
}

export function ClipNode({ data, selected }: NodeProps<VelloNode>) {
  const v = nodeVisual(data);
  const img = nodeImage(data);
  // If the remote icon fails, fall back to a clean monogram over the accent wash.
  const [imgOk, setImgOk] = useState(true);

  return (
    <motion.div
      // Pop-in when the node is added to the canvas; the hover-lift lives on framer
      // (whileHover) instead of a CSS transform so the two don't fight over `transform`.
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -2 }}
      transition={{ type: "spring", stiffness: 480, damping: 30 }}
      className={cn(
        "clip-node-card group relative w-[224px] overflow-hidden rounded-2xl border text-card-foreground backdrop-blur-xl transition-[box-shadow,border-color] duration-200",
        "shadow-[0_10px_30px_-12px_rgba(28,28,31,0.4)] hover:shadow-[0_16px_44px_-14px_rgba(28,28,31,0.5)]",
        selected
          ? "border-primary/70 ring-2 ring-primary/40"
          : "border-white/60 hover:border-white/80",
        data.status === "running" && "ring-2 ring-primary/50",
        data.status === "error" && "border-destructive/60"
      )}
      style={{
        background:
          "linear-gradient(160deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.62) 100%)",
      }}
    >
      {v.hasInput && (
        <Handle type="target" position={v.inputPos} className="clip-handle" />
      )}
      {v.hasOutput && (
        <Handle type="source" position={v.outputPos} className="clip-handle" />
      )}
      {/* Compose keeps its default (null-id, Right) source handle for
          Compose→Publish, and adds two NAMED source handles so skill edges
          leave the Top/Bottom of the hub without crossing the horizontal
          Source→Compose→Publish edges. New skill edges set sourceHandle to one
          of these; legacy null-handle skill edges still bind to the default
          Right handle (and self-heal to top/bottom on the next Tidy). */}
      {data.kind === "compose" && (
        <>
          <Handle id="skills-top" type="source" position={Position.Top} className="clip-handle" />
          <Handle id="skills-bottom" type="source" position={Position.Bottom} className="clip-handle" />
        </>
      )}

      {/* Icon on the LEFT, title + description stacked BESIDE it on the right; the
          status dot sits inline at the far end. Title and description share ONE text
          size so the card reads as a clean horizontal row. */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div
          className="flex size-11 shrink-0 items-center justify-center rounded-[14px] border border-white/70 shadow-[0_10px_22px_-8px_rgba(28,28,31,0.4),inset_0_1px_0_rgba(255,255,255,0.65)] transition-transform duration-200 group-hover:-translate-y-0.5"
          style={{
            background: `linear-gradient(155deg, color-mix(in oklch, ${v.accent} 44%, white) 0%, color-mix(in oklch, ${v.accent} 18%, white) 100%)`,
          }}
        >
          {imgOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img}
              alt=""
              width={26}
              height={26}
              loading="lazy"
              onError={() => setImgOk(false)}
              className="size-[26px] object-contain drop-shadow-[0_2px_6px_rgba(28,28,31,0.3)] transition-transform duration-200 group-hover:scale-110"
            />
          ) : (
            <span className="text-xl font-bold text-white drop-shadow-sm">
              {data.title.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-tight tracking-tight text-zinc-900">
            {data.title}
          </div>
          <div className="mt-0.5 line-clamp-2 text-[15px] leading-snug text-muted-foreground">
            {v.summary}
          </div>
        </div>
        <div className="shrink-0">
          <StatusDot status={data.status} />
        </div>
      </div>

      {/* Publish node: thumbnail strip of the finished clip(s) right on the
          node - click the node to open the full preview dialog. */}
      {data.kind === "publish" && data.output && (data.output.type === "clip" || data.output.type === "clips") && (
        <div className="flex justify-center gap-1.5 px-3 pb-3">
          {(data.output.type === "clips" ? data.output.items.slice(0, 3) : [data.output]).map((c, i) => (

            <video
              key={`${"clipUrl" in c ? c.clipUrl : i}`}
              src={"clipUrl" in c ? c.clipUrl : undefined}
              muted
              playsInline
              preload="metadata"
              className="h-20 w-auto rounded-md border border-white/10 bg-black"
              style={{ aspectRatio: "9 / 16" }}
            />
          ))}
          {data.output.type === "clips" && data.output.items.length > 3 && (
            <span className="grid h-20 w-8 place-items-center rounded-md border border-white/10 bg-black/40 text-[10px] font-medium text-zinc-300">
              +{data.output.items.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Per-node progress bar: sweeping while running, filled (accent) when done, red on error. */}
      {data.status === "running" && (
        <span className="absolute inset-x-0 bottom-0 h-1.5 overflow-hidden bg-foreground/10">
          <span
            className="absolute inset-y-0 left-0 w-2/5 rounded-full animate-[vello-sweep_1.1s_ease-in-out_infinite]"
            style={{ background: v.accent }}
          />
        </span>
      )}
      {data.status === "done" && (
        <span className="absolute inset-x-0 bottom-0 h-1.5" style={{ background: v.accent }} />
      )}
      {data.status === "error" && (
        <span className="absolute inset-x-0 bottom-0 h-1.5 bg-destructive" />
      )}
    </motion.div>
  );
}
