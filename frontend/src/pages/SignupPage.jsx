import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../config'

export default function SignupPage() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', linkedin: '', occupation: '' })
  const [preview, setPreview] = useState(null)
  const [uploadFile, setUploadFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [done, setDone] = useState(false)

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
    if (uploadFile) fd.append('image', uploadFile)

    try {
      const res = await apiFetch('/api/auth/signup', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        showStatus('error', data.detail || 'Registration failed.')
      } else {
        setDone(true)
      }
    } catch {
      showStatus('error', 'Network error. Make sure the backend is running.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="sr-page">
        <div className="sr-card" style={{ textAlign: 'center', padding: '56px 40px' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: 20 }}>✓</div>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: 10 }}>
            You're registered!
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 32, lineHeight: 1.7 }}>
            Your account has been created.
          </p>
          <Link to="/login" className="sr-submit" style={{ display: 'inline-block', textDecoration: 'none', padding: '13px 40px' }}>
            Sign In
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="sr-page">
      <div className="sr-card">
        <div className="sr-header">
          <h1 className="sr-title">Create Account</h1>
          <p className="sr-sub">Fill in your details to get started.</p>
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

          <div className="sr-photo-section">
            <label>Profile Photo <span className="sr-hint" style={{ fontWeight: 400 }}>(optional)</span></label>
            <div className="sr-photo-area">
              <input type="file" accept="image/*" id="sp-file" className="sr-hidden"
                onChange={handleFileChange} disabled={submitting} />
              {!preview ? (
                <label htmlFor="sp-file" className="sr-drop">
                  <div className="sr-drop-icon">+</div>
                  <span>Click to upload a photo</span>
                  <span className="sr-drop-hint">JPG, PNG</span>
                </label>
              ) : (
                <div className="sr-preview-wrap">
                  <img src={preview} alt="preview" className="sr-preview" />
                  <label htmlFor="sp-file" className="sr-retake">Change Photo</label>
                </div>
              )}
            </div>
          </div>

          {status && (
            <div className={`sr-status ${status}`}>{statusMsg}</div>
          )}

          <button type="submit" className="sr-submit" disabled={submitting}>
            {submitting ? 'Registering...' : 'Create Account'}
          </button>

          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', marginTop: -8 }}>
            Already have an account?{' '}
            <Link to="/login" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
              Sign in
            </Link>
          </p>

        </form>
      </div>
    </div>
  )
}
