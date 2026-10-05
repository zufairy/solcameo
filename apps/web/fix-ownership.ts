import fs from 'fs';
import path from 'path';

function walk(dir: string, fileList: string[] = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const p = path.join(dir, file);
    if (fs.statSync(p).isDirectory()) {
      walk(p, fileList);
    } else if (p.endsWith('.ts')) {
      fileList.push(p);
    }
  }
  return fileList;
}

const apiDir = path.join(__dirname, 'app/api');
const files = walk(apiDir);

let changedFiles = 0;
for (const file of files) {
  let content = fs.readFileSync(file, 'utf-8');
  let original = content;
  
  // Replace requireOwnerWithSiws(auth, agent?.creatorWallet) with requireOwnerWithSiws(auth, agent)
  content = content.replace(/requireOwnerWithSiws\(auth,\s*([a-zA-Z0-9_]+)\?\.creatorWallet\)/g, 'requireOwnerWithSiws(auth, $1)');
  content = content.replace(/requireOwnerWithSiws\(auth,\s*([a-zA-Z0-9_]+)\.creatorWallet\)/g, 'requireOwnerWithSiws(auth, $1)');
  
  if (content !== original) {
    fs.writeFileSync(file, content);
    console.log(`Updated ${file}`);
    changedFiles++;
  }
}
console.log(`Fixed ownership checks in ${changedFiles} files in app/api`);
