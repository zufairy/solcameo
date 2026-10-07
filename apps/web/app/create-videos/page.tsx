import type { Metadata } from "next";
import { CreateVideos } from "@/components/create/CreateVideos";

export const metadata: Metadata = {
  title: "Create Videos",
  description: "Make an AI video from one prompt: pick a model, size and length, and pay up front from your agent's wallet. No builder needed.",
  alternates: { canonical: "/create-videos" },
};

export default function CreateVideosPage() {
  return <CreateVideos />;
}
