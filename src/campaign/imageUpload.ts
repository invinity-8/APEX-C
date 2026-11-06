import { imageDimensions, safeDimensions } from './images';
import type { SceneMap } from './maps';

function canvas(width: number, height: number) { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; }
function encode(c: HTMLCanvasElement) {
  let image = c.toDataURL('image/webp', .82);
  if (image.length > 3_460_000) image = c.toDataURL('image/webp', .55);
  if (image.length > 3_460_000) throw new Error('This map remains too large after processing. Use a smaller image.');
  const small = canvas(256, Math.max(1, Math.round(c.height / c.width * 256)));
  if (small.height > 256) { small.width = Math.max(1, Math.round(256 * c.width / c.height)); small.height = 256; }
  small.getContext('2d')!.drawImage(c, 0, 0, small.width, small.height);
  return { image, thumbnail: small.toDataURL('image/webp', .75) };
}
export async function prepareMapUpload(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 24_000_000) throw new Error('Choose a JPG, PNG or WebP image up to 24 MB.');
  const header = new Uint8Array(await file.slice(0, 131072).arrayBuffer());
  const d = imageDimensions(header, file.type);
  if (!safeDimensions(d, 40_000_000)) throw new Error('Invalid or oversized map dimensions (maximum 40 megapixels / 16,384 px per side).');
  const ratio = Math.min(1, 2048 / Math.max(d.width, d.height));
  const width = Math.max(1, Math.round(d.width * ratio)), height = Math.max(1, Math.round(d.height * ratio));
  const bitmap = await createImageBitmap(file, { resizeWidth: width, resizeHeight: height });
  try { const c = canvas(width, height); c.getContext('2d')!.drawImage(bitmap, 0, 0, width, height); return { ...encode(c), width, height }; }
  finally { bitmap.close(); }
}

/** Bake revealed rectangles into a separate raster. Players never receive the GM source URL. */
export async function playerSafeBackground(map: SceneMap, sourceUrl: string) {
  const response = await fetch(sourceUrl); if (!response.ok) throw new Error('Could not load the private source map.');
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const c = canvas(bitmap.width, bitmap.height), ctx = c.getContext('2d')!;
    ctx.fillStyle = '#11151b'; ctx.fillRect(0, 0, c.width, c.height);
    if (map.revealBackground) ctx.drawImage(bitmap, 0, 0);
    else for (const n of map.nodes.filter(n => n.kind === 'area' && n.visible)) {
      const x = Math.max(0, n.x / map.width * c.width), y = Math.max(0, n.y / map.height * c.height);
      const w = Math.min(c.width - x, n.width / map.width * c.width), h = Math.min(c.height - y, n.height / map.height * c.height);
      if (w > 0 && h > 0) ctx.drawImage(bitmap, x, y, w, h, x, y, w, h);
    }
    return encode(c);
  } finally { bitmap.close(); }
}
