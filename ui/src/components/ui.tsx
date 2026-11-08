/** Small UI primitives: buttons, card shell, icon chip, segmented toggle, select, popover. */
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as SelectPrimitive from '@radix-ui/react-select';
import { clsx, type ClassValue } from 'clsx';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

type Variant = 'outline' | 'primary' | 'ghost' | 'dark';
const VARIANTS: Record<Variant, string> = {
  outline: 'border border-border bg-popover hover:bg-muted shadow-emboss-sm',
  primary: 'bg-primary text-primary-foreground hover:opacity-90 shadow-emboss-sm',
  dark: 'bg-foreground text-background hover:opacity-90 shadow-emboss-sm',
  ghost: 'hover:bg-muted text-muted-foreground hover:text-foreground',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'icon' }
>(function Button({ variant = 'outline', size = 'md', className, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition disabled:opacity-45 disabled:pointer-events-none cursor-pointer',
        size === 'md' && 'h-8 px-3 text-[12.5px]',
        size === 'sm' && 'h-7 px-2.5 text-[12px]',
        size === 'icon' && 'size-8',
        VARIANTS[variant],
        className
      )}
      {...props}
    />
  );
});

export function CardShell({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-2xl border border-border/60 bg-card shadow-emboss', className)}>{children}</section>
  );
}

export function IconChip({ icon: Icon, size = 26 }: { icon: LucideIcon; size?: number }) {
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
      style={{ width: size, height: size }}
    >
      <Icon size={size > 24 ? 14 : 13} strokeWidth={2.2} />
    </span>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full bg-secondary/55 p-0.5 shadow-well">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full px-3 py-1 text-[12px] font-medium transition cursor-pointer',
            o.value === value ? 'bg-popover text-foreground shadow-emboss-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectPrimitive.Trigger
        className={cn(
          'inline-flex h-8 items-center justify-between gap-2 rounded-lg border border-border bg-popover px-3 text-[12.5px] shadow-emboss-sm cursor-pointer',
          className
        )}
      >
        <span className="truncate whitespace-nowrap">
          <SelectPrimitive.Value />
        </span>
        <ChevronDown size={14} className="text-muted-foreground" />
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-[var(--radix-select-trigger-width)] rounded-xl border border-border bg-popover p-1 shadow-emboss"
        >
          <SelectPrimitive.Viewport>
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[12.5px] outline-none data-[highlighted]:bg-muted"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check size={13} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({ children, className, align = 'end' }: { children: ReactNode; className?: string; align?: 'start' | 'center' | 'end' }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn('z-50 rounded-xl border border-border bg-popover p-3 shadow-emboss outline-none', className)}
      >
        {children}
        <PopoverPrimitive.Arrow className="fill-popover" />
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="grid min-h-24 place-items-center text-[13px] text-muted-foreground">{children}</div>;
}
