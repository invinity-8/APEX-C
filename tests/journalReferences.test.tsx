import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JournalMarkdown } from '../src/components/JournalMarkdown';

const visibleId = '00000000-0000-4000-8000-000000000001';
const hiddenId = '00000000-0000-4000-8000-000000000002';

describe('journal reference rendering', () => {
  it('renders only resolved People and Places as clickable buttons', () => {
    const onReference = vi.fn();
    const html = renderToStaticMarkup(<JournalMarkdown body={'Met [[ref:' + visibleId + ']] and [[ref:' + hiddenId + ']].'} references={{ [visibleId]: 'The Old Inn' }} onReference={onReference} />);
    expect(html).toContain('The Old Inn');
    expect(html).toContain('Unavailable reference');
    expect(html).not.toContain(hiddenId);
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it('keeps reference tokens inert when the caller provides no navigation handler', () => {
    const html = renderToStaticMarkup(<JournalMarkdown body={'[[ref:' + visibleId + ']]'} references={{ [visibleId]: 'Sinna' }} />);
    expect(html).toContain('Unavailable reference');
    expect(html).not.toContain('Sinna');
  });
});
