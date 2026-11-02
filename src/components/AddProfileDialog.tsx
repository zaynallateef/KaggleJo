import { ArrowRight, ArrowUpRight, CheckCircle, GlobeHemisphereWest, Link, User } from '@phosphor-icons/react'
import { useState, type FormEvent } from 'react'
import { HAS_SUPABASE, IS_STATIC, request } from '../api'
import { cities } from '../types'
import { Modal } from './Common'

export function AddProfileDialog({ close, onAdded }: { close: () => void; onAdded?: () => void }) {
  return IS_STATIC && !HAS_SUPABASE ? <AutomaticInclusionDialog close={close} /> : <NominationForm close={close} onAdded={onAdded} />
}

function AutomaticInclusionDialog({ close }: { close: () => void }) {
  return <Modal title="Join the Jordan community" onClose={close}><div className="inclusion-intro"><GlobeHemisphereWest size={32} /><p>Members are discovered automatically from public Kaggle profiles. You don’t need a ranking to appear.</p></div><ol className="inclusion-steps"><li><strong>Set your location on Kaggle.</strong><span>Choose your city in Jordan, or Jordan, in your Kaggle profile.</span></li><li><strong>Make the location public.</strong><span>Enable location sharing so it is available in Kaggle’s public search.</span></li><li><strong>Check back after the next update.</strong><span>We check for new profiles hourly. Kaggle’s search index and scheduled updates can take longer.</span></li></ol><a className="button form-submit" href="https://www.kaggle.com/" target="_blank" rel="noreferrer">Open Kaggle <ArrowUpRight size={17} /></a><p className="inclusion-note">KaggleJo never needs your password or API token. A profile can be visible on Kaggle while its location is absent from the search API. If you are missing, check location sharing and allow time for indexing. Refresh reloads the latest published snapshot.</p></Modal>
}

function NominationForm({ close, onAdded }: { close: () => void; onAdded?: () => void }) {
  const [username, setUsername] = useState('')
  const [city, setCity] = useState('Amman')
  const [url, setUrl] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [status, setStatus] = useState<'idle' | 'sending' | 'success'>('idle')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [approved, setApproved] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setStatus('sending')
    try {
      const response = await request<{ message: string; status?: string }>('/nominations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, city, evidence_url: url, confirmed }) })
      setApproved(response.status === 'approved'); setMessage(response.message); setStatus('success')
      if (response.status === 'approved') onAdded?.()
    } catch (e) { setError(e instanceof Error ? e.message : 'Submission failed. Please try again.'); setStatus('idle') }
  }
  return <Modal title="Join the Jordan community" onClose={close}>{status === 'success' ? <div className="success-state" role="status"><CheckCircle size={45} weight="duotone" /><h3>{HAS_SUPABASE ? approved ? 'Profile added.' : 'Automatic check queued.' : 'Submitted for review.'}</h3><p>{message}</p><button className="button" onClick={close}>Back to the community <ArrowRight size={16} /></button></div> : <form className="profile-form" onSubmit={submit}>
    <p>{HAS_SUPABASE ? 'Add a public Kaggle profile connected to Jordan. We check the account and add it automatically—no manual review.' : 'Know a Kaggler connected to Jordan? Submit their public profile for review.'}</p>
    <label htmlFor="username">Kaggle username</label><div className="form-input-icon"><User size={17} /><input id="username" value={username} onChange={e => { const next = e.target.value; setUsername(next); if (!url || url === `https://www.kaggle.com/${username}`) setUrl(`https://www.kaggle.com/${next}`) }} placeholder="your_kaggle_username" pattern="[a-zA-Z0-9_]{3,50}" maxLength={50} required autoComplete="off" /></div>
    <label htmlFor="city">City in Jordan</label><select id="city" value={city} onChange={e => setCity(e.target.value)}>{(HAS_SUPABASE ? [...cities, 'Karak', 'Mafraq', 'Ajloun', 'Jerash', 'Tafilah', 'Maan', 'Not specified'] : cities).map(c => <option key={c}>{c}</option>)}</select>
    <label htmlFor="profile-url">Public Kaggle profile</label><div className="form-input-icon"><Link size={17} /><input id="profile-url" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.kaggle.com/username" required maxLength={200} /></div><p className="form-hint">Use the exact account’s public Kaggle link.</p>
    <label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required /><span>I confirm this public profile is connected to Jordan and the selected city is accurate.</span></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button form-submit" disabled={status === 'sending'}>{status === 'sending' ? 'Checking account…' : HAS_SUPABASE ? 'Add profile' : 'Submit for review'} <ArrowRight size={17} /></button><p className="form-hint">No Kaggle password or API key needed. Account checks do not verify ownership or the submitted location. Available statistics update hourly.</p>
  </form>}</Modal>
}
