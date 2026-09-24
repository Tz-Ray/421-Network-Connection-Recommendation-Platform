import React from 'react';
import { Navigate } from 'react-router-dom';
import ChatWidget from './components/ChatWidget';
import { AI_DISABLED } from './lib/proxyClient';
import { useAuth } from './lib/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactElement;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background-dark">
        <div className="text-primary animate-pulse">Verifying Session...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <>
      {children}
      {!AI_DISABLED && <ChatWidget />}
    </>
  );
};

export default ProtectedRoute;
