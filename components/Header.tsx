import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { Icon } from './Icon';
import { db } from '../firebase';
import { useAuth } from '../lib/AuthContext';

interface HeaderProps {
  onMenuToggle: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onMenuToggle }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [jobTitle, setJobTitle] = useState('');

  // Job title lives in the users/{uid} profile document (see ProfileScreen).
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) {
      setJobTitle('');
      return;
    }
    let active = true;
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (!active) return;
        const title = snap.exists() ? snap.data()?.jobTitle : '';
        setJobTitle(typeof title === 'string' ? title : '');
      } catch (err) {
        console.error('Error fetching header user data:', err);
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.uid]);

  const nameLine = user?.displayName || user?.email || 'Signed in';
  const subLine = jobTitle || (user?.displayName ? user?.email ?? '' : '');
  const initial = (nameLine.trim()[0] ?? '?').toUpperCase();

  return (
    <header className="sticky top-0 z-20 glass-panel h-16 flex items-center justify-between px-4 md:px-8 border-b border-slate-800">
      
      <div className="flex items-center flex-1 max-w-sm">
        <button 
          onClick={onMenuToggle}
          aria-label="Toggle Menu"
          className="md:hidden mr-3 w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white transition-all active:scale-95"
        >
          <Icon name="menu" />
        </button>
        
        <div className="flex-1 flex items-center bg-slate-800/50 px-3 md:px-4 py-1.5 rounded-lg border border-slate-700 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all duration-300 shadow-inner">
          <Icon name="search" className="text-slate-400 text-sm mr-2" />
          <input 
            type="text" 
            placeholder="Search..." 
            className="bg-transparent border-none focus:ring-0 text-sm w-full text-slate-200 placeholder:text-slate-500 outline-none" 
          />
        </div>
      </div>

      <div className="flex items-center gap-1 md:gap-4 ml-4">
        <button className="w-10 h-10 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-800 hover:text-white transition-colors active:scale-90">
          <Icon name="notifications" />
        </button>
        
        <div className="h-8 w-[1px] bg-slate-800 hidden md:block"></div>
        
        <div
          onClick={() => navigate('/profile')}
          className="flex items-center gap-3 md:pl-2 cursor-pointer hover:opacity-80 transition-opacity active:scale-95 rounded-lg p-1"
        >
          <div className="text-right hidden sm:block">
            <p className="text-xs font-bold text-slate-200">{nameLine}</p>
            <p className="text-[10px] text-slate-500 uppercase font-medium">{subLine}</p>
          </div>
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt="Profile"
              className="w-8 h-8 md:w-10 md:h-10 rounded-full border border-slate-700 object-cover shadow-sm"
            />
          ) : (
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-full border border-slate-700 object-cover shadow-sm bg-primary/20 text-primary font-bold flex items-center justify-center">
              {initial}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
