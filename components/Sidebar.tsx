import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon } from './Icon';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const location = useLocation();

  const navItems = [
    { name: 'Dashboard', icon: 'dashboard', path: '' },
    { name: 'Portfolio', icon: 'pie_chart', path: '' },
    { name: 'Pipeline', icon: 'account_tree', path: '' },
    { name: 'Insights', icon: 'auto_graph', path: '' },
    { name: 'Documents', icon: 'description', path: '' },
  ];

  return (
    <>
      {/* Mobile Overlay */}
      <div 
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden transition-opacity duration-300 ${isOpen ? 'opacity-100 visible' : 'opacity-0 invisible'}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sidebar Content */}
      <aside 
        className={`fixed md:static top-0 left-0 h-full w-64 glass-panel border-r border-slate-800 flex flex-col z-40 bg-[#101622]/95 md:bg-transparent transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        <div className="p-6 md:p-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
              <Icon name="insights" className="text-white text-2xl" />
            </div>
            <span className="font-extrabold text-xl tracking-tight text-white">App Name<span className="text-primary">.</span></span>
          </div>
          
          <button 
            onClick={onClose}
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-all active:scale-95"
            aria-label="Close menu"
          >
            <Icon name="close" />
          </button>
        </div>
        
        <nav className="flex-1 px-4 py-4 space-y-1.5 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.name}
                to={item.path}
                onClick={() => onClose()} // Close on mobile navigation
                className={`flex items-center px-4 py-3 rounded-lg transition-all duration-200 group active:scale-95 ${
                  isActive 
                    ? 'bg-primary/15 text-primary border-r-2 border-primary shadow-sm shadow-primary/5' 
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 hover:translate-x-1'
                }`}
              >
                <Icon 
                  name={item.icon} 
                  className={`mr-3 transition-colors ${isActive ? 'text-primary' : 'group-hover:text-primary/80'}`} 
                />
                <span className={`font-${isActive ? 'semibold' : 'medium'}`}>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 mt-auto mb-4">
          <div className="bg-primary/10 rounded-xl p-4 border border-primary/20 hover:border-primary/40 transition-colors cursor-pointer group">
            <p className="text-xs font-bold text-primary uppercase tracking-wider mb-1">Fund II Status</p>
            <div className="flex justify-between items-end mb-2">
              <span className="text-lg font-bold text-slate-100 group-hover:text-white transition-colors">84%</span>
              <span className="text-xs text-slate-400">Deployed</span>
            </div>
            <div className="w-full bg-primary/20 h-1.5 rounded-full overflow-hidden">
              <div className="bg-primary h-full rounded-full transition-all duration-1000 group-hover:brightness-125" style={{ width: '84%' }}></div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};