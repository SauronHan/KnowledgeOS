import { useState, useEffect } from 'react';
import axios from 'axios';
import { Globe, Loader2, X, Check, Upload, Archive } from 'lucide-react';

export function SharedProjectDashboard() {
  const [projects, setProjects] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit access modal
  const [editProject, setEditProject] = useState<any>(null);
  const [editTenantIds, setEditTenantIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  // Publish new version modal
  const [publishProject, setPublishProject] = useState<any>(null);
  const [packageFilename, setPackageFilename] = useState('');
  const [packageVersion, setPackageVersion] = useState('');
  const [publishing, setPublishing] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [tRes] = await Promise.all([
        axios.get('/api/v1/tenants'),
      ]);
      setTenants(tRes.data.data);
      const allProjects = await axios.get('/api/v1/projects', {
        headers: { Authorization: 'Bearer mock-jwt-token-2' },
      });
      const sharedProjects = (allProjects.data.data || []).filter(
        (p: any) => p.visibility === 'shared',
      );
      // Fetch access info for each shared project
      const enriched = await Promise.all(
        sharedProjects.map(async (p: any) => {
          try {
            const aRes = await axios.get(`/api/v1/projects/${p.id}/access`, {
              headers: { Authorization: 'Bearer mock-jwt-token-2' },
            });
            return { ...p, access: aRes.data.data };
          } catch {
            return { ...p, access: { tenants: [] } };
          }
        }),
      );
      setProjects(enriched);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // ── Edit Access ──

  const handleOpenEditAccess = async (project: any) => {
    setEditProject(project);
    try {
      const aRes = await axios.get(`/api/v1/projects/${project.id}/access`, {
        headers: { Authorization: 'Bearer mock-jwt-token-2' },
      });
      setEditTenantIds(aRes.data.data.tenant_ids || []);
    } catch {
      setEditTenantIds([]);
    }
  };

  const handleSaveAccess = async () => {
    if (!editProject) return;
    try {
      setSaving(true);
      await axios.put(`/api/v1/projects/${editProject.id}/access`, {
        tenant_ids: editTenantIds,
      }, {
        headers: { Authorization: 'Bearer mock-jwt-token-2' },
      });
      setEditProject(null);
      await fetchData();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to update access');
    } finally {
      setSaving(false);
    }
  };

  const toggleEditTenant = (id: number) => {
    setEditTenantIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  };

  // ── Publish New Version ──

  const handleOpenPublish = (project: any) => {
    setPublishProject(project);
    setPackageFilename(project.package_filename || '');
    setPackageVersion('');
  };

  const handlePublish = async () => {
    if (!publishProject || !packageFilename.trim()) return;
    try {
      setPublishing(true);
      const body: any = { package_filename: packageFilename.trim() };
      if (packageVersion.trim()) {
        body.version = parseInt(packageVersion.trim(), 10);
      }
      await axios.put(`/api/v1/shared-projects/${publishProject.id}/package`, body, {
        headers: { Authorization: 'Bearer mock-jwt-token-2' },
      });
      setPublishProject(null);
      await fetchData();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to publish package');
    } finally {
      setPublishing(false);
    }
  };

  // ── Archive / Activate ──

  const handleToggleStatus = async (project: any) => {
    const newStatus = project.status === 'active' ? 'archived' : 'active';
    const action = newStatus === 'archived' ? 'Archive' : 'Activate';
    if (!window.confirm(`${action} project "${project.name}"?`)) return;
    try {
      await axios.put(`/api/v1/projects/${project.id}/status`, {
        status: newStatus,
      }, {
        headers: { Authorization: 'Bearer mock-jwt-token-2' },
      });
      await fetchData();
    } catch (err: any) {
      alert(err.response?.data?.detail || `Failed to ${action.toLowerCase()} project`);
    }
  };

  // ── Helpers ──

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  const activeProjects = projects.filter((p: any) => p.status !== 'archived');

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-center border-b border-slate-200 pb-4">
        <Globe className="w-8 h-8 text-green-600 mr-3" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Shared Projects</h1>
          <p className="text-slate-500 text-sm mt-1">Manage shared project packages, versions, and tenant access.</p>
        </div>
      </div>

      {/* Deployment instruction */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800 space-y-2">
        <p className="font-semibold">Shared Project Package Deployment</p>
        <p>
          Before publishing a new version, place the <code className="bg-blue-100 px-1.5 py-0.5 rounded text-xs font-mono">.zip</code> package file into the
          server directory:
        </p>
        <p className="font-mono text-xs bg-blue-100 inline-block px-2 py-1 rounded">
          server/shared_packages/
        </p>
        <p className="text-blue-600 text-xs">
          You can copy the file via <code className="bg-blue-100 px-1 rounded">scp</code>, <code className="bg-blue-100 px-1 rounded">docker cp</code>,
          SFTP, or directly place it on the host machine under the mounted volume.
          After that, click <strong>Publish</strong> on a project row and enter the exact filename.
        </p>
      </div>

      {/* Project list — full width */}
      <div>
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">
              Active Projects ({activeProjects.length})
            </h3>
          </div>
          {projects.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              No shared projects yet. Create one from the desktop client to get started.
            </div>
          ) : activeProjects.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              All shared projects are archived.
            </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-white">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Project</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">Version</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Package</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Tenants</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {activeProjects.map((p: any) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-green-500 shrink-0" />
                        <span className="text-sm font-medium text-slate-900">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        p.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <span className="text-sm font-mono text-slate-600">
                        v{p.package_version || 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-[160px]">
                      {p.package_filename ? (
                        <span className="text-sm text-slate-600 truncate block" title={p.package_filename}>
                          {p.package_filename}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 italic">Not published</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(p.access?.tenants || []).map((t: any) => (
                          <span
                            key={t.id}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                          >
                            {t.name}
                          </span>
                        ))}
                        {(!p.access?.tenants || p.access.tenants.length === 0) && (
                          <span className="text-xs text-rose-500">None</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleOpenPublish(p)}
                          className="text-green-600 hover:text-green-800 text-sm font-medium cursor-pointer flex items-center gap-1"
                          title="Publish new version"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          Publish
                        </button>
                        <button
                          onClick={() => handleOpenEditAccess(p)}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium cursor-pointer"
                          title="Edit tenant access"
                        >
                          Access
                        </button>
                        <button
                          onClick={() => handleToggleStatus(p)}
                          className="text-amber-600 hover:text-amber-800 text-sm font-medium cursor-pointer flex items-center gap-1"
                          title="Archive project"
                        >
                          <Archive className="w-3.5 h-3.5" />
                          Archive
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Edit Access Modal */}
      {editProject && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">
                Edit Access — {editProject.name}
              </h3>
              <button
                onClick={() => setEditProject(null)}
                className="p-1 hover:bg-slate-100 rounded cursor-pointer"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-md bg-slate-50 p-2 space-y-1 mb-4">
              {tenants.map((t: any) => (
                <label
                  key={t.id}
                  className={`flex items-center gap-2 px-2 py-1 rounded text-sm cursor-pointer ${
                    editTenantIds.includes(t.id)
                      ? 'bg-blue-50 text-blue-800'
                      : 'hover:bg-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={editTenantIds.includes(t.id)}
                    onChange={() => toggleEditTenant(t.id)}
                    className="w-4 h-4 text-blue-600 border-slate-300 rounded"
                  />
                  {t.name}
                </label>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditProject(null)}
                className="px-4 py-2 bg-slate-200 text-slate-800 rounded-md hover:bg-slate-300 text-sm font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAccess}
                disabled={saving}
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium cursor-pointer"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Check className="w-4 h-4 mr-2" />
                )}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Publish New Version Modal */}
      {publishProject && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">
                Publish New Version — {publishProject.name}
              </h3>
              <button
                onClick={() => setPublishProject(null)}
                className="p-1 hover:bg-slate-100 rounded cursor-pointer"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Package Filename *
                </label>
                <input
                  type="text"
                  value={packageFilename}
                  onChange={(e) => setPackageFilename(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-md text-sm font-mono"
                  placeholder="e.g. kb-enterprise-v2.zip"
                />
                <p className="text-xs text-slate-400 mt-1">
                  File must exist in server/shared_packages/ directory.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Version (optional)
                </label>
                <input
                  type="number"
                  value={packageVersion}
                  onChange={(e) => setPackageVersion(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-md text-sm"
                  placeholder={`Auto: ${(publishProject.package_version || 0) + 1}`}
                  min={1}
                />
                <p className="text-xs text-slate-400 mt-1">
                  Leave blank to auto-increment from current v{publishProject.package_version || 0}.
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPublishProject(null)}
                className="px-4 py-2 bg-slate-200 text-slate-800 rounded-md hover:bg-slate-300 text-sm font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handlePublish}
                disabled={publishing || !packageFilename.trim()}
                className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 text-sm font-medium cursor-pointer"
              >
                {publishing ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                Publish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
