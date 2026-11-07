/**
 * Browser-only: turns a PNG/JPG/WebP picture or the first page of a PDF into RGBA pixels for
 * sampleImageToHex(). Everything stays on the device; nothing is uploaded.
 */
const MAX_SIDE = 1024;
export const MAX_PICTURE_BYTES = 15 * 1024 * 1024;

export async function loadPictureForSampling(file: File): Promise<{ pixels: Uint8ClampedArray; width: number; height: number }> {
  if (file.size > MAX_PICTURE_BYTES) throw new Error('The file is larger than 15 MB.');
  const head = new TextDecoder('latin1').decode(new Uint8Array(await file.slice(0, 1024).arrayBuffer()));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot read pictures.');
  if (head.includes('%PDF-')) {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    try {
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(4, MAX_SIDE / Math.max(base.width, base.height)) });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: ctx, viewport, canvas } as unknown as Parameters<typeof page.render>[0]).promise;
    } finally {
      void doc.cleanup();
    }
  } else {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Choose a PNG, JPG or WebP picture, or a PDF.');
    const bitmap = await createImageBitmap(file);
    const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * k));
    canvas.height = Math.max(1, Math.round(bitmap.height * k));
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
  }
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { pixels: data.data, width: canvas.width, height: canvas.height };
}
