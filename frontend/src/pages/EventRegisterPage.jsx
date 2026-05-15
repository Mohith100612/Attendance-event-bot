import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../config'

export default function EventRegisterPage() {
  const { eventId } = useParams()

  const [form, setForm] = useState({ name: '', email: '', phone: '', linkedin: '', occupation: '', company: '', industry: '', website: '', business_description: '' })
  const [preview, setPreview] = useState(null)
  const [uploadFile, setUploadFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [eventName, setEventName] = useState(null)
  const [eventNotFound, setEventNotFound] = useState(false)

  useEffect(() => {
    if (!eventId) return
    apiFetch('/api/events')
      .then(r => r.json())
      .then(events => {
        const ev = events.find(e => e.id === Number(eventId))
        if (ev) setEventName(ev.name)
        else setEventNotFound(true)
      })
      .catch(() => {})
  }, [eventId])

  function handleField(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploadFile(file)
    setPreview(URL.createObjectURL(file))
  }

  function showStatus(type, msg) {
    setStatus(type)
    setStatusMsg(msg)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return showStatus('error', 'Full name is required.')

    setSubmitting(true)
    setStatus(null)

    const fd = new FormData()
    fd.append('name', form.name.trim())
    if (form.email.trim()) fd.append('email', form.email.trim())
    if (form.phone.trim()) fd.append('phone', form.phone.trim())
    if (form.linkedin.trim()) fd.append('linkedin', form.linkedin.trim())
    if (form.occupation.trim()) fd.append('occupation', form.occupation.trim())
    if (form.company.trim()) fd.append('company', form.company.trim())
    if (form.industry.trim()) fd.append('industry', form.industry.trim())
    if (form.website.trim()) fd.append('website', form.website.trim())
    if (form.business_description.trim()) fd.append('business_description', form.business_description.trim())
    fd.append('event_id', eventId)
    if (uploadFile) fd.append('image', uploadFile)

    try {
      const res = await apiFetch('/api/auth/signup', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        showStatus('error', data.detail || 'Registration failed.')
      } else {
        showStatus('success', `Successfully registered for "${eventName || 'the event'}"! You're all set.`)
        setForm({ name: '', email: '', phone: '', linkedin: '', occupation: '', company: '', industry: '', website: '', business_description: '' })
        setPreview(null)
        setUploadFile(null)
      }
    } catch {
      showStatus('error', 'Network error. Make sure the backend is running.')
    } finally {
      setSubmitting(false)
    }
  }

  if (eventNotFound) {
    return (
      <div className="sr-page">
        <div className="sr-card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>⚠</div>
          <h2 style={{ marginBottom: 8 }}>Event Not Found</h2>
          <p style={{ color: 'var(--muted, #888)' }}>This event no longer exists. Ask the organiser for the correct registration link.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="sr-page">
      <div className="sr-card">
        <div className="sr-header">
          <h1 className="sr-title">Register</h1>
          {eventName
            ? <p className="sr-sub">Registering for <strong>{eventName}</strong>. Fill in your details below.</p>
            : <p className="sr-sub">Loading event details…</p>
          }
        </div>

        <form onSubmit={handleSubmit} className="sr-form">

          <div className="sr-row">
            <div className="sr-field">
              <label>Full Name <span className="req">*</span></label>
              <input name="name" placeholder="John Doe" value={form.name}
                onChange={handleField} disabled={submitting} />
            </div>
            <div className="sr-field">
              <label>Email Address</label>
              <input name="email" type="email" placeholder="john@example.com" value={form.email}
                onChange={handleField} disabled={submitting} />
            </div>
          </div>

          <div className="sr-row">
            <div className="sr-field">
              <label>Phone Number</label>
              <input name="phone" placeholder="+91 98765 43210" value={form.phone}
                onChange={handleField} disabled={submitting} />
            </div>
            <div className="sr-field">
              <label>Occupation</label>
              <input name="occupation" placeholder="Software Engineer" value={form.occupation}
                onChange={handleField} disabled={submitting} />
            </div>
          </div>

          <div className="sr-field">
            <label>LinkedIn Profile URL</label>
            <input name="linkedin" placeholder="https://linkedin.com/in/yourprofile"
              value={form.linkedin} onChange={handleField} disabled={submitting} />
          </div>

          <div className="sr-row">
            <div className="sr-field">
              <label>Company</label>
              <input name="company" placeholder="Acme Corp" value={form.company}
                onChange={handleField} disabled={submitting} />
            </div>
            <div className="sr-field">
              <label>Industry</label>
              <input name="industry" placeholder="SaaS / Healthcare / Fintech" value={form.industry}
                onChange={handleField} disabled={submitting} />
            </div>
          </div>

          <div className="sr-field">
            <label>Website</label>
            <input name="website" placeholder="https://yourcompany.com"
              value={form.website} onChange={handleField} disabled={submitting} />
          </div>

          <div className="sr-field">
            <label>Business Description</label>
            <textarea name="business_description" placeholder="What does your business do…"
              value={form.business_description} onChange={handleField} disabled={submitting}
              className="sr-textarea" rows={3} />
          </div>

          <div className="sr-photo-section">
            <label>Profile Photo <span className="sr-hint" style={{ fontWeight: 400 }}>(optional)</span></label>
            <div className="sr-photo-area">
              <input type="file" accept="image/*" id="er-file" className="sr-hidden"
                onChange={handleFileChange} disabled={submitting} />
              {!preview ? (
                <label htmlFor="er-file" className="sr-drop">
                  <div className="sr-drop-icon">+</div>
                  <span>Click to upload a photo</span>
                  <span className="sr-drop-hint">JPG, PNG</span>
                </label>
              ) : (
                <div className="sr-preview-wrap">
                  <img src={preview} alt="preview" className="sr-preview" />
                  <label htmlFor="er-file" className="sr-retake">Change Photo</label>
                </div>
              )}
            </div>
          </div>

          {status && (
            <div className={`sr-status ${status}`}>{statusMsg}</div>
          )}

          <button type="submit" className="sr-submit" disabled={submitting || !eventName}>
            {submitting ? 'Registering...' : 'Register'}
          </button>
        </form>
      </div>
    </div>
  )
}
