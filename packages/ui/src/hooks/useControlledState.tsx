import * as React from "react";

import { useRefValue } from "./useRefValue";

interface CommonControlledStateProps<T> {
  value?: T;
  defaultValue?: T;
}

export function useControlledState<T, Rest extends any[] = []>(
  props: CommonControlledStateProps<T> & {
    onChange?: (value: T, ...args: Rest) => void;
  },
): readonly [T, (next: T, ...args: Rest) => void] {
  const { value, defaultValue, onChange } = props;
  const isControlled = value !== undefined;
  const [internalState, setInternalState] = React.useState<T>(() =>
    isControlled ? value : (defaultValue as T),
  );
  const onChangeRef = useRefValue(onChange);

  const setState = React.useCallback(
    (next: T, ...args: Rest) => {
      if (!isControlled) {
        setInternalState(next);
      }
      onChangeRef.current?.(next, ...args);
    },
    [isControlled, onChangeRef],
  );

  return [isControlled ? value : internalState, setState] as const;
}
