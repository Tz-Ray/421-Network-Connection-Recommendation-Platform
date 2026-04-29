import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { Icon } from './Icon';

interface HeaderProps {
  onMenuToggle: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onMenuToggle }) => {
  const navigate = useNavigate();
  const [userName, setUserName] = useState('John Doe');
  const [userPosition, setUserPosition] = useState('No Position');
  const [userPhoto, setUserPhoto] = useState('https://lh3.googleusercontent.com/aida-public/AB6AXuBCXhFQNn8bjG3hECp_CaJj1ShQC3aagsQv9NVXWrcr_x_CuJ4gW58O4dOjAPL93dPNCv6AccCE8-5CuZ9x7VrZOa8TT1pfnkrWv4inmdhLwEcfDfvGu1RbdB9e5gMNDfPrPP4_ASJC5lqLaNEoERyOqr_lZ7cwwhn5WaIrUIPe-e9ZXAmJqWZXXnS-eT3OUSMboVGQiq85J3Fq1gwse3d4091Ft0DlUBwqqvnLDak2S1Z8U5jKkI20ycsILB2FaquiavgIVY0pYAQ');

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        // Set name from Auth
        if (user.displayName) {
          setUserName(user.displayName);
        }

        // Set photo from Auth
        if (user.photoURL) {
          setUserPhoto(user.photoURL);
        }

        // Fetch jobTitle from Firestore
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          const data = userDocSnap.data();
          if (data.jobTitle) {
            setUserPosition(data.jobTitle);
          }
        }
      } catch (err) {
        console.error('Error fetching header user data:', err);
      }
    };

    fetchUserData();
  }, []);

  const handleProfileClick = () => {
    navigate('/profile');
  };

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
          onClick={handleProfileClick}
          className="flex items-center gap-3 md:pl-2 cursor-pointer hover:opacity-80 transition-opacity active:scale-95 rounded-lg p-1"
        >
          <div className="text-right hidden sm:block">
            <p className="text-xs font-bold text-slate-200">{userName}</p>
            <p className="text-[10px] text-slate-500 uppercase font-medium">{userPosition}</p>
          </div>
          <img 
            src={userPhoto} 
            alt="Profile" 
            className="w-8 h-8 md:w-10 md:h-10 rounded-full border border-slate-700 object-cover shadow-sm" 
          />
        </div>
      </div>
    </header>
  );
};