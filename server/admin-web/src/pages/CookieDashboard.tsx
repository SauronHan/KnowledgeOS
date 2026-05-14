import { useState, useEffect } from 'react';
import axios from 'axios';
import { Cookie, Loader2, X, Plus, Save, AlertTriangle } from 'lucide-react';

const AUTH_HEADER = { Authorization: 'Bearer mock-jwt-token-2' };

const DEFAULT_PLATFORMS = [
  { domain: 'zhihu.com', label: '知乎 (zhihu.com)' },
  { domain: 'bilibili.com', label: 'B站 (bilibili.com)' },
  { domain: 'youtube.com', label: 'YouTube (youtube.com)' },
  { domain: 'x.com', label: 'X/Twitter (x.com)' },
  { domain: 'weixin.qq.com', label: '微信公众号 (weixin.qq.com)' },
];

interface CookieEntry {
  id: number;
  domain: string;
  cookie_value: string;
  format: string;
  extra_headers?: Record<string, string>;
  description?: string;
  status: string;
  expires_at?: string;
  created_at?: string;
  updated_at?: string;
}

export function CookieDashboard() {
  const [cookies, setCookies] = useState<CookieEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit modal
  const [editingCookie, setEditingCookie] = useState<CookieEntry | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formDomain, setFormDomain] = useState('');
  const [formCookieValue, setFormCookieValue] = useState('');
  const [formFormat, setFormFormat] = useState('header_string');
  const [formExtraHeaders, setFormExtraHeaders] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formExpiresAt, setFormExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchCookies = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/v1/admin/platform-cookies', { headers: AUTH_HEADER });
      setCookies(res.data.data || []);
    } catch (err) {
      console.error('Failed to load cookies:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCookies(); }, []);

  const resetForm = () => {
    setFormDomain('');
    setFormCookieValue('');
    setFormFormat('header_string');
    setFormExtraHeaders('');
    setFormDescription('');
    setFormExpiresAt('');
    setEditingCookie(null);
    setIsCreating(false);
  };

  const openCreate = () => {
    resetForm();
    setIsCreating(true);
  };

  const openEdit = (c: CookieEntry) => {
    setEditingCookie(c);
    setFormDomain(c.domain);
    setFormCookieValue(c.cookie_value);
    setFormFormat(c.format || 'header_string');
    setFormExtraHeaders(c.extra_headers ? JSON.stringify(c.extra_headers, null, 2) : '');
    setFormDescription(c.description || '');
    setFormExpiresAt(c.expires_at ? c.expires_at.slice(0, 16) : '');
    setIsCreating(false);
  };

  const handleSave = async () => {
    if (!formDomain.trim() || !formCookieValue.trim()) return;
    setSaving(true);
    try {
      const body: any = {
        domain: formDomain.trim(),
        cookie_value: formCookieValue.trim(),
        format: formFormat,
        description: formDescription.trim() || null,
        expires_at: formExpiresAt ? new Date(formExpiresAt).toISOString() : null,
      };
      if (formExtraHeaders.trim()) {
        try { body.extra_headers = JSON.parse(formExtraHeaders); }
        catch { alert('Extra Headers must be valid JSON'); setSaving(false); return; }
      }

      if (isCreating) {
        await axios.post('/api/v1/admin/platform-cookies', body, { headers: AUTH_HEADER });
      } else if (editingCookie) {
        await axios.put(`/api/v1/admin/platform-cookies/${editingCookie.id}`, body, { headers: AUTH_HEADER });
      }
      resetForm();
      await fetchCookies();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to save cookie');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: CookieEntry) => {
    if (!window.confirm(`Delete cookie for '${c.domain}'?`)) return;
    try {
      await axios.delete(`/api/v1/admin/platform-cookies/${c.id}`, { headers: AUTH_HEADER });
      await fetchCookies();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to delete');
    }
  };

  const isExpired = (c: CookieEntry) => {
    if (!c.expires_at) return false;
    return new Date(c.expires_at) < new Date();
  };

  const isExpiringSoon = (c: CookieEntry) => {
    if (!c.expires_at) return false;
    const days = (new Date(c.expires_at).getTime() - Date.now()) / 86400000;
    return days > 0 && days < 7;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  const showModal = isCreating || editingCookie !== null;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div className="flex items-center">
          <Cookie className="w-8 h-8 text-amber-600 mr-3" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Platform Cookies</h1>
            <p className="text-slate-500 text-sm mt-1">
              Manage authentication cookies for external platforms (Zhihu, YouTube, etc.) used during URL ingestion.
            </p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 text-sm font-medium cursor-pointer"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Cookie
        </button>
      </div>

      {cookies.length === 0 ? (
        <div className="text-center text-slate-500 py-12 text-sm">
          No platform cookies configured yet. Add cookies for sites like Zhihu or YouTube to enable URL content extraction.
        </div>
      ) : (
        <table className="min-w-full divide-y divide-slate-200 bg-white rounded-lg border border-slate-200 shadow-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Domain</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Format</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Preview</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Description</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">Status</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {cookies.map((c) => {
              const preview = c.cookie_value.length > 40
                ? c.cookie_value.slice(0, 40) + '...'
                : c.cookie_value;
              return (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-mono font-medium text-slate-900">
                    {c.domain}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      c.format === 'netscape' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {c.format === 'netscape' ? 'Netscape' : 'Header'}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-[240px] text-sm text-slate-500 font-mono truncate" title={c.cookie_value}>
                    {preview}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {c.description || '-'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center">
                    {isExpired(c) ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                        <AlertTriangle className="w-3 h-3" /> Expired
                      </span>
                    ) : isExpiringSoon(c) ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                        <AlertTriangle className="w-3 h-3" /> Expiring
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(c)}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(c)}
                        className="text-red-600 hover:text-red-800 text-sm font-medium cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">
                {isCreating ? 'Add Platform Cookie' : `Edit Cookie — ${formDomain}`}
              </h3>
              <button onClick={resetForm} className="p-1 hover:bg-slate-100 rounded cursor-pointer">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Platform *</label>
                {isCreating ? (
                  <select
                    value={formDomain}
                    onChange={(e) => setFormDomain(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-md text-sm"
                  >
                    <option value="">Select platform...</option>
                    <option value="">── Custom ──</option>
                    {DEFAULT_PLATFORMS.map((p) => (
                      <option key={p.domain} value={p.domain}>{p.label}</option>
                    ))}
                  </select>
                ) : (
                  <input type="text" value={formDomain} disabled className="w-full p-2 border border-slate-200 rounded-md text-sm bg-slate-50" />
                )}
                {isCreating && (
                  <input
                    type="text"
                    value={!DEFAULT_PLATFORMS.find(p => p.domain === formDomain) ? formDomain : ''}
                    onChange={(e) => setFormDomain(e.target.value)}
                    placeholder="Or enter custom domain (e.g. example.com)"
                    className="w-full mt-1 p-2 border border-slate-300 rounded-md text-sm font-mono"
                  />
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Format</label>
                <select
                  value={formFormat}
                  onChange={(e) => setFormFormat(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-md text-sm"
                >
                  <option value="header_string">Header String (知乎/微信/X)</option>
                  <option value="netscape">Netscape (YouTube/B站)</option>
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  Cookie-Editor → Export → 选对应格式。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cookie Value *</label>
                <textarea
                  value={formCookieValue}
                  onChange={(e) => setFormCookieValue(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-md text-sm font-mono h-24"
                  placeholder="Paste content from Cookie-Editor → Export"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Cookie-Editor 导出后直接粘贴全部内容。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Extra Headers (JSON)</label>
                <textarea
                  value={formExtraHeaders}
                  onChange={(e) => setFormExtraHeaders(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-md text-sm font-mono h-16"
                  placeholder='{"Referer": "https://www.zhihu.com/"}'
                />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                  <input
                    type="text"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-md text-sm"
                    placeholder="e.g. 知乎登录Cookie"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Expires</label>
                  <input
                    type="datetime-local"
                    value={formExpiresAt}
                    onChange={(e) => setFormExpiresAt(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-md text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-2 justify-end">
              <button
                onClick={resetForm}
                className="px-4 py-2 bg-slate-200 text-slate-800 rounded-md hover:bg-slate-300 text-sm font-medium cursor-pointer"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formDomain.trim() || !formCookieValue.trim()}
                className="flex items-center px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 text-sm font-medium cursor-pointer"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                {isCreating ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
