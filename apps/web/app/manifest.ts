import type { MetadataRoute } from "next";
import { HOME_DESCRIPTION, SITE_NAME } from "@/lib/seo";

// Web app manifest — another place the brand name is declared (Google reads
// it for site name/icon, and it enables "install app" on mobile).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: "Solcameo",
    description: HOME_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icon.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
