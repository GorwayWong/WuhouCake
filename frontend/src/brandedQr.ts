export async function brandedQr(url: string): Promise<string> {
  const QRCode = await import('qrcode');
  const logo = new Image();
  logo.src = '/brand.jpg';
  await logo.decode();
  const canvas = document.createElement('canvas');
  await QRCode.toCanvas(canvas, url, { width: 640, margin: 4, errorCorrectionLevel: 'H' });
  const context = canvas.getContext('2d');
  if (!context) throw new Error('二维码图片生成失败');
  const box = Math.floor(canvas.width * 0.2);
  const left = Math.floor((canvas.width - box) / 2);
  context.fillStyle = '#fff';
  context.fillRect(left, left, box, box);
  const ratio = Math.min(box / logo.naturalWidth, box / logo.naturalHeight);
  const width = logo.naturalWidth * ratio, height = logo.naturalHeight * ratio;
  context.drawImage(logo, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  return canvas.toDataURL('image/png');
}
