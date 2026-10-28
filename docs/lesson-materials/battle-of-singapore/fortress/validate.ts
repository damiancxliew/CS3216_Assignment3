import fs from 'node:fs';
import { AdventureSpec, LatestAdventureSpec, checkSpec, editableIssues, supportsReadingSelection } from '../../../../packages/spec-v3/src/index.ts';
import { parseSpecImport } from '../../../../apps/web/src/lib/v3/spec-transfer.ts';
import { readSpecArchive, createSpecArchive } from '../../../../apps/web/src/lib/v3/spec-archive.ts';
import { validateEditedSpec } from '../../../../apps/web/src/lib/v3/edit/validation.ts';
const folder=new URL('.', import.meta.url).pathname;
const bundle=parseSpecImport(fs.readFileSync(folder+'/adventure.json','utf8'));
LatestAdventureSpec.parse(bundle.spec);
const sourceTexts=bundle.sources.map(s=>({id:s.id,text:s.pages.map(p=>p.text).join('\n')}));
const checks=validateEditedSpec(bundle.spec,sourceTexts);
const extra=editableIssues(bundle.spec);
const errors=[...new Map([...checks.errors,...extra].map(e=>[JSON.stringify(e),e])).values()];
console.log(JSON.stringify({errors,warnings:checks.warnings},null,2));
if(errors.length)process.exit(1);
for(const doc of bundle.spec.documents){
 for(const q of [...doc.readingCheck!.variants,doc.readingCheck!.recovery]){
  if(!q.support.some(s=>supportsReadingSelection(doc.body,q.support,s.start,s.end)))throw Error('Support rejected: '+q.id);
  if(supportsReadingSelection(doc.body,q.support,0,doc.body.length))throw Error('Whole-document selection accepted: '+q.id);
 }
}
const bytes=await createSpecArchive(bundle,async()=>{throw Error('Unexpected external media fetch')});
await readSpecArchive(bytes);
fs.writeFileSync(folder+'/the-fortress-that-fell.zip',bytes);
console.log(`ZIP import round trip passed; ${bytes.length} bytes. ${bundle.spec.documents.length*5} answer supports accepted; whole-document highlights rejected.`);
