// Convert text to a URL-safe handle (lowercase, no diacritics, dashes for separators).
// Solène → solene  ·  Blå → bla  ·  Vionna FR → vionna-fr
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")  // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function autoSiblingsHandle(productName: string): string {
  const slug = slugify(productName);
  return slug ? `${slug}-siblings` : "";
}
