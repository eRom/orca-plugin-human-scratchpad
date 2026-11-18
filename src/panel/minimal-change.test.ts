import { assert, test } from 'orca/testing'
import { minimalChange, type TextChange } from './minimal-change'

function apply(text: string, change: TextChange | null): string {
  return change ? text.slice(0, change.from) + change.insert + text.slice(change.to) : text
}

const CASES: [string, string, TextChange | null][] = [
  ['abc', 'abc', null],
  ['hello', 'hello world', { from: 5, to: 5, insert: ' world' }],
  ['hello world', 'world', { from: 0, to: 6, insert: '' }],
  ['aXc', 'aYc', { from: 1, to: 2, insert: 'Y' }],
  ['aaa', 'aaaa', { from: 3, to: 3, insert: 'a' }],
  ['', 'new', { from: 0, to: 0, insert: 'new' }],
  ['old', '', { from: 0, to: 3, insert: '' }],
  ['a😀b', 'a😃b', { from: 1, to: 3, insert: '😃' }],
]
for (const [oldText, newText, expected] of CASES) {
  test(`minimalChange ${JSON.stringify(oldText)} -> ${JSON.stringify(newText)}`, () => {
    assert.deepEqual(minimalChange(oldText, newText), expected)
  })
}

test('applying the change always yields the new text (random pairs)', () => {
  const alphabet = ['a', 'b', '\n', '😀', 'é']
  const random = (): string =>
    Array.from({ length: Math.floor(Math.random() * 8) }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  for (let i = 0; i < 2000; i++) {
    const oldText = random()
    const newText = random()
    assert.equal(apply(oldText, minimalChange(oldText, newText)), newText, JSON.stringify([oldText, newText]))
  }
})
