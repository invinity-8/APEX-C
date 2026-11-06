/** Header-only image validation; never decode an unbounded upload on the server. */
export function imageDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (i: number, n: number) => String.fromCharCode(...bytes.slice(i, i + n));
  if (mime === 'image/png' && bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b) && ascii(12, 4) === 'IHDR') return { width: v.getUint32(16), height: v.getUint32(20) };
  if (mime === 'image/webp' && bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4);
    if (kind === 'VP8X') return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    if (kind === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) return { width: v.getUint16(26, true) & 16383, height: v.getUint16(28, true) & 16383 };
    if (kind === 'VP8L' && bytes[20] === 47) { const bits = v.getUint32(21, true); return { width: (bits & 16383) + 1, height: ((bits >>> 14) & 16383) + 1 }; }
  }
  if (mime === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let p = 2;
    while (p + 9 < bytes.length) {
      if (bytes[p++] !== 255) return null;
      while (bytes[p] === 255) p++;
      const marker = bytes[p++]; if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (p + 2 > bytes.length) return null;
      const length = v.getUint16(p); if (length < 2) return null;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) return length >= 7 && p + 7 <= bytes.length ? { height: v.getUint16(p + 3), width: v.getUint16(p + 5) } : null;
      p += length;
    }
  }
  return null;
}

export function safeDimensions(d: { width: number; height: number } | null, maxPixels = 16_777_216): d is { width: number; height: number } {
  return !!d && d.width > 0 && d.height > 0 && d.width <= 16384 && d.height <= 16384 && d.width * d.height <= maxPixels;
}
