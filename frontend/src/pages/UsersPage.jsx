import { useState, useEffect } from 'react'
import { apiFetch } from '../config'
import UserAvatar from '../components/UserAvatar'

export default function UsersPage() {
  const [allUsers, setAllUsers]   = useState([])
  const [events, setEvents]       = useState([])
  const [eventUsers, setEventUsers] = useState({})   // { [eventId]: [...] }
  const [activeTab, setActiveTab] = useState('all')  // 'all' | eventId
  const [loading, setLoading]     = useState(true)
  const [expanded, setExpanded]   = useState(null)
  const [deleting, setDeleting]   = useState(null)
  const [search, setSearch]       = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(null)
  const [bulkEnrolling, setBulkEnrolling] = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function handleBulkEnroll() {
    if (activeTab === 'all') return
    const targetEvent = events.find(e => e.id === activeTab)
    if (!targetEvent) return
    const otherEventIds = events.filter(e => e.id !== activeTab).map(e => e.id)
    const otherEventNames = events.filter(e => e.id !== activeTab).map(e => e.name).join(', ') || 'none'
    if (!window.confirm(
      `Enroll every non-admin user into "${targetEvent.name}", except people already in: ${otherEventNames}?`
    )) return

    setBulkEnrolling(true)
    try {
      const res = await apiFetch(`/api/events/${activeTab}/enroll-all-except`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exclude_event_ids: otherEventIds }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(`Bulk enroll failed: ${data.detail || res.status}`)
        return
      }
      alert(`Enrolled ${data.enrolled} user(s) in "${targetEvent.name}".`)
      await fetchAll()
    } catch (e) {
      alert(`Network error: ${e?.message || 'backend unreachable'}`)
    } finally {
      setBulkEnrolling(false)
    }
  }

  async function handlePhotoUpload(user, file) {
    if (!file) return
    setUploadingPhoto(user.id)
    try {
      const fd = new FormData()
      fd.append('image', file)
      const res = await apiFetch(`/api/register/users/${user.id}/photo`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) throw new Error('upload failed')
      const data = await res.json()

      const apply = (u) => u.id === user.id ? { ...u, image_url: data.image_url } : u
      setAllUsers(prev => prev.map(apply))
      setEventUsers(prev => {
        const updated = { ...prev }
        for (const eid in updated) updated[eid] = updated[eid].map(apply)
        return updated
      })
    } catch {
      alert('Failed to upload photo.')
    } finally {
      setUploadingPhoto(null)
    }
  }

  async function fetchAll() {
    setLoading(true)
    try {
      const [usersRes, eventsRes] = await Promise.all([
        apiFetch('/api/register/users'),
        apiFetch('/api/events'),
      ])
      const [users, evs] = await Promise.all([usersRes.json(), eventsRes.json()])
      setAllUsers(users)
      setEvents(evs)

      const perEvent = {}
      await Promise.all(evs.map(async ev => {
        try {
          const r = await apiFetch(`/api/events/${ev.id}/users`)
          perEvent[ev.id] = await r.json()
        } catch {
          perEvent[ev.id] = []
        }
      }))
      setEventUsers(perEvent)
    } catch {
      // only wipe users if the main users fetch itself failed
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(user) {
    const isEventTab = activeTab !== 'all'
    const eventName = isEventTab ? events.find(e => e.id === activeTab)?.name : null

    const message = isEventTab
      ? `Remove "${user.name}" from "${eventName}"? Their record stays in the system and in any other events they're in.`
      : `Delete "${user.name}"? This wipes their record, photo, and attendance across ALL events. This cannot be undone.`
    if (!window.confirm(message)) return

    setDeleting(user.id)
    try {
      if (isEventTab) {
        const res = await apiFetch(`/api/events/${activeTab}/users/${user.id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('remove failed')
        setEventUsers(prev => ({
          ...prev,
          [activeTab]: (prev[activeTab] || []).filter(x => x.id !== user.id),
        }))
      } else {
        const res = await apiFetch(`/api/register/users/${user.id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('delete failed')
        setAllUsers(u => u.filter(x => x.id !== user.id))
        setEventUsers(prev => {
          const updated = { ...prev }
          for (const eid in updated) updated[eid] = updated[eid].filter(x => x.id !== user.id)
          return updated
        })
      }
      if (expanded === user.id) setExpanded(null)
    } catch {
      alert(isEventTab ? 'Failed to remove user from this event.' : 'Failed to delete user.')
    } finally {
      setDeleting(null)
    }
  }

  function toggleExpand(id) {
    setExpanded(prev => prev === id ? null : id)
  }

  const displayUsers = activeTab === 'all'
    ? allUsers
    : (eventUsers[activeTab] || [])

  const filtered = displayUsers.filter(u =>
    !search.trim() ||
    [u.occupation, u.company, u.industry, u.business_description]
      .some(v => v?.toLowerCase()?.includes(search.toLowerCase()))
  )

  const totalForTab = activeTab === 'all' ? allUsers.length : (eventUsers[activeTab]?.length ?? 0)

  return (
    <div className="ul-page">
      <div className="ul-container">

        {/* Header */}
        <div className="ul-header">
          <div>
            <h1 className="ul-title">
              Registered Users
              <span className="ul-count">{totalForTab}</span>
            </h1>
            <p className="ul-sub">Click a card to see full details or delete a user.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {activeTab !== 'all' && (
              <button
                className="change-btn"
                onClick={handleBulkEnroll}
                disabled={bulkEnrolling || loading}
                title="Adds every non-admin user (who isn't already in another event) to this event"
              >
                {bulkEnrolling ? 'Enrolling…' : '+ Enroll Everyone Else'}
              </button>
            )}
            <button className="change-btn" onClick={fetchAll} disabled={loading}>
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Event tabs */}
        <div className="ul-tabs">
          <button
            className={`ul-tab ${activeTab === 'all' ? 'ul-tab--active' : ''}`}
            onClick={() => { setActiveTab('all'); setExpanded(null) }}
          >
            All Users
            <span className="ul-tab-count">{allUsers.length}</span>
          </button>
          {events.map(ev => (
            <button
              key={ev.id}
              className={`ul-tab ${activeTab === ev.id ? 'ul-tab--active' : ''}`}
              onClick={() => { setActiveTab(ev.id); setExpanded(null) }}
            >
              {ev.name}
              <span className="ul-tab-count">{eventUsers[ev.id]?.length ?? '…'}</span>
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          className="ul-search"
          placeholder="Search by occupation, company, industry or business description..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {/* Empty states */}
        {loading && <p className="muted" style={{ textAlign: 'center', padding: '40px 0' }}>Loading users...</p>}

        {!loading && displayUsers.length === 0 && (
          <div className="ul-empty">
            <div style={{ fontSize: 48, marginBottom: 12 }}>👤</div>
            <p>{activeTab === 'all' ? 'No users registered yet.' : 'No users enrolled in this event.'}</p>
          </div>
        )}

        {!loading && displayUsers.length > 0 && filtered.length === 0 && (
          <div className="ul-empty">
            <p>No users match "<strong>{search}</strong>"</p>
          </div>
        )}

        {/* User list */}
        {!loading && filtered.length > 0 && (
          <div className="users-list">
            {filtered.map(user => (
              <div key={user.id} className="user-card">

                <div className="user-card-header" onClick={() => toggleExpand(user.id)}>
                  <UserAvatar src={user.image_url} name={user.name} imgClass="user-thumb" fallbackClass="user-thumb-placeholder">👤</UserAvatar>
                  <div className="user-info">
                    <div className="user-name">
                      {user.name}
                      {user.status && (
                        <span className={`ul-status-badge ul-status-${user.status}`}>
                          {user.status === 'present' ? '✓ Checked In' : 'Enrolled'}
                        </span>
                      )}
                    </div>
                    <div className="user-date">
                      {user.email || 'No email'}
                      {user.registered_at && (
                        <> · Registered {new Date(user.registered_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</>
                      )}
                    </div>
                  </div>
                  <span className="user-chevron">{expanded === user.id ? '▲' : '▼'}</span>
                </div>

                {expanded === user.id && (
                  <div className="user-details">
                    {user.email && (
                      <div className="detail-row">
                        <span className="detail-icon">✉</span>
                        <span>{user.email}</span>
                      </div>
                    )}
                    {user.phone && (
                      <div className="detail-row">
                        <span className="detail-icon">📞</span>
                        <span>{user.phone}</span>
                      </div>
                    )}
                    {user.occupation && (
                      <div className="detail-row">
                        <span className="detail-icon">💼</span>
                        <span>{user.occupation}</span>
                      </div>
                    )}
                    {user.linkedin && (
                      <div className="detail-row">
                        <span className="detail-icon">🔗</span>
                        <a
                          href={user.linkedin.startsWith('http') ? user.linkedin : `https://${user.linkedin}`}
                          target="_blank"
                          rel="noreferrer"
                          className="detail-link"
                          onClick={e => e.stopPropagation()}
                        >
                          LinkedIn Profile
                        </a>
                      </div>
                    )}

                    {!user.email && !user.phone && !user.occupation && !user.linkedin && (
                      <p className="muted" style={{ fontSize: 13 }}>No additional details on record.</p>
                    )}

                    {user.role !== 'admin' && (
                      <label
                        className="btn-upload-photo"
                        onClick={e => e.stopPropagation()}
                        style={{
                          display: 'inline-block', marginTop: 8, marginRight: 8,
                          padding: '6px 12px', borderRadius: 6,
                          background: 'var(--accent, #6c5ce7)', color: '#fff',
                          fontSize: 13, cursor: uploadingPhoto === user.id ? 'wait' : 'pointer',
                          opacity: uploadingPhoto === user.id ? 0.6 : 1,
                        }}
                      >
                        {uploadingPhoto === user.id
                          ? 'Uploading…'
                          : (user.image_url ? '📷 Change Photo' : '📷 Upload Photo')}
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          disabled={uploadingPhoto === user.id}
                          onChange={e => {
                            const file = e.target.files?.[0]
                            e.target.value = ''
                            handlePhotoUpload(user, file)
                          }}
                        />
                      </label>
                    )}

                    {user.role !== 'admin' && (
                      <button
                        className="btn-delete-full"
                        disabled={deleting === user.id}
                        onClick={e => { e.stopPropagation(); handleDelete(user) }}
                      >
                        {deleting === user.id
                          ? (activeTab === 'all' ? 'Deleting...' : 'Removing...')
                          : (activeTab === 'all' ? '✕ Delete User' : '✕ Remove from Event')}
                      </button>
                    )}
                  </div>
                )}

              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
