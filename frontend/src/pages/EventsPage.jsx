import { useState, useEffect, useRef } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { apiFetch } from '../config'

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const DAY_NAMES = ['Su','Mo','Tu','We','Th','Fr','Sa']

function MiniCalendar({ selectedDate, onSelectDate }) {
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())

  useEffect(() => {
    if (selectedDate) {
      const d = new Date(selectedDate + 'T00:00:00')
      setViewYear(d.getFullYear())
      setViewMonth(d.getMonth())
    }
  }, [selectedDate])

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()

  function isPast(d) {
    if (!d) return false
    return new Date(viewYear, viewMonth, d) < todayDate
  }
  function isToday(d) {
    return d && viewYear === today.getFullYear() && viewMonth === today.getMonth() && d === today.getDate()
  }
  function isSelected(d) {
    if (!d || !selectedDate) return false
    const s = new Date(selectedDate + 'T00:00:00')
    return s.getFullYear() === viewYear && s.getMonth() === viewMonth && s.getDate() === d
  }

  function handleClick(d) {
    if (!d || isPast(d)) return
    const mm = String(viewMonth + 1).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    onSelectDate(`${viewYear}-${mm}-${dd}`)
  }

  const cells = []
  for (let i = 0; i < firstDayOfMonth; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div className="cal-wrap">
      <div className="cal-head">
        <button type="button" className="cal-nav" onClick={prevMonth}>‹</button>
        <span className="cal-label">{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button type="button" className="cal-nav" onClick={nextMonth}>›</button>
      </div>
      <div className="cal-grid">
        {DAY_NAMES.map(n => <div key={n} className="cal-dn">{n}</div>)}
        {cells.map((d, i) => (
          <div
            key={i}
            onClick={() => handleClick(d)}
            className={[
              'cal-day',
              !d ? 'cal-day--empty' : '',
              d && isPast(d) ? 'cal-day--past' : '',
              d && isToday(d) ? 'cal-day--today' : '',
              d && isSelected(d) ? 'cal-day--sel' : '',
              d && !isPast(d) ? 'cal-day--clickable' : '',
            ].filter(Boolean).join(' ')}
          >
            {d}
          </div>
        ))}
      </div>
    </div>
  )
}

function formatDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function EventsPage() {
  const [events, setEvents] = useState([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState(null)
  const [urlModal, setUrlModal] = useState(null)
  const [qrModal, setQrModal] = useState(null)
  const [copied, setCopied] = useState(null)
  const qrCanvasRef = useRef(null)

  function downloadQR(eventName) {
    const canvas = document.querySelector('.qr-modal-canvas canvas')
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `qr-${eventName.replace(/\s+/g, '-').toLowerCase()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  useEffect(() => { loadEvents() }, [])

  async function loadEvents() {
    try {
      const res = await apiFetch('/api/events')
      const data = await res.json()
      setEvents(data)
    } catch {}
  }

  async function handleCreate(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setLoading(true)
    setMsg(null)
    try {
      const res = await apiFetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          description: description.trim() || null,
          expires_at: expiresAt || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        setMsg({ type: 'error', text: err.detail || 'Failed to create event.' })
        return
      }
      const event = await res.json()
      setEvents(prev => [event, ...prev])
      setName('')
      setDescription('')
      setExpiresAt('')
      setMsg({ type: 'success', text: `"${event.name}" created successfully!` })
      setUrlModal({
        id: event.id,
        name: event.name,
        displayUrl: `${window.location.origin}/display/${event.id}`,
        registerUrl: `${window.location.origin}/register/${event.id}`,
      })
    } catch {
      setMsg({ type: 'error', text: 'Network error. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(event) {
    if (!window.confirm(`Delete "${event.name}"? This cannot be undone.`)) return
    try {
      await apiFetch(`/api/events/${event.id}`, { method: 'DELETE' })
      setEvents(prev => prev.filter(e => e.id !== event.id))
    } catch {}
  }

  function copyText(text, key) {
    const flash = () => {
      setCopied(key)
      setTimeout(() => setCopied(null), 1800)
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(flash).catch(() => fallbackCopy(text, flash))
    } else {
      fallbackCopy(text, flash)
    }
  }

  function fallbackCopy(text, onDone) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    try { document.execCommand('copy'); onDone() } catch {}
    document.body.removeChild(ta)
  }

  return (
    <div className="ev-page">

      {qrModal && (
        <div className="url-modal-backdrop" onClick={() => setQrModal(null)}>
          <div className="url-modal" onClick={e => e.stopPropagation()}>
            <button className="url-modal-close" onClick={() => setQrModal(null)}>✕</button>
            <div className="url-modal-title">Scan QR for Live Display</div>
            <div className="url-modal-event">{qrModal.name}</div>
            <div className="url-modal-qr qr-modal-canvas">
              <QRCodeCanvas value={qrModal.displayUrl} size={220} level="M" includeMargin={true} />
            </div>
            <div className="url-modal-qr-hint">Scan to open the live event display</div>
            <div className="url-modal-btn-row">
              <button className="url-modal-copy" onClick={() => copyText(qrModal.displayUrl, 'qr-display')}>
                {copied === 'qr-display' ? 'Copied!' : 'Copy Display URL'}
              </button>
              <button className="url-modal-copy url-modal-copy--outline" onClick={() => downloadQR(qrModal.name)}>
                Download QR
              </button>
            </div>
          </div>
        </div>
      )}

      {urlModal && (
        <div className="url-modal-backdrop" onClick={() => setUrlModal(null)}>
          <div className="url-modal" onClick={e => e.stopPropagation()}>
            <button className="url-modal-close" onClick={() => setUrlModal(null)}>✕</button>
            <div className="url-modal-title">Event Created</div>
            <div className="url-modal-event">{urlModal.name}</div>

            <p className="url-modal-desc" style={{ marginTop: 16 }}>Live display QR code:</p>
            <div className="url-modal-qr qr-modal-canvas">
              <QRCodeCanvas value={urlModal.displayUrl} size={180} level="M" includeMargin={true} />
            </div>
            <div className="url-modal-qr-hint">Scan to open the live event display</div>
            <div className="url-modal-btn-row">
              <button className="url-modal-copy" onClick={() => copyText(urlModal.displayUrl, 'modal-display-qr')}>
                {copied === 'modal-display-qr' ? 'Copied!' : 'Copy Display URL'}
              </button>
              <button className="url-modal-copy url-modal-copy--outline" onClick={() => downloadQR(urlModal.name)}>
                Download QR
              </button>
            </div>

            <p className="url-modal-desc" style={{ marginTop: 16 }}>Display screen (no login required):</p>
            <div className="url-modal-box">{urlModal.displayUrl}</div>
            <button
              className="url-modal-copy"
              onClick={() => copyText(urlModal.displayUrl, 'modal-display')}
            >
              {copied === 'modal-display' ? 'Copied!' : 'Copy Display URL'}
            </button>
            <p className="url-modal-desc" style={{ marginTop: 16 }}>Self-registration link for attendees:</p>
            <div className="url-modal-box">{urlModal.registerUrl}</div>
            <button
              className="url-modal-copy"
              onClick={() => copyText(urlModal.registerUrl, 'modal-register')}
            >
              {copied === 'modal-register' ? 'Copied!' : 'Copy Register URL'}
            </button>
          </div>
        </div>
      )}

      <div className="ev-container">

        {/* ── Left: Create form ── */}
        <div className="ev-left">
          <h1 className="ev-title">Create Event</h1>
          <p className="ev-sub">Create an event and share its registration link or QR with attendees.</p>

          <form className="ev-form" onSubmit={handleCreate}>
            <div className="ev-field">
              <label className="ev-label">Event Name <span className="req">*</span></label>
              <input
                className="ev-input"
                placeholder="e.g. Annual Tech Summit"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>

            <div className="ev-field">
              <label className="ev-label">Description <span className="ev-optional">(optional)</span></label>
              <input
                className="ev-input"
                placeholder="Brief description of the event"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>

            <div className="ev-field">
              <label className="ev-label">Auto-delete date <span className="ev-optional">(optional)</span></label>
              <p className="ev-hint">
                The event and its attendance records will be automatically deleted at the end of this day.
                Leave unset to keep the event indefinitely.
              </p>
              <MiniCalendar selectedDate={expiresAt} onSelectDate={setExpiresAt} />
              {expiresAt ? (
                <div className="ev-selected-date">
                  <span>Will be deleted after <strong>{formatDate(expiresAt + 'T00:00:00')}</strong></span>
                  <button type="button" className="ev-clear-date" onClick={() => setExpiresAt('')}>
                    Clear
                  </button>
                </div>
              ) : (
                <div className="ev-no-expiry">No expiry — event persists until manually deleted</div>
              )}
            </div>

            {msg && <div className={`ev-msg ${msg.type}`}>{msg.text}</div>}

            <button className="ev-submit" disabled={loading || !name.trim()}>
              {loading ? 'Creating...' : 'Create Event'}
            </button>
          </form>
        </div>

        {/* ── Right: Event list ── */}
        <div className="ev-right">
          <div className="ev-list-header">
            <h2 className="ev-section-title">Active Events</h2>
            <span className="ev-count">{events.length}</span>
          </div>

          {events.length === 0 ? (
            <div className="ev-empty">No events yet. Create one using the form.</div>
          ) : (
            <div className="ev-list">
              {events.map(ev => (
                <div key={ev.id} className="ev-card">
                  <div className="ev-card-top">
                    <div className="ev-card-name">{ev.name}</div>
                    <button className="ev-delete-btn" onClick={() => handleDelete(ev)} title="Delete event">
                      Delete
                    </button>
                  </div>
                  {ev.description && <div className="ev-card-desc">{ev.description}</div>}
                  <div className="ev-card-meta">
                    <span>Created {formatDate(ev.created_at)}</span>
                    {ev.expires_at ? (
                      <span className="ev-expires-badge">
                        Expires {formatDate(ev.expires_at)}
                      </span>
                    ) : (
                      <span className="ev-no-exp-badge">No expiry</span>
                    )}
                  </div>
                  <div className="ev-card-urls">
                    <button
                      className="ev-url-btn ev-url-btn--qr"
                      onClick={() => setQrModal({
                        name: ev.name,
                        displayUrl: `${window.location.origin}/display/${ev.id}`,
                        registerUrl: `${window.location.origin}/register/${ev.id}`,
                      })}
                    >
                      Show QR Code
                    </button>
                    <button
                      className="ev-url-btn"
                      onClick={() => copyText(`${window.location.origin}/display/${ev.id}`, `display-${ev.id}`)}
                    >
                      {copied === `display-${ev.id}` ? '✓ Copied' : 'Copy Display URL'}
                    </button>
                    <button
                      className="ev-url-btn"
                      onClick={() => copyText(`${window.location.origin}/register/${ev.id}`, `reg-${ev.id}`)}
                    >
                      {copied === `reg-${ev.id}` ? '✓ Copied' : 'Copy Register URL'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
