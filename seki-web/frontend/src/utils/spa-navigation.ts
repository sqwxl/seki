export const SPA_NAVIGATE_EVENT = "seki:navigate";

export type SpaNavigateDetail = {
  to: string;
  replace?: boolean;
  reload?: boolean;
};

export function requestSpaNavigation(
  to: string,
  options: Omit<SpaNavigateDetail, "to"> = {},
): void {
  window.dispatchEvent(
    new CustomEvent<SpaNavigateDetail>(SPA_NAVIGATE_EVENT, {
      detail: { to, ...options },
    }),
  );
}

export function authUrl(mode: "login" | "register"): string {
  const current = window.location.pathname + window.location.search;
  // Don't redirect back to auth pages or root
  if (
    current === "/" ||
    current.startsWith("/login") ||
    current.startsWith("/register")
  ) {
    return `/${mode}`;
  }
  return `/${mode}?redirect=${encodeURIComponent(current)}`;
}
