const { readFile, readdir, writeFile } = require('fs/promises');
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
      content = convertSubstringFunctions(content);

      await writeFile(path.resolve('./', 'postgres-queries', filename), content, 'utf8');

      process.stdout.write('Complete.\r\n');
    } catch (e) {
      process.stdout.write('Failed.\r\n');
      console.error(e);
    }
  }
}
function convertSubstringFunctions(content) {
  const ret = [];
  let fromEncountered = false;
  let lines = content.split(/[\n\r]/);
  const repMap = [];
  for (const line of lines) {
    let newLine = line;
    if (line.toLowerCase().includes('from')) {
      fromEncountered = true;
    }

    if (line.toLowerCase().includes('dbms_lob')) {
      // handle dbms_lob

    } else {
      let re = /\.([a-z0-9_]+)[, ]/i;
      let match = re.exec(line);
      if (match?.[1]) {
        const oldString = '.' + match[1]
        const newString = oldString.toLowerCase();
        repMap.push({oldString, newString, match: match[1]});
      }

      re = /([a-z0-9_]+)\./i;
      match = re.exec(line);
      if (match?.[1]) {
        const oldString = match[1] + '.';
        const newString = oldString.toLowerCase();
        repMap.push({oldString, newString, match: match[1]});
      }


      for (const rep of repMap) {
        const oString = rep.oldString;
        const nString = rep.newString;
        const match = rep.match;
        newLine = newLine.replace(oString, nString);
        if (!newLine.toLowerCase().includes(nString + ' as ') && !fromEncountered) {
          // if there's not an 'AS' then add one
          newLine = newLine.replace(nString , `${nString} AS "${match}"`);
        }
      }
    }
  }

  return ret.join('\n');
}
run().then(() => console.log('Done.')).catch(e => console.error(e));