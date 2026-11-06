import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { storedZip } from '../src/campaign/zip';
describe('portable journal archive', () => {
  it('is readable and CRC-valid with Python standard zipfile, including UTF-8 and binary attachments', () => {
    const zip=storedZip([{name:'journal.md',data:new TextEncoder().encode('# Grüße\n\n![Image](attachments/image.png)')},{name:'attachments/image.png',data:Uint8Array.from([0,255,42,128])}]);
    const script="import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({'text':z.read('journal.md').decode('utf-8'),'image':list(z.read('attachments/image.png'))}))";
    const result=JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',['-c',script],{input:zip,encoding:'utf8'}));
    expect(result.text).toContain('# Grüße'); expect(result.image).toEqual([0,255,42,128]);
  });
  it('rejects archive traversal paths', () => {
    expect(()=>storedZip([{name:'../outside',data:new Uint8Array()}])).toThrow('Invalid archive path');
    expect(()=>storedZip([{name:'/absolute',data:new Uint8Array()}])).toThrow('Invalid archive path');
  });
});
