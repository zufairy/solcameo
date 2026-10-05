import { AppHeaderShell } from "@/components/home/app-shell";

export default function DevLayout({ children }: { children: React.ReactNode }) {
  return <AppHeaderShell>{children}</AppHeaderShell>;
}
