/**
 * Checks the Node version before anything tries to use node:sqlite.
 *
 * Without this the failure is `bad option: --experimental-sqlite`, printed by
 * node itself before a line of the project runs, which says nothing about what
 * to install. Runs as a prestart hook and from the demo script, both of which
 * start without that flag.
 */
'use strict';

const REQUIRED = [22, 5, 0];

function parse(version) {
  return version.replace(/^v/, '').split('.').map(Number);
}

function isOlder([major, minor, patch], [rMajor, rMinor, rPatch]) {
  if (major !== rMajor) return major < rMajor;
  if (minor !== rMinor) return minor < rMinor;
  return patch < rPatch;
}

const current = parse(process.versions.node);

if (isOlder(current, REQUIRED)) {
  const want = REQUIRED.join('.');
  process.stderr.write([
    '',
    `Besy требует Node.js ${want} или новее — у вас v${process.versions.node}.`,
    '',
    'Проект хранит данные во встроенном модуле node:sqlite, который появился',
    `в Node ${want}. Без него сервер не запустится.`,
    '',
    'Поставить рядом с текущим, ничего не заменяя:',
    '',
    '  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash',
    '  source ~/.bashrc',
    '  nvm install 22',
    '',
    'Или системно (Debian/Ubuntu, заменит текущий Node):',
    '',
    '  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -',
    '  apt-get install -y nodejs',
    '',
  ].join('\n') + '\n');
  process.exit(1);
}

module.exports = { REQUIRED };
