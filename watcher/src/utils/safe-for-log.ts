/** Keep printable ASCII only and truncate so an untrusted value cannot shape what is printed (G4) */
export function safeForLog(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '?').slice(0, 60);
}
