import { createContext, forwardRef, useContext } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';

/** Element tooltips are portalled into, so scoped styles apply (modal / fullscreen). */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  icon: ReactNode;
  /** Pressed state for toggle buttons. */
  pressed?: boolean;
  /** Keyboard shortcut hint shown in the tooltip. */
  shortcut?: string;
  showLabel?: boolean;
}

/** Icon-only button with an accessible name and a Radix tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, pressed, shortcut, showLabel, className, ...rest },
  ref,
) {
  const container = useContext(PortalContainerContext);
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          className={`dsc-btn${showLabel ? ' dsc-btn--label' : ''}${className ? ` ${className}` : ''}`}
          {...rest}
        >
          {icon}
          {showLabel && <span>{label}</span>}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal container={container ?? undefined}>
        <Tooltip.Content className="dsc-tooltip" sideOffset={6} collisionPadding={8}>
          {label}
          {shortcut && <kbd className="dsc-kbd">{shortcut}</kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
});

export function Separator() {
  return <span className="dsc-sep" role="separator" aria-orientation="vertical" />;
}
