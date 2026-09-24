import type { Ref } from "react";

export const BRAND_ICON_LOCKED = "/brand/seraframe-icon-locked.png";

type ProfileButtonProps = {
  connected: boolean;
  pressed: boolean;
  floating?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  onClick: () => void;
};

export function ProfileButton({ connected, pressed, floating = false, buttonRef, onClick }: ProfileButtonProps) {
  const label = connected ? "Settings. A server is connected." : "Settings";
  return (
    <button
      ref={buttonRef}
      type="button"
      className={floating ? "profile-chip is-floating" : "profile-chip"}
      aria-haspopup="dialog"
      aria-expanded={pressed}
      aria-controls="profile-menu"
      aria-label={label}
      onClick={onClick}
    >
      <img src={BRAND_ICON_LOCKED} alt="" width={floating ? 64 : 44} height={floating ? 64 : 44} draggable={false} />
      {connected ? <span className="presence" aria-hidden="true" /> : null}
    </button>
  );
}
