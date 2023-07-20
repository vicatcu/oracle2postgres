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
    const keywords = [
      {regex: /(\b)(select)(\b)/igm, replace: 'SELECT'},
      {regex: /(\b)(from)(\b)/igm, replace: 'FROM'},
      {regex: /(\b)(left)(\b)/igm, replace: 'LEFT'},
      {regex: /(\b)(inner)(\b)/igm, replace: 'INNER'},
      {regex: /(\b)(right)(\b)/igm, replace: 'RIGHT'},
      {regex: /(\b)(join)(\b)/igm,replace: 'JOIN'},
      {regex: /(\b)(where)(\b)/igm, replace: 'WHERE'},
      {regex: /(\b)(in)(\b)/igm, replace: 'IN'},
      {regex: /(\b)(on)(\b)/igm, replace: 'ON'},
      {regex: /(\b)(as)(\b)/igm, replace: 'AS'},
      {regex: /(\b)(and)(\b)/igm, replace: 'AND'},
      {regex: /(\b)(or)(\b)/igm, replace: 'OR'},
      {regex: /(\b)(is)(\b)/igm, replace: 'IS'},
      {regex: /(\b)(not)(\b)/igm, replace: 'NOT'},
      {regex: /(\b)(null)(\b)/igm, replace: 'NULL'},
      {regex: /(\b)(when)(\b)/igm, replace: 'WHEN'},
      {regex: /(\b)(then)(\b)/igm, replace: 'THEN'},
      {regex: /(\b)(else)(\b)/igm, replace: 'ELSE'},
      {regex: /(\b)(end)(\b)/igm, replace: 'END'},
      {regex: /(\b)(like)(\b)/igm, replace: 'LIKE'},
    ];

    let newLine = line.trim();
    for (const keyword of keywords) {
      const re = keyword.regex;
      const rep = keyword.replace;
      newLine = newLine.replace(re, `$1${rep}$3`);
    }

    if (line.toLowerCase().includes('from')) {
      fromEncountered = true;
    }

    // handle dbms_lob
    if (line.toLowerCase().includes('dbms_lob')) {
      const regex = /(DBMS_LOB.SUBSTR\s*\()("?)([^"]+)("?)(,\s*)([0-9]+)(,\s*)([0-9+])(\))/i;
      const replace = "substring($3, $8, $6)";
      const match = regex.exec(newLine);
      newLine = newLine.replace(regex, replace);
      newLine = newLine.replace(match[3] + ',', match[3].toLowerCase() + ',');
    }

    let re = /\.([a-z0-9_]+)([, ]|$)/i;
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

    re = /join ([a-z0-9_]+)/i;
    match = re.exec(line);
    if (match?.[1]) {
      const oldString = match[1];
      const newString = oldString.toLowerCase();
      repMap.push({oldString, newString, match: match[1]});
    }

    for (const rep of repMap) {
      const oString = rep.oldString;
      const nString = rep.newString;
      const match = rep.match;
      newLine = newLine.replace(oString, nString);
      if (!nString.endsWith('.')) {
        if (!newLine.toLowerCase().includes(nString + ' as ') && !fromEncountered) {
          // if there's not an 'AS' then add one
          newLine = newLine.replace(nString , `${nString} AS "${match}"`);
        }
      }
    }

    // if there's an AS clause and it's redundant, remove the AS clause
    const argv = process.argv;

    if (process.argv.includes('--no-alias')) {
      if (newLine.toLowerCase().includes(' as ')) {
        const regex = /(\.?)([a-z0-9_]+)(\s+)(as)(\s+)("?)([a-z0-9_]+)("?)(,?)/i;
        const match = regex.exec(newLine);
        if (match) {
          if (match[2].toLowerCase() === match[7].toLowerCase()) {
            // then remove the as clause
            newLine = newLine.replace(/([^ ]+)(\s+)(AS)([^,]+)(,?)/, '$1$5');
          } else {
            newLine = newLine.replace(`${match[4]}${match[5]}${match[6]}${match[7]}`, `${match[4]}${match[5]}${match[6]}${match[7].toLowerCase()}`)
          }
        }
      }
    }

    ret.push(newLine);
  }

  return ret.join('\n');
}
run().then(() => console.log('Done.')).catch(e => console.error(e));