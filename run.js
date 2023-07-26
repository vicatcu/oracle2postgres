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
  let selectEncountered = false;
  const specials = ['(', '|', '<', '>', '='];

  let lines = content.trim().split(/[\n\r]+/);
  if (lines[0].toLowerCase().startsWith('select')) {
    const regex = /(select)(\s+)(.*)/i;
    const match = regex.exec(lines[0]);
    if (match?.[3]) {
      lines = ['select', match[3]].concat(lines.slice(1));
    }
  }

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

    const isSelect = line.toLowerCase().includes('select');
    if (isSelect) {
      selectEncountered = true;
    }

    const isFrom = line.toLowerCase().includes('from');
    if (isFrom) {
      fromEncountered = true;
      // make sure the previous row doesn't end with a comma
      if (ret[ret.length - 1].trim().endsWith(',')) {
        ret[ret.length - 1] = ret[ret.length - 1].trim().slice(0, -1);
      }
    }

    // handle dbms_lob
    if (line.toLowerCase().includes('dbms_lob')) {
      const regex = /(DBMS_LOB.SUBSTR\s*\()("?)([^"]+)("?)(,\s*)([0-9]+)(,\s*)([0-9+])(\))/i;
      const replace = "substring($3, $8, $6)";
      const match = regex.exec(newLine);
      newLine = newLine.replace(regex, replace);
      newLine = newLine.replace(match[3] + ',', match[3].toLowerCase() + ',');
    }

    if (line.toLowerCase().includes('to_char')) {
      const regex = /to_char\s*\(\s*([^) ]+)\s*\)/i;
      const match = regex.exec(newLine);
      const replace = `cast(${match[1]} AS text)`;
      newLine = newLine.replace(regex, replace);
      newLine = newLine.replace(match[1] + ':', match[1].toLowerCase() + ':');
    }

    if (line.toLowerCase().includes('nvl')) {
      const regex = /(nvl\s*\(\s*)([^)\, ]+)(\s*,\s*)(.+)(\s*\))/i;
      const match = regex.exec(newLine);
      const replace = `coalesce(${match[2]}, ${match[4]})`;
      newLine = newLine.replace(regex, replace);
      if (match[2].includes('.')) {
        newLine = newLine.replace(match[2] + ',', match[2].toLowerCase() + ',');
      }
    }

    if (line.toLowerCase().includes('sysdate')) {
      const regex = /sysdate\s*([+\-])\s*([0-9]+)/ig;
      const replace = "(current_timestamp $1 (interval '$2' day))";
      newLine = newLine.replace(regex, replace);
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
          let skip = false;
          for (const special of specials) {
            if (newLine.includes(special)) {
              skip = true;
              break;
            }
          }

          if (!skip) {
            // if there's not an 'AS' then add one
            newLine = newLine.replace(nString , `${nString} AS "${match}"`);
          }
        }
      }
    }

    // if there's an AS clause and it's redundant, remove the AS clause
    const argv = process.argv;
    if (argv.includes('--no-alias')) {
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


    let extraLinesToPush = [];
    let newLines = [];
    let alreadyPushed = false;
    if (!argv.includes('--no-extra-aliases')) {
      if (newLine.toLowerCase().includes(' as ')) {
        const regex = /(.*)( as )(.*)/i;
        const match = regex.exec(newLine);
        let alias = match[3].trim();
        const newLineEndsWithComma = alias.trim().endsWith(',');
        const extra = newLineEndsWithComma ? '' : ',';
        const newLineStartsWithElse = newLine.toLowerCase().startsWith('else ') || newLine.toLowerCase().startsWith('end ');;

        if (newLineStartsWithElse) {
          // seek backwards for the first line that ends with a comma
          // the next line to the end are the lines that need to be copied
          const idxOfMostRecentComma = ret.slice().reverse().findIndex(v => v.endsWith(','));
          extraLinesToPush = ret.slice(ret.length - idxOfMostRecentComma);
        }

        ret.push(newLine.replace(' AS ' + alias, ' AS ' + alias + extra));
        alreadyPushed = true;

        if (alias.toUpperCase() !== alias) {
          for (const line of extraLinesToPush) {
            newLines.push(line);
          }
          if (extraLinesToPush.length > 0) {
            newLines.push(newLine.replace(' AS ' + alias, ' AS ' + alias.toUpperCase() + extra));
          } else {
            ret.push(newLine.replace(' AS ' + alias, ' AS ' + alias.toUpperCase() + extra));
          }
        }

        if (alias.toLowerCase() !== alias) {
          for (const line of extraLinesToPush) {
            newLines.push(line);
          }
          if (extraLinesToPush.length > 0) {
            newLines.push(newLine.replace(' AS ' + alias, ' AS ' + alias.toLowerCase() + extra));
          } else {
            ret.push(newLine.replace(' AS ' + alias, ' AS ' + alias.toLowerCase() + extra));
          }
        }
      }
    }

    for (const line of newLines) {
      ret.push(line);
    }
    if (!alreadyPushed) {
      ret.push(newLine);
    }

  }

  let idx = 0;
  for (const line of ret) {
    // quote all the 'AS' strings
    if (line.includes(' AS ')) {
      const regex = /(.*)( AS )("?)([^,"]+)("?)(,?)/i;
      const match = regex.exec(line);
      ret[idx] = `${match[1]}${match[2]}"${match[4]}"${match[6]}`;
    }
    idx++;
  }

  return ret.filter(v => !!v?.trim()).join('\r\n');
}
run().then(() => console.log('Done.')).catch(e => console.error(e));