import React from 'react';
import { Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useAuth } from './lib/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactElement;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="session-loading">
        <div role="status">Verifying Session...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <AppShell key={user.uid}>{children}</AppShell>;
};

export default ProtectedRoute;
