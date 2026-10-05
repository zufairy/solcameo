/* Line icons for the Operators Call page: one 24px grid, 1.5px stroke, round caps. */
import type { ReactNode } from "react";

const base = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export const ICONS = {
  mint: base(<><path d="M12 3l7.5 4.3v9.4L12 21l-7.5-4.3V7.3L12 3z" /><path d="M12 8.5v7M8.5 12h7" /></>),
  deploy: base(<><circle cx="12" cy="12" r="1.8" /><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 5.4a9.4 9.4 0 0 0 0 13.2M18.6 5.4a9.4 9.4 0 0 1 0 13.2" /></>),
  earn: base(<><path d="M3 17l5.5-5.5 4 4L21 7" /><path d="M15 7h6v6" /></>),
  badge: base(<path d="M12 3l2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.4l6-.9L12 3z" />),
  call: base(<><rect x="3" y="6" width="12.5" height="12" rx="2.2" /><path d="M15.5 10.2L21 7v10l-5.5-3.2" /></>),
  compass: base(<><circle cx="12" cy="12" r="9" /><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1 5.1-2.1z" /></>),
  key: base(<><circle cx="8" cy="12" r="4" /><path d="M12 12h9M18 12v3M15.5 12v2.2" /></>),
  circle: base(<><circle cx="9" cy="9" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17.2" cy="8.2" r="2.4" /><path d="M16.2 14.2c2.9.2 4.8 2.3 4.8 5.3" /></>),
  crown: base(<path d="M3 8l4.6 4L12 5l4.4 7L21 8l-2 11H5L3 8z" />),
  pulse: base(<path d="M3 12h4l3-8 4 16 3-8h4" />),
  build: base(<><path d="M12 3l8.5 4.8v8.4L12 21l-8.5-4.8V7.8L12 3z" /><path d="M3.5 7.8L12 12.6l8.5-4.8M12 12.6V21" /></>),
  climb: base(<path d="M3 20h5v-5h5v-5h5V5h3" />),
  chat: base(<path d="M4 5h16v11H9.5L4 20.5V5z" />),
};

export type IconName = keyof typeof ICONS;
export const Icon = ({ name }: { name: IconName }) => ICONS[name];
