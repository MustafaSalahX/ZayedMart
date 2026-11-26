import React from 'react';
import { cn } from '../../lib/utils.js';

/**
 * Shadcn New York responsive data table primitives with RTL logical alignment
 * and theme-scoped semantic borders/surfaces.
 */
const Table = React.forwardRef(function Table(
  { className, wrapperClassName, ...props },
  ref
) {
  return (
    <div
      className={cn(
        'relative w-full overflow-x-auto rounded-[var(--g-radius-card)] border border-line bg-surface shadow-[var(--g-shadow-sm)]',
        wrapperClassName
      )}
    >
      <table
        ref={ref}
        className={cn('w-full caption-bottom text-sm text-start border-collapse', className)}
        {...props}
      />
    </div>
  );
});
Table.displayName = 'Table';

const TableHeader = React.forwardRef(function TableHeader(
  { className, ...props },
  ref
) {
  return (
    <thead
      ref={ref}
      className={cn('bg-surface-2/60 border-b border-line', className)}
      {...props}
    />
  );
});
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef(function TableBody(
  { className, ...props },
  ref
) {
  return (
    <tbody
      ref={ref}
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
});
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef(function TableFooter(
  { className, ...props },
  ref
) {
  return (
    <tfoot
      ref={ref}
      className={cn(
        'border-t border-line bg-surface-2/60 font-medium [&>tr]:last:border-b-0',
        className
      )}
      {...props}
    />
  );
});
TableFooter.displayName = 'TableFooter';

const TableRow = React.forwardRef(function TableRow(
  { className, ...props },
  ref
) {
  return (
    <tr
      ref={ref}
      className={cn(
        'border-b border-line-subtle transition-[background-color] duration-150 hover:bg-surface-tint data-[state=selected]:bg-surface-tint',
        className
      )}
      {...props}
    />
  );
});
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef(function TableHead(
  { className, ...props },
  ref
) {
  return (
    <th
      ref={ref}
      className={cn(
        'h-11 px-3.5 text-start align-middle text-xs font-semibold text-ink-muted whitespace-nowrap',
        className
      )}
      {...props}
    />
  );
});
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef(function TableCell(
  { className, ...props },
  ref
) {
  return (
    <td
      ref={ref}
      className={cn('px-3.5 py-3 align-middle text-sm', className)}
      {...props}
    />
  );
});
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef(function TableCaption(
  { className, ...props },
  ref
) {
  return (
    <caption
      ref={ref}
      className={cn('mt-3 text-xs text-ink-muted', className)}
      {...props}
    />
  );
});
TableCaption.displayName = 'TableCaption';

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
};
export default Table;
