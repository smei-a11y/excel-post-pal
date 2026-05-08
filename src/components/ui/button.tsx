import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// BoConcept-inspired: rectangular, sharp-edged buttons. Uppercase + wide tracking
// for primary/secondary, no drop shadows.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary: solid charcoal/black with white uppercase text
        default:
          "bg-primary text-primary-foreground uppercase tracking-widest hover:bg-foreground/85",
        destructive:
          "bg-destructive text-destructive-foreground uppercase tracking-widest hover:bg-destructive/90",
        // Secondary / Ghost-outline: transparent with thin 1px black border
        outline:
          "border border-foreground bg-transparent text-foreground uppercase tracking-widest hover:bg-foreground hover:text-background",
        secondary:
          "border border-foreground bg-transparent text-foreground uppercase tracking-widest hover:bg-foreground hover:text-background",
        ghost:
          "text-foreground hover:bg-foreground/5",
        link: "text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-6 py-2",
        sm: "h-9 px-4 text-[11px]",
        lg: "h-12 px-10 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
