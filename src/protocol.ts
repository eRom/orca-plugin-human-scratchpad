// Contrat de requêtes partagé entre le worker et le panneau.

export type FileErrorCode = 'invalid_path' | 'not_found' | 'too_large' | 'permission_denied' | 'io_error'
export type FileError = { status: 'error'; code: FileErrorCode; message: string }
export type ResolveOutput = { status: 'ok'; path: string; displayPath: string; isDefault: boolean } | FileError
export type StatOutput = { status: 'ok'; exists: boolean; mtimeMs: number; size: number } | FileError
export type ReadOutput = { status: 'ok'; content: string; version: string; mtimeMs: number; size: number } | FileError
export type WriteInput = { path: string; content: string; baseVersion: string; force: boolean }
export type WriteOutput =
  | { status: 'saved'; version: string; mtimeMs: number; size: number }
  | { status: 'conflict'; content: string; version: string; mtimeMs: number; size: number }
  | FileError

declare module 'orca' {
  interface PluginRequests {
    'scratchpad.resolve': { input: Record<string, never>; output: ResolveOutput }
    'scratchpad.stat': { input: { path: string }; output: StatOutput }
    'scratchpad.read': { input: { path: string }; output: ReadOutput }
    'scratchpad.write': { input: WriteInput; output: WriteOutput }
  }
}
