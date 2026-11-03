"use client";

type SearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  "aria-label"?: string;
  "aria-controls"?: string;
};

export function SearchField({
  value,
  onChange,
  placeholder,
  className,
  "aria-label": ariaLabel,
  "aria-controls": ariaControls,
}: SearchFieldProps) {
  return (
    <label className={["catalog-search", className].filter(Boolean).join(" ")}>
      <span className="catalog-search-field">
        <SearchIcon />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-controls={ariaControls}
        />
      </span>
    </label>
  );
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="m15 15 4 4" />
    </svg>
  );
}
