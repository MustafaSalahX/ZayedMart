import React from 'react';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { cn } from '../../lib/utils.js';

/**
 * Accessible horizontal/vertical divider backed by `@radix-ui/react-separator`.
 */
const Separator = React.forwardRef(function Separator(
  { className, orientation = 'horizontal', decorative = true, ...props },
  ref
) {
  return (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'bg-border shrink-0',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className
      )}
      {...props}
    />
  );
});

Separator.displayName = SeparatorPrimitive.Root.displayName;

export { Separator };
export default Separator;
