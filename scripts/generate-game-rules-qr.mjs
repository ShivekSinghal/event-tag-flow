import QRCode from 'qrcode';

const url = 'https://pinkd.hashtag.dance/game-rules';
await QRCode.toFile(new URL('../public/game-rules-qr.png', import.meta.url).pathname, url, {
  type: 'png', width: 1200, margin: 4, errorCorrectionLevel: 'H',
  color: { dark: '#000000', light: '#ffffff' },
});
console.log(`Generated game-rules QR for ${url}`);
