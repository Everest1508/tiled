import { Tileset } from "./types";

const cache = new Map<string, HTMLImageElement>();

/** Returns the decoded image for a tileset once it is ready (null before that). */
export function getImage(ts: Tileset): HTMLImageElement | null {
  const hit = cache.get(ts.id);
  return hit && hit.complete && hit.naturalWidth > 0 ? hit : null;
}

export function loadImage(ts: Tileset): Promise<HTMLImageElement> {
  const hit = cache.get(ts.id);
  if (hit && hit.complete && hit.naturalWidth > 0) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      cache.set(ts.id, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Could not read the image for "${ts.name}".`));
    img.src = ts.src;
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read that file."));
    r.readAsDataURL(file);
  });
}
