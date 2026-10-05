import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

export const IconGear = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const IconGauge = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 16a8 8 0 1 1 16 0" /><path d="M12 16l4-5" /><circle cx="12" cy="16" r="1" /></svg>
);
export const IconStack = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></svg>
);
export const IconCrosshair = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="7" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>
);
export const IconList = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 6h12M8 12h12M8 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></svg>
);
export const IconRefresh = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M20 11a8 8 0 0 0-14.9-3.9L4 9" /><path d="M4 4v5h5" /><path d="M4 13a8 8 0 0 0 14.9 3.9L20 15" /><path d="M20 20v-5h-5" /></svg>
);
export const IconPause = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 6v12M15 6v12" /></svg>
);
export const IconPlay = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 5l11 7-11 7V5z" /></svg>
);
export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
);
export const IconPin = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 4h6l-1 6 3 3H7l3-3-1-6z" /><path d="M12 13v7" /></svg>
);
export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
);
export const IconExternal = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
);
export const IconChevron = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 6l6 6-6 6" /></svg>
);
export const IconX = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconFlag = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 21V4h11l-2 4 2 4H5" /></svg>
);
export const IconFlask = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3" /><path d="M7.5 15h9" /></svg>
);
export const IconGrid = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><path d="M16.75 14v5.5M14 16.75h5.5" /></svg>
);
export const IconMoon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
);
export const IconSun = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const IconPulse = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>
);
export const IconTopology = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="3" width="6" height="5" rx="1" /><rect x="15" y="3" width="6" height="5" rx="1" /><rect x="9" y="16" width="6" height="5" rx="1" /><path d="M6 8v3h12V8M12 11v5" /></svg>
);
export const IconExport = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>
);
export const IconCase = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" /></svg>
);
export const IconUsers = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14.6c2.7.1 4.5 1.9 4.5 4.4" /></svg>
);
