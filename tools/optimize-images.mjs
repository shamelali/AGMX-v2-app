import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ENTERPRISE_DIR = 'assets/enterprise';
const QUALITY_WEBP = 80;
const QUALITY_AVIF = 75;
const MAX_WIDTH = 1920;

// Ensure output dirs exist
fs.mkdirSync(`${ENTERPRISE_DIR}/webp`, { recursive: true });
fs.mkdirSync(`${ENTERPRISE_DIR}/avif`, { recursive: true });

function hashSuffix(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex').slice(0, 8);
}

async function optimizeEnterprise() {
  const files = fs.readdirSync(ENTERPRISE_DIR).filter(f => f.endsWith('.png'));
  const mapping = {};

  for (const file of files) {
    const inputPath = path.join(ENTERPRISE_DIR, file);
    const baseName = file.replace('.png', '');
    const inputBuffer = fs.readFileSync(inputPath);
    const hash = hashSuffix(inputBuffer);

    const metadata = await sharp(inputBuffer).metadata();
    const width = Math.min(metadata.width, MAX_WIDTH);

    // WebP output
    const webpBuffer = await sharp(inputBuffer)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: QUALITY_WEBP })
      .toBuffer();
    const webpName = `${baseName}.${hash}.webp`;
    fs.writeFileSync(path.join(ENTERPRISE_DIR, 'webp', webpName), webpBuffer);

    // AVIF output
    const avifBuffer = await sharp(inputBuffer)
      .resize({ width, withoutEnlargement: true })
      .avif({ quality: QUALITY_AVIF })
      .toBuffer();
    const avifName = `${baseName}.${hash}.avif`;
    fs.writeFileSync(path.join(ENTERPRISE_DIR, 'avif', avifName), avifBuffer);

    const origSize = (inputBuffer.length / 1024 / 1024).toFixed(2);
    const webpSize = (webpBuffer.length / 1024 / 1024).toFixed(2);
    const avifSize = (avifBuffer.length / 1024 / 1024).toFixed(2);
    const savings = ((1 - webpBuffer.length / inputBuffer.length) * 100).toFixed(1);

    mapping[file] = { webp: webpName, avif: avifName, origSize, webpSize, avifSize, savings };

    console.log(`  ${file}: ${origSize}MB → WebP ${webpSize}MB (-${savings}%) + AVIF ${avifSize}MB`);
  }

  // Keep original PNGs as fallback for og:image compatibility
  console.log('\n  Original PNGs kept as fallback for og:image meta tags');

  return mapping;
}

async function optimizeImagesDir() {
  // Remove redundant format copies, keep only webp + avif
  const dirsToRemove = ['jpeg', 'master', 'web'];
  for (const dir of dirsToRemove) {
    const dirPath = path.join('images', dir);
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      for (const f of files) fs.unlinkSync(path.join(dirPath, f));
      fs.rmdirSync(dirPath);
      console.log(`  Removed images/${dir}/ (${files.length} files)`);
    }
  }

  const remaining = fs.readdirSync('images').filter(f => fs.statSync(path.join('images', f)).isFile());
  console.log(`  Remaining files in images/: ${remaining.join(', ')}`);
}

async function main() {
  console.log('=== Optimizing assets/enterprise/ ===');
  const enterpriseMapping = await optimizeEnterprise();

  console.log('\n=== Optimizing images/ ===');
  await optimizeImagesDir();

  // Write mapping file
  const mappingPath = 'tools/image-hash-mapping.json';
  fs.writeFileSync(mappingPath, JSON.stringify(enterpriseMapping, null, 2));
  console.log(`\n✓ Mapping written to ${mappingPath}`);

  let totalOrig = 0, totalWebp = 0, totalAvif = 0;
  for (const [, m] of Object.entries(enterpriseMapping)) {
    totalOrig += parseFloat(m.origSize);
    totalWebp += parseFloat(m.webpSize);
    totalAvif += parseFloat(m.avifSize);
  }
  console.log(`\n=== Summary ===\nOriginal: ${totalOrig.toFixed(2)}MB\nWebP:     ${totalWebp.toFixed(2)}MB\nAVIF:     ${totalAvif.toFixed(2)}MB\nSaved:    ${(totalOrig - totalWebp).toFixed(2)}MB (${((1 - totalWebp / totalOrig) * 100).toFixed(1)}% reduction)`);
}

main().catch(console.error);