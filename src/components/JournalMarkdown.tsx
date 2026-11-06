import type { ReactNode } from 'react';
function inline(text:string):ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).map((s,i) => s.startsWith('**') && s.endsWith('**') ? <strong key={i}>{s.slice(2,-2)}</strong> : s.startsWith('`') && s.endsWith('`') ? <code key={i}>{s.slice(1,-1)}</code> : s.startsWith('*') && s.endsWith('*') ? <em key={i}>{s.slice(1,-1)}</em> : s);
}
/** Text-only Markdown subset: no HTML injection or untrusted links. Full source remains portable. */
export function JournalMarkdown({ body }: { body:string }) {
  return <>{body.split('\n').map((line,i) => /^#{1,3} /.test(line) ? <h4 key={i}>{inline(line.replace(/^#{1,3} /,''))}</h4> : /^[-*] /.test(line) ? <p key={i}>• {inline(line.slice(2))}</p> : line.startsWith('> ') ? <blockquote key={i}>{inline(line.slice(2))}</blockquote> : <p key={i}>{inline(line || '\u00a0')}</p>)}</>;
}
