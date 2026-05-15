
import { useState, useEffect } from 'react'
import { apiFetch } from '../config'
import UserAvatar from '../components/UserAvatar'

export default function CheckInPage() {
  const [events, setEvents] = useState([])
  const [selectedEvent, setSelectedEvent] = useState('')
  const [roster, setRoster] = useState([])
  const [selectedUser, setSelectedUser] = useState('')
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [lastCheckIn, setLastCheckIn] = useState(null)

  useEffect(() => {
    apiFetch('/api/events')
      .then(r => r.json())
      .then(data => setEvents(Array.isArray(data) ? data : []))
      .catch(() => setError('Could not load events.'))
  }, [])

  useEffect(() => {
    setSelectedUser('')
    setLastCheckIn(null)
    if (!selectedEvent) {
      setRoster([])
      return
    }
    setLoading(true)
    setError('')
    apiFetch(`/api/attendance/roster?event_id=${selectedEvent}`)
      .then(r => r.json())
      .then(data => setRoster(Array.isArray(data) ? data : []))
      .catch(() => setError('Could not load roster.'))
      .finally(() => setLoading(false))
  }, [selectedEvent])

  const currentUser = roster.find(r => r.id === Number(selectedUser)) || null

  async function handleCheckIn(checkInType) {
    if (!selectedUser || !selectedEvent) return
    setPending(true)
    setError('')
    try {
      const res = await apiFetch('/api/attendance/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: Number(selectedUser),
          event_id: Number(selectedEvent),
          check_in_type: checkInType,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || 'Check-in failed.')
        return
      }
      const data = await res.json()
      setRoster(prev => prev.map(row =>
        row.id === Number(selectedUser)
          ? { ...row, status: 'present', check_in_type: data.check_in_type, timestamp: data.timestamp, checked_out_at: null }
          : row
      ))
      setLastCheckIn({
        name: currentUser?.name,
        action: 'in',
        check_in_type: data.check_in_type,
      })
      setSelectedUser('')
    } catch {
      setError('Network error. Make sure the backend is running.')
    } finally {
      setPending(false)
    }
  }

  async function handleCheckOut() {
    if (!selectedUser || !selectedEvent) return
    setPending(true)
    setError('')
    try {
      const res = await apiFetch('/api/attendance/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: Number(selectedUser),
          event_id: Number(selectedEvent),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || 'Check-out failed.')
        return
      }
      const data = await res.json()
      setRoster(prev => prev.map(row =>
        row.id === Number(selectedUser)
          ? { ...row, status: 'checked_out', checked_out_at: data.checked_out_at }
          : row
      ))
      setLastCheckIn({
        name: currentUser?.name,
        action: 'out',
      })
      setSelectedUser('')
    } catch {
      setError('Network error. Make sure the backend is running.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="ci-page">
      <div className="ci-container">
        <div className="ci-header">
          <h1 className="ci-title">Check-In</h1>
          <p className="ci-sub">
            Pick an event, choose a registered attendee, and check them in. They'll appear on the
            event's display screen.
          </p>
        </div>

        <div className="ci-card">
          <div className="ci-field">
            <label className="ci-label">Event</label>
            <select
              value={selectedEvent}
              onChange={e => setSelectedEvent(e.target.value)}
              className="ci-select"
            >
              <option value="">— Select an event —</option>
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
          </div>

          {selectedEvent && (
            <div className="ci-field">
              <label className="ci-label">Registered Attendee</label>
              <select
                value={selectedUser}
                onChange={e => setSelectedUser(e.target.value)}
                className="ci-select"
                disabled={loading || roster.length === 0}
              >
                <option value="">
                  {loading
                    ? 'Loading…'
                    : roster.length === 0
                      ? 'No one is enrolled in this event yet'
                      : '— Select an attendee —'}
                </option>
                {roster.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.email ? ` · ${r.email}` : ''}
                    {r.status === 'checked_out'
                      ? ' · checked out'
                      : r.status === 'present'
                        ? ` · already ${r.check_in_type === 'in_person' ? 'in-person' : 'virtual'}`
                        : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {currentUser && (
            <div className="ci-selected">
              <UserAvatar
                src={currentUser.image_url}
                name={currentUser.name}
                imgClass="ci-avatar"
                fallbackClass="ci-avatar ci-avatar-fallback"
              />
              <div className="ci-row-info">
                <div className="ci-row-name">{currentUser.name}</div>
                {currentUser.email && <div className="ci-row-meta">{currentUser.email}</div>}
                {currentUser.occupation && <div className="ci-row-meta">{currentUser.occupation}</div>}
                {currentUser.status === 'present' && (
                  <span className={`ci-badge ci-badge--${currentUser.check_in_type || 'virtual'}`} style={{ marginTop: 6 }}>
                    ✓ already {currentUser.check_in_type === 'in_person' ? 'In-Person' : 'Virtual'}
                  </span>
                )}
                {currentUser.status === 'checked_out' && (
                  <span className="ci-badge" style={{ marginTop: 6 }}>
                    ⤴ checked out
                  </span>
                )}
              </div>
            </div>
          )}

          {currentUser && currentUser.status !== 'present' && (
            <div className="ci-actions">
              <button
                className="ci-action-btn ci-action-btn--virtual"
                disabled={pending}
                onClick={() => handleCheckIn('virtual')}
              >
                {pending ? 'Checking in…' : 'Virtual Check-In'}
              </button>
              <button
                className="ci-action-btn ci-action-btn--in_person"
                disabled={pending}
                onClick={() => handleCheckIn('in_person')}
              >
                {pending ? 'Checking in…' : 'In-Person Check-In'}
              </button>
            </div>
          )}

          {currentUser && currentUser.status === 'present' && (
            <div className="ci-actions">
              <button
                className="ci-action-btn ci-action-btn--in_person"
                disabled={pending}
                onClick={handleCheckOut}
              >
                {pending ? 'Checking out…' : 'Check-Out'}
              </button>
            </div>
          )}

          {error && <div className="ci-error">{error}</div>}

          {lastCheckIn && lastCheckIn.action === 'in' && (
            <div className="ci-success">
              ✓ {lastCheckIn.name} checked in
              {' '}({lastCheckIn.check_in_type === 'in_person' ? 'In-Person' : 'Virtual'}). Now showing on the display screen.
            </div>
          )}
          {lastCheckIn && lastCheckIn.action === 'out' && (
            <div className="ci-success">
              ⤴ {lastCheckIn.name} checked out.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
