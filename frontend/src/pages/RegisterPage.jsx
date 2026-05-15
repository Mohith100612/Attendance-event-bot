import { useState, useEffect } from 'react'
import { apiFetch } from '../config'

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', linkedin: '', occupation: '', company: '', industry: '', business_description: '' })
  const [preview, setPreview] = useState(null)
  const [uploadFile, setUploadFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState(null)
  const [statusMsg, setStatusMsg] = useState('')

  const [events, setEvents] = useState([])
  const [selectedEvent, setSelectedEvent] = useState('')

  useEffect(() => {
    apiFetch('/api/events')
      .then(r => r.json())
      .then(data => setEvents(data))
      .catch(() => {})
  }, [])

  const [sheetUrl, setSheetUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  const [csvFile, setCsvFile] = useState(null)
  const [imageFiles, setImageFiles] = useState([])
  const [csvEvent, setCsvEvent] = useState('')
  const [csvImporting, setCsvImporting] = useState(false)
  const [csvResult, setCsvResult] = useState(null)

  function handleField(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploadFile(file)
    setPreview(URL.createObjectURL(file))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return showStatus('error', 'Full name is required.')
    if (!selectedEvent) return showStatus('error', 'Please select an event.')

    setSubmitting(true)
    setStatus(null)

    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => {
      fd.append(k, v.trim())
    })
    if (selectedEvent) fd.append('event_id', selectedEvent)
    if (uploadFile) fd.append('image', uploadFile)

    try {
      const res = await apiFetch('/api/register', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        showStatus('error', data.detail || 'Registration failed.')
      } else {
        const evtMsg = data.event_name ? ` for "${data.event_name}"` : ''
        showStatus('success', `${data.name} registered successfully${evtMsg}!`)
        setForm({ name: '', email: '', phone: '', linkedin: '', occupation: '', company: '', industry: '', business_description: '' })
        setSelectedEvent('')
        setPreview(null)
        setUploadFile(null)
      }
    } catch {
      showStatus('error', 'Network error. Make sure the backend is running.')
    } finally {
      setSubmitting(false)
    }
  }

  function showStatus(type, msg) {
    setStatus(type)
    setStatusMsg(msg)
  }

  async function handleCsvImport() {
    if (!csvFile) return
    setCsvImporting(true)
    setCsvResult(null)
    try {
      const fd = new FormData()
      fd.append('csv_file', csvFile)
      for (const img of imageFiles) fd.append('images', img)
      if (csvEvent.trim()) fd.append('event_name', csvEvent.trim())

      const res = await apiFetch('/api/import/csv-upload', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = data?.detail
        const msg = typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail.map(d => `${(d.loc || []).join('.')}: ${d.msg}`).join(' · ')
            : `HTTP ${res.status}`
        setCsvResult({ success: false, error: msg })
      } else {
        setCsvResult(data)
      }
    } catch (e) {
      setCsvResult({ success: false, error: `Network error: ${e?.message || 'backend not reachable'}` })
    } finally {
      setCsvImporting(false)
    }
  }

  async function handleImport() {
    if (!sheetUrl.trim()) return
    setImporting(true)
    setImportResult(null)
    try {
      const res = await apiFetch('/api/import/google-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet_url: sheetUrl.trim() }),
      })
      const data = await res.json()
      setImportResult(data)
    } catch {
      setImportResult({ success: false, error: 'Network error. Make sure the backend is running.' })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="sr-page">
      <div className="sr-card">

        <div className="sr-header">
          <h1 className="sr-title">Spotregister</h1>
          <p className="sr-sub">Fill in the details and select your event. You will be enrolled in the event you register under.</p>
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
            <label>Business Description</label>
            <textarea name="business_description" placeholder="What does your business do…"
              value={form.business_description} onChange={handleField} disabled={submitting}
              className="sr-textarea" rows={3} />
          </div>

          <div className="sr-field">
            <label>Event Name <span className="req">*</span></label>
            <select
              value={selectedEvent}
              onChange={e => setSelectedEvent(e.target.value)}
              disabled={submitting}
              className="sr-select"
            >
              <option value="">— Select the event you are registering for —</option>
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
            {events.length === 0
              ? <span className="sr-hint">No events created yet. Ask the organiser to create an event first.</span>
              : <span className="sr-hint">You will only be enrolled in the event you select here.</span>
            }
          </div>

          <div className="sr-photo-section">
            <label>Profile Photo <span className="sr-hint" style={{ fontWeight: 400 }}>(optional)</span></label>
            <div className="sr-photo-area">
              <input type="file" accept="image/*" id="sr-file" className="sr-hidden"
                onChange={handleFileChange} disabled={submitting} />
              {!preview ? (
                <label htmlFor="sr-file" className="sr-drop">
                  <div className="sr-drop-icon">+</div>
                  <span>Click to upload a photo</span>
                  <span className="sr-drop-hint">JPG, PNG</span>
                </label>
              ) : (
                <div className="sr-preview-wrap">
                  <img src={preview} alt="preview" className="sr-preview" />
                  <label htmlFor="sr-file" className="sr-retake">Change Photo</label>
                </div>
              )}
            </div>
          </div>

          {status && (
            <div className={`sr-status ${status}`}>{statusMsg}</div>
          )}

          <button type="submit" className="sr-submit" disabled={submitting}>
            {submitting ? 'Registering...' : 'Register'}
          </button>

        </form>
      </div>
      <div className="sr-card import-card">
        <div className="sr-header">
          <h1 className="sr-title">Bulk Import from Google Sheet</h1>
          <p className="sr-sub">
            Paste your Google Sheet URL to register everyone at once. The sheet must be shared as
            <strong> "Anyone with the link can view"</strong>.
          </p>
        </div>

        <div className="import-columns-hint">
          Expected column headers (exact, case-insensitive):
          <code>name &nbsp;|&nbsp; gmail &nbsp;|&nbsp; phone no &nbsp;|&nbsp; occupation &nbsp;|&nbsp; company &nbsp;|&nbsp; industry &nbsp;|&nbsp; business description &nbsp;|&nbsp; linkedin &nbsp;|&nbsp; photo &nbsp;|&nbsp; event name</code>
          <br />
          The <em>photo</em> column is optional and may contain a Google Drive sharing link or a direct image URL.
        </div>

        <div className="import-row">
          <input
            className="import-url-input"
            placeholder="https://docs.google.com/spreadsheets/d/..."
            value={sheetUrl}
            onChange={e => setSheetUrl(e.target.value)}
            disabled={importing}
          />
          <button
            className="sr-submit import-btn"
            onClick={handleImport}
            disabled={importing || !sheetUrl.trim()}
          >
            {importing ? 'Importing...' : 'Import'}
          </button>
        </div>

        {importing && (
          <div className="import-progress">
            Processing rows — downloading photos. This may take a minute...
          </div>
        )}

        {importResult && (
          <div className={`import-result ${importResult.success ? 'success' : 'error'}`}>
            {!importResult.success ? (
              <p>Error: {importResult.error}</p>
            ) : (
              <>
                <p>
                  <strong>✓ {importResult.imported} registered</strong>
                  {importResult.skipped > 0 && <span> &nbsp;·&nbsp; ⚠ {importResult.skipped} skipped</span>}
                </p>
                {importResult.events_created?.length > 0 && (
                  <p>Events created: {importResult.events_created.join(', ')}</p>
                )}
                {importResult.errors?.length > 0 && (
                  <details className="import-errors">
                    <summary>Show skipped ({importResult.errors.length})</summary>
                    <ul>
                      {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="sr-card import-card">
        <div className="sr-header">
          <h1 className="sr-title">Bulk Import from Local CSV + Images</h1>
          <p className="sr-sub">
            Upload a <code>.csv</code> file and the matching photo files together. Existing users
            (matched by email) keep their data — only missing fields and photos are filled in.
            New users are created and enrolled in the event below.
          </p>
        </div>

        <div className="import-columns-hint">
          Expected CSV headers (any subset, case-insensitive):
          <code>full_name &nbsp;|&nbsp; email &nbsp;|&nbsp; phone &nbsp;|&nbsp; company &nbsp;|&nbsp; industry &nbsp;|&nbsp; business_description &nbsp;|&nbsp; image_filename</code>
          <br />
          The <em>image_filename</em> column should reference one of the photo files you upload
          (folder prefix like <code>images/</code> is OK — only the file name is used).
        </div>

        <div className="sr-field">
          <label>CSV File <span className="req">*</span></label>
          <input
            type="file"
            accept=".csv"
            disabled={csvImporting}
            onChange={e => setCsvFile(e.target.files?.[0] || null)}
          />
          {csvFile && <span className="sr-hint">Selected: {csvFile.name}</span>}
        </div>

        <div className="sr-field">
          <label>Photo Files <span className="sr-hint" style={{ fontWeight: 400 }}>(select all images at once)</span></label>
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={csvImporting}
            onChange={e => setImageFiles(Array.from(e.target.files || []))}
          />
          {imageFiles.length > 0 && <span className="sr-hint">{imageFiles.length} image(s) selected</span>}
        </div>

        <div className="sr-field">
          <label>Enroll Everyone In Event <span className="sr-hint" style={{ fontWeight: 400 }}>(optional — leave blank to only update profiles)</span></label>
          <select
            value={csvEvent}
            onChange={e => setCsvEvent(e.target.value)}
            disabled={csvImporting}
            className="sr-select"
          >
            <option value="">— Don't enroll —</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.name}>{ev.name}</option>
            ))}
          </select>
        </div>

        <button
          className="sr-submit import-btn"
          onClick={handleCsvImport}
          disabled={csvImporting || !csvFile}
        >
          {csvImporting ? 'Importing…' : 'Import CSV + Photos'}
        </button>

        {csvImporting && (
          <div className="import-progress">
            Uploading files and processing rows…
          </div>
        )}

        {csvResult && (
          <div className={`import-result ${csvResult.success ? 'success' : 'error'}`}>
            {!csvResult.success ? (
              <p>Error: {csvResult.error || 'Import failed.'}</p>
            ) : (
              <>
                <p>
                  <strong>✓ {csvResult.inserted} new · {csvResult.updated} updated</strong>
                  {csvResult.enrolled_in_event > 0 && (
                    <span> &nbsp;·&nbsp; 🎫 {csvResult.enrolled_in_event} enrolled in {csvResult.event_name}</span>
                  )}
                  {csvResult.skipped > 0 && <span> &nbsp;·&nbsp; ⚠ {csvResult.skipped} issues</span>}
                </p>
                {csvResult.event_created && (
                  <p>Event created: {csvResult.event_name}</p>
                )}
                {csvResult.errors?.length > 0 && (
                  <details className="import-errors">
                    <summary>Show issues ({csvResult.errors.length})</summary>
                    <ul>
                      {csvResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
