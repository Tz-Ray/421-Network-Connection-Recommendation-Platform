import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './lib/AuthContext';

interface PublicRouteProps {
  children: React.ReactElement;
}

const PublicRoute: React.FC<PublicRouteProps> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) return null;

  // If already logged in, skip the login/register screen
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

export default PublicRoute;
