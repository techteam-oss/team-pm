/**
 * Shrink a photo before upload so the 1 GB free storage lasts: at most `max` pixels on the long
 * side, re-encoded as WebP (JPEG where the browser can't make WebP). GIFs, non-images and files
 * that would not get smaller are returned unchanged.
 */
export async function shrinkImage(file: File, max = 1920, quality = 0.82): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 150 * 1024) return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const toBlob = (type: string) => new Promise<Blob | null>(res => canvas.toBlob(res, type, quality))
    let blob = await toBlob('image/webp')
    if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg')
    if (!blob || blob.size >= file.size) return file
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg'
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.' + ext, { type: blob.type })
  } catch {
    return file
  }
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}
