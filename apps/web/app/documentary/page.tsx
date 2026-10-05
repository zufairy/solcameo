import type { Metadata } from "next";
import { DocumentaryApp } from "@/components/documentary-app/DocumentaryApp";

export const metadata: Metadata = {
  title: "Documentary Maker: Story Videos From an Idea",
  // Without its own canonical this page inherited the root layout's "/".
  alternates: { canonical: "/documentary" },
  description:
    "Turn an idea or product link into a narrated mini documentary: real internet photos, an ElevenLabs narrator, and a cinematic soundtrack.",
};

export default function DocumentaryPage() {
  return <DocumentaryApp />;
}
