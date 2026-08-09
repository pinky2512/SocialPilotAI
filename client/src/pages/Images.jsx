import { useEffect, useState } from 'react';
import { useSession } from '../session.jsx';
import { api } from '../api.js';

// EXTENSION — AI image generation. Generate a marketing image, preview it, and
// submit it for approval (same human-in-the-loop gate as text content).
export default function Images() {
  const { userId } = useSession();
  const [prompt, setPrompt] = useState('');
  const [images, setImages] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const { images } = await api.listImages(userId);
      setImages(images);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
  }, [userId]);

  async function generate(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.generateImage(userId, { prompt });
      setPrompt('');
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(id) {
    setError('');
    try {
      await api.submitImage(userId, id);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <section className="panel">
        <h2>Generate a marketing image</h2>
        <p className="hint">
          AI-generated images are held for human approval before use — just like text.
          Set <code>OPENAI_API_KEY</code> for real images (a placeholder is shown otherwise).
        </p>
        <form onSubmit={generate} className="gen-form">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. CeraVe hydrating cleanser on a clean bathroom shelf, soft daylight, minimal"
            rows={3}
            required
          />
          <div className="card-actions">
            <button className="primary" type="submit" disabled={busy || !prompt.trim()}>
              {busy ? 'Generating…' : 'Generate image'}
            </button>
          </div>
        </form>
        {error && <div className="error">{error}</div>}
      </section>

      <section className="panel">
        <h2>Images</h2>
        {images.length === 0 && <p className="hint">No images yet — generate one above.</p>}
        <div className="cards">
          {images.map((im) => (
            <div className="card" key={im.id}>
              <div className="card-head">
                <span className={`status status-${im.status}`}>{im.status.replace('_', ' ')}</span>
                <span className="cid">#{im.id}</span>
              </div>
              <img className="img-preview" src={api.imageUrl(im.id)} alt={im.prompt} />
              <p className="hint">{im.prompt}</p>
              {['draft', 'rejected'].includes(im.status) && (
                <div className="card-actions">
                  <button className="primary" onClick={() => submit(im.id)}>Submit for approval</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
