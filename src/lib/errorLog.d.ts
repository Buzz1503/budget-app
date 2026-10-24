export interface ErrorEntry { at: string; kind: string; where: string | null; name: string | null; message: string; stack: string | null; count?: number }
export const ERROR_LOG_KEY: string
export const MAX_ERRORS: number
export function entryFrom(err: unknown, context?: { kind?: string; where?: string | null }, now?: Date): ErrorEntry
export function addEntry(list: ErrorEntry[], entry: ErrorEntry, max?: number): ErrorEntry[]
export function readErrors(): ErrorEntry[]
export function onErrorsChanged(fn: (list: ErrorEntry[]) => void): () => void
export function logError(err: unknown, context?: { kind?: string; where?: string | null }): void
export function clearErrors(): void
export function errorReport(list: ErrorEntry[], meta?: { version?: string | null; device?: string | null }): string
export function installErrorLog(): void
