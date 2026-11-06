/** Small dependency-free ZIP writer (stored files). Export paths are fixed, never entry titles. */
const crcTable = Uint32Array.from({ length:256 }, (_,i) => { let n=i; for(let j=0;j<8;j++) n=(n&1) ? 0xedb88320^(n>>>1) : n>>>1; return n>>>0; });
function crc32(bytes:Uint8Array) { let crc=0xffffffff; for(const b of bytes) crc=crcTable[(crc^b)&255]^(crc>>>8); return (crc^0xffffffff)>>>0; }
export function storedZip(files:{ name:string; data:Uint8Array }[]):Uint8Array {
  if(files.length>65535) throw new Error('Too many files for one journal archive.');
  const local:Uint8Array[]=[], central:Uint8Array[]=[]; let offset=0;
  for(const file of files) {
    if(!file.name || /(^\/|\\|(^|\/)\.\.(\/|$)|[\x00-\x1f])/.test(file.name)) throw new Error('Invalid archive path.');
    const name=new TextEncoder().encode(file.name), crc=crc32(file.data);
    const header=new Uint8Array(30+name.length), h=new DataView(header.buffer);
    h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(6,0x800,true); h.setUint16(12,33,true); h.setUint32(14,crc,true); h.setUint32(18,file.data.length,true); h.setUint32(22,file.data.length,true); h.setUint16(26,name.length,true); header.set(name,30);
    const record=new Uint8Array(46+name.length), r=new DataView(record.buffer);
    r.setUint32(0,0x02014b50,true); r.setUint16(4,20,true); r.setUint16(6,20,true); r.setUint16(8,0x800,true); r.setUint16(14,33,true); r.setUint32(16,crc,true); r.setUint32(20,file.data.length,true); r.setUint32(24,file.data.length,true); r.setUint16(28,name.length,true); r.setUint32(42,offset,true); record.set(name,46);
    local.push(header,file.data); central.push(record); offset+=header.length+file.data.length;
  }
  const size=central.reduce((n,c)=>n+c.length,0), end=new Uint8Array(22), e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true); e.setUint32(12,size,true); e.setUint32(16,offset,true);
  const output=new Uint8Array(offset+size+end.length); let at=0;
  for(const chunk of [...local,...central,end]) { output.set(chunk,at); at+=chunk.length; }
  return output;
}
