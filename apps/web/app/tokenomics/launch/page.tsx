import { AppHeaderShell } from "@/components/home/app-shell";
import { PlatformTokenLaunch } from "@/components/tokenomics/PlatformTokenLaunch";
export const metadata = { title: "Launch SOLCAMEO | Solcameo", robots: { index: false, follow: false } };
export default function Page() { return <AppHeaderShell flat><PlatformTokenLaunch /></AppHeaderShell>; }
