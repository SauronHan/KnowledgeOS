import { BrowserRouter, Routes, Route, Link, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { Database, Settings, Users, LogOut, User as UserIcon, Globe, Cookie } from 'lucide-react';
import { AuditDashboard } from './pages/AuditDashboard';
import { ConfigDashboard } from './pages/ConfigDashboard';
import { UserDashboard } from './pages/UserDashboard';
import { SharedProjectDashboard } from './pages/SharedProjectDashboard';
import { CookieDashboard } from './pages/CookieDashboard';
import { Login } from './pages/Login';

// Helper to check auth status
const isAuthenticated = () => !!localStorage.getItem('adminToken');

function AuthGuard({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full h-full">
      <Sidebar />
      <div className="flex-1 overflow-auto bg-slate-50">
        {children}
      </div>
    </div>
  );
}

function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  
  const userStr = localStorage.getItem('adminUser');
  const user = userStr ? JSON.parse(userStr) : null;
  
  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    navigate('/login');
  };

  const navItems = [
    { path: '/', label: 'Audit Center', icon: Database },
    { path: '/users', label: 'Users & Tenants', icon: Users },
    { path: '/shared-projects', label: 'Shared Projects', icon: Globe },
    { path: '/cookies', label: 'Platform Cookies', icon: Cookie },
    { path: '/config', label: 'LLM Config', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
      <div className="h-16 flex items-center px-4 border-b border-slate-200">
        <img src="/admin/logo.png" className="w-8 h-8 mr-2 object-contain" alt="Logo" />
        <span className="font-bold text-lg text-slate-800">Lyrebird KOS</span>
      </div>
      <nav className="flex-1 py-4 px-3 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex items-center px-3 py-2 rounded-md font-medium transition-colors ${
              location.pathname === item.path
                ? 'bg-blue-50 text-blue-700'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <item.icon className={`w-5 h-5 mr-3 ${
              location.pathname === item.path ? 'text-blue-600' : 'text-slate-400'
            }`} />
            {item.label}
          </Link>
        ))}
      </nav>
      
      {/* User profile & Logout */}
      {user && (
        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center mb-3 px-2">
            <div className="bg-slate-100 p-2 rounded-full mr-3">
              <UserIcon className="w-4 h-4 text-slate-600" />
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-medium text-slate-900 truncate">{user.username}</p>
              <p className="text-xs text-slate-500 capitalize">{user.role}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center px-3 py-2 text-sm font-medium text-rose-600 rounded-md hover:bg-rose-50 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4 mr-3" />
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}

function App() {
  return (
    <BrowserRouter basename="/admin">
      <div className="min-h-screen h-screen bg-slate-50 flex overflow-hidden">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={
            <AuthGuard>
              <MainLayout>
                <Routes>
                  <Route path="/" element={<AuditDashboard />} />
                  <Route path="/users" element={<UserDashboard />} />
                  <Route path="/shared-projects" element={<SharedProjectDashboard />} />
                  <Route path="/cookies" element={<CookieDashboard />} />
                  <Route path="/config" element={<ConfigDashboard />} />
                </Routes>
              </MainLayout>
            </AuthGuard>
          } />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
