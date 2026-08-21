"use client";

import type { ButtonHTMLAttributes } from "react";

// A plain submit/button wrapper that asks window.confirm() before letting the
// click through — e.preventDefault() on the click stops a submit button's
// form submission too, so this works inside a <form action={...}> unchanged.
export function ConfirmButton({
  confirmMessage,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { confirmMessage?: string }) {
  return (
    <button
      {...props}
      onClick={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    />
  );
}
