import { useState, useEffect } from 'react';
import axios from 'axios';
import { Users, Building2, Plus, Trash2, Loader2 } from 'lucide-react';

export function UserDashboard() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Forms
  const [newTenant, setNewTenant] = useState({ name: '', description: '' });
  const [newUser, setNewUser] = useState({ id: 0, username: '', password: '', role: 'employee', tenant_id: '', is_active: true, expires_at: '' });
  const [isEditing, setIsEditing] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [tRes, uRes] = await Promise.all([
        axios.get('/api/v1/tenants'),
        axios.get('/api/v1/users')
      ]);
      setTenants(tRes.data.data);
      setUsers(uRes.data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTenant.name) return;
    try {
      await axios.post('/api/v1/tenants', newTenant);
      setNewTenant({ name: '', description: '' });
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to create tenant');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.username || !newUser.tenant_id) return;
    try {
      const payload = {
        username: newUser.username,
        role: newUser.role,
        tenant_id: parseInt(newUser.tenant_id as string),
        is_active: newUser.is_active,
        expires_at: newUser.expires_at ? new Date(newUser.expires_at).toISOString() : null
      };
      if (newUser.password) {
        (payload as any).password = newUser.password;
      }
      
      if (isEditing) {
        await axios.put(`/api/v1/users/${newUser.id}`, payload);
      } else {
        await axios.post('/api/v1/users', payload);
      }
      
      setNewUser({ id: 0, username: '', password: '', role: 'employee', tenant_id: '', is_active: true, expires_at: '' });
      setIsEditing(false);
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to save user');
    }
  };

  const handleEditUser = (user: any) => {
    setNewUser({
      id: user.id,
      username: user.username,
      password: '', // do not show existing password
      role: user.role,
      tenant_id: user.tenant_id.toString(),
      is_active: user.is_active !== false,
      expires_at: user.expires_at ? user.expires_at.split('T')[0] : ''
    });
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setNewUser({ id: 0, username: '', password: '', role: 'employee', tenant_id: '', is_active: true, expires_at: '' });
    setIsEditing(false);
  };

  const handleDeleteUser = async (id: number) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
      await axios.delete(`/api/v1/users/${id}`);
      fetchData();
    } catch (err) {
      alert('Failed to delete user');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-center border-b border-slate-200 pb-4">
        <Users className="w-8 h-8 text-blue-600 mr-3" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Users & Tenants</h1>
          <p className="text-slate-500 text-sm mt-1">Manage organization structure and user roles.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Forms */}
        <div className="space-y-8 lg:col-span-1">
          {/* Tenant Form */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
            <div className="flex items-center mb-4">
              <Building2 className="w-5 h-5 text-slate-400 mr-2" />
              <h2 className="text-lg font-semibold text-slate-900">Add New Tenant</h2>
            </div>
            <form onSubmit={handleCreateTenant} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Company/Dept Name</label>
                <input 
                  type="text" 
                  value={newTenant.name}
                  onChange={e => setNewTenant({...newTenant, name: e.target.value})}
                  className="w-full p-2 border border-slate-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g. Acme Corp"
                  required
                />
              </div>
              <button type="submit" className="w-full flex justify-center items-center px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-800 text-sm font-medium transition-colors cursor-pointer">
                <Plus className="w-4 h-4 mr-2" /> Create Tenant
              </button>
            </form>
          </div>

          {/* User Form */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
            <div className="flex items-center mb-4">
              <Users className="w-5 h-5 text-slate-400 mr-2" />
              <h2 className="text-lg font-semibold text-slate-900">{isEditing ? 'Edit User' : 'Add New User'}</h2>
            </div>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
                <input 
                  type="text" 
                  value={newUser.username}
                  onChange={e => setNewUser({...newUser, username: e.target.value})}
                  className="w-full p-2 border border-slate-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g. alice_smith"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Assign to Tenant</label>
                <select 
                  value={newUser.tenant_id}
                  onChange={e => setNewUser({...newUser, tenant_id: e.target.value})}
                  className="w-full p-2 border border-slate-300 rounded-md text-sm bg-white focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  <option value="" disabled>Select Tenant</option>
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                <select 
                  value={newUser.role}
                  onChange={e => setNewUser({...newUser, role: e.target.value})}
                  className="w-full p-2 border border-slate-300 rounded-md text-sm bg-white focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="employee">Employee (Viewer / Editor)</option>
                  <option value="checker">Checker (Audit Documents)</option>
                  <option value="admin">Admin (System Wide)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Password {isEditing && "(Leave blank to keep current)"}</label>
                <input 
                  type="password" 
                  value={newUser.password}
                  onChange={e => setNewUser({...newUser, password: e.target.value})}
                  className="w-full p-2 border border-slate-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Password"
                  required={!isEditing}
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Expires At</label>
                  <input 
                    type="date" 
                    value={newUser.expires_at}
                    onChange={e => setNewUser({...newUser, expires_at: e.target.value})}
                    className="w-full p-2 border border-slate-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="flex items-center pt-6">
                  <input 
                    type="checkbox" 
                    id="is_active"
                    checked={newUser.is_active}
                    onChange={e => setNewUser({...newUser, is_active: e.target.checked})}
                    className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="is_active" className="ml-2 block text-sm text-slate-700">Active</label>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={tenants.length === 0} className="flex-1 flex justify-center items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer">
                  {isEditing ? 'Save Changes' : <><Plus className="w-4 h-4 mr-2" /> Create User</>}
                </button>
                {isEditing && (
                  <button type="button" onClick={handleCancelEdit} className="px-4 py-2 bg-slate-200 text-slate-800 rounded-md hover:bg-slate-300 text-sm font-medium transition-colors cursor-pointer">
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        {/* Right Column: Lists */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-50 px-6 py-3 border-b border-slate-200">
              <h3 className="font-semibold text-slate-800">User Directory</h3>
            </div>
            {users.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">No users found.</div>
            ) : (
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-white">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Username</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Tenant</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">{user.username}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {user.tenant_name || 'None'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 capitalize">{user.role}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                        {user.is_active ? (
                          <span className="text-green-600 font-medium">Active</span>
                        ) : (
                          <span className="text-rose-600 font-medium">Disabled</span>
                        )}
                        {user.expires_at && <div className="text-xs text-slate-400 mt-1">Exp: {new Date(user.expires_at).toLocaleDateString()}</div>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button 
                          onClick={() => handleEditUser(user)}
                          className="text-blue-600 hover:text-blue-900 cursor-pointer p-1 rounded-md hover:bg-blue-50 transition-colors mr-2"
                          title="Edit User"
                        >
                          Edit
                        </button>
                        <button 
                          onClick={() => handleDeleteUser(user.id)}
                          className="text-rose-600 hover:text-rose-900 cursor-pointer p-1 rounded-md hover:bg-rose-50 transition-colors"
                          title="Delete User"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
