import type { SVGProps } from "react";

const PATHS = {
  book: "M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17ZM4 19.5A2.5 2.5 0 0 1 6.5 17H20",
  soundOn: "M4 9h4l5-4v14l-5-4H4V9Zm13 0a4 4 0 0 1 0 6m2.5-9a8 8 0 0 1 0 12",
  soundOff: "M4 9h4l5-4v14l-5-4H4V9Zm13 1 5 5m0-5-5 5",
  flag: "M5 21V4m0 0h11l-2 4 2 4H5",
  close: "M6 6l12 12M18 6 6 18",
  cards: "M8 3h11v15H8zM5 6v15h11",
  log: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  sword: "M14.5 3H21v6.5L10 20.5l-3-3L18 6.5M4 17l3 3m-5 1 3-3",
  move: "M5 12h14m-4-4 4 4-4 4M9 8 5 12l4 4",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  crown: "M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8Z",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  users: "M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20m16 0v-1.5a3.5 3.5 0 0 0-2.5-3.35M14.5 4.3a3.5 3.5 0 0 1 0 6.4M13.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z",
  dice: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3.5 5h.01M15.5 8h.01M12 12h.01M8.5 16h.01M15.5 16h.01",
  shield: "M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Z",
  check: "M5 12.5 10 17 19 7",
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z",
  menu: "M4 7h16M4 12h16M4 17h16",
  home: "M4 11.5 12 5l8 6.5V20h-5v-5h-6v5H4v-8.5Z",
  device: "M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm4 15h2",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
