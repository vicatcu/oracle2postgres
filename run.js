const { readFile, readdir } = require('fs/promises');
const path = require('path');
async function run() {
  const filesToTranslate = await readdir(path.resolve('./', 'oracle-queries'));
  for (const filename of filesToTranslate) {
    if (filename === '.gitkeep') {
      continue;
    }

    process.stdout.write(`Translating "${filename}"...`);
    try {
      let content = await readFile(path.resolve('./', 'oracle-queries', filename), 'utf8');
      content = content.toLowerCase();
      content = convertSubstringFunctions(content);

      process.stdout.write('Complete.\r\n');
    } catch (e) {
      process.stdout.write('Failed.\r\n');
      console.error(e);
    }
  }
}
function convertSubstringFunctions(content) {
  // look for a substring function
  // if you find one, convert it
  // repeat until you don't find one

  return content;
}
run().then(() => console.log('Done.')).catch(e => console.error(e));