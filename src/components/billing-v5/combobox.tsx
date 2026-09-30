"use client";

import { useId, useState, type ReactNode } from "react";

import { Input } from "@/components/ui";

export interface ComboOption {
  id: string;
  /** Main text of the option (also what the search matches first). */
  label: string;
  /** Small text under it: code, details. */
  hint?: string;
  /** Extra text the search matches (codes, other names). */
  keywords?: readonly string[];
}

export function matchOptions(options: readonly ComboOption[], query: string, limit = 30): ComboOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options.slice(0, limit);
  const words = needle.split(/\s+/);
  return options
    .filter((option) => {
      const haystack = [option.label, option.hint ?? "", ...(option.keywords ?? [])].join(" ").toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .slice(0, limit);
}

/**
 * A text input with a searchable list under it (ARIA combobox). The text is
 * the caller's (`value` / `onInput`); choosing an option calls `onPick`. Works
 * with the keyboard (↑ ↓ Enter Esc) and on touch.
 */
export function Combobox({
  value,
  onInput,
  options,
  onPick,
  onBlur,
  placeholder,
  ariaLabel,
  disabled,
  empty,
  testId,
  className = "",
  inputClassName = "",
  trailing,
}: {
  value: string;
  onInput: (text: string) => void;
  options: readonly ComboOption[];
  onPick: (id: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  /** Shown when nothing matches (omit to show no list at all). */
  empty?: string;
  testId: string;
  className?: string;
  inputClassName?: string;
  trailing?: ReactNode;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const shown = matchOptions(options, value);
  // Nothing left to choose once the text is exactly one option: the list gets out of the way.
  const exact = shown.length === 1 && shown[0].label.trim().toLowerCase() === value.trim().toLowerCase();
  const visible = open && !disabled && !exact && (shown.length > 0 || !!empty);

  const pick = (option: ComboOption) => {
    onPick(option.id);
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <Input
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={visible && shown[active] ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        className={inputClassName}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          onBlur?.();
        }}
        onChange={(event) => {
          onInput(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.min(index + 1, Math.max(shown.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && visible && shown[active]) {
            event.preventDefault();
            pick(shown[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        data-testid={testId}
      />
      {trailing}
      {visible && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-panel py-1 shadow-lg"
          data-testid={`${testId}-options`}
        >
          {shown.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-muted">{empty}</li>
          ) : (
            shown.map((option, index) => (
              <li
                key={option.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                // Keep focus in the input so blur does not close the list first.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(option)}
                onMouseEnter={() => setActive(index)}
                className={`cursor-pointer px-3 py-2 ${index === active ? "bg-fill" : ""}`}
                data-testid={`${testId}-option`}
              >
                <span className="block truncate text-[14px]">{option.label}</span>
                {option.hint && <span className="block truncate text-[12px] text-muted">{option.hint}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
