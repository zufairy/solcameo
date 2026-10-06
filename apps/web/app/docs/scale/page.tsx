import { redirect } from "next/navigation";

/** Old chapter URL: earn and scale became "Grow". */
export default function Page() {
  redirect("/docs/grow");
}
