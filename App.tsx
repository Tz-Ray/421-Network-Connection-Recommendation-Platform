import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import DashboardScreen from './screens/DashboardScreen';
import ProtectedRoute from './ProtectedRoute';
import PublicRoute from './PublicRoute';

const App: React.FC = () => {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        
        {/* Public Routes: Redirect to dashboard if already logged in */}
        <Route path="/login" element={<PublicRoute><LoginScreen /></PublicRoute>} />
        <Route path="/register" element={<PublicRoute><RegisterScreen /></PublicRoute>} />
        
        {/* Protected Route: Redirect to login if NOT logged in */}
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              <DashboardScreen />
            </ProtectedRoute>
          } 
        />
      </Routes>
    </HashRouter>
  );
};

export default App;