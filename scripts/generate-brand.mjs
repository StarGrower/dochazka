// Vygeneruje PNG ikonu a obrázek pro splash ze zdrojových SVG v
// assets/brand/ (etapa 3 - ikona a logo). sharp není závislost appky:
//   npm i --no-save sharp && node scripts/generate-brand.mjs
import sharp from 'sharp';

const jobs = [
  // Ikona: plně neprůhledná (iOS průhlednost u ikony nesnese).
  { src: 'assets/brand/icon.svg', out: 'assets/images/icon.png', size: 1024, flatten: true },
  { src: 'assets/brand/splash.svg', out: 'assets/images/splash-icon.png', size: 1024, flatten: false },
  { src: 'assets/brand/icon.svg', out: 'assets/images/favicon.png', size: 48, flatten: true },
];

for (const job of jobs) {
  let img = sharp(job.src, { density: 1024 }).resize(job.size, job.size);
  if (job.flatten) img = img.flatten({ background: '#131311' }).removeAlpha();
  await img.png().toFile(job.out);
  console.log(`${job.out} (${job.size}×${job.size})`);
}
