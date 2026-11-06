import { useEffect, useRef, useState } from 'react';
import { api } from '../online/api';
export function SceneThumbnail({ assetId, label }: { assetId?: string | null; label: string }) {
  const ref = useRef<HTMLDivElement>(null), [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true; setUrl(null);
    if (!assetId || !ref.current) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      observer.disconnect();
      api.mapImage(assetId, true).then(r => { if (live) setUrl(r.url); }).catch(() => undefined);
    }, { rootMargin: '100px' });
    observer.observe(ref.current);
    return () => { live = false; observer.disconnect(); };
  }, [assetId]);
  return <div ref={ref} className="scene-thumbnail">{url ? <img src={url} alt={label} loading="lazy" /> : <span aria-hidden="true">✦</span>}</div>;
}
