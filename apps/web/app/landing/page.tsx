import { redirect } from "next/navigation";

// The landing design is now the homepage (`/`). Keep this path working for any
// existing links by redirecting it to the root.
export default function LandingPage() {
  redirect("/");
}
