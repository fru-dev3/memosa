// Monochrome line icons for the 3.0 UI (spec 10). No emoji anywhere.
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
  // The Memosa mark (memosa.dev): a voice line ending in a dot.
  logo: (
    <>
      <path d="M2.5 17.5c3.1 0 4.8-10 6.2-10s2.6 8.6 4 8.6 2.4-6.2 3.9-6.2 1.9 5.5 2.9 5.5 2.1-1.2 3.5-1.2" strokeWidth={2.2} />
      <circle cx="19.2" cy="5.2" r="1.7" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  reveal: (
    <>
      <path d="M14 4h6v6M20 4l-8 8" />
      <path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>
  ),
  dots: (
    <>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </>
  ),
  doc: (
    <>
      <path d="M6 2h9l5 5v15H6z" />
      <path d="M14 2v6h6" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />,
  pause: <path d="M8 5v14M16 5v14" strokeWidth={2.4} />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
    </>
  ),
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  upload: (
    <>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0z" />
      <path d="M12 17v4" />
    </>
  ),
  cloud: <path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.5A3.75 3.75 0 0 1 17.5 18z" />,
  spark: <path d="M12 3l2 5.5L19.5 10.5 14 12.5 12 18l-2-5.5L4.5 10.5 10 8.5z" />,
  speaker: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  account: (
    <>
      <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" />
      <path d="M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3" />
    </>
  ),
  tag: <path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16" />,
  grip: (
    <>
      <circle cx="9" cy="7" r="0.6" fill="currentColor" />
      <circle cx="15" cy="7" r="0.6" fill="currentColor" />
      <circle cx="9" cy="12" r="0.6" fill="currentColor" />
      <circle cx="15" cy="12" r="0.6" fill="currentColor" />
      <circle cx="9" cy="17" r="0.6" fill="currentColor" />
      <circle cx="15" cy="17" r="0.6" fill="currentColor" />
    </>
  ),
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
