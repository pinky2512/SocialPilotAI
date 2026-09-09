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

  // Optional: upload a photo (for a new product you can't AI-generate).
  async function onUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      await api.uploadImage(userId, { dataUrl, label: file.name });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Restyle userId={userId} onChanged={refresh} />

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
            <label className="upload-btn">
              Upload a photo (optional)
              <input type="file" accept="image/*" onChange={onUpload} disabled={busy} hidden />
            </label>
          </div>
        </form>
        <p className="hint">New product with no image to generate? Upload your own photo instead.</p>
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

// EXTENSION — restyle a real product photo into a described scene / color grade.
// Upload your product shot, describe the environment + lighting + color grading,
// and the AI re-renders the product in that setting. Held for approval like any image.
function Restyle({ userId, onChanged }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    setError('');
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) {
      setError('Please choose a PNG, JPG or WEBP photo.');
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function restyle(e) {
    e.preventDefault();
    if (!file) { setError('Choose a product photo first.'); return; }
    setBusy(true);
    setError('');
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      await api.restyleImage(userId, { dataUrl, prompt });
      setFile(null); setPreview(''); setPrompt('');
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Restyle a product photo</h2>
      <p className="hint">
        Upload a photo of your real product and describe the scene, lighting and colour grade —
        the AI re-renders the product in that setting. Needs <code>OPENAI_API_KEY</code>; without it
        the original photo is kept unchanged. Result is held for approval like any image.
      </p>
      <form onSubmit={restyle} className="gen-form">
        <div className="row">
          <label className="upload-btn">
            {file ? 'Change photo' : 'Choose product photo'}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} hidden />
          </label>
          {preview && <img className="img-preview" src={preview} alt="chosen product" style={{ maxHeight: 96, width: 'auto' }} />}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Place this product on a wet marble countertop by a bright window, soft morning daylight from the left, fresh eucalyptus leaves in the background, cool clean colour grade with airy highlights and gentle shadows, luxury skincare mood"
          rows={3}
          required
        />
        <div className="card-actions">
          <button className="primary" type="submit" disabled={busy || !file || !prompt.trim()}>
            {busy ? 'Restyling…' : 'Restyle with AI'}
          </button>
        </div>
      </form>
      {error && <div className="error">{error}</div>}
    </section>
  );
}
