import React, { useLayoutEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import DashboardScreen from './screens/DashboardScreen';
import ProfileScreen from './screens/ProfileScreen';
import ProtectedRoute from './ProtectedRoute';
import PublicRoute from './PublicRoute';
import RecommenderScreen from './screens/RecommenderScreen';
import AIScreen from './screens/AIScreen';
import ConnectionsScreen from './screens/ConnectionsScreen';
import NetworkScreen from './screens/NetworkScreen';
import ResetPasswordScreen from './screens/ResetPasswordScreen';
import { AuthProvider } from './lib/AuthContext';

// Firebase's email action URL is the site root and appends its params before the "#".
const RootRedirect: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('mode') && params.has('oobCode')) {
    return <Navigate to="/reset-password" replace />;
  }
  return <Navigate to="/login" replace />;
};

function RouteTitle() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    const title = (
      {
        '/login': 'Sign in',
        '/register': 'Create account',
        '/reset-password': 'Reset your password',
        '/dashboard': 'Home',
        '/recommender': 'Search',
        '/connections': 'Connections',
        '/network': 'Network',
        '/ai': 'Assistant',
        '/profile': 'Profile',
      } as Record<string, string>
    )[pathname];
    document.title = title ? `${title} · Connection Recommender` : 'Connection Recommender';
  }, [pathname]);
  return null;
}

const App: React.FC = () => {
  return (
    <AuthProvider>
      <HashRouter>
        <RouteTitle />
        <Routes>
          <Route path="/" element={<RootRedirect />} />

          {/* Public Routes */}
          <Route
            path="/login"
            element={
              <PublicRoute>
                <LoginScreen />
              </PublicRoute>
            }
          />
          <Route
            path="/register"
            element={
              <PublicRoute>
                <RegisterScreen />
              </PublicRoute>
            }
          />

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

          <Route
            path="/network"
            element={
              <ProtectedRoute>
                <NetworkScreen />
              </ProtectedRoute>
            }
          />

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
