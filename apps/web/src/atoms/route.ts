import { atom } from "jotai";
import type { Location, NavigateFunction, Params } from "react-router";

interface RouteAtom {
  params: Readonly<Params<string>>;
  searchParams: URLSearchParams;
  location: Location;
}

export const routeAtom = atom<RouteAtom>({
  params: {},
  searchParams: new URLSearchParams(),
  location: {
    pathname: "",
    search: "",
    hash: "",
    state: null,
    key: "",
  },
});

// Vite HMR will create new router instance, but RouterProvider always stable

// null until StableRouterProvider mounts; readers navigate with `fn?.(...)`.
export const navigateAtom = atom<{ fn: NavigateFunction | null }>({
  fn: null,
});
