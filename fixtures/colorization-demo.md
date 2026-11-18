# Scratchpad colorization demo

## Inline formatting

### Headings, emphasis and links

A paragraph with **bold text**, *italic text*, ***both at once*** and ~~struck through~~. It links to [the Orca site](https://orca.sh/docs) and carries `inline code` next to a plain sentence that keeps wrapping, so the soft wrap is visible too.

- Top level bullet
  - Nested bullet with **bold**
    - A third level
- Another top level bullet

1. First numbered item
2. Second numbered item
3. Third numbered item

- [ ] An open task
- [x] A finished task
- [ ] Another open task with `code`

> A quoted thought, muted and italic.
> It spans two lines.

---

```ts
interface Note {
  id: number
  title: string
  tags?: string[]
}

export async function loadNote(id: number): Promise<Note> {
  const base = 'https://api.example.com'
  const res = await fetch(`${base}/notes/${id}?full=${true}`)
  if (!res.ok) throw new Error('not found') // surfaced to the caller
  return (await res.json()) as Note
}
```

```json
{
  "name": "scratchpad",
  "version": "0.1.0",
  "private": true,
  "retries": 3,
  "tags": ["markdown", "notes"],
  "owner": null
}
```

```bash
# build then ship
NAME="scratchpad"
bun run build | tee build.log
if [ -f "$NAME.md" ]; then echo "ok: ${NAME}"; fi
```
