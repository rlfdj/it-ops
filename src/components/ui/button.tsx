import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

// Restyled to the design system: classes live in globals.css (.btn, .pri, .ghost, .sm, .icon).
const buttonVariants = cva("btn [&_svg]:pointer-events-none [&_svg]:shrink-0", {
  variants: {
    variant: {
      primary: "pri",
      danger: "pri danger",
      secondary: "",
      ghost: "ghost",
    },
    size: {
      default: "",
      sm: "sm",
      icon: "icon",
      "icon-sm": "sm icon",
    },
  },
  defaultVariants: {
    variant: "secondary",
    size: "default",
  },
});

function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      type={asChild ? undefined : (type ?? "button")}
      {...props}
    />
  );
}

export { Button, buttonVariants };
