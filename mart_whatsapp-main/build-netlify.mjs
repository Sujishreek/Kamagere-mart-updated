import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const apiUrl = process.env.KM_API_URL;

if (!apiUrl) {
  throw new Error('Set KM_API_URL to the deployed Google Apps Script /exec URL.');
}

const parsedApiUrl = new URL(apiUrl);
if (parsedApiUrl.protocol !== 'https:' || !parsedApiUrl.pathname.endsWith('/exec')) {
  throw new Error('KM_API_URL must be an HTTPS Google Apps Script /exec URL.');
}

const includes = [
  'Stylesheet',
  'AnimationStyles',
  'ImageData',
  'ApiBridge',
  'DataScript',
  'AppScript',
  'AppScriptContinuation',
  'AnimationScript'
];

let html = fs.readFileSync(path.join(root, 'UserPortal.html'), 'utf8');

for (const name of includes) {
  const marker = `<?!= include('${name}') ?>`;
  if (!html.includes(marker)) {
    throw new Error(`Expected template include for ${name} in UserPortal.html.`);
  }
  const partial = fs.readFileSync(path.join(root, `${name}.html`), 'utf8');
  html = html.replace(marker, () => partial);
}

html = html.replace(
  /<\?!=\s*JSON\.stringify\(route\s*\|\|\s*''\)\s*\?>/,
  JSON.stringify(process.env.KM_INITIAL_ROUTE || '')
);
html = html.replace(
  '<!-- JavaScript (order matters) -->',
  `<!-- JavaScript (order matters) -->\n    <script>window.KM_API_URL = ${JSON.stringify(apiUrl)};</script>`
);

const unresolvedTemplate = html.match(/<\?!=[\s\S]*?\?>/);
if (unresolvedTemplate) {
  throw new Error(`Unresolved Apps Script template syntax: ${unresolvedTemplate[0]}`);
}

const outputDir = path.join(root, 'dist');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'index.html'), html);
console.log(`Built ${path.join(outputDir, 'index.html')}`);