import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import DashboardScreen from './screens/DashboardScreen';
import RecommenderScreen from './screens/RecommenderScreen';

const App: React.FC = () => {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/register" element={<RegisterScreen />} />
        <Route path="/dashboard" element={<DashboardScreen />} />
        <Route path="/recommender" element={<RecommenderScreen />} />
      </Routes>
    </HashRouter>
  );
};

export default App;