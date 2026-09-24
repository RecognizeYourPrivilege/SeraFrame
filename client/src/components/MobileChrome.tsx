import { useEffect, useRef, type RefObject } from "react";
import { sectionHash, SECTION_LABEL, type GallerySection } from "../lib/route";

type MobileTabBarProps = {
  section: GallerySection | null;
  railOpen: boolean;
  onToggleRail: () => void;
};

type OverflowMenuProps = {
  section: GallerySection | null;
  toggleRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onServers: () => void;
  onAddSource: () => void;
};

const SECTIONS = ["foryou", "library", "albums"] as const;

export function MobileTabBar({ section, railOpen, onToggleRail }: MobileTabBarProps) {
  return (
    <nav className="mobile-tabbar" aria-label="Primary">
      {SECTIONS.map((item) => (
        <a
          key={item}
          className="mobile-tab"
          href={sectionHash(item)}
          aria-current={section === item ? "page" : undefined}
        >
          <SectionIcon section={item} />
          <span>{SECTION_LABEL[item]}</span>
        </a>
      ))}
      <button
        type="button"
        className="mobile-tab"
        aria-expanded={railOpen}
        aria-controls="servers-rail"
        aria-current={section === null ? "page" : undefined}
        onClick={onToggleRail}
      >
        <ServersIcon />
        <span>Servers</span>
      </button>
    </nav>
  );
}

export function OverflowMenu({ section, toggleRef, onClose, onServers, onAddSource }: OverflowMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLElement>("a, button");
    first?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      if (toggleRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      toggleRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, toggleRef]);

  return (
    <div ref={menuRef} id="mobile-overflow" className="overflow-menu">
      <nav aria-label="Primary">
        {SECTIONS.map((item) => (
          <a
            key={item}
            className="overflow-item"
            href={sectionHash(item)}
            aria-current={section === item ? "page" : undefined}
            onClick={onClose}
          >
            <SectionIcon section={item} />
            <span>{SECTION_LABEL[item]}</span>
            {section === item ? <CheckIcon /> : null}
          </a>
        ))}
        <button
          type="button"
          className="overflow-item"
          aria-expanded={false}
          aria-controls="servers-rail"
          aria-current={section === null ? "page" : undefined}
          onClick={onServers}
        >
          <ServersIcon />
          <span>Servers</span>
          {section === null ? <CheckIcon /> : null}
        </button>
        <button type="button" className="overflow-item" onClick={onAddSource}>
          <PlusIcon />
          <span>Add source</span>
        </button>
      </nav>
    </div>
  );
}

export function HamburgerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SectionIcon({ section }: { section: (typeof SECTIONS)[number] }) {
  if (section === "foryou") return <StarIcon />;
  if (section === "albums") return <FolderIcon />;
  return <LibraryIcon />;
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.6 14.1 9l5.7.4-4.4 3.6 1.4 5.5L12 15.8 7.2 18.5 8.6 13 4.2 9.4 9.9 9 12 3.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 15.5 10.4 12l2.1 2.4 1.6-1.8L16.5 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="1" fill="currentColor" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 8.5A2 2 0 0 1 6 6.5h3.2l1.6 1.6H18a2 2 0 0 1 2 2v7.2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ServersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5.5v13M5.5 12h13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="overflow-check" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.5 12.5 10 17l8.5-9.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
