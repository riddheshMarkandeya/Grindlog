/**
 * Copies an off-screen HTMLCanvasElement as a PNG image to the clipboard,
 * falling back cleanly to a local PNG download when clipboard permissions deny image writes.
 */
export function exportCanvasPng(
  canvas: HTMLCanvasElement,
  fallbackFilename: string,
  onDone: () => void
): void {
  canvas.toBlob(async blob => {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      onDone();
    } catch {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fallbackFilename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onDone();
    }
  });
}
