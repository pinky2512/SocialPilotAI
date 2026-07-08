import { useEffect, useState } from 'react';
import { useSession } from '../session.jsx';
import { api } from '../api.js';

// STORY-002 — approver view. Pending drafts held at the approval gate; a human
// approves or rejects. Content can only go live once approved here.
export default function ApprovalQueue() {
  const { userId } = useSession();
  const [pending, setPending] = useState([]);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const { pending } = await api.pendingApprovals(userId);
      setPending(pending);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
  }, [userId]);

  async function act(kind, approvalId) {
    setError('');
    try {
      if (kind === 'approve') await api.approve(userId, approvalId);
      else await api.reject(userId, approvalId, 'Rejected from approval queue');
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="queue">
      <section className="panel">
        <h2>Pending approvals</h2>
        <p className="hint">Human-in-the-loop: AI proposes, you approve. Every decision is audited.</p>
        {error && <div className="error">{error}</div>}
        {pending.length === 0 && <p className="hint">Nothing waiting for approval. 🎉</p>}
        <div className="cards">
          {pending.map((p) => (
            <div className="card" key={p.approval_id}>
              <div className="card-head">
                <span className="status status-pending_approval">pending approval</span>
                <span className="cid">content #{p.content_id}</span>
              </div>
              <p className="body">{p.content_text}</p>
              <div className="card-actions">
                <button className="primary" onClick={() => act('approve', p.approval_id)}>Approve</button>
                <button className="danger" onClick={() => act('reject', p.approval_id)}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
