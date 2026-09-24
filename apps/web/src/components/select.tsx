"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

/** Shared, themed dropdown with keyboard navigation and native form values. */
export function Select({
  name,
  label,
  options,
  defaultValue,
  value,
  onValueChange,
  disabled,
  icon,
  className = "w-full rounded-control border-2 border-line px-3.5 py-3 text-base",
}: {
  name?: string;
  label: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  icon?: ReactNode;
  className?: string;
}) {
  const initialValue = defaultValue ?? options[0]?.value ?? "";
  const [selection, setSelection] = useState(initialValue);
  const trigger = useRef<HTMLButtonElement>(null);

  // Server-action forms reset after success, just like an ordinary form reset.
  useEffect(() => {
    const form = trigger.current?.form;
    if (!form || value !== undefined) return;
    const reset = () => setSelection(initialValue);
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [initialValue, value]);

  return (
    <SelectPrimitive.Root
      name={name}
      value={value ?? selection}
      onValueChange={(next) => {
        if (value === undefined) setSelection(next);
        onValueChange?.(next);
      }}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        ref={trigger}
        aria-label={label}
        className={`group inline-flex min-h-11 cursor-pointer items-center justify-between gap-2 bg-surface text-left text-ink transition-colors hover:border-line-strong focus-visible:border-record disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate"><SelectPrimitive.Value /></span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          className="z-[100] max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-24px)] overflow-hidden rounded-control border border-line-strong bg-surface text-ink shadow-[0_8px_28px_color-mix(in_srgb,var(--shadow)_20%,transparent)]"
        >
          <SelectPrimitive.ScrollUpButton className="flex h-7 items-center justify-center bg-surface text-muted">
            <ChevronUp className="h-4 w-4" aria-hidden />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1.5">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="relative flex min-h-11 cursor-pointer select-none items-center rounded-lg py-2 pr-9 pl-3 text-base data-[state=checked]:font-semibold data-[state=checked]:text-record data-[highlighted]:bg-record-wash data-[highlighted]:text-record"
                // The highlighted row supplies focus feedback inside the listbox.
                style={{ outline: "none" }}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-3 inline-flex items-center">
                  <Check className="h-4 w-4" aria-hidden />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-7 items-center justify-center bg-surface text-muted">
            <ChevronDown className="h-4 w-4" aria-hidden />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
