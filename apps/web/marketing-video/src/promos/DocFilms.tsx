/** Three documentary configs wired to the auto-generated VO cue maps. */
import React from "react";
import { DocFilm, DocConfig } from "./DocEngine";
import { DOCS } from "./doccues";

const S = (n: string) => `stock/st_${n}.mp4`;
const B = (n: string) => `doc/${n}.mp4`;

const D1: DocConfig = {
  title: "The Feed Never Sleeps", chapter: "Chapter 01 — Attention",
  dur: DOCS.D1.dur, cues: DOCS.D1.cues as any, revealAt: 18,
  media: [S("853794"), S("6574256"), S("10374888"), S("14367163"), B("clipper_a"), S("7606057"),
    S("11372816"), S("7140928"), S("3941990"), B("agent_vert"), S("6109926"), S("17512949"),
    S("4474918"), S("6109923"), S("19910709"), S("12421171"), S("8086497"), B("launch_a"),
    B("park"), B("agent_vert"), S("7140928"), B("park")],
};
const D2: DocConfig = {
  title: "Own the Machine", chapter: "Chapter 02 — Automation",
  dur: DOCS.D2.dur, cues: DOCS.D2.cues as any, revealAt: 17,
  media: [S("17516653"), S("12043160"), S("7140928"), S("10327270"), S("17512949"), S("7579943"),
    S("6266288"), S("4524511"), S("11372816"), S("6574256"), S("12421171"), S("14367163"),
    B("agent_vert"), B("clipper_b"), S("7579945"), B("launch_b"), S("853794"), B("park"),
    B("agent_vert"), S("6326861"), B("park")],
};
const D3: DocConfig = {
  title: "The Window Is Open", chapter: "Chapter 03 — The Rush",
  dur: DOCS.D3.dur, cues: DOCS.D3.cues as any, revealAt: 15,
  media: [S("3602435"), S("10327270"), S("4524511"), S("12043160"), S("7579943"), S("853794"),
    S("6109926"), S("19910709"), S("12421171"), S("7000589"), S("10374888"), S("7140928"),
    B("agent_vert"), S("7606057"), S("6574256"), B("park"), B("clipper_b"), B("park")],
};

export const DocFeed: React.FC = () => <DocFilm cfg={D1} />;
export const DocMachines: React.FC = () => <DocFilm cfg={D2} />;
export const DocGoldRush: React.FC = () => <DocFilm cfg={D3} />;
export const DOC_DURS = {
  DocFeed: Math.round((DOCS.D1.dur + 5.5) * 30),
  DocMachines: Math.round((DOCS.D2.dur + 5.5) * 30),
  DocGoldRush: Math.round((DOCS.D3.dur + 5.5) * 30),
};
