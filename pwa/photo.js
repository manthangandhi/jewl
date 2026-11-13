/** Phone / laptop photo capture: shrink the picture before it is sent to Google Drive. */

export const PHOTO_MAX_EDGE = 1280;
export const PHOTO_QUALITY = 0.78;

export function fitWithin(width, height, max = PHOTO_MAX_EDGE) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!w || !h) return { width: 0, height: 0 };
  const longest = Math.max(w, h);
  if (longest <= max) return { width: w, height: h };
  const scale = max / longest;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export function photoFileName({ customerName = '', kind = 'sale', date = '', stamp = Date.now() } = {}) {
  const who = String(customerName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'customer';
  const day = String(date || '').slice(0, 10) || new Date(stamp).toISOString().slice(0, 10);
  return `${day}-${String(kind).toLowerCase()}-${who}-${stamp}`;
}

export function splitDataUrl(dataUrl) {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('That photo could not be read. Try again.');
  return { mime: m[1], base64: m[2] };
}

function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).catch(() => loadImageElement(file));
  }
  return loadImageElement(file);
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a photo.')); };
    img.src = url;
  });
}

/** Resize to a JPEG data URL (about 100–250 KB) so saving on a slow connection stays quick. */
export async function compressImage(file, { max = PHOTO_MAX_EDGE, quality = PHOTO_QUALITY } = {}) {
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Choose a photo (picture file).');
  const bitmap = await loadBitmap(file);
  const srcW = bitmap.width || bitmap.naturalWidth;
  const srcH = bitmap.height || bitmap.naturalHeight;
  const { width, height } = fitWithin(srcW, srcH, max);
  if (!width) throw new Error('That photo is empty.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === 'function') bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return { dataUrl, ...splitDataUrl(dataUrl) };
}
