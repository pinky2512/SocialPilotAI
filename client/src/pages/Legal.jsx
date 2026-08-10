import { useEffect, useState } from 'react';
import { api } from '../api.js';

// STORY-034 — Privacy Policy & Terms of Service (public).
export default function Legal() {
  const [legal, setLegal] = useState(null);
  const [tab, setTab] = useState('privacy');
  const [error, setError] = useState('');

  useEffect(() => {
    api.legal().then((r) => setLegal(r.legal)).catch((e) => setError(e.message));
  }, []);

  if (error) return <section className="panel"><div className="error">{error}</div></section>;
  if (!legal) return <section className="panel"><p className="hint">Loading…</p></section>;

  const doc = tab === 'privacy' ? legal.privacyPolicy : legal.termsOfService;

  return (
    <section className="panel">
      <div className="card-head">
        <div className="chips">
          <button className={tab === 'privacy' ? 'chip on' : 'chip'} onClick={() => setTab('privacy')}>Privacy Policy</button>
          <button className={tab === 'terms' ? 'chip on' : 'chip'} onClick={() => setTab('terms')}>Terms of Service</button>
        </div>
        <span className="hint">v{legal.version} · {legal.updatedAt}</span>
      </div>
      <pre className="legal-doc">{doc}</pre>
    </section>
  );
}
