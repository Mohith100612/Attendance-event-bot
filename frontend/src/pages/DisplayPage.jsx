import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import confetti from 'canvas-confetti'
import { API_BASE, WS_BASE, apiFetch } from '../config'
import UserAvatar from '../components/UserAvatar'

const WS_URL = `${WS_BASE}/ws/display`
const REFRESH_MS = 5000
const SEARCH_API = 'http://13.126.130.56:8003'

/* ── Clock ─────────────────────────────────────────────────────── */
function Clock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="dp-clock">
      {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </div>
  )
}

/* ── Idle screen ────────────────────────────────────────────────── */
function IdleScreen({ connected, eventName }) {
  return (
    <div className="dp-idle">
      <div className="dp-pulse-wrap">
        <div className="dp-pulse-ring" />
        <div className="dp-pulse-dot" />
      </div>
      <div className="dp-brand">Attend</div>
      {eventName && <div className="dp-idle-event">{eventName}</div>}
      <Clock />
      <div className="dp-idle-sub">
        {connected ? 'Live attendance display' : 'Connecting to server…'}
      </div>
    </div>
  )
}

/* ── Face-scan result card ──────────────────────────────────────── */
function DetailRow({ label, value }) {
  if (!value) return null
  return (
    <div className="dp-detail-row">
      <span className="dp-detail-label">{label}</span>
      <span className="dp-detail-value">{value}</span>
    </div>
  )
}

function PersonCard({ data }) {
  const { user, event_name, timestamp, type } = data
  const isNotEnrolled = type === 'not_enrolled'
  const checkedIn = user.already_attended
  const time = new Date(timestamp + 'Z').toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  return (
    <div className={`dp-card ${isNotEnrolled ? 'dp-card--warn' : ''}`}>
      <div className="dp-photo-side">
        <UserAvatar src={user.image_url} name={user.name} imgClass="dp-photo" fallbackClass="dp-photo dp-photo--placeholder" apiBase={API_BASE}>
          {user.name?.[0]?.toUpperCase()}
        </UserAvatar>
      </div>
      <div className="dp-info-side">
        <div className="dp-name">{user.name}</div>
        {isNotEnrolled ? (
          <div className="dp-badge dp-badge--warn">⚠ Not Enrolled for This Event</div>
        ) : checkedIn ? (
          <div className="dp-badge dp-badge--already">✓ Already Checked In</div>
        ) : (
          <div className="dp-badge dp-badge--present">✓ Checked In</div>
        )}
        {event_name && <div className="dp-event-name">◆ {event_name}</div>}
        <div className="dp-time">{time}</div>
        {!isNotEnrolled && (
          <div className="dp-details">
            <DetailRow label="Email"       value={user.email} />
            <DetailRow label="Phone"       value={user.phone} />
            <DetailRow label="Occupation"  value={user.occupation} />
            <DetailRow label="Company"     value={user.company} />
            <DetailRow label="LinkedIn"    value={user.linkedin} />
            <DetailRow label="About"       value={user.business_description} />
          </div>
        )}
        {isNotEnrolled && (
          <p className="dp-not-enrolled-msg">
            Please go to the Spotregister desk to register for this event.
          </p>
        )}
      </div>
    </div>
  )
}

/* ── Local search (fallback) ───────────────────────────────────── */
const SYNONYMS = {
  ai:         ['artificial intelligence', 'machine learning', 'deep learning', 'neural', 'nlp', 'llm', 'generative'],
  ml:         ['machine learning', 'data science', 'deep learning', 'artificial intelligence', 'neural'],
  cyber:      ['security', 'cybersecurity', 'infosec', 'penetration', 'ethical hacking', 'soc', 'vulnerability'],
  security:   ['cybersecurity', 'infosec', 'penetration testing', 'ethical hacking', 'firewall', 'soc'],
  data:       ['analytics', 'analysis', 'scientist', 'engineer', 'warehouse', 'pipeline', 'bi', 'intelligence'],
  devops:     ['sre', 'platform', 'infrastructure', 'cloud', 'kubernetes', 'docker', 'reliability'],
  cloud:      ['aws', 'azure', 'gcp', 'infrastructure', 'devops', 'terraform', 'serverless'],
  frontend:   ['react', 'vue', 'angular', 'ui', 'ux', 'web', 'javascript', 'typescript', 'css'],
  backend:    ['api', 'server', 'node', 'python', 'java', 'golang', 'microservices', 'django', 'spring'],
  fullstack:  ['full stack', 'fullstack', 'mern', 'mean', 'frontend', 'backend'],
  mobile:     ['ios', 'android', 'flutter', 'react native', 'swift', 'kotlin', 'app'],
  product:    ['product manager', 'product owner', 'pm', 'agile', 'scrum', 'roadmap'],
  design:     ['ux', 'ui', 'figma', 'user experience', 'user interface', 'designer', 'creative'],
  blockchain: ['web3', 'crypto', 'ethereum', 'solidity', 'nft', 'defi', 'smart contract'],
  research:   ['phd', 'scientist', 'researcher', 'academic', 'lab', 'publication'],
  manager:    ['lead', 'head', 'director', 'vp', 'chief', 'cto', 'ceo', 'engineering manager'],
  embedded:   ['firmware', 'iot', 'rtos', 'hardware', 'microcontroller', 'arduino', 'raspberry'],
  game:       ['unity', 'unreal', 'game developer', 'gamedev', '3d', 'graphics'],
}

function _norm(t) { return t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim() }

function _expandTokens(query) {
  const tokens = new Set(_norm(query).split(/\s+/).filter(Boolean))
  for (const tok of [...tokens]) {
    const syns = SYNONYMS[tok] || []
    for (const s of syns) _norm(s).split(/\s+/).filter(Boolean).forEach(w => tokens.add(w))
  }
  return tokens
}

function _scoreParticipant(p, query, tokens) {
  const fields = []
  if (p.occupation) fields.push({ text: _norm(p.occupation), w: 4, label: p.occupation })
  if (p.business_description) fields.push({ text: _norm(p.business_description), w: 3, label: 'business description' })
  if (p.company) fields.push({ text: _norm(p.company), w: 3, label: p.company })
  if (p.linkedin) {
    const parts = p.linkedin.replace(/\/$/, '').split('/')
    const i = parts.indexOf('in')
    if (i >= 0 && i + 1 < parts.length) {
      const handle = _norm(parts[i + 1].replace(/-/g, ' '))
      if (handle) fields.push({ text: handle, w: 3, label: 'LinkedIn profile' })
    }
  }
  if (p.email?.includes('@')) {
    fields.push({ text: _norm(p.email.split('@')[1].split('.')[0]), w: 1, label: 'email domain' })
  }

  let score = 0
  const hits = new Set()
  for (const tok of tokens) {
    for (const f of fields) {
      if (f.text.includes(tok) && !hits.has(f.label)) { score += f.w; hits.add(f.label) }
    }
  }
  const qn = _norm(query)
  if (fields.some(f => f.text.includes(qn))) score += 3

  const max = tokens.size * 4 + 3
  const pct = max > 0 ? Math.min(100, Math.round((score / max) * 150)) : 0

  let reason = ''
  if (hits.size > 0) {
    const [first, ...rest] = [...hits]
    reason = first === 'LinkedIn profile' ? 'Found in LinkedIn profile keywords'
           : first === 'email domain'     ? 'Matched via email domain'
           : first === 'business description' ? 'Matched in business description'
           : `Occupation: ${first}`
    if (rest.length) reason += ` · ${rest.length} more signal${rest.length > 1 ? 's' : ''}`
  }
  return { score: pct, reason }
}

function searchLocally(participants, query) {
  if (!query.trim()) return []
  const tokens = _expandTokens(query)
  return participants
    .map(p => { const { score, reason } = _scoreParticipant(p, query, tokens); return { ...p, score, reason } })
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
}

/* ── Remote search engine (semantic vector search over attendees) ─ */
async function searchRemote(query, signal) {
  const url = `${SEARCH_API}/search?q=${encodeURIComponent(query)}&limit=50`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Search API ${res.status}`)
  const data = await res.json()
  // data.results = [{ id, full_name, role, organization, experience_level, detailed_profile, linkedin_url, score }]
  return data.results || []
}

/* Push our locally-registered participants into the search index so
   they show up in semantic search results. Best-effort, non-blocking. */
async function bulkIndexParticipants(participants) {
  const payload = participants
    .filter(p => p.name)
    .map(p => ({
      id: String(p.id),
      full_name: p.name,
      email: p.email || `attendee-${p.id}@local.invalid`,
      phone: p.phone || null,
      organization: p.company || p.occupation || 'Independent',
      role: p.occupation || (p.company ? 'Team member' : 'Attendee'),
      detailed_profile: p.business_description || null,
      linkedin_url: p.linkedin || null,
    }))
  if (!payload.length) return
  try {
    await fetch(`${SEARCH_API}/attendees/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    /* best-effort */
  }
}

/* Map a remote search result onto our participant shape. If the
   remote id matches one of our local participants, enrich with the
   local fields (photo, phone, etc.). Otherwise render the remote
   attendee as-is so it's still useful. */
function mergeRemoteResult(r, localById) {
  const local = localById.get(String(r.id))
  const score = Math.round((r.score || 0) * 100)
  const reason = [r.experience_level, r.organization].filter(Boolean).join(' · ') || 'Semantic match'
  if (local) return { ...local, score, reason, _remote: true }
  return {
    id: r.id,
    name: r.full_name,
    occupation: r.role,
    company: r.organization,
    business_description: r.detailed_profile,
    linkedin: r.linkedin_url,
    score,
    reason,
    _remote: true,
    _experience: r.experience_level,
  }
}

/* ── Profile body (shared by swipe view) ───────────────────────── */
function ProfileBody({ person: p }) {
  return (
    <>
      <div className="dp-modal-body">
        <div className="dp-modal-left">
          <UserAvatar src={p.image_url} name={p.name} imgClass="dp-modal-img" fallbackClass="dp-modal-img-fallback" apiBase={API_BASE}>
            {p.name?.[0]?.toUpperCase()}
          </UserAvatar>
          <div className="dp-modal-name">{p.name}</div>
          {p.company && <div className="dp-modal-company">{p.company}</div>}
          {p.occupation && <div className="dp-modal-occ">{p.occupation}</div>}
          <div className="dp-badge dp-badge--present dp-modal-badge">✓ Checked In</div>
        </div>

        <div className="dp-modal-right">
          <div className="dp-modal-details">
            {p.email    && <div className="dp-modal-row"><span className="dp-modal-icon">✉</span><span>{p.email}</span></div>}
            {p.phone    && <div className="dp-modal-row"><span className="dp-modal-icon">📞</span><span>{p.phone}</span></div>}
            {p.linkedin && (
              <div className="dp-modal-row">
                <span className="dp-modal-icon">🔗</span>
                <a href={p.linkedin} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all', color: 'inherit' }}>{p.linkedin}</a>
              </div>
            )}
            {p.industry && <div className="dp-modal-row"><span className="dp-modal-icon">🏷</span><span>{p.industry}</span></div>}
            {p.website  && (
              <div className="dp-modal-row">
                <span className="dp-modal-icon">🌐</span>
                <a href={p.website} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all', color: 'inherit' }}>{p.website}</a>
              </div>
            )}
            {p.checked_in_at && (
              <div className="dp-modal-row">
                <span className="dp-modal-icon">🕐</span>
                <span>{new Date(p.checked_in_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {p.business_description && (
        <div className="dp-modal-bio dp-modal-business">
          <div className="dp-modal-bio-label">Company description</div>
          <div className="dp-modal-bio-text">{p.business_description}</div>
        </div>
      )}
    </>
  )
}

/* ── Search overlay (used inside swipe view) ───────────────────── */
function ParticipantSearch({ participants, onClose, onSelect }) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const inputRef  = useRef(null)
  const timerRef  = useRef(null)
  const abortRef  = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const runSearch = (q) => {
    if (!q.trim()) { setResults([]); return }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    searchRemote(q, ctrl.signal)
      .then(arr => {
        const byId = new Map(participants.map(p => [String(p.id), p]))
        setResults(arr.map(r => mergeRemoteResult(r, byId)))
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setResults(searchLocally(participants, q))
      })
      .finally(() => setLoading(false))
  }

  const handleInput = (e) => {
    const val = e.target.value
    setQuery(val)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => runSearch(val), 280)
  }

  const HINTS = ['Cyber Security', 'Data Scientist', 'AI Engineer', 'Product Manager', 'Full Stack Developer', 'DevOps', 'Mobile Developer', 'Designer']

  return (
    <div className="dp-search-overlay">
      <div className="dp-search-header">
        <button className="dp-search-back" onClick={onClose}>← Back</button>
        <div className="dp-search-input-wrap">
          <span className="dp-search-icon-prefix">🔍</span>
          <input
            ref={inputRef}
            className="dp-search-input"
            placeholder="Search by role, skill or field…"
            value={query}
            onChange={handleInput}
            autoComplete="off"
            spellCheck="false"
          />
          {loading && <span className="dp-dir-spinner" />}
          {query && !loading && (
            <button className="dp-search-clear"
              onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus() }}>✕</button>
          )}
        </div>
      </div>

      <div className="dp-search-body">
        {!query && (
          <div className="dp-search-hints">
            <div className="dp-search-hints-label">Try searching for:</div>
            <div className="dp-search-hint-chips">
              {HINTS.map(h => (
                <button key={h} className="dp-search-hint-chip"
                  onClick={() => { setQuery(h); runSearch(h) }}>{h}</button>
              ))}
            </div>
          </div>
        )}
        {query && results.length === 0 && !loading && (
          <div className="dp-search-state">No participants found for "<strong>{query}</strong>"</div>
        )}
        {results.length > 0 && (
          <div className="dp-search-results">
            <div className="dp-search-count">{results.length} match{results.length !== 1 ? 'es' : ''} found</div>
            {results.map(p => (
              <div key={p.id} className="dp-search-card" onClick={() => onSelect(p)}>
                <UserAvatar src={p.image_url} name={p.name}
                  imgClass="dp-search-photo" fallbackClass="dp-search-avatar" apiBase={API_BASE}>
                  {p.name?.[0]?.toUpperCase()}
                </UserAvatar>
                <div className="dp-search-card-body">
                  <div className="dp-search-card-name">{p.name}</div>
                  {(p.company || p.occupation) && (
                    <div className="dp-search-card-occ">{p.company || p.occupation}</div>
                  )}
                  {p.reason && <div className="dp-search-card-reason">✦ {p.reason}</div>}
                </div>
                {typeof p.score === 'number' && p.score > 0 && (
                  <div className="dp-search-card-score">{p.score}%</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Swipeable participant profile with 3D page-flip ──────────── */
function ParticipantSwipeView({ participants, startIndex, eventName, onBack }) {
  const [index, setIndex]           = useState(startIndex)

  /* Flip-animation refs (carry the OLD page through the rotation) */
  const [prevSnap, setPrevSnap]     = useState(null)
  const [isFlipping, setIsFlipping] = useState(false)
  const [flipDir, setFlipDir]       = useState(null)
  const containerRef  = useRef(null)
  const canvasRef     = useRef(null)
  const flatLayerRef  = useRef(null)
  const turnWrapRef   = useRef(null)
  const turnInnerRef  = useRef(null)
  const animRef       = useRef(null)
  const prevPersonRef = useRef(participants[startIndex])
  const prevIndexRef  = useRef(startIndex)
  const flipDirRef    = useRef(null)
  const firstRender   = useRef(true)

  /* Swipe input refs */
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const mouseStartX = useRef(null)

  /* Push current participants into the remote search index so semantic
     queries return them. Best-effort, runs once per participant-count. */
  const indexedRef = useRef(0)
  useEffect(() => {
    if (participants.length && participants.length !== indexedRef.current) {
      indexedRef.current = participants.length
      bulkIndexParticipants(participants)
    }
  }, [participants])

  /* Clamp index when participants shrinks (e.g. event refresh) */
  useEffect(() => {
    if (index >= participants.length && participants.length > 0) {
      setIndex(participants.length - 1)
    }
  }, [participants.length, index])

  /* Trigger the page-flip whenever index changes */
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      prevPersonRef.current = participants[index]
      prevIndexRef.current  = index
      return
    }
    if (prevIndexRef.current !== index && flipDirRef.current) {
      const dir = flipDirRef.current
      flipDirRef.current = null
      setPrevSnap({ person: prevPersonRef.current, index: prevIndexRef.current })
      setFlipDir(dir)
      setIsFlipping(true)
      startFlip(dir)
    }
    prevPersonRef.current = participants[index]
    prevIndexRef.current  = index
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, participants])

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current) }, [])

  const startFlip = (dir) => {
    let t0 = null
    const DURATION = 600
    const tick = (ts) => {
      if (!t0) t0 = ts
      const raw = Math.min((ts - t0) / DURATION, 1)
      const t   = raw < 0.5 ? 4 * raw ** 3 : 1 - (-2 * raw + 2) ** 3 / 2
      updateFrame(t, dir)
      if (raw < 1) {
        animRef.current = requestAnimationFrame(tick)
      } else {
        const cv = canvasRef.current
        if (cv) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height)
        setIsFlipping(false)
        setPrevSnap(null)
        setFlipDir(null)
      }
    }
    animRef.current = requestAnimationFrame(tick)
  }

  const updateFrame = (t, dir) => {
    const root = containerRef.current
    if (!root) return
    const W = root.offsetWidth
    const H = root.offsetHeight

    const foldX = dir === 'next' ? W * (1 - t) : W * t
    const turnW = dir === 'next' ? W - foldX : foldX
    const angle = t * 90

    if (flatLayerRef.current) {
      flatLayerRef.current.style.clipPath = dir === 'next'
        ? `inset(0 ${Math.round(W - foldX)}px 0 0)`
        : `inset(0 0 0 ${Math.round(foldX)}px)`
    }

    if (turnWrapRef.current) {
      const el = turnWrapRef.current
      if (dir === 'next') {
        el.style.left            = `${foldX}px`
        el.style.width           = `${turnW}px`
        el.style.transformOrigin = 'left center'
        el.style.transform       = `perspective(1200px) rotateY(${-angle}deg)`
      } else {
        el.style.left            = '0px'
        el.style.width           = `${turnW}px`
        el.style.transformOrigin = 'right center'
        el.style.transform       = `perspective(1200px) rotateY(${angle}deg)`
      }
    }
    if (turnInnerRef.current) {
      turnInnerRef.current.style.left  = dir === 'next' ? `-${foldX}px` : '0px'
      turnInnerRef.current.style.width = `${W}px`
    }

    const cv = canvasRef.current
    if (!cv) return
    cv.width  = W
    cv.height = H
    const ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, W, H)

    /* Shadow ahead of fold on the newly revealed page */
    const shadowW = W * 0.055
    ctx.save()
    if (dir === 'next') {
      const sg = ctx.createLinearGradient(Math.max(0, foldX - shadowW), 0, foldX, 0)
      sg.addColorStop(0, 'rgba(0,0,0,0)')
      sg.addColorStop(1, 'rgba(0,0,0,0.55)')
      ctx.fillStyle = sg
      ctx.fillRect(Math.max(0, foldX - shadowW), 0, Math.min(shadowW, foldX), H)
    } else {
      const sg = ctx.createLinearGradient(foldX, 0, Math.min(W, foldX + shadowW), 0)
      sg.addColorStop(0, 'rgba(0,0,0,0.55)')
      sg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = sg
      ctx.fillRect(foldX, 0, Math.min(shadowW, W - foldX), H)
    }
    ctx.restore()

    /* Crease line at the fold */
    ctx.save()
    ctx.strokeStyle = 'rgba(220,210,255,0.95)'
    ctx.lineWidth   = 1.5
    ctx.shadowColor = 'rgba(180,160,255,0.5)'
    ctx.shadowBlur  = 5
    ctx.beginPath()
    ctx.moveTo(foldX, 0)
    ctx.lineTo(foldX, H)
    ctx.stroke()
    ctx.restore()
  }

  const goPrev = () => {
    if (isFlipping || index <= 0) return
    flipDirRef.current = 'prev'
    setIndex(i => i - 1)
  }
  const goNext = () => {
    if (isFlipping || index >= participants.length - 1) return
    flipDirRef.current = 'next'
    setIndex(i => i + 1)
  }

  const onSwipe = (dx) => {
    if (Math.abs(dx) < 60) return
    if (dx > 0) goPrev(); else goNext()
  }

  const onTouchStart = (e) => {
    if (e.target.closest('button, a, input')) return
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }
  const onTouchEnd = (e) => {
    if (e.target.closest('button, a, input')) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    if (Math.abs(dy) > Math.abs(dx)) return
    onSwipe(dx)
  }
  const onMouseDown = (e) => {
    if (e.target.closest('button, a, input')) return
    mouseStartX.current = e.clientX
  }
  const onMouseUp = (e) => {
    if (mouseStartX.current === null) return
    if (e.target.closest('button, a, input')) { mouseStartX.current = null; return }
    const dx = e.clientX - mouseStartX.current
    mouseStartX.current = null
    onSwipe(dx)
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft')  goPrev()
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'Escape')     onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, participants.length, isFlipping])

  /* Inline search (top bar) — debounced remote + local fallback */
  const [query, setQuery]           = useState('')
  const [results, setResults]       = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const debounceRef = useRef(null)
  const abortRef    = useRef(null)

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setSearchLoading(false)
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setSearchLoading(true)
      try {
        const remote = await searchRemote(query, ctrl.signal)
        const byId = new Map(participants.map(x => [String(x.id), x]))
        setResults(remote.map(r => mergeRemoteResult(r, byId)))
      } catch (err) {
        if (err.name === 'AbortError') return
        setResults(searchLocally(participants, query))
      } finally {
        setSearchLoading(false)
      }
    }, 280)
    return () => clearTimeout(debounceRef.current)
  }, [query, participants])

  const jumpTo = (person) => {
    setQuery('')
    setResults([])
    const idx = participants.findIndex(x => String(x.id) === String(person.id))
    if (idx < 0 || idx === index || isFlipping) return
    flipDirRef.current = idx > index ? 'next' : 'prev'
    setIndex(idx)
  }

  const p = participants[index]
  if (!p) return null

  /* Build the data shape that PersonCard expects so each participant
     renders in the same layout as the live face-scan card. */
  const buildScanData = (person) => {
    let ts = person.checked_in_at || new Date().toISOString()
    ts = ts.replace(/Z$/, '')   // PersonCard appends 'Z' itself
    return {
      user: { ...person, already_attended: false },
      event_name: eventName,
      timestamp: ts,
      type: 'match',
    }
  }

  const renderProfile = (person) => (
    <div className="dp-swipe-profile">
      <PersonCard data={buildScanData(person)} />
    </div>
  )

  return (
    <div className="dp-swipe-view">

      {/* Stable header: back + search bar + counter (does NOT flip) */}
      <div className="dp-swipe-header">
        <button className="dp-back-btn dp-swipe-back-btn" onClick={onBack}>← Back</button>

        <div className="dp-swipe-search-wrap">
          <span className="dp-search-icon-prefix">🔍</span>
          <input
            className="dp-swipe-search-input"
            placeholder='Search… e.g. "ML engineers in healthcare"'
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck="false"
          />
          {searchLoading && <span className="dp-dir-spinner" />}
          {query && !searchLoading && (
            <button className="dp-search-clear" onClick={() => setQuery('')} aria-label="Clear">×</button>
          )}

          {query && results.length > 0 && (
            <div className="dp-swipe-search-results">
              <div className="dp-search-count">{results.length} match{results.length !== 1 ? 'es' : ''}</div>
              {results.map(r => (
                <div key={r.id} className="dp-search-card" onClick={() => jumpTo(r)}>
                  <UserAvatar src={r.image_url} name={r.name}
                    imgClass="dp-search-photo" fallbackClass="dp-search-avatar" apiBase={API_BASE}>
                    {r.name?.[0]?.toUpperCase()}
                  </UserAvatar>
                  <div className="dp-search-card-body">
                    <div className="dp-search-card-name">{r.name}</div>
                    {(r.company || r.occupation) && (
                      <div className="dp-search-card-occ">{r.company || r.occupation}</div>
                    )}
                    {r.reason && <div className="dp-search-card-reason">✦ {r.reason}</div>}
                  </div>
                  {typeof r.score === 'number' && r.score > 0 && (
                    <div className="dp-search-card-score">{r.score}%</div>
                  )}
                </div>
              ))}
            </div>
          )}
          {query && !searchLoading && results.length === 0 && (
            <div className="dp-swipe-search-results">
              <div className="dp-search-state">No matches for "<strong>{query}</strong>"</div>
            </div>
          )}
        </div>

        <div className="dp-swipe-counter">
          {index + 1} / {participants.length}
          {eventName && <span className="dp-part-event-badge">◆ {eventName}</span>}
        </div>
      </div>

      {/* Flip area: only the profile body flips */}
      <div
        ref={containerRef}
        className="dp-swipe-flip-area"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
      >
        {/* z-index 1 — new page underneath */}
        <div className="dp-page-layer">
          {renderProfile(p)}
        </div>

        {isFlipping && prevSnap && (<>
          {/* z-index 2 — old page flat half (stationary clipped) */}
          <div ref={flatLayerRef} className="dp-page-layer dp-page-old" style={{ pointerEvents: 'none' }}>
            {renderProfile(prevSnap.person)}
          </div>

          {/* z-index 3 — old page turning half (3D rotation) */}
          <div
            ref={turnWrapRef}
            style={{
              position: 'absolute', top: 0, height: '100%', zIndex: 3,
              overflow: 'hidden', pointerEvents: 'none',
              backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
            }}
          >
            <div ref={turnInnerRef} style={{ position: 'absolute', top: 0, height: '100%' }}>
              {renderProfile(prevSnap.person)}
            </div>
            <div style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              background: flipDir === 'next'
                ? 'linear-gradient(to right, rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.65) 100%)'
                : 'linear-gradient(to left,  rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.65) 100%)',
            }} />
          </div>
        </>)}

        {/* z-index 4 — canvas for shadow + crease */}
        {isFlipping && <canvas ref={canvasRef} className="dp-flip-canvas" />}

        {/* Floating Previous / Next buttons (stable, don't flip) */}
        <button
          className="dp-part-nav-btn dp-swipe-prev-btn"
          onClick={goPrev}
          disabled={index === 0 || isFlipping}
        >← Previous</button>
        <button
          className="dp-part-nav-btn dp-swipe-next-btn"
          onClick={goNext}
          disabled={index >= participants.length - 1 || isFlipping}
        >Next →</button>
      </div>
    </div>
  )
}


/* ── Confetti burst ─────────────────────────────────────────────── */
function fireConfetti() {
  const opts = { particleCount: 80, spread: 70, startVelocity: 45, ticks: 200 }
  confetti({ ...opts, origin: { x: 0.2, y: 0.6 } })
  confetti({ ...opts, origin: { x: 0.8, y: 0.6 } })
}

/* ── Celebration sound ──────────────────────────────────────────── */
function playCheckInSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const notes = [523.25, 659.25, 783.99, 1046.50] // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.1
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.2, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
      osc.start(t)
      osc.stop(t + 0.3)
    })
  } catch (e) {}
}

/* ── Scan popup ─────────────────────────────────────────────────── */
function ScanPopup({ data }) {
  const { user } = data
  return (
    <div className="dp-popup">
      <div className="dp-popup-emoji">🎉</div>
      <UserAvatar
        src={user.image_url}
        name={user.name}
        imgClass="dp-popup-photo"
        fallbackClass="dp-popup-avatar"
        apiBase={API_BASE}
      >
        {user.name?.[0]?.toUpperCase()}
      </UserAvatar>
      <div className="dp-popup-name">{user.name}</div>
      <div className="dp-popup-sub">Just checked in! 🎊</div>
    </div>
  )
}

/* ── Main DisplayPage ───────────────────────────────────────────── */
export default function DisplayPage() {
  const { eventId } = useParams()
  const numericEventId = eventId ? Number(eventId) : null

  const [person, setPerson]             = useState(null)
  const [connected, setConnected]       = useState(false)
  const [eventName, setEventName]       = useState(null)
  const [eventNotFound, setEventNotFound] = useState(false)
  const [view, setView]                 = useState('main')  // 'main' | 'profiles'
  const [participants, setParticipants] = useState([])
  const [partLoading, setPartLoading]   = useState(false)
  const [popup, setPopup]               = useState(null)

  const popupQueue     = useRef([])
  const popupShowing   = useRef(false)
  const popupTimer     = useRef(null)
  const idleTimer      = useRef(null)
  const scanQueue      = useRef([])
  const isDisplaying   = useRef(false)
  const displayTimer   = useRef(null)
  const showNextRef    = useRef(null)
  const showNextPopupRef = useRef(null)

  const IDLE_TIMEOUT_MS  = 60 * 60 * 1000 // 1 hour
  const DISPLAY_MIN_MS   = 2000

  showNextRef.current = function showNext() {
    if (scanQueue.current.length === 0) {
      isDisplaying.current = false
      return
    }
    isDisplaying.current = true
    const next = scanQueue.current.shift()
    setPerson(next)
    setView('main')
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setPerson(null), IDLE_TIMEOUT_MS)
    displayTimer.current = setTimeout(() => showNextRef.current(), DISPLAY_MIN_MS)
  }

  const POPUP_DURATION_MS = 3000
  showNextPopupRef.current = function showNextPopup() {
    if (popupQueue.current.length === 0) {
      popupShowing.current = false
      setPopup(null)
      return
    }
    popupShowing.current = true
    setPopup(popupQueue.current.shift())
    popupTimer.current = setTimeout(() => showNextPopupRef.current(), POPUP_DURATION_MS)
  }

  /* ── Fetch event name ── */
  useEffect(() => {
    if (!numericEventId) return
    apiFetch('/api/events')
      .then(r => r.json())
      .then(events => {
        const ev = events.find(e => e.id === numericEventId)
        if (ev) setEventName(ev.name)
        else setEventNotFound(true)
      })
      .catch(() => {})
  }, [numericEventId])

  /* ── Swipe on main display → opens participants ── */
  const mainTouchX  = useRef(0)
  const mainTouchY  = useRef(0)
  const mainMouseX  = useRef(null)
  const openParticipants = () => {
    if (view === 'main') {
      setView('profiles')
      loadParticipants()
    }
  }
  const handleMainSwipe = (dx, dy) => {
    if (Math.abs(dy) > Math.abs(dx)) return
    if (dx < -60) openParticipants()  // swipe left → participants
  }
  const onMainTouchStart = (e) => {
    if (e.target.closest('button, a, input')) return
    mainTouchX.current = e.touches[0].clientX
    mainTouchY.current = e.touches[0].clientY
  }
  const onMainTouchEnd = (e) => {
    if (e.target.closest('button, a, input')) return
    const dx = e.changedTouches[0].clientX - mainTouchX.current
    const dy = e.changedTouches[0].clientY - mainTouchY.current
    handleMainSwipe(dx, dy)
  }
  const onMainMouseDown = (e) => {
    if (e.target.closest('button, a, input')) return
    mainMouseX.current = e.clientX
  }
  const onMainMouseUp = (e) => {
    if (mainMouseX.current === null) return
    if (e.target.closest('button, a, input')) { mainMouseX.current = null; return }
    const dx = e.clientX - mainMouseX.current
    mainMouseX.current = null
    handleMainSwipe(dx, 0)
  }

  /* ── Load participants ── */
  const loadParticipants = useCallback(() => {
    const url = numericEventId
      ? `/api/attendance/present?event_id=${numericEventId}`
      : '/api/attendance/present'
    setPartLoading(true)
    apiFetch(url)
      .then(r => r.json())
      .then(data => { setParticipants(data); setPartLoading(false) })
      .catch(() => setPartLoading(false))
  }, [numericEventId])

  useEffect(() => {
    if (view !== 'profiles') return
    loadParticipants()
    const t = setInterval(loadParticipants, REFRESH_MS)
    return () => clearInterval(t)
  }, [view, loadParticipants])

  /* ── WebSocket ── */
  useEffect(() => {
    let reconnectTimer

    function connect() {
      const ws = new WebSocket(WS_URL)
      ws.onopen  = () => setConnected(true)
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data)
        if (numericEventId !== null && data.event_id !== numericEventId) return

        playCheckInSound()
        fireConfetti()

        popupQueue.current.push(data)
        if (!popupShowing.current) {
          showNextPopupRef.current()
        }

        scanQueue.current.push(data)
        if (!isDisplaying.current) {
          showNextRef.current()
        }
      }
      ws.onclose = () => {
        setConnected(false)
        reconnectTimer = setTimeout(connect, 2000)
      }
      ws.onerror = () => ws.close()
    }

    connect()
    return () => {
      clearTimeout(reconnectTimer)
      clearTimeout(idleTimer.current)
      clearTimeout(displayTimer.current)
    }
  }, [numericEventId])

  if (eventNotFound) {
    return (
      <div className="dp-page">
        <div className="dp-idle">
          <div className="dp-brand">Attend</div>
          <div style={{ fontSize: '3rem', margin: '16px 0' }}>⚠</div>
          <div style={{ fontSize: '1.3rem', color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>
            This event no longer exists.
          </div>
          <div style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.35)', marginTop: 8 }}>
            Ask the organiser for the updated display link.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="dp-page">
      {view === 'main' ? (
        <div
          className="dp-face dp-face--front"
          style={{ position: 'relative', width: '100%', height: '100%' }}
          onTouchStart={onMainTouchStart}
          onTouchEnd={onMainTouchEnd}
          onMouseDown={onMainMouseDown}
          onMouseUp={onMainMouseUp}
        >
          {person ? <PersonCard data={person} /> : <IdleScreen connected={connected} eventName={eventName} />}
          <button
            className="dp-open-participants-btn"
            onClick={openParticipants}
          >
            Open Participants
          </button>
          <div className="dp-swipe-hint dp-swipe-hint--left">
            <span className="dp-swipe-arrow">‹</span> swipe to see attendees
          </div>
        </div>
      ) : (
        <div className="dp-face dp-face--back" style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'auto', transform: 'none', background: 'var(--bg)' }}>
          {partLoading && participants.length === 0 ? (
            <div className="dp-part-loading">Loading participants…</div>
          ) : participants.length === 0 ? (
            <div className="dp-part-empty">
              <div>No one has checked in yet.</div>
              {eventName && <div style={{ color: 'var(--accent)', marginTop: 8 }}>{eventName}</div>}
              <button className="dp-back-btn" style={{ position: 'static', marginTop: 24 }} onClick={() => setView('main')}>
                ← Back
              </button>
            </div>
          ) : (
            <ParticipantSwipeView
              participants={participants}
              startIndex={0}
              eventName={eventName}
              onBack={() => setView('main')}
            />
          )}
        </div>
      )}

      {popup && <ScanPopup data={popup} />}
    </div>
  )
}
