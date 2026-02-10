import React from 'react';
import { Icon } from './Icon';

interface HeaderProps {
  onMenuToggle: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onMenuToggle }) => {
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
        
        <div className="flex items-center gap-3 md:pl-2 cursor-pointer hover:opacity-80 transition-opacity active:scale-95 rounded-lg p-1">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-bold text-slate-200">John Doe</p>
            <p className="text-[10px] text-slate-500 uppercase font-medium">General Partner</p>
          </div>
          <img 
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuBCXhFQNn8bjG3hECp_CaJj1ShQC3aagsQv9NVXWrcr_x_CuJ4gW58O4dOjAPL93dPNCv6AccCE8-5CuZ9x7VrZOa8TT1pfnkrWv4inmdhLwEcfDfvGu1RbdB9e5gMNDfPrPP4_ASJC5lqLaNEoERyOqr_lZ7cwwhn5WaIrUIPe-e9ZXAmJqWZXXnS-eT3OUSMboVGQiq85J3Fq1gwse3d4091Ft0DlUBwqqvnLDak2S1Z8U5jKkI20ycsILB2FaquiavgIVY0pYAQ" 
            alt="Profile" 
            className="w-8 h-8 md:w-10 md:h-10 rounded-full border border-slate-700 object-cover shadow-sm" 
          />
        </div>
      </div>
    </header>
  );
};