import { DownloadSimple } from '@phosphor-icons/react'
import { useState } from 'react'
import { API, downloadRankings, IS_STATIC } from '../api'

export function ExportRankings({ params }: { params: URLSearchParams }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!IS_STATIC) return <a className="icon-button export-button" href={`${API}/api/export?${params}`} aria-label="Export filtered rankings as CSV" title="Export CSV"><DownloadSimple size={18} /></a>
  return <><button className="icon-button export-button" disabled={busy} title="Export CSV" aria-label="Export filtered rankings as CSV" onClick={async () => {
    setBusy(true); setError('')
    try { await downloadRankings(params) } catch (e) { setError(e instanceof Error ? e.message : 'The export could not be downloaded.') } finally { setBusy(false) }
  }}><DownloadSimple size={18} /></button>{error && <span className="export-error" role="alert">{error}</span>}</>
}
