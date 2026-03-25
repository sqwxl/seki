export type NavigationError = {
  status: number;
  message: string;
};

export type NavigationRedirect = {
  to: string;
  flash: string;
};

export function buildGameNavigationRedirect(
  gameId: number,
  error: NavigationError,
  returnTo: string,
): NavigationRedirect | undefined {
  switch (error.status) {
    case 401:
      return {
        to: `/login?redirect=${encodeURIComponent(returnTo)}`,
        flash: "Please log in to view this page",
      };
    case 403:
      return {
        to: "/games",
        flash: error.message,
      };
    case 404:
      return {
        to: "/games",
        flash: `The game you were looking for (ID ${gameId}) does not exist`,
      };
    default:
      return undefined;
  }
}
