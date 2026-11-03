"use client";

import { useEffect, useRef, useState } from "react";

export type SystemSelectOption = {
  value: string;
  label: string;
};

export function SystemSelect({
  options,
  value,
  defaultValue = "",
  name,
  required,
  disabled,
  autoFocus,
  placeholder,
  className,
  onChange,
  "aria-label": ariaLabel,
}: {
  options: SystemSelectOption[];
  value?: string;
  defaultValue?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  onChange?: (value: string) => void;
  "aria-label"?: string;
}) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const selected = controlled ? value : internal;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((option) => option.value === selected);
  const label = current?.label ?? placeholder ?? "Seleccionar";

  function choose(next: string) {
    if (!controlled) setInternal(next);
    onChange?.(next);
    setOpen(false);
  }

  return (
    <div
      ref={rootRef}
      className={`system-select ${open ? "open" : ""} ${className ?? ""}`}
    >
      {name && (
        <input type="hidden" name={name} value={selected} required={required} />
      )}
      <button
        type="button"
        disabled={disabled}
        autoFocus={autoFocus}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <span>{label}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 6 8 10.5 12.5 6" />
        </svg>
      </button>
      {open && (
        <ul className="system-select-menu" role="listbox">
          {options.map((option) => (
            <li key={option.value || "empty"}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === selected}
                onClick={() => choose(option.value)}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
