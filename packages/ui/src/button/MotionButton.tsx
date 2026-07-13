import type { HTMLMotionProps } from "motion/react";
import { m } from "motion/react";

export const MotionButtonBase = ({
  ref,
  children,
  type = "button",
  ...rest
}: HTMLMotionProps<"button"> & {
  ref?: React.RefObject<HTMLButtonElement>;
}) => {
  return (
    <m.button
      initial={true}
      whileFocus={{ scale: 1.02 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.95 }}
      type={type}
      {...rest}
      ref={ref}
    >
      {children}
    </m.button>
  );
};

MotionButtonBase.displayName = "MotionButtonBase";
