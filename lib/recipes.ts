export type RecipeInput = {
  id?: string;
  title?: string;
  url: string;
  category?: string;
  subcategory?: string;
  tags?: string[];
  notes?: string;
  favorite?: boolean;
  source?: string;
  addedAt?: string;
  messageAt?: string;
  unavailable?: boolean;
  categoryManual?: boolean;
  tagsManual?: boolean;
};

export function normalizeUrl(raw: string) {
  try {
    const url = new URL(raw.trim().replace(/[)>\],.!?]+$/, ""));
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.trim().replace(/[)>\],.!?]+$/, "");
  }
}

export function sourceFor(url: string) {
  if (/instagram\.com/i.test(url)) return "Instagram";
  if (/(facebook\.com|fb\.watch)/i.test(url)) return "Facebook";
  return "Other";
}
