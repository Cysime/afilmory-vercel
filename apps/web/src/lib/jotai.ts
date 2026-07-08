import type { PrimitiveAtom } from "jotai";
import { useAtom, useAtomValue, useSetAtom } from "jotai";

/**
 * @param atom - jotai
 * @returns - [atom, useAtom, useAtomValue, useSetAtom]
 */
export const createAtomHooks = <T>(atom: PrimitiveAtom<T>) =>
  [
    atom,
    () => useAtom(atom),
    () => useAtomValue(atom),
    () => useSetAtom(atom),
  ] as const;
