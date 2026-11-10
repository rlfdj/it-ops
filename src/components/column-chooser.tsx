"use client";

import { Columns3Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** "Columns" menu for a table: tick the columns to show (B-39). */
export function ColumnChooser({
  columns,
  hidden,
  onToggle,
  onReset,
}: {
  columns: { id: string; label: string }[];
  hidden: string[];
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" aria-label="Choose columns">
          <Columns3Icon size={13} aria-hidden /> Columns
          {hidden.length ? <span className="muted"> · {hidden.length} hidden</span> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        {columns.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.id}
            checked={!hidden.includes(c.id)}
            // Keep the menu open so several columns can be toggled in one go.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onToggle(c.id)}
          >
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
        {hidden.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onReset}>Show all columns</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
