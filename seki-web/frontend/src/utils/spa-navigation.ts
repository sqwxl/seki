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
