import type { ButtonHTMLAttributes, ReactNode } from "react";

interface PixelButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
}

export function PixelButton({
  children,
  variant = "primary",
  className = "",
  ...props
}: PixelButtonProps) {
  return (
    <button className={`pixel-button ${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
