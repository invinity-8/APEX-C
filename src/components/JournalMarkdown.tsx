import type { ReactNode } from 'react';
type ReferenceMap = Record<string, string>;
function inline(text: string, references: ReferenceMap, onReference?: (id: string) => void): ReactNode[] {
  return text.split(/(\[\[ref:[0-9a-f-]{36}\]\]|\*\*[^*]+\*\*|\`[^\`]+\`|\*[^*]+\*)/g).map((s, i) => {
    const reference = /^\[\[ref:([0-9a-f-]{36})\]\]$/i.exec(s);
    if (reference) {
      const title = references[reference[1]];
      return title && onReference
        ? <button key={i} type="button" className="underline decoration-gold-500/60 underline-offset-2" onClick={() => onReference(reference[1])}>{title}</button>
        : <span key={i} className="text-marble-500">Unavailable reference</span>;
    }
    return s.startsWith('**') && s.endsWith('**') ? <strong key={i}>{s.slice(2,-2)}</strong> : s.startsWith('\`') && s.endsWith('\`') ? <code key={i}>{s.slice(1,-1)}</code> : s.startsWith('*') && s.endsWith('*') ? <em key={i}>{s.slice(1,-1)}</em> : s;
  });
}
/** Text-only Markdown subset: no HTML injection or untrusted links. Full source remains portable. */
export function JournalMarkdown({ body, references = {}, onReference }: { body: string; references?: ReferenceMap; onReference?: (id: string) => void }) {
  return <>{body.split('\n').map((line,i) => /^#{1,3} /.test(line) ? <h4 key={i}>{inline(line.replace(/^#{1,3} /,''), references, onReference)}</h4> : /^[-*] /.test(line) ? <p key={i}>• {inline(line.slice(2), references, onReference)}</p> : line.startsWith('> ') ? <blockquote key={i}>{inline(line.slice(2), references, onReference)}</blockquote> : <p key={i}>{inline(line || '\u00a0', references, onReference)}</p>)}</>;
}
