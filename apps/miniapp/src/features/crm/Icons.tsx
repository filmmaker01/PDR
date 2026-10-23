import type { ReactNode, SVGProps } from 'react';

/**
 * Иконки раздела «Мастерская». Линейные, цветом текста: так они сами
 * подстраиваются под светлую и тёмную тему Telegram и не тянут шрифт иконок.
 */
function Icon({ children, size = 22, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const make = (paths: ReactNode) =>
  function IconComponent(props: IconProps) {
    return <Icon {...props}>{paths}</Icon>;
  };

export const IconToday = make(
  <>
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M8 3v4M16 3v4M3.5 10h17" />
    <path d="M9 14.5l2 2 4-4" />
  </>,
);

export const IconCar = make(
  <>
    <path d="M5 16.5V12l1.8-4.2A2 2 0 0 1 8.6 6.5h6.8a2 2 0 0 1 1.8 1.3L19 12v4.5" />
    <path d="M3.5 12h17v4.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
    <circle cx="7.5" cy="14.8" r="0.9" fill="currentColor" />
    <circle cx="16.5" cy="14.8" r="0.9" fill="currentColor" />
    <path d="M6 17.5v1.5M18 17.5v1.5" />
  </>,
);

export const IconCalendar = make(
  <>
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M8 3v4M16 3v4M3.5 10h17M8 14h2M14 14h2M8 17h2" />
  </>,
);

export const IconClients = make(
  <>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8" />
    <path d="M15.5 5.6a3 3 0 0 1 0 5.8M17 14.4c1.9.5 3.1 2 3.5 4.6" />
  </>,
);

export const IconMore = make(
  <>
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </>,
);

export const IconBell = make(
  <>
    <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </>,
);

export const IconGear = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.5 7.5 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 2.6-1.5l2.4 1 2-3.4z" />
  </>,
);

export const IconSearch = make(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </>,
);

export const IconPlus = make(<path d="M12 5v14M5 12h14" />);

export const IconChevron = make(<path d="M9.5 6l6 6-6 6" />);

export const IconChat = make(
  <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17H5A1.5 1.5 0 0 1 3.5 15.5V7A1.5 1.5 0 0 1 5 5.5z" />,
);

export const IconCamera = make(
  <>
    <path d="M4.5 8h3l1.7-2.5h5.6L16.5 8h3A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-8A1.5 1.5 0 0 1 4.5 8z" />
    <circle cx="12" cy="13.2" r="3.4" />
  </>,
);

export const IconUser = make(
  <>
    <circle cx="12" cy="8.5" r="3.6" />
    <path d="M4.5 20c.8-3.6 3.8-5.6 7.5-5.6s6.7 2 7.5 5.6" />
  </>,
);

export const IconCheck = make(<path d="M5.5 12.5l4 4 9-9" />);
