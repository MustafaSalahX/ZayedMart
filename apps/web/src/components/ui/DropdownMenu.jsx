import React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '../../lib/utils.js';
import Icon from './Icon.jsx';

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
const DropdownMenuSub = DropdownMenuPrimitive.Sub;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuSubTrigger = React.forwardRef(function DropdownMenuSubTrigger(
  { className, inset = false, children, ...props },
  ref
) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      ref={ref}
      className={cn(
        'flex min-h-[44px] sm:min-h-[40px] cursor-pointer select-none items-center gap-2 rounded-[var(--g-radius-sm)] px-2.5 py-1.5 text-xs sm:text-sm font-medium text-popover-foreground outline-none transition-[background-color,color] duration-150 focus:bg-surface-2 data-[state=open]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
        inset && 'ps-8',
        className
      )}
      {...props}
    >
      {children}
      <Icon
        name="chevron_left"
        size={15}
        className="ms-auto text-ink-muted ltr:rotate-180"
      />
    </DropdownMenuPrimitive.SubTrigger>
  );
});
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = React.forwardRef(function DropdownMenuSubContent(
  { className, sideOffset = 6, ...props },
  ref
) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'g-radix-popover z-[72] min-w-[10.5rem] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-[var(--g-radius-md)] border border-border bg-popover p-1 text-popover-foreground shadow-[var(--g-shadow-elevated)]',
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName;

const DropdownMenuContent = React.forwardRef(function DropdownMenuContent(
  { className, sideOffset = 8, ...props },
  ref
) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'g-radix-popover z-[70] min-w-[12.5rem] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-[var(--g-radius-md)] border border-border bg-popover p-1 text-popover-foreground shadow-[var(--g-shadow-elevated)]',
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef(function DropdownMenuItem(
  { className, inset = false, destructive = false, ...props },
  ref
) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex min-h-[44px] sm:min-h-[40px] cursor-pointer select-none items-center gap-2 rounded-[var(--g-radius-sm)] px-2.5 py-1.5 text-xs sm:text-sm font-medium outline-none transition-[background-color,color] duration-150 data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
        destructive
          ? 'text-danger focus:bg-danger-bg focus:text-danger'
          : 'text-popover-foreground focus:bg-surface-2 focus:text-ink',
        inset && 'ps-8',
        className
      )}
      {...props}
    />
  );
});
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuLabel = React.forwardRef(function DropdownMenuLabel(
  { className, inset = false, ...props },
  ref
) {
  return (
    <DropdownMenuPrimitive.Label
      ref={ref}
      className={cn(
        'px-2.5 py-1.5 text-xs font-semibold text-ink-muted',
        inset && 'ps-8',
        className
      )}
      {...props}
    />
  );
});
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = React.forwardRef(function DropdownMenuSeparator(
  { className, ...props },
  ref
) {
  return (
    <DropdownMenuPrimitive.Separator
      ref={ref}
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
});
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
};
export default DropdownMenu;
