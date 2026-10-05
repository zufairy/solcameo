import type { SVGProps } from "react";
/** Three video frames fanned around a central play card. */
export function VideoStackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" {...props}>
      <rect
        x="5"
        y="13"
        width="23"
        height="28"
        rx="4"
        transform="rotate(-16 5 13)"
        fill="currentColor"
        fillOpacity=".04"
        stroke="currentColor"
        strokeOpacity=".4"
        strokeWidth="1.5"
      />
      <rect
        x="22"
        y="7"
        width="23"
        height="28"
        rx="4"
        transform="rotate(16 22 7)"
        fill="currentColor"
        fillOpacity=".04"
        stroke="currentColor"
        strokeOpacity=".65"
        strokeWidth="1.5"
      />
      <rect
        x="13"
        y="8"
        width="23"
        height="32"
        rx="5"
        fill="var(--card, #202326)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="m22 20 7 4-7 4v-8Z" fill="currentColor" />
    </svg>
  );
}
