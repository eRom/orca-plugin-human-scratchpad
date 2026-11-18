import { assert, test } from 'orca/testing'
import { applyFormat, formatRange, type FormatCommand } from './format-commands'

const CASES: [FormatCommand, string, number, number, string, number, number][] = [
  ['heading1', 'Title', 0, 0, '# Title', 2, 2],
  ['heading1', '# Title', 7, 7, 'Title', 5, 5],
  ['heading2', '# Title', 7, 7, '## Title', 8, 8],
  ['heading3', '', 0, 0, '### ', 4, 4],
  ['paragraph', '## Title', 8, 8, 'Title', 5, 5],
  ['paragraph', '> quoted', 8, 8, 'quoted', 6, 6],
  ['paragraph', '  - [ ] task', 12, 12, '  task', 6, 6],
  ['bold', 'make bold', 5, 9, 'make **bold**', 7, 11],
  ['bold', 'make **bold**', 7, 11, 'make bold', 5, 9],
  ['bold', 'make **bold**', 5, 13, 'make bold', 5, 9],
  ['bold', 'ab', 1, 1, 'a****b', 3, 3],
  ['italic', 'x', 0, 1, '*x*', 1, 2],
  ['strike', 'gone', 0, 4, '~~gone~~', 2, 6],
  ['bulletList', 'a\nb', 0, 3, '- a\n- b', 2, 7],
  ['bulletList', '- a\n- b', 0, 7, 'a\nb', 0, 3],
  ['bulletList', '', 0, 0, '- ', 2, 2],
  ['orderedList', 'a\n\nb', 0, 4, '1. a\n\n2. b', 3, 10],
  ['orderedList', '- a', 3, 3, '1. a', 4, 4],
  ['taskList', 'todo', 4, 4, '- [ ] todo', 10, 10],
  ['taskList', '- [x] done', 10, 10, 'done', 4, 4],
  ['bulletList', '- [ ] todo', 10, 10, '- todo', 6, 6],
  ['quote', 'a\nb', 0, 3, '> a\n> b', 2, 7],
  ['quote', '> a\n> b', 0, 7, 'a\nb', 0, 3],
  ['link', 'see docs', 4, 8, 'see [docs](url)', 11, 14],
  ['link', 'x', 1, 1, 'x[](url)', 2, 2],
]
for (const [command, doc, from, to, text, efrom, eto] of CASES) {
  test(`${command} on ${JSON.stringify(doc)} [${from},${to}]`, () => {
    assert.deepEqual(applyFormat(command, doc, from, to), { text, from: efrom, to: eto })
  })
}

test('a selection ending right after a newline does not reach the next line', () => {
  assert.deepEqual(formatRange('a\nb\nc', 0, 4), { from: 0, to: 3 })
  assert.deepEqual(formatRange('a\nb', 0, 2), { from: 0, to: 1 })
})

test('formatRange orders anchor and head and leaves other selections alone', () => {
  assert.deepEqual(formatRange('hello world', 8, 2), { from: 2, to: 8 })
  assert.deepEqual(formatRange('a\nb', 2, 2), { from: 2, to: 2 })
  assert.deepEqual(formatRange('a\nb', 0, 3), { from: 0, to: 3 })
})

test('a line command on a selection that ended after a newline formats only the selected lines', () => {
  const doc = 'one\ntwo\nthree'
  const { from, to } = formatRange(doc, 0, 8)
  assert.equal(applyFormat('bulletList', doc, from, to).text, '- one\n- two\nthree')
})
