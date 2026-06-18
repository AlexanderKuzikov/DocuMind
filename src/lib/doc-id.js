import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);

  await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });

  return hash.digest('hex');
}

export async function makeDocId(document) {
  const files = Array.isArray(document.files) ? document.files : [];
  const fileEntries = await Promise.all(files.map(async (file) => {
    const stat = await fsPromises.stat(file.path);
    return {
      size: stat.size,
      hash: await hashFile(file.path)
    };
  }));

  fileEntries.sort((a, b) => a.hash.localeCompare(b.hash));

  const contentDigest = crypto
    .createHash('sha256')
    .update(JSON.stringify(fileEntries))
    .digest('hex');

  const runTime = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);

  const runSuffix = crypto.randomBytes(2).toString('hex');

  return `dm-${runTime}-${contentDigest.slice(0, 12)}-${runSuffix}`;
}

export function isValidDocId(value) {
  return /^dm-\d{14}-[a-f0-9]{12}-[a-f0-9]{4}$/.test(String(value || ''));
}
