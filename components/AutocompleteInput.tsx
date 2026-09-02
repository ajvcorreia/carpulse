"use client";

import { useEffect, useId, useRef, useState } from "react";

// Native <input list> + <datalist> doesn't show any dropdown on iOS Safari
// (long-standing WebKit gap), so autocomplete needs its own dropdown here
// instead of relying on the browser to render one.
export function AutocompleteInput({
  id,
  name,
  value,
  onChange,
  options,
  placeholder,
  required,
  className,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    function handleOutside(e: Event) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, []);

  const needle = value.trim().toLowerCase();
  const filtered = (needle ? options.filter((o) => o.toLowerCase().includes(needle)) : options).slice(0, 20);

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        name={name}
        type="text"
        autoComplete="off"
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        className={className}
      />
      {open && filtered.length > 0 ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-border bg-surface py-1 text-sm shadow-md"
        >
          {filtered.map((opt) => (
            <li key={opt} role="option" aria-selected={opt === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-page"
              >
                {opt}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
