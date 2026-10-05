// Root template — Next.js re-mounts this on every navigation (it's given a
// unique key), so the page-entrance animation replays each time a page opens.
// The wrapper is layout-neutral (block, auto height): full-height pages keep
// their own `h-[calc(100vh-3.5rem)]`, and scrolling pages scroll normally.
// The reveal itself (fade + slide-up) lives in `.page-reveal` in globals.css,
// and is disabled under prefers-reduced-motion. On app pages the menu stays
// put and only [data-app-content] animates (see globals.css).
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-reveal">{children}</div>;
}
