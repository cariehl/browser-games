// Inlines the badge engine and simulated odds into the page.
// Writes index.html (standalone, e.g. GitHub Pages) and dist/artifact.html (body-only fragment).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const page = read('src/page.html')
  .replace('/*__BADGES__*/', () => read('src/badges.js'))
  .replace('/*__ODDS__*/', () => JSON.stringify(JSON.parse(read('src/odds.json'))));

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/artifact.html'), page);
const head = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n';
const [pre, post] = page.split('</style>');
fs.writeFileSync(path.join(root, 'index.html'), head + pre + '</style>\n</head>\n<body>\n' + post + '</body>\n</html>\n');
console.log('Built index.html and dist/artifact.html');
