import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import DashboardScreen from './screens/DashboardScreen';
import ProfileScreen from './screens/ProfileScreen';
import ProtectedRoute from './ProtectedRoute';
import PublicRoute from './PublicRoute';
import RecommenderScreen from './screens/RecommenderScreen';
import AIScreen from './screens/AIScreen';
import ConnectionsScreen from './screens/ConnectionsScreen';
import ResetPasswordScreen from './screens/ResetPasswordScreen';
import { AuthProvider } from './lib/AuthContext';

// Experimental screens (docs: FREE_FEATURES "Never on the hosted site"): the
// dynamic import exists only when VITE_EXPERIMENTAL=on, so a production build
// without the flag contains none of their code.
const InsightsScreen =
  import.meta.env.VITE_EXPERIMENTAL === 'on'
    ? React.lazy(() => import('./experimental/sql-insights/InsightsScreen'))
    : null;

// Firebase's email action URL is the site root and appends its params before the "#".
const RootRedirect: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('mode') && params.has('oobCode')) {
    return <Navigate to="/reset-password" replace />;
  }
  return <Navigate to="/login" replace />;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<RootRedirect />} />

          {/* Public Routes */}
          <Route path="/login" element={<PublicRoute><LoginScreen /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><RegisterScreen /></PublicRoute>} />

          {/* Email action links */}
          <Route path="/reset-password" element={<ResetPasswordScreen />} />

          {/* Protected Routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardScreen />
              </ProtectedRoute>
            }
          />

          <Route
            path="/recommender"
            element={
              <ProtectedRoute>
                <RecommenderScreen />
              </ProtectedRoute>
            }
          />

          <Route
            path="/ai"
            element={
              <ProtectedRoute>
                <AIScreen />
              </ProtectedRoute>
            }
          />

          <Route
            path="/connections"
            element={
              <ProtectedRoute>
                <ConnectionsScreen />
              </ProtectedRoute>
            }
          />

          {InsightsScreen && (
            <Route
              path="/insights"
              element={
                <ProtectedRoute>
                  <React.Suspense
                    fallback={
                      <div className="h-screen w-full flex items-center justify-center bg-background-dark">
                        <div className="text-primary animate-pulse">Loading Insights...</div>
                      </div>
                    }
                  >
                    <InsightsScreen />
                  </React.Suspense>
                </ProtectedRoute>
              }
            />
          )}

          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfileScreen />
              </ProtectedRoute>
            }
          />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
};

export default App;