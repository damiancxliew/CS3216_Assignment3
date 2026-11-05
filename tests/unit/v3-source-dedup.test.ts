import { expect, it } from 'vitest';
import { extractPlainText } from '@adventure/generation';
import { memoryV3SourceStore } from '@/lib/v3/generation/deps';
it('retains accepted evidence when a retry returns the same URL with a different title',async()=>{
  const store=memoryV3SourceStore();
  const url='https://nlb.gov.sg/record';
  const original=extractPlainText({id:'outside-original',title:'Original record',kind:'text',text:'Original accepted evidence. '.repeat(30)});
  const retry=extractPlainText({id:'outside-new-title',title:'A new search title',kind:'text',text:'Different text from a later request. '.repeat(30)});
  await store.saveOutside('adventure',[{id:original.id,title:original.title,origin:'outside',url}],[original]);
  await store.saveOutside('adventure',[{id:retry.id,title:retry.title,origin:'outside',url}],[retry]);
  expect(await store.load('adventure')).toEqual([{...original,origin:'outside',url}]);
});
