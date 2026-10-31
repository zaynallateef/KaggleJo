import { ArrowRight, ArrowUpRight, CheckCircle, GlobeHemisphereWest, Link, User } from '@phosphor-icons/react'
import { useState, type FormEvent } from 'react'
import { IS_STATIC, request } from '../api'
import { cities } from '../types'
import { Modal } from './Common'

export function AddProfileDialog({ close }: { close: () => void }) {
  return IS_STATIC ? <AutomaticInclusionDialog close={close} /> : <NominationForm close={close} />
}

function AutomaticInclusionDialog({ close }: { close: () => void }) {
  return <Modal title="Join the Jordan community" onClose={close}><div className="inclusion-intro"><GlobeHemisphereWest size={32} /><p>Members are discovered automatically from public Kaggle profiles. You don’t need a ranking to appear.</p></div><ol className="inclusion-steps"><li><strong>Set your location on Kaggle.</strong><span>Choose your city in Jordan, or Jordan, in your Kaggle profile.</span></li><li><strong>Make the location public.</strong><span>Enable location sharing so it is available in Kaggle’s public search.</span></li><li><strong>Check back after the next update.</strong><span>We check for new profiles hourly. Kaggle’s search index and scheduled updates can take longer.</span></li></ol><a className="button form-submit" href="https://www.kaggle.com/" target="_blank" rel="noreferrer">Open Kaggle <ArrowUpRight size={17} /></a><p className="inclusion-note">KaggleJo never needs your password or API token. If you prefer to keep your location private, your profile may not appear here.</p></Modal>
}

function NominationForm({ close }: { close: () => void }) {
  const [username, setUsername] = useState('')
  const [city, setCity] = useState('Amman')
  const [url, setUrl] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [status, setStatus] = useState<'idle' | 'sending' | 'success'>('idle')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setStatus('sending')
    try {
      const response = await request<{ message: string }>('/nominations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, city, evidence_url: url, confirmed }) })
      setMessage(response.message); setStatus('success')
    } catch (e) { setError(e instanceof Error ? e.message : 'Submission failed. Please try again.'); setStatus('idle') }
  }
  return <Modal title="A place on the leaderboard" onClose={close}>{status === 'success' ? <div className="success-state" role="status"><CheckCircle size={45} weight="duotone" /><h3>You’re on the list.</h3><p>{message}</p><button className="button" onClick={close}>Back to the community <ArrowRight size={16} /></button></div> : <form className="profile-form" onSubmit={submit}>
    <p>Know a Kaggler connected to Jordan? Submit their public profile for review.</p>
    <label htmlFor="username">Kaggle username</label><div className="form-input-icon"><User size={17} /><input id="username" value={username} onChange={e => { const next = e.target.value; setUsername(next); if (!url || url === `https://www.kaggle.com/${username}`) setUrl(`https://www.kaggle.com/${next}`) }} placeholder="your_kaggle_username" pattern="[a-zA-Z0-9_]{3,50}" maxLength={50} required autoComplete="off" /></div>
    <label htmlFor="city">City in Jordan</label><select id="city" value={city} onChange={e => setCity(e.target.value)}>{cities.map(c => <option key={c}>{c}</option>)}</select>
    <label htmlFor="profile-url">Public Kaggle profile</label><div className="form-input-icon"><Link size={17} /><input id="profile-url" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.kaggle.com/username" required maxLength={200} /></div><p className="form-hint">The public profile should show a connection to Jordan.</p>
    <label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required /><span>I confirm this public profile is connected to Jordan and can be reviewed for this community index.</span></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button form-submit" disabled={status === 'sending'}>{status === 'sending' ? 'Submitting…' : 'Submit for review'} <ArrowRight size={17} /></button><p className="form-hint">No Kaggle password or API key needed. Submitting does not verify ownership or immediately publish a ranking.</p>
  </form>}</Modal>
}
