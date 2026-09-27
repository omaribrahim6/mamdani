import { Fragment, type ReactNode } from 'react';

// Just enough markdown for Mamdani's answers: headings, paragraphs, bullet/numbered lists, tables,
// bold/italic/code, links, and work-order numbers (#1842) that open the issue.

type Open = (id: number) => void;

function inline(text: string, open: Open, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|#\d{3,6}\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = key;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={k++}>{inline(t.slice(2, -2), open, k * 100)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!;
      out.push(
        <a key={k++} href={href} target="_blank" rel="noreferrer">
          {label}
        </a>,
      );
    } else if (t.startsWith('#')) {
      const id = Number(t.slice(1));
      out.push(
        <button key={k++} className="wo-link" onClick={() => open(id)}>
          #{id}
        </button>,
      );
    } else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, open }: { text: string; open: Open }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^-{3,}$/.test(line.trim())) {
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)/.exec(line);
    if (h) {
      blocks.push(<h4 key={k++}>{inline(h[2], open)}</h4>);
      i++;
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div className="md-table" key={k++}>
          <table>
            <thead>
              <tr>{head?.map((c, j) => <th key={j}>{inline(c, open)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, x) => (
                <tr key={x}>{r.map((c, j) => <td key={j}>{inline(c, open)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*([-*•]|\d+\.)\s+/, ''), open)}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={k++}>{items}</ol> : <ul key={k++}>{items}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*([-*•]|\d+\.)\s|\|)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(
      <p key={k++}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p, open)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="md">{blocks}</div>;
}
