// Monochrome line icons for the 3.0 UI (spec 10) — no emoji anywhere.
import React from "react";

const P: Record<string, React.ReactNode> = {
  library: <path d="M4 6h16M4 12h16M4 18h10" />,
  ask: (
    <>
      <path d="M21 12a8 8 0 1 1-3.2-6.4L21 5" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" />
    </>
  ),
  tasks: (
    <>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </>
  ),
  capture: (
    <>
      <circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14a7.8 7.8 0 0 0 0-4l1.6-1.2-2-3.4-1.9.8a7.8 7.8 0 0 0-3.5-2L13 .8h-4l-.3 2.4a7.8 7.8 0 0 0-3.5 2l-1.9-.8-2 3.4L2.9 10a7.8 7.8 0 0 0 0 4l-1.6 1.2 2 3.4 1.9-.8a7.8 7.8 0 0 0 3.5 2l.3 2.4h4l.3-2.4a7.8 7.8 0 0 0 3.5-2l1.9.8 2-3.4z" />
    </>
  ),
  folder: <path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H3z" />,
  domain: <path d="M12 21s-7-4.5-9.2-9C1.3 8.8 3 5.5 6.2 5.5 8 5.5 9.3 6.6 12 9c2.7-2.4 4-3.5 5.8-3.5 3.2 0 4.9 3.3 3.4 6.5C19 16.5 12 21 12 21z" />,
  file: (
    <>
      <path d="M6 3h7l5 5v13H6z" />
      <path d="M13 3v5h5" />
    </>
  ),
  caret: <path d="M6 9l6 6 6-6" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  download: (
    <>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  theme: (
    <>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
    </>
  ),
  logo: <path d="M4 7v10M9 4v16M14 8v8M19 6v12" />,
};

export function Icon({ name, size = 18 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {P[name] ?? null}
    </svg>
  );
}
