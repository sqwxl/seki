export function setHead(title: string, description?: string): void {
  document.title = title;

  const ogTitle = document.querySelector('meta[property="og:title"]');

  if (ogTitle) {
    ogTitle.setAttribute("content", title);
  }

  const ogDescription = document.querySelector(
    'meta[property="og:description"]',
  );

  if (ogDescription && description) {
    ogDescription.setAttribute("content", description);
  }
}

export function pageTitle(page: string): string {
  return `Seki - ${page}`;
}
